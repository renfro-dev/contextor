#!/usr/bin/env node
import express from 'express';
import dotenv from 'dotenv';
import * as fireflies from './services/fireflies.js';
import * as taskExtractor from './services/task-extractor.js';
import * as planner from './services/planner.js';
import * as teams from './services/teams.js';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const app = express();
// Replit uses PORT, fallback to WEBHOOK_PORT or 3000
const PORT: number = Number(process.env.PORT || process.env.WEBHOOK_PORT || 3000);
const STATE_DIR = path.join(process.cwd(), '.state');
const PROCESSED_FILE = path.join(STATE_DIR, 'processed-meetings.json');

// Middleware
app.use(express.json());

// Simple logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

/**
 * Load processed meetings from state file
 */
function loadProcessedMeetings(): Set<string> {
  try {
    if (!fs.existsSync(PROCESSED_FILE)) {
      return new Set();
    }
    const data = fs.readFileSync(PROCESSED_FILE, 'utf-8');
    const meetingIds = JSON.parse(data);
    return new Set(meetingIds);
  } catch (error) {
    console.error('[Server] Error loading processed meetings:', error);
    return new Set();
  }
}

/**
 * Save processed meetings to state file
 */
function saveProcessedMeetings(meetings: Set<string>): void {
  try {
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
    fs.writeFileSync(PROCESSED_FILE, JSON.stringify([...meetings], null, 2));
  } catch (error) {
    console.error('[Server] Error saving processed meetings:', error);
  }
}

/**
 * Process a Fireflies meeting
 */
async function processMeeting(meetingId: string, meetingTitle?: string) {
  const processedMeetings = loadProcessedMeetings();

  // Check if already processed
  if (processedMeetings.has(meetingId)) {
    console.log(`[Server] Meeting ${meetingId} already processed, skipping`);
    return { success: true, message: 'Already processed' };
  }

  console.log(`\n🚀 Processing meeting: ${meetingId}`);
  console.log('=' .repeat(60));

  try {
    // Step 1: Get meeting summary
    console.log('\n📋 Step 1: Fetching meeting summary from Fireflies...');
    const meetingSummary = await fireflies.getMeetingSummaryForExtraction(meetingId);
    console.log(`   ✓ Retrieved meeting summary (${meetingSummary.length} characters)`);

    // Step 2: Extract tasks with Claude
    console.log('\n🤖 Step 2: Analyzing content with Claude API...');
    const tasks = await taskExtractor.extractTasks(meetingSummary);
    console.log(`   ✓ Identified ${tasks.length} actionable tasks`);

    if (tasks.length === 0) {
      console.log('   ℹ️  No tasks found in meeting, skipping');
      processedMeetings.add(meetingId);
      saveProcessedMeetings(processedMeetings);
      return { success: true, message: 'No tasks found' };
    }

    // Step 3: Create tasks in Planner
    console.log('\n📝 Step 3: Creating tasks in Microsoft Planner...');
    const planId = process.env.PLANNER_PLAN_ID;
    if (!planId) {
      throw new Error('PLANNER_PLAN_ID not configured');
    }
    const plannerTasks = await planner.createTasksInPlanner(planId, tasks);
    console.log(`   ✓ Created ${plannerTasks.length} tasks in Planner`);

    // Step 4: Find Teams channel
    console.log('\n💬 Step 4: Finding Teams channel...');
    const teamName = process.env.TEAMS_TEAM_NAME;
    const channelName = process.env.TEAMS_CHANNEL_NAME || 'ClickUp Task Orchestrator';
    if (!teamName) {
      throw new Error('TEAMS_TEAM_NAME not configured');
    }
    const channel = await teams.findChannelByName(teamName, channelName);
    console.log(`   ✓ Found channel: ${channel.channelName} in team ${channel.teamName}`);

    // Step 5: Get meeting title if not provided
    if (!meetingTitle) {
      const meetings = await fireflies.listRecentMeetings(50);
      const meeting = meetings.find(m => m.id === meetingId);
      meetingTitle = meeting ? meeting.title : 'Unknown Meeting';
    }

    // Step 6: Create session
    console.log('\n🎫 Step 5: Creating approval session...');
    const sessionId = await teams.createSession(
      meetingId,
      meetingTitle,
      channel.teamId,
      channel.channelId
    );
    console.log(`   ✓ Created session: ${sessionId}`);

    // Step 7: Post tasks to Teams
    console.log('\n📤 Step 6: Posting tasks to Teams...');
    for (const task of plannerTasks) {
      try {
        const messageId = await teams.postTaskToChannel(
          channel.teamId,
          channel.channelId,
          task
        );
        await teams.addTaskToSession(sessionId, task, messageId);
        console.log(`   ✓ Posted: ${task.title}`);
      } catch (error) {
        console.error(`   ✗ Failed to post: ${task.title}`, error);
      }
    }

    // Mark as processed
    processedMeetings.add(meetingId);
    saveProcessedMeetings(processedMeetings);

    console.log('\n✅ Complete!');
    console.log(`📋 Session ID: ${sessionId}`);
    console.log(`📍 Channel: ${channel.teamName} > ${channel.channelName}`);
    console.log(`📝 Tasks posted: ${plannerTasks.length}`);
    console.log('\n👉 Team members can now approve tasks in Teams with 👍');
    console.log(`👉 Run check-approvals later: npm run dev -- check-approvals --session-id ${sessionId}`);
    console.log('=' .repeat(60));

    return {
      success: true,
      sessionId,
      tasksPosted: plannerTasks.length,
      message: 'Tasks posted to Teams for approval'
    };

  } catch (error) {
    console.error('\n❌ Error processing meeting:', error);
    throw error;
  } finally {
    // Clean up MCP clients
    await planner.closeMCPClient();
    await teams.closeMCPClient();
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Fireflies webhook endpoint
app.post('/webhook/fireflies', async (req, res) => {
  try {
    console.log('\n📨 Received Fireflies webhook');
    console.log('Payload:', JSON.stringify(req.body, null, 2));

    const { transcript_id, title, event_type } = req.body;

    // Fireflies sends transcript_id as the meeting ID
    const meetingId = transcript_id;

    if (!meetingId) {
      console.error('❌ No transcript_id in webhook payload');
      return res.status(400).json({ error: 'Missing transcript_id' });
    }

    // Only process if it's a transcript completion event
    if (event_type && event_type !== 'transcript_ready') {
      console.log(`ℹ️  Skipping event type: ${event_type}`);
      return res.json({ message: 'Event type not processed', event_type });
    }

    // Respond immediately to avoid timeout
    res.status(202).json({
      message: 'Webhook received, processing meeting',
      meetingId
    });

    // Process meeting asynchronously
    processMeeting(meetingId, title).catch(error => {
      console.error('❌ Error processing meeting:', error);
    });

  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Manual trigger endpoint (for testing)
app.post('/trigger/:meetingId', async (req, res) => {
  const { meetingId } = req.params;

  try {
    console.log(`\n🔧 Manual trigger for meeting: ${meetingId}`);

    // Respond immediately
    res.status(202).json({
      message: 'Processing meeting',
      meetingId
    });

    // Process meeting asynchronously
    const result = await processMeeting(meetingId);
    console.log('✅ Manual trigger completed:', result);

  } catch (error) {
    console.error('❌ Manual trigger error:', error);
  }
});

// Start server (bind to 0.0.0.0 for Replit/cloud compatibility)
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 Fireflies Webhook Server Started');
  console.log('='.repeat(60));
  console.log(`\n📡 Listening on port: ${PORT}`);

  // Show appropriate URL based on environment
  const isReplit = process.env.REPL_SLUG && process.env.REPL_OWNER;
  if (isReplit) {
    const replitUrl = `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
    console.log(`\n🌐 Public URL: ${replitUrl}`);
    console.log(`📍 Webhook endpoint: ${replitUrl}/webhook/fireflies`);
    console.log(`🔧 Manual trigger: POST ${replitUrl}/trigger/:meetingId`);
    console.log(`💚 Health check: ${replitUrl}/health`);
  } else {
    console.log(`\n📍 Webhook endpoint: http://localhost:${PORT}/webhook/fireflies`);
    console.log(`🔧 Manual trigger: POST http://localhost:${PORT}/trigger/:meetingId`);
    console.log(`💚 Health check: http://localhost:${PORT}/health`);
    console.log('\n💡 To test locally with Fireflies webhooks:');
    console.log('   1. Install ngrok: https://ngrok.com/download');
    console.log('   2. Run: ngrok http ' + PORT);
    console.log('   3. Copy the https:// URL from ngrok');
    console.log('   4. Add webhook in Fireflies: Settings → Integrations → Webhooks');
    console.log(`   5. Set webhook URL to: https://YOUR_NGROK_URL/webhook/fireflies`);
  }

  console.log('\n' + '='.repeat(60) + '\n');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await planner.closeMCPClient();
  await teams.closeMCPClient();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await planner.closeMCPClient();
  await teams.closeMCPClient();
  process.exit(0);
});

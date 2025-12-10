---
paths: src/server.ts
---

# Webhook Server Development

## Server Setup

### Express Configuration

```typescript
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || process.env.WEBHOOK_PORT || 3000;

// Middleware
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});
```

### Cloud Compatibility

**CRITICAL**: Bind to `0.0.0.0` (not `localhost`) for cloud deployment:

```typescript
// Correct - works on Replit, CloudRun, etc.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Listening on port: ${PORT}`);
});

// Incorrect - only works locally
app.listen(PORT, () => { ... });
```

### Port Configuration

Priority order:
1. `process.env.PORT` (Replit, CloudRun)
2. `process.env.WEBHOOK_PORT` (custom .env)
3. `3000` (default fallback)

## Webhook Endpoint Pattern

### Immediate Response (202 Accepted)

Always respond immediately to avoid timeout:

```typescript
app.post('/webhook/fireflies', async (req, res) => {
  const { transcript_id, title } = req.body;

  // Respond immediately (avoid timeout)
  res.status(202).json({
    message: 'Webhook received, processing meeting',
    meetingId: transcript_id
  });

  // Process asynchronously
  processMeeting(transcript_id, title).catch(error => {
    console.error('❌ Error processing meeting:', error);
  });
});
```

**Why 202?**
- Fireflies webhook times out after ~30 seconds
- Processing can take 1-2 minutes
- 202 = "Accepted, processing asynchronously"

### Error Handling in Webhook

```typescript
try {
  // Validate payload
  if (!transcript_id) {
    return res.status(400).json({ error: 'Missing transcript_id' });
  }

  // Respond immediately
  res.status(202).json({ ... });

  // Process asynchronously (catch errors separately)
  processMeeting(transcript_id).catch(error => {
    console.error('Processing error:', error);
  });

} catch (error) {
  console.error('Webhook error:', error);
  res.status(500).json({ error: 'Internal server error' });
}
```

## Duplicate Prevention

### Processed Meetings Tracking

```typescript
const STATE_DIR = path.join(process.cwd(), '.state');
const PROCESSED_FILE = path.join(STATE_DIR, 'processed-meetings.json');

function loadProcessedMeetings(): Set<string> {
  try {
    if (!fs.existsSync(PROCESSED_FILE)) {
      return new Set();
    }
    const data = fs.readFileSync(PROCESSED_FILE, 'utf-8');
    return new Set(JSON.parse(data));
  } catch (error) {
    console.error('[Server] Error loading processed meetings:', error);
    return new Set();
  }
}

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

async function processMeeting(meetingId: string) {
  const processedMeetings = loadProcessedMeetings();

  // Check if already processed
  if (processedMeetings.has(meetingId)) {
    console.log(`[Server] Meeting ${meetingId} already processed, skipping`);
    return { success: true, message: 'Already processed' };
  }

  // Process meeting...

  // Mark as processed
  processedMeetings.add(meetingId);
  saveProcessedMeetings(processedMeetings);
}
```

## Environment Detection

### Replit Detection

```typescript
const isReplit = process.env.REPL_SLUG && process.env.REPL_OWNER;

if (isReplit) {
  const replitUrl = `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
  console.log(`🌐 Public URL: ${replitUrl}`);
  console.log(`📍 Webhook endpoint: ${replitUrl}/webhook/fireflies`);
} else {
  console.log(`📍 Webhook endpoint: http://localhost:${PORT}/webhook/fireflies`);
  console.log('💡 To test locally with Fireflies webhooks:');
  console.log('   1. Install ngrok: https://ngrok.com/download');
  console.log('   2. Run: ngrok http ' + PORT);
}
```

## Endpoints

### Health Check

```typescript
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});
```

### Fireflies Webhook

```typescript
app.post('/webhook/fireflies', async (req, res) => {
  const { transcript_id, title, event_type } = req.body;

  // Only process transcript_ready events
  if (event_type && event_type !== 'transcript_ready') {
    return res.json({ message: 'Event type not processed', event_type });
  }

  // Respond immediately
  res.status(202).json({ message: 'Processing', meetingId: transcript_id });

  // Process asynchronously
  processMeeting(transcript_id, title).catch(error => {
    console.error('Error:', error);
  });
});
```

### Manual Trigger (Testing)

```typescript
app.post('/trigger/:meetingId', async (req, res) => {
  const { meetingId } = req.params;

  // Respond immediately
  res.status(202).json({ message: 'Processing meeting', meetingId });

  // Process
  const result = await processMeeting(meetingId);
  console.log('✅ Manual trigger completed:', result);
});
```

**Testing**:
```bash
curl -X POST http://localhost:3000/trigger/01KBR8ZMVYFHKG1BFS6D523E7K
```

## Graceful Shutdown

### Cleanup on Shutdown

```typescript
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
```

## Logging Best Practices

### Structured Logging

```typescript
console.log('\n🚀 Processing meeting: ' + meetingId);
console.log('='.repeat(60));

console.log('\n📋 Step 1: Fetching meeting summary from Fireflies...');
console.log('   ✓ Retrieved meeting summary (X characters)');

console.log('\n🤖 Step 2: Analyzing content with Claude API...');
console.log('   ✓ Identified N actionable tasks');

console.log('\n✅ Complete!');
console.log('='.repeat(60));
```

### Emoji Guide

- 🚀 - Starting process
- 📋 - Fetching/reading data
- 🤖 - AI processing
- 📝 - Creating tasks
- 💬 - Teams operations
- 📤 - Posting/sending
- ✅ - Success
- ❌ - Error
- 🛑 - Shutdown
- 🌐 - URL/network
- 📍 - Location/endpoint
- 💚 - Health check
- 🔧 - Manual/debug

## Testing

### Local Development

```bash
npm run server  # Start server with tsx
```

### Test with curl

```bash
# Health check
curl http://localhost:3000/health

# Manual trigger
curl -X POST http://localhost:3000/trigger/MEETING_ID
```

### Test with ngrok (for Fireflies)

```bash
# In terminal 1
npm run server

# In terminal 2
ngrok http 3000

# Copy https URL from ngrok
# Add to Fireflies: Settings → Integrations → Webhooks
# URL: https://abc123.ngrok.io/webhook/fireflies
```

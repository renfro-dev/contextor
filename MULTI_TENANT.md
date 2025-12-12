# Multi-Tenant Architecture Guide

**Status**: Future Enhancement (Not Implemented)
**Created**: 2025-12-12
**Purpose**: Reference document for converting single-user system to multi-tenant

## Current Architecture (Single-User)

The system currently uses environment variables for a single team configuration:

- `PLANNER_PLAN_ID` - Single Planner plan
- `TEAMS_TEAM_NAME` / `TEAMS_CHANNEL_NAME` - Single Teams channel
- `CLICKUP_LIST_ID` / `CLICKUP_TEAM_ID` - Single ClickUp workspace
- State files in `.state/` (not team-specific)

**Problem**: When multiple users/teams use the system:
- User A's meeting posts to User B's Teams channel
- No way to route meetings to correct team/workspace
- State collisions between teams

## Multi-Tenant Design

### Core Concept

**Meeting → Team Resolver → Team-Specific Configuration**

1. Fireflies webhook receives meeting
2. System fetches meeting organizer/attendees
3. Resolver maps organizer/attendees to team configuration
4. Processing uses team-specific Plan/Teams/ClickUp IDs
5. State stored per-team

## Implementation Plan

### Phase 1: Configuration System

**Create**: `config/teams.json`

```json
{
  "teams": {
    "revops": {
      "name": "RevOps",
      "members": ["jrenfro@cageandmiles.com", "user2@cageandmiles.com"],
      "planner_plan_id": "xuZZE-4NM0ud-lvUf-zruGQAGyIp",
      "teams_team_name": "RevOps",
      "teams_channel_name": "Clickup Task Orchestrator",
      "clickup_list_id": "901103514767",
      "clickup_team_id": "42044915"
    },
    "sales": {
      "name": "Sales Team",
      "members": ["sales1@cageandmiles.com", "sales2@cageandmiles.com"],
      "planner_plan_id": "abc123-sales-plan-id",
      "teams_team_name": "Sales",
      "teams_channel_name": "Task Approval",
      "clickup_list_id": "987654321",
      "clickup_team_id": "11111111"
    },
    "engineering": {
      "name": "Engineering",
      "members": ["dev1@cageandmiles.com", "dev2@cageandmiles.com"],
      "planner_plan_id": "xyz789-eng-plan-id",
      "teams_team_name": "Engineering",
      "teams_channel_name": "Sprint Tasks",
      "clickup_list_id": "555555555",
      "clickup_team_id": "22222222"
    }
  },
  "default_team": "revops"
}
```

**TypeScript Interface**: Update `src/types.ts`

```typescript
export interface TeamConfig {
  name: string;
  members: string[];
  planner_plan_id: string;
  teams_team_name: string;
  teams_channel_name: string;
  clickup_list_id: string;
  clickup_team_id: string;
}

export interface TeamsConfigFile {
  teams: { [key: string]: TeamConfig };
  default_team: string;
}
```

### Phase 2: Team Resolver Service

**Create**: `src/services/team-resolver.ts`

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as fireflies from './fireflies.js';
import type { TeamConfig, TeamsConfigFile } from '../types.js';

const CONFIG_PATH = path.join(process.cwd(), 'config', 'teams.json');

/**
 * Load team configuration from file
 */
export function loadTeamsConfig(): TeamsConfigFile {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error('Teams configuration not found: config/teams.json');
  }

  const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(data);
}

/**
 * Get team configuration by key
 */
export function getTeamConfig(teamKey: string): TeamConfig | null {
  const config = loadTeamsConfig();
  return config.teams[teamKey] || null;
}

/**
 * Get default team configuration
 */
export function getDefaultTeam(): TeamConfig {
  const config = loadTeamsConfig();
  const defaultKey = config.default_team;
  const team = config.teams[defaultKey];

  if (!team) {
    throw new Error(`Default team "${defaultKey}" not found in configuration`);
  }

  return team;
}

/**
 * Resolve which team a meeting belongs to based on organizer/attendees
 *
 * Resolution order:
 * 1. Check if organizer is a team member
 * 2. Check if any attendee is a team member (by majority)
 * 3. Fall back to default team
 */
export async function resolveTeamForMeeting(meetingId: string): Promise<TeamConfig> {
  const config = loadTeamsConfig();

  console.log('[TeamResolver] Resolving team for meeting:', meetingId);

  try {
    // Get meeting details including organizer/attendees
    const meetingDetails = await fireflies.getMeetingDetails(meetingId);
    const organizerEmail = meetingDetails.organizer_email;
    const attendees = meetingDetails.attendees || [];

    console.log('[TeamResolver] Organizer:', organizerEmail);
    console.log('[TeamResolver] Attendees:', attendees);

    // Strategy 1: Find team where organizer is a member
    for (const [teamKey, teamConfig] of Object.entries(config.teams)) {
      if (teamConfig.members.includes(organizerEmail)) {
        console.log(`[TeamResolver] Resolved via organizer: ${teamConfig.name}`);
        return teamConfig;
      }
    }

    // Strategy 2: Find team with most attendee matches
    let bestMatch: { team: TeamConfig; count: number } | null = null;

    for (const [teamKey, teamConfig] of Object.entries(config.teams)) {
      const matchCount = attendees.filter(email =>
        teamConfig.members.includes(email)
      ).length;

      if (matchCount > 0 && (!bestMatch || matchCount > bestMatch.count)) {
        bestMatch = { team: teamConfig, count: matchCount };
      }
    }

    if (bestMatch) {
      console.log(`[TeamResolver] Resolved via attendees (${bestMatch.count} matches): ${bestMatch.team.name}`);
      return bestMatch.team;
    }

    // Strategy 3: Fall back to default team
    console.log('[TeamResolver] No matches found, using default team');
    return getDefaultTeam();

  } catch (error) {
    console.error('[TeamResolver] Error resolving team:', error);
    console.log('[TeamResolver] Falling back to default team');
    return getDefaultTeam();
  }
}

/**
 * List all configured teams
 */
export function listTeams(): TeamConfig[] {
  const config = loadTeamsConfig();
  return Object.values(config.teams);
}
```

### Phase 3: Enhanced Fireflies Service

**Extract inline code to**: `src/services/fireflies.ts`

Add new function:

```typescript
/**
 * Get meeting details including organizer and attendees
 */
export async function getMeetingDetails(meetingId: string): Promise<{
  id: string;
  title: string;
  organizer_email: string;
  attendees: string[];
  date: Date;
}> {
  const query = `
    query GetMeeting($meetingId: String!) {
      transcript(id: $meetingId) {
        id
        title
        organizer_email
        date
        participants {
          email
        }
      }
    }
  `;

  const response = await fetch('https://api.fireflies.ai/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.FIREFLIES_API_KEY}`
    },
    body: JSON.stringify({
      query,
      variables: { meetingId }
    })
  });

  if (!response.ok) {
    throw new Error(`Fireflies API error: ${response.statusText}`);
  }

  const result = await response.json();

  if (result.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(result.errors)}`);
  }

  const transcript = result.data.transcript;

  return {
    id: transcript.id,
    title: transcript.title,
    organizer_email: transcript.organizer_email || 'unknown@example.com',
    attendees: transcript.participants?.map((p: any) => p.email).filter(Boolean) || [],
    date: new Date(transcript.date)
  };
}
```

**Note**: Check Fireflies API docs to verify exact field names:
- `organizer_email` might be `organizer` or `host_email`
- `participants` might return different structure

### Phase 4: Per-Team State Management

**Update**: `src/services/teams.ts`

Add helper functions:

```typescript
import type { TeamConfig } from '../types.js';

/**
 * Get state directory for a specific team
 */
function getTeamStateDir(teamConfig: TeamConfig): string {
  const teamSlug = teamConfig.name.toLowerCase().replace(/\s+/g, '-');
  const teamDir = path.join(STATE_DIR, teamSlug);

  if (!fs.existsSync(teamDir)) {
    fs.mkdirSync(teamDir, { recursive: true });
  }

  return teamDir;
}

/**
 * Get state file path for a team
 */
function getTeamStatePath(teamConfig: TeamConfig, filename: string): string {
  const teamDir = getTeamStateDir(teamConfig);
  return path.join(teamDir, filename);
}

/**
 * Load state for a specific team
 */
export async function loadState(teamConfig: TeamConfig): Promise<TeamsApprovalState> {
  const stateFile = getTeamStatePath(teamConfig, 'teams-approval.json');

  try {
    if (!fs.existsSync(stateFile)) {
      return { version: '1.0.0', sessions: {} };
    }

    const data = await fs.promises.readFile(stateFile, 'utf-8');
    const state = JSON.parse(data);

    if (state.version !== '1.0.0') {
      console.warn(`[Teams] Warning: State file has incompatible version for team ${teamConfig.name}`);
      await fs.promises.copyFile(stateFile, `${stateFile}.backup.${Date.now()}`);
      return { version: '1.0.0', sessions: {} };
    }

    return state;
  } catch (error) {
    console.error(`[Teams] Error loading state for team ${teamConfig.name}:`, error);
    return { version: '1.0.0', sessions: {} };
  }
}

/**
 * Save state for a specific team
 */
export async function saveState(
  state: TeamsApprovalState,
  teamConfig: TeamConfig
): Promise<void> {
  const stateFile = getTeamStatePath(teamConfig, 'teams-approval.json');

  try {
    await fs.promises.writeFile(stateFile, JSON.stringify(state, null, 2), 'utf-8');
  } catch (error) {
    console.error(`[Teams] Error saving state for team ${teamConfig.name}:`, error);
    throw error;
  }
}

/**
 * Create a new session for a team
 */
export async function createSession(
  meetingId: string,
  meetingTitle: string,
  teamId: string,
  channelId: string,
  teamConfig: TeamConfig
): Promise<string> {
  const state = await loadState(teamConfig);
  const sessionId = `${meetingId}-${Date.now()}`;

  state.sessions[sessionId] = {
    sessionId,
    meetingId,
    meetingTitle,
    createdAt: new Date().toISOString(),
    teamId,
    channelId,
    tasks: {}
  };

  await saveState(state, teamConfig);
  return sessionId;
}

// Update all other state functions to accept teamConfig parameter
```

**Update**: `src/server.ts` for per-team processed meetings:

```typescript
/**
 * Load processed meetings for a specific team
 */
function loadProcessedMeetings(teamConfig: TeamConfig): Set<string> {
  const teamSlug = teamConfig.name.toLowerCase().replace(/\s+/g, '-');
  const teamStateDir = path.join(STATE_DIR, teamSlug);
  const processedFile = path.join(teamStateDir, 'processed-meetings.json');

  try {
    if (!fs.existsSync(processedFile)) {
      return new Set();
    }
    const data = fs.readFileSync(processedFile, 'utf-8');
    return new Set(JSON.parse(data));
  } catch (error) {
    console.error(`[Server] Error loading processed meetings for ${teamConfig.name}:`, error);
    return new Set();
  }
}

/**
 * Save processed meetings for a specific team
 */
function saveProcessedMeetings(teamConfig: TeamConfig, meetings: Set<string>): void {
  const teamSlug = teamConfig.name.toLowerCase().replace(/\s+/g, '-');
  const teamStateDir = path.join(STATE_DIR, teamSlug);

  if (!fs.existsSync(teamStateDir)) {
    fs.mkdirSync(teamStateDir, { recursive: true });
  }

  const processedFile = path.join(teamStateDir, 'processed-meetings.json');

  try {
    fs.writeFileSync(processedFile, JSON.stringify([...meetings], null, 2));
  } catch (error) {
    console.error(`[Server] Error saving processed meetings for ${teamConfig.name}:`, error);
  }
}
```

### Phase 5: Updated Server Processing

**Update**: `src/server.ts` `processMeeting()` function:

```typescript
import * as teamResolver from './services/team-resolver.js';

async function processMeeting(meetingId: string, meetingTitle?: string) {
  console.log(`\n🚀 Processing meeting: ${meetingId}`);
  console.log('=' .repeat(60));

  try {
    // STEP 1: Resolve team for this meeting
    console.log('\n🔍 Step 1: Resolving team configuration...');
    const teamConfig = await teamResolver.resolveTeamForMeeting(meetingId);
    console.log(`   ✓ Resolved to team: ${teamConfig.name}`);
    console.log(`   → Planner Plan: ${teamConfig.planner_plan_id}`);
    console.log(`   → Teams Channel: ${teamConfig.teams_team_name} > ${teamConfig.teams_channel_name}`);
    console.log(`   → ClickUp List: ${teamConfig.clickup_list_id}`);

    // STEP 2: Check if already processed (per-team)
    const processedMeetings = loadProcessedMeetings(teamConfig);
    if (processedMeetings.has(meetingId)) {
      console.log(`\n   ℹ️  Meeting already processed for team "${teamConfig.name}", skipping`);
      return { success: true, message: 'Already processed', team: teamConfig.name };
    }

    // STEP 3: Get meeting summary
    console.log('\n📋 Step 2: Fetching meeting summary from Fireflies...');
    const meetingSummary = await fireflies.getMeetingSummaryForExtraction(meetingId);
    console.log(`   ✓ Retrieved meeting summary (${meetingSummary.length} characters)`);

    // STEP 4: Extract tasks with Claude
    console.log('\n🤖 Step 3: Analyzing content with Claude API...');
    const tasks = await taskExtractor.extractTasks(meetingSummary);
    console.log(`   ✓ Identified ${tasks.length} actionable tasks`);

    if (tasks.length === 0) {
      console.log('   ℹ️  No tasks found in meeting, skipping');
      processedMeetings.add(meetingId);
      saveProcessedMeetings(teamConfig, processedMeetings);
      return { success: true, message: 'No tasks found', team: teamConfig.name };
    }

    // STEP 5: Create tasks in Planner (team-specific plan)
    console.log('\n📝 Step 4: Creating tasks in Microsoft Planner...');
    console.log(`   → Using plan: ${teamConfig.planner_plan_id}`);
    const plannerTasks = await planner.createTasksInPlanner(
      teamConfig.planner_plan_id,  // Team-specific!
      tasks
    );
    console.log(`   ✓ Created ${plannerTasks.length} tasks in Planner`);

    // STEP 6: Find Teams channel (team-specific)
    console.log('\n💬 Step 5: Finding Teams channel...');
    const channel = await teams.findChannelByName(
      teamConfig.teams_team_name,      // Team-specific!
      teamConfig.teams_channel_name    // Team-specific!
    );
    console.log(`   ✓ Found channel: ${channel.channelName} in team ${channel.teamName}`);

    // STEP 7: Get meeting title if not provided
    if (!meetingTitle) {
      const meetingDetails = await fireflies.getMeetingDetails(meetingId);
      meetingTitle = meetingDetails.title;
    }

    // STEP 8: Create session (per-team state)
    console.log('\n🎫 Step 6: Creating approval session...');
    const sessionId = await teams.createSession(
      meetingId,
      meetingTitle,
      channel.teamId,
      channel.channelId,
      teamConfig  // Pass team config!
    );
    console.log(`   ✓ Created session: ${sessionId}`);

    // STEP 9: Post tasks to Teams
    console.log('\n📤 Step 7: Posting tasks to Teams...');
    for (const task of plannerTasks) {
      try {
        const messageId = await teams.postTaskToChannel(
          channel.teamId,
          channel.channelId,
          task
        );
        await teams.addTaskToSession(sessionId, task, messageId, teamConfig);
        console.log(`   ✓ Posted: ${task.title}`);
      } catch (error) {
        console.error(`   ✗ Failed to post: ${task.title}`, error);
      }
    }

    // Mark as processed (per-team)
    processedMeetings.add(meetingId);
    saveProcessedMeetings(teamConfig, processedMeetings);

    console.log('\n✅ Complete!');
    console.log(`📋 Session ID: ${sessionId}`);
    console.log(`👥 Team: ${teamConfig.name}`);
    console.log(`📍 Channel: ${channel.teamName} > ${channel.channelName}`);
    console.log(`📝 Tasks posted: ${plannerTasks.length}`);
    console.log('\n👉 Team members can now approve tasks in Teams with 👍');
    console.log(`👉 Run check-approvals later: npm run dev -- check-approvals --session-id ${sessionId}`);
    console.log('=' .repeat(60));

    return {
      success: true,
      sessionId,
      team: teamConfig.name,
      tasksPosted: plannerTasks.length,
      message: 'Tasks posted to Teams for approval'
    };

  } catch (error) {
    console.error('\n❌ Error processing meeting:', error);
    throw error;
  } finally {
    await planner.closeMCPClient();
    await teams.closeMCPClient();
  }
}
```

### Phase 6: CLI Updates

**Update**: `src/index.ts` commands to support team selection

Add team selection to `post-to-teams` command:

```typescript
program
  .command('post-to-teams')
  .description('Post Planner tasks to Teams for approval')
  .option('--meeting-id <id>', 'Specific Fireflies meeting ID to process')
  .option('--team <key>', 'Team key (e.g., "revops", "sales") - auto-resolves if not specified')
  .action(async (options) => {
    try {
      let teamConfig: TeamConfig;

      // If team specified, use it
      if (options.team) {
        teamConfig = teamResolver.getTeamConfig(options.team);
        if (!teamConfig) {
          console.error(`Error: Team "${options.team}" not found in configuration`);
          process.exit(1);
        }
      } else if (options.meetingId) {
        // Auto-resolve team from meeting
        teamConfig = await teamResolver.resolveTeamForMeeting(options.meetingId);
      } else {
        // Use default team
        teamConfig = teamResolver.getDefaultTeam();
      }

      console.log(`\n👥 Using team: ${teamConfig.name}`);

      // Rest of command logic...
      // Use teamConfig.planner_plan_id, teamConfig.teams_team_name, etc.

    } catch (error) {
      console.error('\n❌ Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });
```

Add team parameter to `check-approvals`:

```typescript
program
  .command('check-approvals')
  .description('Check Teams approvals and create ClickUp tasks')
  .option('--session-id <id>', 'Specific session ID to check')
  .option('--team <key>', 'Team key (required if session-id not provided)')
  .action(async (options) => {
    try {
      let teamConfig: TeamConfig;

      if (options.sessionId) {
        // Extract team from session ID or require --team flag
        if (!options.team) {
          console.error('Error: --team flag required when using --session-id');
          process.exit(1);
        }
        teamConfig = teamResolver.getTeamConfig(options.team);
        if (!teamConfig) {
          console.error(`Error: Team "${options.team}" not found`);
          process.exit(1);
        }
      } else {
        // Use default team
        teamConfig = teamResolver.getDefaultTeam();
      }

      console.log(`\n👥 Checking approvals for team: ${teamConfig.name}`);

      // Load team-specific state
      const approvedTasks = await teams.checkApprovals(options.sessionId, teamConfig);

      // Create in team-specific ClickUp list
      for (const task of approvedTasks) {
        const clickupTasks = await clickup.createTasksInClickUp(
          teamConfig.clickup_list_id,  // Team-specific!
          [task]
        );
        // ...
      }

    } catch (error) {
      console.error('\n❌ Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });
```

Add new command to list teams:

```typescript
program
  .command('list-teams')
  .description('List all configured teams')
  .action(() => {
    const teams = teamResolver.listTeams();
    const config = teamResolver.loadTeamsConfig();

    console.log('\n📋 Configured Teams:\n');

    teams.forEach(team => {
      const isDefault = team.name === config.teams[config.default_team].name;
      console.log(`${isDefault ? '⭐' : '  '} ${team.name}`);
      console.log(`   Members: ${team.members.length}`);
      console.log(`   Teams Channel: ${team.teams_team_name} > ${team.teams_channel_name}`);
      console.log(`   ClickUp List: ${team.clickup_list_id}`);
      console.log('');
    });
  });
```

### Phase 7: Authentication Strategy

**Option A: Single Service Account (Recommended)**

Use one MS365 account that has access to all Teams channels:

1. Create service account: `orchestrator@cageandmiles.com`
2. Add to all relevant Teams as member
3. Authenticate once: `npx -y @softeria/ms-365-mcp-server --org-mode --login`
4. Service account creates tasks in all team Planners and posts to all channels

**Pros**:
- Simple authentication
- Single token to manage
- Easy to set up

**Cons**:
- Service account needs to be added to all teams manually
- All tasks appear to come from service account

**Option B: Per-Team Authentication (Complex)**

Store separate auth tokens per team:

```typescript
// Per-team token storage
const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', '@softeria/ms-365-mcp-server', '--org-mode'],
  env: {
    MS365_TOKEN_PATH: `~/.ms365-mcp-server/tokens-${teamSlug}/`
  }
});
```

**Pros**:
- Tasks appear from correct team member
- Better security isolation

**Cons**:
- Complex token management
- Each team needs to authenticate
- Token refresh complexity

**Recommendation**: Start with Option A (service account).

## State Directory Structure

After multi-tenant implementation:

```
.state/
├── revops/
│   ├── processed-meetings.json
│   └── teams-approval.json
├── sales/
│   ├── processed-meetings.json
│   └── teams-approval.json
└── engineering/
    ├── processed-meetings.json
    └── teams-approval.json
```

## Migration Steps

### Step 1: Backup Current State

```bash
cp -r .state .state.backup.$(date +%Y%m%d)
```

### Step 2: Create Configuration

```bash
mkdir -p config
# Create config/teams.json with current team as default
```

### Step 3: Implement Team Resolver

- Create `src/services/team-resolver.ts`
- Add `getMeetingDetails()` to Fireflies service
- Test team resolution logic

### Step 4: Update State Management

- Modify `src/services/teams.ts` to use per-team state
- Migrate existing state to default team directory
- Test state read/write

### Step 5: Update Server

- Modify `processMeeting()` to use team resolver
- Test with webhook
- Verify correct team routing

### Step 6: Update CLI

- Add team parameters to commands
- Test manual workflows
- Add `list-teams` command

### Step 7: Testing

- Create test team in configuration
- Add test users
- Trigger test meeting
- Verify routing to correct team

### Step 8: Rollout

- Add real teams one at a time
- Verify each team's configuration
- Monitor logs for routing issues

## Testing Checklist

- [ ] Team resolver correctly identifies organizer's team
- [ ] Team resolver falls back to attendee matching
- [ ] Default team used when no match found
- [ ] State files created per-team correctly
- [ ] Processed meetings tracked per-team (no cross-contamination)
- [ ] Tasks post to correct Teams channel
- [ ] Approvals checked against correct team's state
- [ ] ClickUp tasks created in correct list
- [ ] CLI commands work with --team flag
- [ ] Webhook correctly routes multiple teams

## Gotchas & Considerations

### 1. Fireflies API Fields

Verify exact field names in Fireflies API:
- `organizer_email` vs `host_email` vs `organizer`
- `participants` structure

Check API docs: https://docs.fireflies.ai/

### 2. Cross-Team Meetings

What happens when meeting has attendees from multiple teams?

**Current Design**: Uses majority matching (team with most attendees).

**Alternative**: Could post to multiple teams or require explicit team assignment.

### 3. Team Member Changes

When someone changes teams, their old meetings stay in old team's state.

**Solution**: Accept this as expected behavior, or add migration command.

### 4. Service Account Permissions

Service account needs:
- **Planner**: Create tasks in all plans
- **Teams**: Post to all channels (requires member access)
- **ClickUp**: Access to all lists

### 5. Configuration Management

`config/teams.json` contains sensitive IDs. Consider:
- Environment variable substitution
- Secrets management system
- Access control

### 6. Backwards Compatibility

To maintain compatibility with single-user setup during migration:
- Keep environment variables as fallback
- Auto-create config from env vars if config missing
- Gradual migration path

## Future Enhancements

### 1. Admin UI

Web interface to manage team configuration:
- Add/remove teams
- Edit member lists
- View processing status per team

### 2. Fireflies User Mapping

Automatically map Fireflies users to team configuration:
- Sync with Fireflies user directory
- Auto-update team member lists

### 3. Meeting Tags

Allow Fireflies tags to override team resolution:
- Tag meeting with `#revops` → routes to RevOps team
- Explicit override for cross-team meetings

### 4. Per-User Preferences

Allow individual users to customize:
- Default priority mappings
- Custom task templates
- Notification preferences

### 5. Analytics

Track per-team metrics:
- Meetings processed
- Tasks created
- Approval rates
- Time to approval

## Questions to Answer Before Implementation

1. **How many teams** do you expect to support initially? (2-5? 10+? 50+?)

2. **Team membership**: Will teams be static or change frequently?

3. **Cross-team meetings**: How should meetings with multiple team members be handled?

4. **Service account**: Can you create a shared service account with access to all teams?

5. **Configuration management**: Is JSON file acceptable, or need database/secrets manager?

6. **Migration timeline**: Big bang cutover or gradual team-by-team rollout?

7. **Fireflies API**: Do you have access to organizer/attendee email addresses?

8. **ClickUp structure**: Does each team have separate ClickUp workspace or shared workspace?

## References

- Current Architecture: See @CLAUDE.md
- Fireflies API: https://docs.fireflies.ai/graphql-api
- MS365 MCP Server: https://github.com/softeria-team/ms-365-mcp-server
- ClickUp MCP Server: https://github.com/taazkareem/clickup-mcp-server

---

**Document Version**: 1.0
**Last Updated**: 2025-12-12
**Status**: Planning / Not Implemented

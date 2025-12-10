---
paths: src/services/**/*.ts
---

# Service Architecture

## Service Structure Pattern

Every service in `src/services/` follows this consistent structure:

```typescript
// 1. Imports
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Task, ServiceType } from '../types.js';

// 2. Module-level client cache
let mcpClient: Client | null = null;

// 3. Helper functions (private to module)
function mapData(input: any): OutputType {
  // Data transformation logic
}

// 4. getMCPClient() - Get or create client
async function getMCPClient(): Promise<Client> {
  if (!mcpClient) {
    // Initialize client
  }
  return mcpClient;
}

// 5. Main service functions (exported)
export async function performAction(...args): Promise<Result> {
  const client = await getMCPClient();
  // Service logic
}

// 6. closeMCPClient() - Cleanup
export async function closeMCPClient(): Promise<void> {
  if (mcpClient) {
    await mcpClient.close();
    mcpClient = null;
  }
}
```

## Services Overview

### src/services/planner.ts

**Purpose**: Create tasks in Microsoft Planner

**Key Functions**:
- `createTasksInPlanner(planId, tasks)` - Create multiple tasks
- `closeMCPClient()` - Cleanup

**MCP Server**: `@softeria/ms-365-mcp-server` (default mode)

**Tool**: `create-planner-task`

### src/services/teams.ts

**Purpose**: Post tasks to Teams and check approvals

**Key Functions**:
- `findChannelByName(teamName, channelName)` - Locate Teams channel
- `postTaskToChannel(teamId, channelId, task)` - Post formatted task message
- `getMessageReactions(teamId, channelId, messageId)` - Get reactions
- `checkApprovals(sessionId)` - Check reactions and return approved tasks
- State management: `createSession()`, `saveState()`, `loadState()`
- `closeMCPClient()` - Cleanup

**MCP Server**: `@softeria/ms-365-mcp-server --org-mode` (requires --org-mode flag!)

**Tools**: `list-joined-teams`, `list-team-channels`, `send-channel-message`, `get-channel-message`

**State File**: `.state/teams-approval.json`

### src/services/clickup.ts

**Purpose**: Create tasks in ClickUp

**Key Functions**:
- `createTasksInClickUp(listId, tasks)` - Create multiple tasks
- `closeMCPClient()` - Cleanup

**MCP Server**: `@taazkareem/clickup-mcp-server`

**Tool**: `create_task`

### src/services/task-extractor.ts

**Purpose**: Extract actionable tasks from meeting transcripts using Claude

**Key Functions**:
- `extractTasks(meetingContent)` - Analyze content and return tasks

**Integration**: Anthropic SDK (direct API, not MCP)

**Model**: `claude-opus-4-1-20250805`

**No MCP Client**: Uses direct API call via Anthropic SDK

### src/services/fireflies.ts (future)

**Note**: Currently Fireflies logic is inline in `src/index.ts` and `src/server.ts`. Consider extracting to dedicated service.

## Error Logging

### Consistent Prefix Pattern

All services use prefixed logging:

```typescript
console.log('[Planner] Connected to MS365 MCP server');
console.log('[Teams] Found channel: ClickUp Task Orchestrator');
console.log('[ClickUp] Created task: abc123');
console.error('[Service] Error message:', error);
```

**Prefixes**:
- `[Planner]` - planner.ts
- `[Teams]` - teams.ts
- `[ClickUp]` - clickup.ts
- `[Server]` - server.ts
- `[CLI]` - index.ts (CLI commands)

### Error Handling Pattern

```typescript
try {
  const result = await client.callTool({ ... });
  console.log('[Service] Success message');
  return result;
} catch (error) {
  console.error('[Service] Failed to perform action:', error);
  throw error;  // Re-throw for upstream handling
}
```

**Always re-throw errors** to allow CLI/server to handle them appropriately.

## State Management

### Teams Approval State

**File**: `.state/teams-approval.json`

**Structure**:
```typescript
{
  version: "1.0.0",
  sessions: {
    "[sessionId]": {
      sessionId: string,
      meetingId: string,
      meetingTitle: string,
      createdAt: string,
      teamId: string,
      channelId: string,
      tasks: {
        "[plannerTaskId]": {
          plannerTaskId: string,
          teamsMessageId: string,
          title: string,
          description: string,
          priority: number,
          dueDateTime?: string,
          postedAt: string,
          status: 'posted' | 'approved' | 'created-in-clickup',
          approvalCount?: number,
          clickupTaskId?: string,
          processedAt?: string
        }
      }
    }
  }
}
```

**Functions**:
- `createSession(meetingId, meetingTitle, teamId, channelId)` - Create approval session
- `addTaskToSession(sessionId, task, messageId)` - Add task to session
- `saveState(state)` - Write state to file
- `loadState()` - Read state from file
- `getLatestSession()` - Get most recent session

### Processed Meetings State

**File**: `.state/processed-meetings.json`

**Structure**: Array of meeting IDs

```json
["01KBR8ZMVYFHKG1BFS6D523E7K", "01KBR8ABCDEFGHIJK"]
```

**Pattern**:
```typescript
function loadProcessedMeetings(): Set<string> {
  const data = fs.readFileSync(PROCESSED_FILE, 'utf-8');
  return new Set(JSON.parse(data));
}

function saveProcessedMeetings(meetings: Set<string>): void {
  fs.writeFileSync(PROCESSED_FILE, JSON.stringify([...meetings], null, 2));
}
```

## Priority Mapping

### Claude → Planner

```typescript
const mapping: Record<string, number> = {
  urgent: 1,
  high: 3,
  normal: 5,
  low: 9
};
```

### Claude → ClickUp

```typescript
const mapping: Record<string, number> = {
  urgent: 1,
  high: 2,
  normal: 3,
  low: 4
};
```

## API Integration Patterns

### MCP vs Direct API

- **Planner**: MCP (MS365 MCP server)
- **Teams**: MCP (MS365 MCP server with --org-mode)
- **ClickUp**: MCP (ClickUp MCP server)
- **Fireflies**: Direct GraphQL API
- **Claude**: Direct REST API (Anthropic SDK)

### When to Use MCP

Use MCP when:
- Complex authentication (OAuth device code flow)
- Multiple API endpoints
- Community-maintained server exists

### When to Use Direct API

Use direct API when:
- Simple authentication (API key)
- Single or few endpoints
- MCP server doesn't exist or is outdated

## Async Processing Pattern

Services should process items sequentially (not in parallel) to avoid rate limits:

```typescript
// Good - sequential processing
for (const task of tasks) {
  await createTask(task);
}

// Avoid - parallel processing may hit rate limits
await Promise.all(tasks.map(task => createTask(task)));
```

## Cleanup Best Practices

1. Export `closeMCPClient()` from every service that uses MCP
2. Call cleanup in:
   - CLI command completion (finally block)
   - Server shutdown (SIGTERM/SIGINT handlers)
   - After webhook processing completes
3. Set client to `null` after closing
4. Log cleanup actions for debugging

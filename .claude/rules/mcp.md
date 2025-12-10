---
paths: src/services/**/*.ts
---

# MCP Integration Patterns

## On-Demand MCP Pattern

**Achievement: 94% Context Reduction (84k → 5.4k tokens)**

This project uses the **on-demand MCP pattern** to load MCP servers only when needed, dramatically reducing Claude's context usage.

### Why This Matters

- **Without on-demand**: Both MS365 and ClickUp MCPs loaded in Claude's context from start (84k tokens)
- **With on-demand**: Only called when actual task creation occurs (5.4k tokens)
- **Benefit**: Claude can focus on core task extraction logic without bulky API tool definitions upfront

### Configuration

MCP servers are documented in `.mcp.json` (checked into git):

```json
{
  "mcpServers": {
    "ms365-planner": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@softeria/ms-365-mcp-server"]
    },
    "ms365-teams": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@softeria/ms-365-mcp-server", "--org-mode"]
    },
    "clickup": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@taazkareem/clickup-mcp-server"],
      "env": {
        "CLICKUP_API_KEY": "${CLICKUP_API_KEY}",
        "CLICKUP_TEAM_ID": "${CLICKUP_TEAM_ID}"
      }
    }
  }
}
```

## MCP Client Lifecycle Pattern

Every service follows this pattern:

### 1. Module-Level Client Caching

```typescript
// Cache at module level, not function level
let mcpClient: Client | null = null;
```

### 2. getMCPClient() Function

```typescript
/**
 * Get or create MCP client
 */
async function getMCPClient(): Promise<Client> {
  if (!mcpClient) {
    // Create client
    mcpClient = new Client({
      name: 'context-orchestrator-<service>',
      version: '1.0.0'
    }, {
      capabilities: {}
    });

    // Create transport with npx (on-demand loading)
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', '@package/mcp-server', ...flags]
    });

    // Connect
    await mcpClient.connect(transport);
    console.log('[Service] Connected to MCP server');
  }

  return mcpClient;
}
```

### 3. closeMCPClient() Function

```typescript
/**
 * Close the MCP client connection
 */
export async function closeMCPClient(): Promise<void> {
  if (mcpClient) {
    await mcpClient.close();
    mcpClient = null;
    console.log('[Service] Closed MCP client');
  }
}
```

## MS365 MCP Server

### Two Modes

1. **Default Mode** (Planner): `npx -y @softeria/ms-365-mcp-server`
2. **Organization Mode** (Teams): `npx -y @softeria/ms-365-mcp-server --org-mode`

**Critical**: Teams integration REQUIRES `--org-mode` flag.

### Authentication

MS365 uses device code OAuth flow:

```bash
# Authenticate (one-time setup)
npx -y @softeria/ms-365-mcp-server --org-mode --login
```

1. Displays device code and URL
2. User visits https://microsoft.com/devicelogin
3. Enters code and signs in
4. Tokens cached locally (~/.ms365-mcp-server/)

**Authentication Email**: jrenfro@cageandmiles.com

### Tool Calling Conventions

**IMPORTANT**: MS365 MCP tools use camelCase parameters (not kebab-case):

```typescript
// Correct
await client.callTool({
  name: 'list-team-channels',
  arguments: {
    teamId: teamId  // camelCase
  }
});

// Incorrect
await client.callTool({
  name: 'list-team-channels',
  arguments: {
    'team-id': teamId  // Wrong! Will fail with validation error
  }
});
```

**Common Tools**:
- `list-joined-teams` - Get user's teams
- `list-team-channels` - List channels (parameter: `teamId`)
- `send-channel-message` - Post message (parameters: `teamId`, `channelId`, `body`)
- `get-channel-message` - Get message with reactions (parameters: `teamId`, `channelId`, `chatMessageId`)
- `create-planner-task` - Create task in Planner (parameter: `body`)

### Reaction Detection

Microsoft Graph API returns emoji characters for reactions:

```typescript
// Graph API returns actual emoji
const reactions = message.reactions;  // [{ reactionType: '👍', ... }]

// Check for thumbs up
function isApproved(reactions: Reaction[]): boolean {
  const thumbsUp = reactions.find(r => r.reactionType === '👍' || r.reactionType === 'like');
  return thumbsUp ? reactions.length > 0 : false;
}
```

## ClickUp MCP Server

### Configuration

```typescript
const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', '@taazkareem/clickup-mcp-server'],
  env: {
    CLICKUP_API_KEY: process.env.CLICKUP_API_KEY,
    CLICKUP_TEAM_ID: process.env.CLICKUP_TEAM_ID
  }
});
```

**Note**: ClickUp MCP requires environment variables in transport config.

### Tool Calling

```typescript
await client.callTool({
  name: 'create_task',
  arguments: {
    list_id: listId,
    name: task.title,
    description: task.description,
    priority: mapPriorityToClickUp(task.priority),
    due_date: task.dueDateTime ? new Date(task.dueDateTime).getTime() : null
  }
});
```

## Error Handling

### MCP Connection Errors

```typescript
try {
  const client = await getMCPClient();
  const result = await client.callTool({ ... });
} catch (error) {
  console.error('[Service] MCP error:', error);
  if (error.code === -32602) {
    // Validation error - check parameter names (likely kebab-case vs camelCase)
    console.error('Tip: Ensure parameters are camelCase, not kebab-case');
  }
  throw error;
}
```

### Authentication Errors

If authentication fails:

```bash
# Re-authenticate with correct account
npx -y @softeria/ms-365-mcp-server --org-mode --login
# Sign in with: jrenfro@cageandmiles.com
```

## Cleanup Pattern

Always clean up MCP clients in shutdown handlers:

```typescript
// In src/server.ts or src/index.ts
process.on('SIGTERM', async () => {
  await planner.closeMCPClient();
  await teams.closeMCPClient();
  await clickup.closeMCPClient();
  process.exit(0);
});
```

Also clean up after CLI command completion:

```typescript
try {
  // Do work with MCP clients
} finally {
  await planner.closeMCPClient();
  await teams.closeMCPClient();
  await clickup.closeMCPClient();
}
```

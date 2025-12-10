# Context Orchestrator

Automatically convert Fireflies.ai meeting transcripts into actionable tasks with team approval via Microsoft Teams before adding to ClickUp.

See @README.md for complete user documentation and setup instructions.

## Quick Commands

```bash
# Build and run
npm run build          # Compile TypeScript to dist/
npm start              # Run compiled JavaScript

# Development (no build needed)
npm run dev            # Run CLI with tsx
npm run server         # Start webhook server with tsx

# CLI Commands
npm run dev -- post-to-teams [--meeting-id <id>]
npm run dev -- check-approvals [--session-id <id>]

# Production webhook server
npm run server
```

## Architecture Overview

**Workflow**: Fireflies → Claude → Planner → Teams → ClickUp

### Key Files

- @src/server.ts - Express webhook server (282 lines)
- @src/index.ts - CLI commands and orchestration (333 lines)
- @src/types.ts - TypeScript interfaces (90 lines)

### Services (@src/services/)

- @src/services/teams.ts - Teams channel integration (451 lines, largest service)
- @src/services/planner.ts - Microsoft Planner integration (96 lines)
- @src/services/clickup.ts - ClickUp task creation (90 lines)
- @src/services/task-extractor.ts - Claude-based task extraction (84 lines)

### On-Demand MCP Pattern

**Achievement: 94% context reduction (84k → 5.4k tokens)**

This project achieves dramatic context reduction by loading MCP servers only when needed via `npx`:

```typescript
const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', '@softeria/ms-365-mcp-server']
});
```

See @.mcp.json for server configuration.
See @.claude/rules/mcp.md for implementation patterns.

## Code Conventions

See @.claude/rules/ for detailed guidelines:

- @.claude/rules/typescript.md - TypeScript conventions and module patterns
- @.claude/rules/mcp.md - On-demand MCP pattern, client lifecycle, authentication
- @.claude/rules/services.md - Service architecture, state management, error handling
- @.claude/rules/webhook.md - Webhook server patterns, duplicate prevention
- @.claude/rules/deployment.md - Replit deployment and production setup

## Environment Setup

### Prerequisites

- Node.js 22+
- Access to Fireflies, Microsoft 365, ClickUp, Anthropic API

### Quick Start

1. Copy environment template:
   ```bash
   cp .env.example .env
   ```

2. Configure @.env with required values:
   - FIREFLIES_API_KEY, ANTHROPIC_API_KEY
   - PLANNER_PLAN_ID, TEAMS_TEAM_NAME, TEAMS_CHANNEL_NAME
   - CLICKUP_API_KEY, CLICKUP_LIST_ID, CLICKUP_TEAM_ID

   See @README.md lines 54-76 for where to find these values.

3. Authenticate with Microsoft 365:
   ```bash
   npx -y @softeria/ms-365-mcp-server --org-mode --login
   ```

   Sign in with: **jrenfro@cageandmiles.com**

4. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```

## State Management

### Files in .state/ Directory

- `.state/processed-meetings.json` - Tracks processed Fireflies meetings (duplicate prevention)
- `.state/teams-approval.json` - Tracks Teams approval sessions and task status

### Session-Based Workflow

The Teams approval workflow uses session-based state:

1. **post-to-teams**: Creates session, posts tasks to Teams, saves state
2. **check-approvals**: Loads session, checks reactions, creates ClickUp tasks, updates state

See @src/services/teams.ts lines 63-90 for session management implementation.

## Two Modes of Operation

### 1. Webhook Mode (Automatic - Production)

Fireflies webhook triggers automatic processing:

```bash
npm run server  # Start webhook server
```

**Endpoints**:
- `POST /webhook/fireflies` - Fireflies webhook endpoint
- `POST /trigger/:meetingId` - Manual trigger for testing
- `GET /health` - Health check

See @REPLIT_DEPLOY.md for step-by-step Replit deployment guide.

### 2. CLI Mode (Manual - Development)

Manual workflow via command line:

```bash
# Post tasks to Teams
npm run dev -- post-to-teams --meeting-id abc123

# Later, check approvals and create ClickUp tasks
npm run dev -- check-approvals --session-id abc123-1733774400000
```

## Authentication

### Microsoft 365

Uses device code OAuth flow (tokens cached locally):

```bash
npx -y @softeria/ms-365-mcp-server --org-mode --login
```

**Critical**: Use `--org-mode` flag for Teams integration.

**Account**: jrenfro@cageandmiles.com

**Token Location**: `~/.ms365-mcp-server/`

### Fireflies GraphQL API

Direct API access using API key (no OAuth needed).

### ClickUp API

REST API with API key authentication.

### Anthropic Claude API

Direct REST API via @anthropic-ai/sdk package.

**Model**: claude-opus-4-1-20250805

## Deployment

For production deployment to Replit, see @REPLIT_DEPLOY.md (comprehensive step-by-step guide).

For webhook setup and configuration, see @WEBHOOK_SETUP.md.

**Configuration**: @.replit file

## MCP Servers

This project uses three MCP servers:

1. **@softeria/ms-365-mcp-server** (Planner)
   - Default mode
   - Tools: create-planner-task

2. **@softeria/ms-365-mcp-server --org-mode** (Teams)
   - Requires --org-mode flag
   - Tools: list-joined-teams, list-team-channels, send-channel-message, get-channel-message

3. **@taazkareem/clickup-mcp-server** (ClickUp)
   - Requires CLICKUP_API_KEY and CLICKUP_TEAM_ID in environment
   - Tools: create_task

See @.mcp.json for complete configuration.
See @.claude/rules/mcp.md for usage patterns and gotchas.

## Important Notes

### MS365 MCP Parameter Naming

**CRITICAL**: MS365 MCP tools use camelCase parameters (not kebab-case):

```typescript
// Correct
await client.callTool({
  name: 'list-team-channels',
  arguments: { teamId: '...' }  // camelCase
});

// Wrong - will fail
await client.callTool({
  name: 'list-team-channels',
  arguments: { 'team-id': '...' }  // kebab-case
});
```

See @.claude/rules/mcp.md lines 75-96 for complete tool calling conventions.

### Reaction Detection

Microsoft Graph API returns actual emoji characters:

```typescript
// reaction.reactionType === '👍'  (not 'like')
```

See @src/services/teams.ts lines 249-257 for approval detection logic.

## Project Structure

```
context-orchestrator/
├── src/
│   ├── index.ts              # CLI commands
│   ├── server.ts             # Webhook server
│   ├── types.ts              # TypeScript interfaces
│   └── services/
│       ├── planner.ts        # Microsoft Planner
│       ├── teams.ts          # Microsoft Teams
│       ├── clickup.ts        # ClickUp
│       └── task-extractor.ts # Claude AI
├── .claude/
│   └── rules/                # Code conventions
├── .state/                   # State tracking (not in git)
├── CLAUDE.md                 # This file
├── README.md                 # User documentation
├── REPLIT_DEPLOY.md          # Deployment guide
├── WEBHOOK_SETUP.md          # Webhook configuration
├── .mcp.json                 # MCP server config
├── .env.example              # Environment template
└── package.json              # Dependencies
```

## Troubleshooting

### Common Issues

1. **Authentication failed**: Re-run `npx -y @softeria/ms-365-mcp-server --org-mode --login`
2. **Webhook not receiving**: Check Fireflies webhook configuration
3. **Tasks not posting to Teams**: Verify TEAMS_TEAM_NAME and TEAMS_CHANNEL_NAME
4. **MCP parameter errors**: Ensure camelCase parameters (see @.claude/rules/mcp.md)

### Debug Logging

All services use prefixed logging:
- `[Planner]` - planner.ts
- `[Teams]` - teams.ts
- `[ClickUp]` - clickup.ts
- `[Server]` - server.ts

Check console output for detailed operation logs.

## For Claude Code Users

This file (CLAUDE.md) and the @.claude/rules/ directory follow official Claude Code best practices for project memory and documentation organization.

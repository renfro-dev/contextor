# Context Orchestrator

Automatically convert Fireflies.ai meeting transcripts into actionable tasks with team approval via Microsoft Teams before adding to ClickUp.

## 🚀 Production Deploy (DigitalOcean)

We deploy to a cloud server (not local) for reliability and a stable HTTPS URL.
👉 **[See DIGITALOCEAN_DEPLOY.md](./DIGITALOCEAN_DEPLOY.md)** for the production guide.

## Features

### Automatic Workflow (Webhook Mode)
- 🤖 **Auto-trigger**: Webhook automatically processes meetings when Fireflies completes transcription
- 📋 **Teams Approval**: Tasks posted to Microsoft Teams channel for team review
- 👍 **React to Approve**: Team members approve tasks with thumbs up emoji
- ✅ **Auto-sync**: Approved tasks automatically created in ClickUp
- 🔄 **Duplicate Prevention**: Tracks processed meetings to avoid duplicates

### Manual CLI Mode
- Fetches meeting transcripts from Fireflies.ai
- Uses Claude Opus 4 to identify actionable tasks from meeting content
- Creates tasks in Microsoft Planner
- Interactive CLI with meeting selection
- On-demand MCP server integration (94% context reduction)

## Prerequisites

- Node.js 22.x or higher
- Access to:
  - Fireflies.ai account (with meeting transcripts)
  - Microsoft Planner
  - ClickUp workspace
  - Anthropic API (Claude)

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Configure your environment:
```bash
cp .env.example .env
# Edit .env with your API keys and IDs
```

3. Run the orchestrator:
```bash
npm run build
npm start process
```

## Configuration

### Required API Keys

Add these to your `.env` file:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
FIREFLIES_API_KEY=your_fireflies_api_key_here
PLANNER_PLAN_ID=your_planner_plan_id_here
CLICKUP_LIST_ID=your_clickup_list_id_here
CLICKUP_API_KEY=your_clickup_api_key_here
CLICKUP_TEAM_ID=your_clickup_team_id_here
```

### Where to Find IDs

- **Fireflies API Key**: [Fireflies Settings](https://fireflies.ai/settings) → API section
- **Planner Plan ID**: In the Planner URL: `https://tasks.office.com/.../<PLAN_ID>/...`
- **ClickUp List ID**: In the ClickUp URL: `https://app.clickup.com/.../list/<LIST_ID>`
- **ClickUp API Key**: ClickUp Settings → Apps → Generate API Token
- **ClickUp Team ID**: ClickUp Settings → Workspaces

## Usage

### Webhook Mode (Automatic - Recommended)

**Start Webhook Server:**
```bash
npm run server
```

**Commands:**
- `npm run dev -- post-to-teams` - Post tasks to Teams for approval
- `npm run dev -- check-approvals` - Check approved tasks and create in ClickUp

See **[WEBHOOK_SETUP.md](./WEBHOOK_SETUP.md)** for webhook configuration (uses the cloud server).

### Manual CLI Mode

**Interactive Mode:**
```bash
npm start process
```
Select a meeting from the list and follow the prompts.

**Process Specific Meeting:**
```bash
npm start process -- --meeting-id "abc123"
```

**Development Mode (Local – for testing only, not used in production):**
```bash
npm run dev process
```

## How It Works

1. **Fetch Meetings** from Fireflies.ai
2. **Select Meeting** to process
3. **Extract Tasks** using Claude AI
4. **Create in Planner** (visible in Teams)
5. **Select Tasks** to sync to ClickUp
6. **Create in ClickUp**

## Task Data Structure

Tasks are extracted with the following structure:

```json
{
  "title": "Clear action-oriented task title",
  "description": "Detailed description",
  "priority": "urgent|high|normal|low",
  "dueDate": "YYYY-MM-DD or null"
}
```

### Priority Mapping

| Claude | Planner | ClickUp |
|--------|---------|---------|
| urgent | 1       | 1       |
| high   | 3       | 2       |
| normal | 5       | 3       |
| low    | 9       | 4       |

## Architecture

```
Fireflies API → Claude AI → Microsoft Planner + ClickUp
```

**Key Features:**
- On-demand MCP servers via `npx` (only loaded when needed)
- Direct Fireflies GraphQL API integration
- 94% context reduction (84k → 5.4k tokens)

### Why This Design?

- **Minimal context**: MCP tools loaded only when creating tasks
- **No PDF parsing**: Direct API access to transcripts
- **Simple auth**: Browser-based MS365 authentication
- **Real-time data**: Live meeting transcripts from Fireflies

## Troubleshooting

### Authentication
- **MS365**: Follow browser prompt on first use to sign in
- **ClickUp**: Verify API key and Team ID in `.env`

### No Meetings Found
- Ensure meetings are transcribed in Fireflies
- Verify `FIREFLIES_API_KEY` is correct

### Task Creation Failed
- Check all API keys in `.env`
- Verify Plan ID and List ID are correct
- Ensure you have permissions in Planner and ClickUp

## Development

Edit TypeScript files in `src/` and run:
```bash
npm run dev process
```

Build for production:
```bash
npm run build
```

## License

MIT

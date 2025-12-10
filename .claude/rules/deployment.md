# Deployment Guidelines

## Replit Deployment

### Configuration File (.replit)

```toml
run = "npm run server"
entrypoint = "src/server.ts"

[nix]
channel = "stable-23_11"

[deployment]
run = ["npm", "run", "server"]
deploymentTarget = "cloudrun"

[env]
WEBHOOK_PORT = "3000"
```

### Environment Secrets

**CRITICAL**: Use Replit Secrets (not .env file) for production:

1. Click Lock icon 🔒 or go to Tools → Secrets
2. Add each variable as separate secret (key-value pair)
3. Do NOT paste as a block

**Required Secrets**:
- FIREFLIES_API_KEY
- ANTHROPIC_API_KEY
- PLANNER_PLAN_ID
- TEAMS_TEAM_NAME
- TEAMS_CHANNEL_NAME
- CLICKUP_API_KEY
- CLICKUP_LIST_ID
- CLICKUP_TEAM_ID

### MS365 Authentication on Replit

Run in Replit Shell:

```bash
npx -y @softeria/ms-365-mcp-server --org-mode --login
```

1. Copy device code from output
2. Visit https://microsoft.com/devicelogin
3. Enter code
4. Sign in with: **jrenfro@cageandmiles.com**
5. Wait for "Authentication successful" message

Tokens are cached in `~/.ms365-mcp-server/` on the Repl.

### Always-On

**Free Tier**: Repl sleeps after 1 hour of inactivity

**Hacker Plan ($7/month)**:
1. Click ⚙️ Settings
2. Enable "Always On" toggle
3. Server never sleeps

**Free Tier Workaround**:
Use [UptimeRobot](https://uptimerobot.com) (free) to ping every 5 minutes:
```
https://your-repl.your-username.repl.co/health
```

### Public URL

Replit automatically provides HTTPS URL:

```
https://${REPL_SLUG}.${REPL_OWNER}.repl.co
```

The server detects Replit environment and displays the URL on startup.

### Fireflies Webhook Configuration

1. Log in to Fireflies.ai
2. Settings → Integrations → Webhooks
3. Click "Add Webhook"
4. URL: `https://your-repl.your-username.repl.co/webhook/fireflies`
5. Select "Transcript Ready" event
6. Click "Save"

## Local Development

### Setup

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
nano .env

# Authenticate MS365 (one-time)
npx -y @softeria/ms-365-mcp-server --org-mode --login
```

### Running Locally

```bash
# Development mode (with tsx, no build)
npm run dev

# Start webhook server
npm run server

# Build for production
npm run build

# Run production build
npm start
```

### Testing with ngrok

```bash
# Terminal 1: Start server
npm run server

# Terminal 2: Expose with ngrok
ngrok http 3000

# Use the https URL from ngrok for Fireflies webhook
```

## State Directory

**Location**: `.state/` in project root

**Files**:
- `processed-meetings.json` - Tracks processed Fireflies meetings
- `teams-approval.json` - Tracks Teams approval sessions

**Important**:
- `.state/` is in .gitignore (not checked in)
- Created automatically on first run
- Persists on Replit between deploys
- Back up periodically if needed

## Health Checks

### Endpoint

```
GET /health
```

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2025-12-10T..."
}
```

### Monitoring

Use this endpoint for:
- UptimeRobot monitoring (keep Repl awake)
- Health check dashboards
- Load balancer health checks

## Troubleshooting

### Server Won't Start

```bash
# Check all secrets are added
# Verify .replit file exists
# Try manual npm install
npm install
```

### Webhook Not Receiving Events

1. Verify Fireflies webhook URL is correct
2. Check it's HTTPS (Replit provides this)
3. Test with manual trigger first:
   ```bash
   curl -X POST https://your-repl.repl.co/trigger/MEETING_ID
   ```
4. Check Fireflies webhook delivery logs

### MS365 Authentication Expired

Re-authenticate in Shell:

```bash
npx -y @softeria/ms-365-mcp-server --org-mode --login
```

Sign in with: **jrenfro@cageandmiles.com**

### Repl Keeps Sleeping

- Upgrade to Hacker plan for Always On
- Or use UptimeRobot to ping `/health` every 5 minutes

## Security Best Practices

1. **Never commit .env** - Use .gitignore
2. **Use Replit Secrets** for production
3. **Don't log sensitive data** (API keys, tokens)
4. **Use HTTPS only** for webhooks
5. **Validate webhook payloads** before processing

## Deployment Checklist

- [ ] All environment secrets added to Replit
- [ ] MS365 authenticated with correct account
- [ ] Server running and accessible
- [ ] Health endpoint responding
- [ ] Fireflies webhook configured
- [ ] Test meeting processed successfully
- [ ] Tasks appearing in Teams
- [ ] Approval workflow tested
- [ ] Always On enabled (or UptimeRobot configured)
- [ ] Check-approvals scheduled/tested

## Cost

**Replit Free Tier**:
- ✅ Perfect for testing
- ✅ Public HTTPS URL
- ❌ Sleeps after inactivity
- ❌ 500 MB storage

**Replit Hacker Plan ($7/month)**:
- ✅ Always On (never sleeps)
- ✅ 5 GB storage
- ✅ Faster CPUs
- ✅ Better for production

**Other Costs**:
- Anthropic API: ~$0.01-0.02 per meeting (Claude Opus 4)
- Fireflies: Free tier includes webhooks
- MS365: Included with Microsoft 365 subscription
- ClickUp: Included with ClickUp subscription

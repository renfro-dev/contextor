# Automatic Workflow with Fireflies Webhooks

This guide explains how to set up automatic processing of Fireflies meetings using webhooks.

## How It Works

```
Fireflies Meeting Ends → Webhook Triggers → Server Processes Meeting →
Tasks Posted to Teams → Team Approves with 👍 → Tasks Created in ClickUp
```

## Features

- **Automatic Processing**: No manual intervention needed when meetings end
- **Duplicate Prevention**: Tracks processed meetings to avoid duplicates
- **Real-time Notifications**: Immediate processing when Fireflies completes transcription
- **Background Processing**: Webhook responds immediately, processes in background

## Setup Instructions

### Recommended: Deploy to DigitalOcean (Production)

Use a cloud VM with automatic HTTPS and PM2 for an always-on server.
👉 Follow **[DIGITALOCEAN_DEPLOY.md](./DIGITALOCEAN_DEPLOY.md)** for full steps.

#### 1. Create a New Repl

1. Go to https://replit.com
2. Click **+ Create Repl**
3. Choose **Import from GitHub**
4. Paste your repository URL or upload your code
5. Replit will detect Node.js automatically

#### 2. Configure Environment Variables

In your Repl, go to **Tools** → **Secrets** (or the lock icon 🔒) and add:

```bash
FIREFLIES_API_KEY=your_fireflies_api_key_here
PLANNER_PLAN_ID=your_planner_plan_id_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
TEAMS_TEAM_NAME=Your Team Name
TEAMS_CHANNEL_NAME=ClickUp Task Orchestrator
WEBHOOK_PORT=3000
```

**Important:** Do NOT use the `.env` file on Replit - use Secrets instead for security.

#### 3. Configure Replit to Run the Server

Create or update `.replit` file in your project root:

```toml
run = "npm run server"
entrypoint = "src/server.ts"

[nix]
channel = "stable-23_11"

[deployment]
run = ["npm", "run", "server"]
deploymentTarget = "cloudrun"
```

#### 4. Install Dependencies and Start

In the Replit Shell:
```bash
npm install
```

Then click the **Run** button. Your server will start and Replit will provide a public URL.

#### 5. Get Your Replit URL

Once running, Replit automatically provides an HTTPS URL in the format:
```
https://your-repl-name.your-username.repl.co
```

You'll see it in the Webview panel or in the console output.

#### 6. Authenticate MS365 (One-Time Setup)

In the Replit Shell, run:
```bash
npx -y @softeria/ms-365-mcp-server --org-mode --login
```

Follow the device code authentication flow. The tokens will be cached on the Replit server.

#### 7. Keep Replit Always On

**Free Tier:** Repls sleep after inactivity
**Hacker Plan ($7/month):** Always-on Repls available

To enable Always-On:
1. Go to your Repl settings
2. Enable **Always On** toggle
3. Your webhook server will never sleep

**Alternative for Free Tier:**
Use a service like UptimeRobot to ping your health endpoint every 5 minutes:
```
https://your-repl.username.repl.co/health
```

### Alternative: Local Development/Testing

**For local testing only (not used in production):**
```bash
npm run server
```

Use ngrok to expose locally:
```bash
ngrok http 3000
```

Make sure your server is accessible at a public HTTPS URL.

### 3. Configure Fireflies Webhook

1. Log in to Fireflies.ai
2. Go to **Settings** → **Integrations** → **Webhooks**
3. Click **Add Webhook**
4. Configure:
   - **Webhook URL**: `https://YOUR_DOMAIN/webhook/fireflies`
   - **Event**: Select **Transcript Ready** (or all events)
   - **Secret**: (Optional) Not currently validated by server
5. Click **Save**

### 4. Test the Webhook

#### Manual Testing:

Test with curl:
```bash
curl -X POST http://localhost:3000/trigger/YOUR_MEETING_ID
```

#### Live Testing:

1. Start a test meeting in Fireflies (or wait for a real meeting to end)
2. Check server logs for processing output
3. Verify tasks appear in Teams channel
4. Approve tasks with 👍
5. Run check-approvals to create ClickUp tasks

## Webhook Endpoints

### `POST /webhook/fireflies`
Receives webhooks from Fireflies when meetings are processed.

**Expected Payload:**
```json
{
  "transcript_id": "01KBR8ZMVYFHKG1BFS6D523E7K",
  "title": "Meeting Title",
  "event_type": "transcript_ready"
}
```

### `POST /trigger/:meetingId`
Manual trigger for testing (bypasses webhook).

**Example:**
```bash
curl -X POST http://localhost:3000/trigger/01KBR8ZMVYFHKG1BFS6D523E7K
```

### `GET /health`
Health check endpoint.

**Example:**
```bash
curl http://localhost:3000/health
```

## Processed Meetings Tracking

The server tracks processed meetings in `.state/processed-meetings.json` to prevent duplicates.

**Format:**
```json
[
  "01KBR8ZMVYFHKG1BFS6D523E7K",
  "01ABC123DEF456GHI789JKL012"
]
```

To reprocess a meeting, remove its ID from this file.

## Server Configuration

Edit `.env` file:

```bash
# Webhook Server
WEBHOOK_PORT=3000

# Required: Fireflies API
FIREFLIES_API_KEY=your_fireflies_api_key

# Required: Planner
PLANNER_PLAN_ID=your_planner_plan_id

# Required: Teams
TEAMS_TEAM_NAME=RevOps
TEAMS_CHANNEL_NAME=Clickup Task Orchestrator

# Required: Anthropic
ANTHROPIC_API_KEY=your_anthropic_api_key
```

## Monitoring

### View Server Logs

**Local Development:**
```bash
npm run server
```

**PM2 (Production):**
```bash
# View logs
pm2 logs fireflies-webhook

# Real-time monitoring
pm2 monit
```

### Check Server Status

```bash
curl http://localhost:3000/health
```

## Troubleshooting

### Webhook Not Receiving Events

1. **Check Fireflies Configuration:**
   - Verify webhook URL is correct
   - Ensure URL is HTTPS (required for Fireflies)
   - Check event type is set to "Transcript Ready"

2. **Check Server Accessibility:**
   ```bash
   curl https://YOUR_DOMAIN/health
   ```

3. **Check Fireflies Webhook Logs:**
   - Go to Fireflies Settings → Webhooks
   - View delivery history and errors

### Meeting Already Processed

If a meeting was already processed, the server will skip it. To reprocess:

1. Edit `.state/processed-meetings.json`
2. Remove the meeting ID
3. Manually trigger: `curl -X POST http://localhost:3000/trigger/MEETING_ID`

### Server Crashes or Errors

**Check Logs:**
```bash
pm2 logs fireflies-webhook --lines 100
```

**Common Issues:**
- Missing environment variables (check `.env`)
- MS365 authentication expired (re-run: `npx -y @softeria/ms-365-mcp-server --org-mode --login`)
- Network connectivity issues
- API rate limits

## Security Considerations

### For Production Deployment:

1. **Use HTTPS:** Always use HTTPS for webhook endpoints
2. **Validate Webhooks:** Add webhook signature validation (Fireflies provides signatures)
3. **Rate Limiting:** Add rate limiting to prevent abuse
4. **Authentication:** Consider adding API key authentication for manual trigger endpoint
5. **Environment Variables:** Never commit `.env` file to git
6. **Firewall:** Restrict access to only Fireflies IP ranges if possible

### Example: Adding Webhook Validation

```typescript
// In src/server.ts
app.post('/webhook/fireflies', async (req, res) => {
  const signature = req.headers['x-fireflies-signature'];
  const secret = process.env.FIREFLIES_WEBHOOK_SECRET;

  // Validate signature
  if (!validateSignature(req.body, signature, secret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Process webhook...
});
```

## Approval Workflow

After tasks are posted to Teams:

### Manual Check (Recommended for Testing):
```bash
npm run dev -- check-approvals
```

### Automated Check (For Production):

Set up a cron job to check approvals periodically:

```bash
# Check approvals every 30 minutes
*/30 * * * * cd /path/to/context-orchestrator && npm run dev -- check-approvals >> /var/log/check-approvals.log 2>&1
```

Or use PM2 cron:
```bash
pm2 start npm --name "check-approvals" --cron "*/30 * * * *" -- run dev -- check-approvals
```

## Advanced: Multiple Webhooks

To process different types of meetings differently:

1. Create multiple webhook endpoints in `src/server.ts`
2. Configure different Fireflies webhooks for different meetings
3. Use meeting metadata to route to different Teams channels

## Support

For issues or questions:
- Check server logs
- Review Fireflies webhook delivery logs
- Test with manual trigger endpoint first
- Verify all environment variables are set correctly

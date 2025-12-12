# DigitalOcean Deployment (Production)

Deploy the Context Orchestrator as an always‑on HTTPS webhook server on a DigitalOcean Droplet.

## Overview
- Receives Fireflies webhooks at `https://your-domain/webhook/fireflies`
- Posts tasks to Teams for approval; scheduled job checks approvals and creates ClickUp tasks
- Persists state in `.state/` and MS365 tokens in `~/.ms365-mcp-server/`

## Prerequisites
- DigitalOcean account and a Droplet (Ubuntu 22.04/24.04, 1GB+ RAM)
- Optional: a domain with DNS access (A/AAAA records to your Droplet)
- Your `.env` filled with required keys/IDs

## 1) Create Droplet
- Choose Ubuntu (22.04 or 24.04), Basic/Regular CPU, 1GB RAM is sufficient
- Enable SSH key auth
- Create and note the public IP

## 2) Connect and Base Setup
```bash
ssh root@YOUR_DROPLET_IP
apt-get update -y && apt-get upgrade -y
apt-get install -y ufw curl
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
```

## 3) Install Node.js 22 and PM2
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs build-essential
npm i -g pm2
```

## 4) Install Caddy (HTTPS reverse proxy)
```bash
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | tee /etc/apt/trusted.gpg.d/caddy-stable.asc
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y
apt-get install -y caddy
```

## 5) Upload the App
From your laptop (in project root):
```bash
tar czf context-orchestrator.tgz . --exclude=node_modules --exclude=.git
scp context-orchestrator.tgz root@YOUR_DROPLET_IP:/opt/
```

On the server:
```bash
mkdir -p /opt/context-orchestrator
tar xzf /opt/context-orchestrator.tgz -C /opt/context-orchestrator
cd /opt/context-orchestrator
npm install
cp -n .env.example .env  # then edit with nano or vim to set real values
npm run build
```

## 6) One‑time MS365 Authentication
```bash
cd /opt/context-orchestrator
npx -y @softeria/ms-365-mcp-server --org-mode --login
# Follow device code flow. Sign in as jrenfro@cageandmiles.com
```
Tokens are stored under `~/.ms365-mcp-server/` for the user that runs the command.

## 7) Run with PM2 (always‑on)
```bash
cd /opt/context-orchestrator
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # follow printed instructions to enable on boot
pm2 status
```
This starts:
- `orchestrator-server` (webhook server on port 3000)
- `check-approvals` (runs every 30 minutes)

## 8) Configure Caddy (automatic HTTPS)
Edit `/etc/caddy/Caddyfile`:
```
your-domain.com {
  reverse_proxy 127.0.0.1:3000
}
```
Then:
```bash
systemctl reload caddy
```
Point your DNS A/AAAA record for `your-domain.com` to the Droplet IP first.

## 9) Configure Fireflies Webhook
- Webhook URL: `https://your-domain.com/webhook/fireflies`
- Event: Transcript Ready

## 10) Verify
```bash
curl https://your-domain.com/health
pm2 logs orchestrator-server --lines 100
```

## Upgrades
From your laptop:
```bash
tar czf context-orchestrator.tgz . --exclude=node_modules --exclude=.git
scp context-orchestrator.tgz root@YOUR_DROPLET_IP:/opt/
ssh root@YOUR_DROPLET_IP 'cd /opt/context-orchestrator && tar xzf /opt/context-orchestrator.tgz -C /opt/context-orchestrator && npm ci && npm run build && pm2 restart orchestrator-server'
```

## Notes
- Production does not use local tunnels. The server runs in the cloud with a stable HTTPS domain.
- State is stored in `/opt/context-orchestrator/.state/`; MS365 tokens in `~/.ms365-mcp-server/`.
- Ensure `.env` contains FIREFLIES, MS365/Planner, Teams, ClickUp, and Anthropic variables.

# 🎯 Valorant Update Bot for Discord

A Discord bot that automatically monitors and posts **Valorant game updates** — patch notes, server incidents, maintenance windows, and Riot news — to your server channels in real time.

---

## Features

- **Auto-posting** — checks for new updates every N minutes and pushes rich embeds to your channels
- **Multiple sources** — pulls from playvalorant.com content API, Riot Games RSS, and Valorant server status API
- **Deduplication** — SQLite database tracks what's already been posted, so no double-posts even after restarts
- **Slash commands** — `/val-check` (force check), `/val-latest` (show newest update), `/val-status` (server health)
- **Multi-channel** — post to one or multiple channels simultaneously
- **Categorized embeds** — color-coded by type (patch notes, incidents, maintenance)

---

## Setup Guide

### 1. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** → name it (e.g. "Valorant Updates")
3. Go to **Bot** tab → click **Reset Token** → **copy the token** (you'll need it)
4. Under **Privileged Gateway Intents**, you don't need any extra intents
5. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Embed Links`, `View Channels`
6. Copy the generated URL → open it in your browser → invite the bot to your server

### 2. Get the Channel ID

1. In Discord, go to **User Settings → Advanced → Enable Developer Mode**
2. Right-click the channel where you want updates → **Copy Channel ID**

### 3. Configure the Bot

```bash
cp .env.example .env
```

Edit `.env`:

```env
DISCORD_BOT_TOKEN=your_actual_token_here
DISCORD_CHANNEL_IDS=1234567890123456789
CHECK_INTERVAL_MINUTES=10
```

For **multiple channels**, comma-separate the IDs:
```env
DISCORD_CHANNEL_IDS=111111111111,222222222222,333333333333
```

### 4. Install & Run

```bash
npm install
npm start
```

You should see:
```
🤖  Logged in as ValorantUpdates#1234
📢  Posting to channel(s): 1234567890123456789
⏱️   Checking every 10 minute(s)
📝  Registering slash commands…
✅  Slash commands registered.
🔍  Checking for Valorant updates…
```

---

## Slash Commands

| Command        | Description                                  |
|----------------|----------------------------------------------|
| `/val-check`   | Force an immediate update check              |
| `/val-latest`  | Display the most recent Valorant update      |
| `/val-status`  | Show current Valorant server status          |

---

## Deployment Options

### Option A: Run on a VPS (cheapest)

Any $4-5/month VPS (DigitalOcean, Hetzner, Railway) works. Use `pm2` to keep it alive:

```bash
npm install -g pm2
pm2 start src/bot.js --name valorant-bot
pm2 save
pm2 startup   # auto-start on reboot
```

### Option B: Docker

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
CMD ["node", "src/bot.js"]
```

```bash
docker build -t valorant-bot .
docker run -d --env-file .env --name valorant-bot valorant-bot
```

### Option C: Railway / Render (one-click deploy)

Push to GitHub, connect the repo to Railway or Render, set environment variables in their dashboard.

---

## Project Structure

```
valorant-discord-bot/
├── src/
│   ├── bot.js        # Main entry — Discord client, commands, scheduler
│   ├── config.js     # Loads .env, validates config
│   ├── db.js         # SQLite — tracks posted updates
│   └── fetcher.js    # Pulls updates from Valorant/Riot sources
├── data/             # Auto-created — SQLite database lives here
├── .env.example      # Config template
├── .gitignore
├── package.json
└── README.md
```

---

## Customization

**Change the region for server status** — edit the status URL in `fetcher.js`:
- AP (Asia Pacific): `.../status/ap.json`
- NA (North America): `.../status/na.json`
- EU (Europe): `.../status/eu.json`
- KR (Korea): `.../status/kr.json`
- BR (Brazil): `.../status/br.json`

**Add more sources** — add a new async function in `fetcher.js` returning the same `{ id, title, url, description, date, category, image, source }` shape, then add it to the `Promise.allSettled` array in `fetchAllUpdates()`.

---

## License

MIT — do whatever you want with it.

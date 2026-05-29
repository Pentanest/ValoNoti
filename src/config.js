const { readFileSync, existsSync } = require("fs");
const { resolve } = require("path");

// Load .env manually (no dotenv dependency needed)
function loadEnv() {
  const envPath = resolve(__dirname, "..", ".env");
  if (!existsSync(envPath)) {
    // No .env file — that's fine on Railway / Render where env vars are injected
    return;
  }
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

const config = {
  token: process.env.DISCORD_BOT_TOKEN,
  channelIds: (process.env.DISCORD_CHANNEL_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
  checkIntervalMinutes: parseInt(process.env.CHECK_INTERVAL_MINUTES, 10) || 10,
  embedColor: parseInt((process.env.EMBED_COLOR || "#FD4556").replace("#", ""), 16),
};

if (!config.token || config.token === "your_bot_token_here") {
  console.error("❌  DISCORD_BOT_TOKEN is missing in .env");
  process.exit(1);
}
if (config.channelIds.length === 0) {
  console.error("❌  DISCORD_CHANNEL_IDS is missing in .env");
  process.exit(1);
}

module.exports = config;

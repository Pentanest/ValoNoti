const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
} = require("discord.js");
const cron = require("node-cron");
const config = require("./config");
const db = require("./db");
const { fetchAllUpdates } = require("./fetcher");

// ─── Discord Client ─────────────────────────────────────────────────────────

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ─── Embed builder ──────────────────────────────────────────────────────────

const CATEGORY_EMOJI = {
  "Game Update": "🎮",
  "Patch Notes": "📋",
  Maintenance: "🔧",
  Incident: "🚨",
  "Riot News": "📰",
  "Dev Diary": "🗒️",
  Esports: "🏆",
};

function buildEmbed(update) {
  const emoji = CATEGORY_EMOJI[update.category] || "📢";
  const embed = new EmbedBuilder()
    .setTitle(`${emoji}  ${update.title}`)
    .setURL(update.url)
    .setColor(
      update.category === "Incident"
        ? 0xff4444
        : update.category === "Maintenance"
        ? 0xffa500
        : config.embedColor
    )
    .setFooter({
      text: `${update.source}  •  ${update.category}`,
    })
    .setTimestamp(update.date);

  if (update.description) {
    // Truncate to 300 chars for clean embeds
    const desc =
      update.description.length > 300
        ? update.description.slice(0, 297) + "…"
        : update.description;
    embed.setDescription(desc);
  }

  if (update.image) {
    embed.setImage(update.image);
  }

  return embed;
}

// ─── Post updates to all configured channels ────────────────────────────────

async function postUpdate(update) {
  const embed = buildEmbed(update);

  for (const channelId of config.channelIds) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased()) {
        console.warn(`⚠️  Channel ${channelId} is not a text channel, skipping.`);
        continue;
      }
      await channel.send({ embeds: [embed] });
      console.log(`✅  Posted "${update.title}" → #${channel.name}`);
    } catch (err) {
      console.error(`❌  Failed to post to ${channelId}:`, err.message);
    }
  }
}

// ─── Check-and-post cycle ───────────────────────────────────────────────────

let isChecking = false;

async function checkForUpdates() {
  if (isChecking) return;
  isChecking = true;

  try {
    console.log("🔍  Checking for Valorant updates…");
    const updates = await fetchAllUpdates();

    let newCount = 0;
    // Process oldest-first so channel messages appear chronologically
    for (const update of updates.reverse()) {
      if (db.alreadyPosted(update.id)) continue;
      await postUpdate(update);
      db.markPosted(update.id, update.title, update.url);
      newCount++;
      // Small delay between posts to avoid rate limits
      if (newCount > 0) await sleep(2000);
    }

    if (newCount === 0) console.log("   No new updates found.");
    else console.log(`   Posted ${newCount} new update(s).`);
  } catch (err) {
    console.error("❌  Update check failed:", err.message);
  } finally {
    isChecking = false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Slash commands ─────────────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName("val-check")
    .setDescription("Manually check for new Valorant updates right now"),
  new SlashCommandBuilder()
    .setName("val-latest")
    .setDescription("Show the latest Valorant update"),
  new SlashCommandBuilder()
    .setName("val-status")
    .setDescription("Check Valorant server status"),
];

async function registerCommands() {
  const rest = new REST().setToken(config.token);
  try {
    console.log("📝  Registering slash commands…");
    await rest.put(Routes.applicationCommands(client.user.id), {
      body: commands.map((c) => c.toJSON()),
    });
    console.log("✅  Slash commands registered.");
  } catch (err) {
    console.error("❌  Failed to register commands:", err.message);
  }
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "val-check") {
    await interaction.deferReply({ ephemeral: true });
    await checkForUpdates();
    await interaction.editReply("✅ Update check complete!");
  }

  if (interaction.commandName === "val-latest") {
    await interaction.deferReply();
    try {
      const updates = await fetchAllUpdates();
      if (updates.length === 0) {
        await interaction.editReply("No recent updates found.");
        return;
      }
      const embed = buildEmbed(updates[0]);
      await interaction.editReply({ embeds: [embed] });
    } catch {
      await interaction.editReply("❌ Failed to fetch updates.");
    }
  }

  if (interaction.commandName === "val-status") {
    await interaction.deferReply();
    try {
      const res = await fetch(
        "https://valorant.secure.dyn.riotcdn.net/channels/public/x/status/ap.json",
        { signal: AbortSignal.timeout(10_000) }
      );
      const json = await res.json();
      const issues = [...(json.incidents || []), ...(json.maintenances || [])];

      if (issues.length === 0) {
        const embed = new EmbedBuilder()
          .setTitle("✅  Valorant Servers — All Good")
          .setColor(0x00c853)
          .setDescription("No active incidents or maintenance.")
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } else {
        const embeds = issues.slice(0, 5).map((inc) => {
          const title =
            inc.titles?.find((t) => t.locale === "en_US")?.content ||
            "Server Issue";
          return new EmbedBuilder()
            .setTitle(`⚠️  ${title}`)
            .setColor(inc.maintenance_status ? 0xffa500 : 0xff4444)
            .setTimestamp();
        });
        await interaction.editReply({ embeds });
      }
    } catch {
      await interaction.editReply("❌ Failed to fetch server status.");
    }
  }
});

// ─── Startup ────────────────────────────────────────────────────────────────

client.once("ready", async () => {
  console.log(`\n🤖  Logged in as ${client.user.tag}`);
  console.log(`📢  Posting to channel(s): ${config.channelIds.join(", ")}`);
  console.log(`⏱️   Checking every ${config.checkIntervalMinutes} minute(s)\n`);

  await registerCommands();

  // Run first check immediately
  await checkForUpdates();

  // Schedule periodic checks using cron
  const interval = config.checkIntervalMinutes;
  cron.schedule(`*/${interval} * * * *`, () => {
    checkForUpdates();
  });

  // Cleanup old DB entries daily at midnight
  cron.schedule("0 0 * * *", () => {
    db.cleanup();
    console.log("🧹  Cleaned up old DB entries.");
  });
});

client.on("error", (err) => console.error("Discord error:", err));

// ─── Login ──────────────────────────────────────────────────────────────────

client.login(config.token);

const RSSParser = require("rss-parser");

const parser = new RSSParser({
  timeout: 15_000,
  headers: {
    "User-Agent": "ValorantUpdateBot/1.0",
  },
});

// ─── Sources ────────────────────────────────────────────────────────────────

/**
 * Source 1: Valorant official news via playvalorant.com content API
 * Returns patch notes, game updates, esports news, dev diaries, etc.
 */
async function fetchFromContentAPI() {
  const url =
    "https://playvalorant.com/page-data/en-us/news/game-updates/page-data.json";
  const res = await fetch(url, {
    headers: { "User-Agent": "ValorantUpdateBot/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Content API returned ${res.status}`);
  const json = await res.json();

  // Navigate Gatsby page-data structure
  const articles =
    json?.result?.data?.allContentstackArticles?.nodes ?? [];

  return articles.map((a) => ({
    id: `valnews-${a.id || a.url?.url || a.title}`,
    title: a.title,
    url: a.url?.url
      ? `https://playvalorant.com${a.url.url}`
      : `https://playvalorant.com/en-us/news/game-updates/`,
    description: a.description || a.external_link || "",
    date: a.date ? new Date(a.date) : new Date(),
    category: a.category?.[0]?.title || "Game Update",
    image: a.banner?.url || null,
    source: "playvalorant.com",
  }));
}

/**
 * Source 2: Riot Games official news RSS (covers all Riot titles, we filter)
 */
async function fetchFromRiotRSS() {
  try {
    const feed = await parser.parseURL(
      "https://www.riotgames.com/en/news?tags=valorant/rss.xml"
    );
    return (feed.items || []).map((item) => ({
      id: `riot-${item.guid || item.link}`,
      title: item.title,
      url: item.link,
      description: item.contentSnippet || item.content || "",
      date: item.pubDate ? new Date(item.pubDate) : new Date(),
      category: "Riot News",
      image: item.enclosure?.url || null,
      source: "riotgames.com",
    }));
  } catch {
    return []; // non-critical, silently skip
  }
}

/**
 * Source 3: Valorant server status API
 */
async function fetchServerStatus() {
  // AP = Asia Pacific (covers India, SEA, Japan, OCE)
  const url = "https://valorant.secure.dyn.riotcdn.net/channels/public/x/status/ap.json";
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const json = await res.json();

    const incidents = [
      ...(json.incidents || []),
      ...(json.maintenances || []),
    ];

    return incidents.map((inc) => {
      const latestUpdate = inc.updates?.[0];
      const translations = latestUpdate?.translations || [];
      const en = translations.find((t) => t.locale === "en_US") || translations[0] || {};

      // Key by incident *and* its latest update, so each new update Riot posts
      // to an ongoing incident/maintenance re-posts (scheduled → in_progress →
      // resolved) instead of being silently deduped against the first message.
      const updateKey =
        latestUpdate?.id || latestUpdate?.created_at || "init";
      const baseTitle =
        inc.titles?.find((t) => t.locale === "en_US")?.content ||
        `Server ${inc.incident_severity || "notice"}`;
      // Surface the current maintenance phase in the title for follow-up posts.
      const title = inc.maintenance_status
        ? `${baseTitle} — ${inc.maintenance_status}`
        : baseTitle;

      return {
        id: `status-${inc.id}-${updateKey}`,
        title,
        url: "https://status.riotgames.com/valorant?region=ap&locale=en_US",
        description: en.content || "Check Valorant server status for details.",
        date: latestUpdate?.created_at
          ? new Date(latestUpdate.created_at)
          : new Date(),
        category: inc.maintenance_status ? "Maintenance" : "Incident",
        image: null,
        source: "Riot Status",
      };
    });
  } catch {
    return [];
  }
}

// ─── Main fetch ─────────────────────────────────────────────────────────────

/**
 * Fetch updates from all sources, deduplicate, sort newest first.
 */
async function fetchAllUpdates() {
  const results = await Promise.allSettled([
    fetchFromContentAPI(),
    fetchFromRiotRSS(),
    fetchServerStatus(),
  ]);

  const updates = [];
  for (const r of results) {
    if (r.status === "fulfilled") updates.push(...r.value);
    else console.warn("⚠️  Source failed:", r.reason?.message);
  }

  // Dedupe by id
  const seen = new Set();
  const unique = updates.filter((u) => {
    if (seen.has(u.id)) return false;
    seen.add(u.id);
    return true;
  });

  // Sort newest first
  unique.sort((a, b) => b.date - a.date);
  return unique;
}

module.exports = { fetchAllUpdates };

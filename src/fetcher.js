const UA = "ValorantUpdateBot/1.0";

// ─── Sources ────────────────────────────────────────────────────────────────

/**
 * Source 1 (primary, reliable): Valorant client build version.
 *
 * valorant-api.com/v1/version is a public, no-auth, stable endpoint that
 * reflects the live game client build. When `data.version` changes, Riot
 * shipped a new build — this fires the instant a patch drops, even before any
 * news article exists. Keyed by version so the DB posts it exactly once per
 * build. This is HTML-independent and keeps working even if the site redesigns.
 */
async function fetchGameVersion() {
  try {
    const res = await fetch("https://valorant-api.com/v1/version", {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`version API returned ${res.status}`);
    const json = await res.json();
    const data = json?.data;
    if (!data?.version) return [];

    // "12.11.00.4738152" → "12.11" → patch-notes slug "valorant-patch-notes-12-11"
    const [major, minor] = data.version.split(".");
    const shortVer = `${major}.${minor}`;
    const patchNotesUrl = `https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-${major}-${minor}/`;
    const builtOn = data.buildDate
      ? new Date(data.buildDate).toISOString().slice(0, 10)
      : "recently";

    return [
      {
        id: `valver-${data.version}`,
        title: `🆕 New Valorant Build — Patch ${shortVer}`,
        url: patchNotesUrl,
        description: `Riot shipped a new Valorant client build (v${data.version}), built ${builtOn}. Patch notes & full details below.`,
        date: data.buildDate ? new Date(data.buildDate) : new Date(),
        category: "Game Update",
        image: null,
        source: "Riot Client",
      },
    ];
  } catch (err) {
    console.warn("⚠️  Version source failed:", err.message);
    return [];
  }
}

// Map a playvalorant URL category segment to one of our embed categories.
function categoryFromPath(segment, slug) {
  switch (segment) {
    case "game-updates":
      return slug.includes("patch-notes") ? "Patch Notes" : "Game Update";
    case "dev":
      return "Dev Diary";
    case "esports":
      return "Esports";
    case "announcements":
      return "Announcement";
    case "community":
      return "Community";
    default:
      return "Riot News";
  }
}

function matchMeta(html, property) {
  // Tolerate attribute ordering: property may come before or after content.
  const re = new RegExp(
    `<meta[^>]+property=["']${property}["'][^>]*content=["']([^"']*)["']`,
    "i"
  );
  const m = html.match(re);
  return m ? m[1] : "";
}

/**
 * Source 2: Valorant news via playvalorant.com (no-auth HTML scrape).
 *
 * The listing page is server-side rendered with plain <a href> links; each
 * article exposes og:title / og:description / og:image and a <time dateTime>.
 * FRAGILITY: this depends on the current site markup — if Riot redesigns,
 * news may break, but fetchGameVersion() still catches client patches.
 */
async function fetchValorantNews() {
  try {
    const res = await fetch("https://playvalorant.com/en-us/news/", {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`news listing returned ${res.status}`);
    const html = await res.text();

    // Extract unique article paths (listing is newest-first). Exclude the
    // category index pages themselves (those have no second path segment).
    const re = /\/en-us\/news\/([a-z0-9-]+)\/([a-z0-9-]+)\/?/gi;
    const seen = new Set();
    const candidates = [];
    let m;
    while ((m = re.exec(html)) !== null) {
      const [, segment, slug] = m;
      const key = `${segment}/${slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ segment, slug });
      if (candidates.length >= 12) break; // newest 12
    }

    const articles = await Promise.all(
      candidates.map(async ({ segment, slug }) => {
        try {
          const url = `https://playvalorant.com/en-us/news/${segment}/${slug}/`;
          const r = await fetch(url, {
            headers: { "User-Agent": UA },
            signal: AbortSignal.timeout(15_000),
          });
          if (!r.ok) return null;
          const page = await r.text();

          const title = matchMeta(page, "og:title") || slug.replace(/-/g, " ");
          const description = matchMeta(page, "og:description");
          const image = matchMeta(page, "og:image") || null;
          const timeMatch = page.match(/<time[^>]+dateTime=["']([^"']+)["']/i);
          const date = timeMatch ? new Date(timeMatch[1]) : new Date();

          return {
            id: `valnews-${slug}`,
            title,
            url,
            description,
            date,
            category: categoryFromPath(segment, slug),
            image,
            source: "playvalorant.com",
          };
        } catch {
          return null; // skip just this article
        }
      })
    );

    return articles.filter(Boolean);
  } catch (err) {
    console.warn("⚠️  News source failed:", err.message);
    return [];
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
    fetchGameVersion(),
    fetchValorantNews(),
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

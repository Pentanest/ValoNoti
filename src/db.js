const { readFileSync, writeFileSync, mkdirSync, existsSync } = require("fs");
const { resolve } = require("path");

const DATA_DIR = resolve(__dirname, "..", "data");
const DB_PATH = resolve(DATA_DIR, "posted.json");

mkdirSync(DATA_DIR, { recursive: true });

// Load existing data
function load() {
  if (!existsSync(DB_PATH)) return {};
  try {
    return JSON.parse(readFileSync(DB_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function save(data) {
  writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

module.exports = {
  /** Returns true if this update was already posted */
  alreadyPosted(id) {
    const data = load();
    return !!data[id];
  },

  /** Mark an update as posted */
  markPosted(id, title, url) {
    const data = load();
    data[id] = { title, url, postedAt: Date.now() };
    save(data);
  },

  /** Purge entries older than 90 days */
  cleanup() {
    const data = load();
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    let cleaned = 0;
    for (const [id, entry] of Object.entries(data)) {
      if (entry.postedAt < cutoff) {
        delete data[id];
        cleaned++;
      }
    }
    save(data);
    return cleaned;
  },
};

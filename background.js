/**
 * Service worker. Two jobs, both of them about keeping network out of the
 * content script.
 *
 * 1. Hand over the bundled rating table. The worker can read its own packaged
 *    files, so the table never has to become a web-accessible resource that
 *    leetcode.com could read back.
 *
 * 2. Optionally refresh that table from the upstream dataset. This is off by
 *    default and behind an optional host permission the user grants on the
 *    options page, never at install. The permission is re-checked on every
 *    single call, so revoking it at the extensions page stops the traffic
 *    immediately rather than at the next reload.
 *
 * v1's worker existed only to read cookies and hand them to a fetch that could
 * not use them. That whole path, and the "cookies" permission, is gone.
 */

const UPSTREAM = "https://raw.githubusercontent.com/zerotrac/leetcode_problem_rating/main/ratings.txt";
const LIVE_KEY = "lca2:ratings:live";
const LIVE_TTL = 7 * 24 * 60 * 60 * 1000;

let bundled = null;

async function readBundled() {
  if (bundled) return bundled;
  const res = await fetch(chrome.runtime.getURL("data/ratings.tsv"));
  if (!res.ok) throw new Error(`bundled table missing (${res.status})`);
  bundled = await res.text();
  return bundled;
}

function hasUpstreamPermission() {
  return new Promise((resolve) => {
    chrome.permissions.contains({ origins: ["https://raw.githubusercontent.com/*"] }, (granted) =>
      resolve(!!granted && !chrome.runtime.lastError)
    );
  });
}

function cacheGet(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (res) => {
      const box = res && res[key];
      if (!box || !Number.isFinite(box.exp) || Date.now() > box.exp) return resolve(null);
      resolve(box);
    });
  });
}

/**
 * Convert the upstream file into the same shape as the bundled one, so the
 * parser has exactly one format to understand. Upstream columns are checked
 * by name: if the dataset changes shape, this returns null and the bundled
 * table is used, rather than producing a table of NaN.
 */
function convertUpstream(text) {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2) return null;
  const header = lines[0].split("\t").map((h) => h.trim());
  const idx = {
    rating: header.indexOf("Rating"),
    id: header.indexOf("ID"),
    title: header.indexOf("Title"),
    slug: header.indexOf("Title Slug"),
    contest: header.indexOf("Contest Slug"),
    index: header.indexOf("Problem Index"),
  };
  if (Object.values(idx).some((i) => i === -1)) return null;

  const seen = new Set();
  const rows = [];
  for (const line of lines.slice(1)) {
    const f = line.split("\t");
    const slug = (f[idx.slug] || "").trim().toLowerCase();
    const rating = Math.round(parseFloat(f[idx.rating]));
    if (!slug || !Number.isFinite(rating) || seen.has(slug)) continue;
    seen.add(slug);
    rows.push([slug, String(rating), (f[idx.id] || "").trim(), (f[idx.contest] || "").trim(), (f[idx.index] || "").trim(), (f[idx.title] || "").trim()].join("\t"));
  }
  if (rows.length < 1000) return null;
  rows.sort();

  const stamp = new Date().toISOString().slice(0, 10);
  return `# refreshed from upstream\n# snapshot ${stamp}\t${rows.length}\nslug\trating\tid\tcontest\tindex\ttitle\n` + rows.join("\n") + "\n";
}

async function ratingsText(wantLive) {
  if (!wantLive) return { text: await readBundled(), source: "bundled" };

  const cached = await cacheGet(LIVE_KEY);
  if (cached && cached.v) return { text: cached.v, source: "live", fetchedAt: cached.at };

  if (!(await hasUpstreamPermission())) {
    return { text: await readBundled(), source: "bundled", note: "live refresh is on but the permission is not granted" };
  }

  try {
    const res = await fetch(UPSTREAM, { cache: "no-cache" });
    if (!res.ok) throw new Error(String(res.status));
    const converted = convertUpstream(await res.text());
    if (!converted) throw new Error("upstream format changed");
    await chrome.storage.local.set({ [LIVE_KEY]: { v: converted, at: Date.now(), exp: Date.now() + LIVE_TTL } });
    return { text: converted, source: "live", fetchedAt: Date.now() };
  } catch (err) {
    // Any failure falls back to the shipped table. A refresh that cannot
    // happen must never be the reason a chart is empty.
    return { text: await readBundled(), source: "bundled", note: "refresh failed: " + err.message };
  }
}

// Clicking the toolbar icon opens the options page. There is no popup
// because there is nothing a popup could say that the panel on the page does
// not say better.
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "LCA_RATINGS") {
    ratingsText(!!msg.live)
      .then((r) => sendResponse(Object.assign({ ok: true }, r)))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message) }));
    return true;
  }

  if (msg.type === "LCA_DROP_LIVE") {
    chrome.storage.local.remove([LIVE_KEY], () => sendResponse({ ok: true }));
    return true;
  }
});

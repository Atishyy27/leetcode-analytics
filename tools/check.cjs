/**
 * The build check. Run it before loading the extension, every time.
 *
 * It exists because of one line in v1's manifest: the content script list
 * named "libs/chart.min.js" and the file on disk was "libs/chart.umd.min.js".
 * Chrome refuses to load an extension whose content script is missing, so the
 * repo as committed did not run at all, and nothing in the project would ever
 * have told anyone. Every check below is a thing that is invisible until a
 * user hits it.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const problems = [];
const notes = [];
let checks = 0;

function check(what, cond, detail) {
  checks++;
  if (!cond) problems.push(detail ? `${what}: ${detail}` : what);
}

function rel(p) {
  return path.relative(ROOT, p);
}

// --- manifest ---------------------------------------------------------------
const manifestPath = path.join(ROOT, "manifest.json");
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  check("manifest.json parses", true);
} catch (err) {
  console.log(`FAIL  manifest.json does not parse: ${err.message}`);
  process.exit(1);
}

const referenced = new Set();
function mustExist(p, why) {
  const abs = path.join(ROOT, p);
  referenced.add(path.normalize(p));
  check(`${why} exists`, fs.existsSync(abs), `${p} is referenced but not on disk`);
}

for (const cs of manifest.content_scripts || []) {
  for (const js of cs.js || []) mustExist(js, `content script ${js}`);
  for (const css of cs.css || []) mustExist(css, `stylesheet ${css}`);
}
if (manifest.background && manifest.background.service_worker) {
  mustExist(manifest.background.service_worker, "service worker");
}
if (manifest.options_ui && manifest.options_ui.page) {
  mustExist(manifest.options_ui.page, "options page");
}
for (const size of Object.keys(manifest.icons || {})) {
  mustExist(manifest.icons[size], `icon ${size}`);
}

// --- no orphan modules ------------------------------------------------------
// A module written and then never listed in the manifest is dead code that
// looks alive. Same class of mistake as a component that is never mounted.
function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}
const srcFiles = walk(path.join(ROOT, "src"), []);
for (const f of srcFiles) {
  const r = path.normalize(rel(f));
  check(`${r} is loaded`, referenced.has(r), `${r} exists in src/ but no manifest entry loads it`);
}

// --- no stray scripts at the root ------------------------------------------
// v1's content.js is fully superseded by src/. A leftover copy at the root is
// not loaded by anything but is the first file a reader opens.
for (const f of fs.readdirSync(ROOT)) {
  if (!f.endsWith(".js")) continue;
  if (f === "background.js" || f === "options.js") continue;
  check(`no stray script ${f}`, false, `${f} sits at the root and nothing loads it`);
}

// --- every script parses ----------------------------------------------------
const allJs = srcFiles.concat([
  path.join(ROOT, "background.js"),
  path.join(ROOT, "options.js"),
]);
for (const f of allJs) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
    check(`${rel(f)} parses`, true);
  } catch (err) {
    check(`${rel(f)} parses`, false, String(err.stderr || err.message).split("\n")[0]);
  }
}

// --- permissions ------------------------------------------------------------
const perms = (manifest.permissions || []).slice().sort();
check("permissions are only what is used", JSON.stringify(perms) === JSON.stringify(["storage"]),
  `expected exactly ["storage"], found ${JSON.stringify(perms)}`);
check("no cookies permission", !perms.includes("cookies"),
  "v1 asked for cookies to set a Cookie header the browser strips; it must not come back");
check("no host_permissions granted up front", !(manifest.host_permissions || []).length,
  `host_permissions should be empty, found ${JSON.stringify(manifest.host_permissions)}`);
check("the upstream dataset host is optional only",
  (manifest.optional_host_permissions || []).includes("https://raw.githubusercontent.com/*"),
  "the GitHub refresh must be an optional permission");
check("nothing is web accessible", !(manifest.web_accessible_resources || []).length,
  "a web-accessible resource lets leetcode.com detect the extension");

// --- the data file ----------------------------------------------------------
const dataPath = path.join(ROOT, "data", "ratings.tsv");
check("data/ratings.tsv exists", fs.existsSync(dataPath));
if (fs.existsSync(dataPath)) {
  const R = require("../src/core/ratings.js");
  const parsed = R.parseTable(fs.readFileSync(dataPath, "utf8"));
  check("the rating table holds the rows it declares", parsed.count === parsed.declared,
    `declares ${parsed.declared}, parses ${parsed.count}`);
  check("the rating table is not obviously truncated", parsed.count > 2000, `only ${parsed.count} rows`);
  check("the rating table has a snapshot date", /^\d{4}-\d{2}-\d{2}$/.test(parsed.snapshot), parsed.snapshot);

  const age = (Date.now() - Date.parse(parsed.snapshot)) / 86400000;
  if (age > 60) notes.push(`the bundled rating snapshot is ${Math.round(age)} days old; re-run tools/build-data.cjs`);
}

// --- no leftovers from v1 ---------------------------------------------------
check("Chart.js is gone", !fs.existsSync(path.join(ROOT, "libs")),
  "libs/ still exists; v2 draws its own SVG and must not ship a chart library");
const manifestText = fs.readFileSync(manifestPath, "utf8");
check("the manifest does not reference libs/", manifestText.indexOf("libs/") === -1);

// --- stylesheet is namespaced ----------------------------------------------
// A content script that leaks a bare rule restyles leetcode.com itself.
const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const selectors = [];
for (const block of css.split("}")) {
  const head = block.split("{")[0].trim();
  if (!head || block.indexOf("{") === -1) continue;
  for (const sel of head.split(",")) {
    const s = sel.trim();
    if (!s || s.startsWith("@") || /^\d+%$/.test(s) || s === "to" || s === "from") continue;
    selectors.push(s);
  }
}
const leaked = selectors.filter((s) => !s.startsWith(".lca-") && !s.startsWith(":root"));
check("every CSS rule is namespaced", leaked.length === 0,
  `these would style leetcode.com itself: ${leaked.slice(0, 5).join(" | ")}`);
check("the stylesheet has rules at all", selectors.length > 40, `only ${selectors.length} selectors`);

// --- options page -----------------------------------------------------------
const optionsHtml = fs.readFileSync(path.join(ROOT, "options.html"), "utf8");
for (const m of optionsHtml.matchAll(/<script[^>]+src="([^"]+)"/g)) {
  check(`options.html script ${m[1]} exists`, fs.existsSync(path.join(ROOT, m[1])));
}
// Inline handlers would need a CSP exemption and are a smell in an extension page.
check("options.html has no inline event handlers", !/\son[a-z]+="/.test(optionsHtml));

// --- report -----------------------------------------------------------------
for (const n of notes) console.log(`NOTE  ${n}`);
if (problems.length === 0) {
  console.log(`PASS  ${checks}/${checks} checks`);
  process.exit(0);
}
console.log(`FAIL  ${problems.length} of ${checks} checks`);
for (const p of problems) console.log(`   -  ${p}`);
process.exit(1);

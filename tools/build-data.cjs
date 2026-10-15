// tools/build-data.cjs
// Turns zerotrac's ratings.txt into the compact table the extension ships.
//
// Why ship the data instead of fetching it: a fetch to raw.githubusercontent.com
// on every profile view is a third-party request that tells GitHub when this
// user opens LeetCode, costs a round trip before anything renders, and needs a
// host permission that makes the Web Store listing scarier than the extension
// is. The dataset changes once a week when a contest ends, so a bundled
// snapshot plus an opt-in refresh is strictly better on every axis except
// freshness, and the UI prints the snapshot date so staleness is visible.
//
//   node tools/build-data.cjs path/to/ratings.txt
//
// Input columns:  Rating, ID, Title, Title ZH, Title Slug, Contest Slug, Problem Index
// Output columns: slug, rating, id, contest, index, title
// Title ZH is dropped (28% of the bytes, no use here).

const fs = require("node:fs");
const path = require("node:path");

const src = process.argv[2];
if (!src) {
  console.error("usage: node tools/build-data.cjs <ratings.txt>");
  process.exit(2);
}

const text = fs.readFileSync(src, "utf8");
const lines = text.split("\n").filter((l) => l.trim() !== "");
const header = lines[0].split("\t").map((h) => h.trim());

const need = ["Rating", "ID", "Title", "Title Slug", "Contest Slug", "Problem Index"];
const col = {};
for (const n of need) {
  const i = header.indexOf(n);
  if (i === -1) {
    console.error(`FAIL: upstream column "${n}" is gone. Header is now: ${header.join(" | ")}`);
    process.exit(1);
  }
  col[n] = i;
}

const seen = new Set();
const rows = [];
let dropped = 0;

for (const line of lines.slice(1)) {
  const f = line.split("\t");
  const slug = (f[col["Title Slug"]] || "").trim().toLowerCase();
  const rating = Math.round(parseFloat(f[col.Rating]));
  if (!slug || !Number.isFinite(rating)) {
    dropped++;
    continue;
  }
  // A slug appearing twice would silently make one rating win at Map build
  // time. Keep the first and count the rest rather than pretend it cannot
  // happen.
  if (seen.has(slug)) {
    dropped++;
    continue;
  }
  seen.add(slug);
  rows.push([
    slug,
    String(rating),
    (f[col.ID] || "").trim(),
    (f[col["Contest Slug"]] || "").trim(),
    (f[col["Problem Index"]] || "").trim(),
    (f[col.Title] || "").trim().replace(/\t/g, " "),
  ].join("\t"));
}

rows.sort();

const stamp = new Date().toISOString().slice(0, 10);
const out =
  `# leetcode problem ratings, from github.com/zerotrac/leetcode_problem_rating\n` +
  `# snapshot ${stamp}\t${rows.length}\n` +
  `slug\trating\tid\tcontest\tindex\ttitle\n` +
  rows.join("\n") + "\n";

const dest = path.join(__dirname, "..", "data", "ratings.tsv");
fs.writeFileSync(dest, out);

const before = Buffer.byteLength(text);
const after = Buffer.byteLength(out);
console.log(`PASS  ${rows.length} problems, ${dropped} dropped`);
console.log(`      ${(before / 1024).toFixed(0)}K in -> ${(after / 1024).toFixed(0)}K out`);
console.log(`      snapshot ${stamp} -> data/ratings.tsv`);

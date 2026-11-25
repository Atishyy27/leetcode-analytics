// The rating refresh path: the stale line, the upstream converter, and the
// build-data tool. The upstream file here is synthetic, nothing is fetched.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const T = require("./harness.cjs");
const F = require("../src/core/freshen.js");
const R = require("../src/core/ratings.js");

// --- stale line -------------------------------------------------------------
const now = Date.parse("2026-11-25T12:00:00Z");
T.eq(F.snapshotAgeDays("2026-10-15", now), 41, "15 Oct to 25 Nov is 41 days");
const line = F.staleLine("2026-10-15", now);
T.ok(/41 days old/.test(line), "the line says how old");
T.ok(/weekly refresh/.test(line), "the line says what to do");
T.eq(F.staleLine("2026-11-04", now), null, "21 days old is not stale yet");
T.ok(F.staleLine("2026-11-03", now) !== null, "22 days old is stale");
T.eq(F.staleLine("2026-11-25", now), null, "today is not stale");
T.eq(F.staleLine("2027-01-01", now), null, "a snapshot dated in the future is not stale");
T.eq(F.staleLine("", now), null, "no snapshot date gives no line");
T.eq(F.staleLine("garbage", now), null, "an unreadable date gives no line");

// --- convertUpstream --------------------------------------------------------
global.chrome = { action: { onClicked: { addListener() {} } }, runtime: { onMessage: { addListener() {} } } };
const { convertUpstream } = require("../background.js");

const HEAD = ["Rating", "ID", "Title", "Title ZH", "Title Slug", "Contest Slug", "Problem Index"];
function upstream(n, head) {
  const lines = [(head || HEAD).join("\t")];
  for (let i = 0; i < n; i++) {
    lines.push([1200 + (i % 1500) + 0.4, 100 + i, "Problem " + i, "zh", "problem-" + i, "weekly-contest-" + (60 + (i % 400)), "Q" + (1 + (i % 4))].join("\t"));
  }
  return lines.join("\n") + "\n";
}

const good = convertUpstream(upstream(1200));
T.ok(typeof good === "string", "a good upstream file converts");
const parsed = R.parseTable(good);
T.eq(parsed.count, 1200, "all 1200 rows survive");
T.eq(parsed.count, parsed.declared, "the converted table holds the rows it declares");
T.eq(parsed.bySlug.get("problem-0").rating, 1200, "ratings are rounded");
T.ok(/^\d{4}-\d{2}-\d{2}$/.test(parsed.snapshot), "the converted table carries a snapshot date");

T.eq(convertUpstream(upstream(999)), null, "under 1000 rows is refused");
T.eq(convertUpstream(upstream(1200, ["Elo", "ID", "Title", "Title ZH", "Title Slug", "Contest Slug", "Problem Index"])), null, "a renamed Rating column is refused, not turned into NaN");
T.eq(convertUpstream(""), null, "empty text is refused");
T.eq(convertUpstream(HEAD.join("\t") + "\n"), null, "header only is refused");

const dup = upstream(1200) + ["1500", "1", "Dup", "zh", "problem-0", "weekly-contest-1", "Q1"].join("\t") + "\n";
T.eq(R.parseTable(convertUpstream(dup)).count, 1200, "a repeated slug is kept once");

const junk = upstream(1200) + ["abc", "1", "Bad", "zh", "bad-rating", "weekly-contest-1", "Q1"].join("\t") + "\n";
T.eq(R.parseTable(convertUpstream(junk)).count, 1200, "a row with a non-numeric rating is dropped");

// --- build-data -------------------------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lca-build-"));
const input = path.join(dir, "ratings.txt");
const output = path.join(dir, "out.tsv");
fs.writeFileSync(input, upstream(1500) + ["1500", "1", "Dup", "zh", "problem-3", "weekly-contest-1", "Q1"].join("\t") + "\n");
const out = execFileSync(process.execPath, [path.join(__dirname, "..", "tools", "build-data.cjs"), input, output], { encoding: "utf8" });
T.ok(/PASS\s+1500 problems, 1 dropped/.test(out), "build-data reports 1500 problems and 1 dropped duplicate");
const built = R.parseTable(fs.readFileSync(output, "utf8"));
T.eq(built.count, 1500, "build-data row count equals the unique slugs in the input");
T.eq(built.count, built.declared, "build-data declares the rows it wrote");
fs.rmSync(dir, { recursive: true, force: true });

// --- the shipped table ------------------------------------------------------
const shipped = R.parseTable(fs.readFileSync(path.join(__dirname, "..", "data", "ratings.tsv"), "utf8"));
T.ok(shipped.count > 2600, "the shipped table has more than 2600 rows");
T.eq(shipped.count, shipped.declared, "the shipped table holds the rows it declares");

process.exit(T.report("refresh"));

const fs = require("node:fs");
const path = require("node:path");
const t = require("./harness.cjs");
const R = require("../src/core/ratings.js");

// --- parseTable -------------------------------------------------------------
const FIXTURE = [
  "# a comment line that must be skipped",
  "# snapshot 2026-10-15\t3",
  "slug\trating\tid\tcontest\tindex\ttitle",
  "alpha\t1500\t1\tweekly-contest-100\tQ2\tAlpha",
  "BETA\t1700.6\t2\tbiweekly-contest-40\tQ3\tBeta\r",
  "",
  "broken-row-no-rating\t\t3\t\t\t",
  "gamma\t2400\t4\tweekly-contest-300\tQ4\tGamma",
].join("\n");

const parsed = R.parseTable(FIXTURE);
t.eq(parsed.count, 3, "parseTable keeps only rows with a usable rating");
t.eq(parsed.snapshot, "2026-10-15", "parseTable reads the snapshot date out of the comment");
t.eq(parsed.declared, 3, "parseTable reads the declared row count");
t.ok(parsed.bySlug.has("beta"), "parseTable lowercases slugs, so a capitalised slug still matches");
t.eq(parsed.bySlug.get("beta").rating, 1700.6, "parseTable keeps a fractional rating as-is");
t.eq(parsed.bySlug.get("beta").title, "Beta", "parseTable strips the carriage return a CRLF file leaves on the last field");
t.ok(!parsed.bySlug.has("broken-row-no-rating"), "a row with no rating is dropped rather than stored as NaN");

// The shipped table must match its own declared count. This catches a
// truncated or half-written data file, which would otherwise show up as
// quietly missing problems rather than as an error.
const real = R.parseTable(fs.readFileSync(path.join(__dirname, "..", "data", "ratings.tsv"), "utf8"));
t.eq(real.count, real.declared, `shipped table holds the ${real.declared} rows it says it holds`);
t.ok(real.count > 2000, "shipped table has a plausible number of problems");
t.ok(/^\d{4}-\d{2}-\d{2}$/.test(real.snapshot), "shipped table carries a snapshot date");

// --- bucketOf ---------------------------------------------------------------
t.eq(R.bucketOf(1500), 1500, "a rating on a band edge belongs to that band");
t.eq(R.bucketOf(1599.99), 1500, "a rating just under the next edge stays in the lower band");
t.eq(R.bucketOf(1600), 1600, "the next edge starts the next band");
t.eq(R.bucketOf(1750, 250), 1750, "a custom band size is respected");

// --- histogram: the v1 bug --------------------------------------------------
// v1 built labels from the brackets that happened to be present, so an empty
// band vanished and the two either side were drawn adjacent.
const h = R.histogram([1500, 1500, 1800]);
t.eq(h.map((b) => b.bucket), [1500, 1600, 1700, 1800], "histogram emits every band between min and max, including empty ones");
t.eq(h.map((b) => b.count), [2, 0, 0, 1], "the empty bands come back as zero, not as gaps");
t.eq(R.histogram([]), [], "an empty input gives an empty histogram rather than throwing");
t.eq(R.histogram([1500, NaN, null]).length, 1, "non-numbers are ignored");

// --- percentile -------------------------------------------------------------
t.eq(R.percentile([1, 2, 3, 4], 50), 2.5, "p50 interpolates between the two middle values");
t.near(R.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9.1, 1e-9, "p90 matches the linear-interpolation definition");
t.eq(R.percentile([5], 90), 5, "a single value is every percentile");
t.eq(R.percentile([], 50), null, "no values gives null, not zero");
t.eq(R.percentile([3, 1, 2], 0), 1, "input does not have to be sorted");
t.eq(R.percentile([3, 1, 2], 100), 3, "p100 is the maximum");

// --- topKMean ---------------------------------------------------------------
t.eq(R.topKMean([1000, 2000, 3000], 2), 2500, "top-2 mean takes the two largest");
t.eq(R.topKMean([1000, 2000], 10), 1500, "asking for more than exists averages what exists");
t.eq(R.topKMean([], 5), null, "no values gives null");

// --- summarise --------------------------------------------------------------
const s = R.summarise([1200, 1400, 1600, 1800, 2000]);
t.eq([s.n, s.min, s.max, s.median], [5, 1200, 2000, 1600], "summarise reports n, min, max and median");
t.eq(s.mean, 1600, "summarise reports the mean");
t.eq(R.summarise([]).n, 0, "summarising nothing gives n 0 and nulls, not NaN");
t.eq(R.summarise([]).median, null, "median of nothing is null");

// --- contest helpers --------------------------------------------------------
t.eq(R.indexBreakdown([{ index: "Q1" }, { index: "Q4" }, { index: "Q4" }, { index: "Q5" }]),
  { Q1: 1, Q2: 0, Q3: 0, Q4: 2, other: 1 }, "index breakdown counts each slot and buckets the rest");
t.eq(R.contestKind("biweekly-contest-40"), "biweekly", "biweekly is recognised");
t.eq(R.contestKind("weekly-contest-400"), "weekly", "weekly is recognised");
t.eq(R.contestKind("some-other-thing"), "other", "an unknown contest slug is not forced into one of the two");
t.eq(R.contestNumber("weekly-contest-412"), 412, "the contest number is pulled off the slug");
t.eq(R.contestNumber(""), null, "no slug gives null rather than 0, which would sort as the first contest");

process.exit(t.report("ratings") ? 1 : 0);

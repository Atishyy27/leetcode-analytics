const t = require("./harness.cjs");
const A = require("../src/core/analysis.js");

/**
 * A universe with hand-checkable numbers.
 * Band 1500: ten problems, six solved  -> coverage 0.6
 * Band 1600: ten problems, four solved -> coverage 0.4
 * Tag "array" sits on all ten 1500s.
 * Tag "dp" sits on the five unsolved-ish 1500s and five 1600s.
 */
function universe() {
  const out = [];
  for (let i = 0; i < 10; i++) {
    out.push({
      slug: "p" + i, title: "P" + i, rating: 1500 + i, index: "Q2", contest: "weekly-contest-100",
      solved: i < 6, paidOnly: false, tags: ["array"].concat(i >= 5 ? ["dp"] : []),
    });
  }
  for (let i = 0; i < 10; i++) {
    out.push({
      slug: "q" + i, title: "Q" + i, rating: 1600 + i, index: "Q3", contest: "weekly-contest-101",
      solved: i < 4, paidOnly: false, tags: i >= 5 ? ["dp"] : ["greedy"],
    });
  }
  return out;
}

// --- coverageCurve ----------------------------------------------------------
const curve = A.coverageCurve(universe());
t.eq(curve.map((c) => c.bucket), [1500, 1600], "the curve covers both bands");
t.eq(curve.map((c) => c.rate), [0.6, 0.4], "coverage is solved over available, band by band");
t.eq(curve.map((c) => [c.solved, c.total]), [[6, 10], [4, 10]], "the curve carries the raw counts too");
t.eq(A.coverageCurve([]), [], "an empty universe gives an empty curve, not a throw");

// A band with no problems at all between two that have some must still appear,
// otherwise the x-axis silently compresses.
const gapped = [
  { rating: 1500, solved: true, tags: [] },
  { rating: 1700, solved: false, tags: [] },
];
t.eq(A.coverageCurve(gapped).map((c) => c.bucket), [1500, 1600, 1700], "an empty band in the middle is still emitted");
t.eq(A.coverageCurve(gapped)[1].rate, null, "a band with no problems has a null rate, not a zero");

// --- crossoverRating --------------------------------------------------------
t.eq(A.crossoverRating(curve, 0.5), 1550, "the 50% crossing is interpolated between the bands either side");
t.eq(A.crossoverRating(curve, 0.45), 1575, "a different threshold moves the crossing proportionally");
t.eq(A.crossoverRating([{ bucket: 1500, total: 10, rate: 0.9 }], 0.5), null, "one band cannot define a crossing");
t.eq(A.crossoverRating([{ bucket: 1500, total: 10, rate: 0.2 }, { bucket: 1600, total: 10, rate: 0.1 }], 0.5), null,
  "a curve that starts below the threshold never crosses it, and says so with null");

// A tiny band must not be allowed to invent a crossing: two problems at 1400
// that you both solved is not evidence of 100% coverage at 1400.
const tiny = [
  { bucket: 1400, total: 2, rate: 1 },
  { bucket: 1500, total: 10, rate: 0.4 },
];
t.eq(A.crossoverRating(tiny, 0.5), null, "bands below the sample floor are ignored");
t.near(A.crossoverRating(tiny, 0.5, 1), 1400 + 100 * (0.5 / 0.6), 1e-9, "lowering the sample floor lets the same curve cross, five sixths of the way across the gap");

// --- topicMatrix ------------------------------------------------------------
const m = A.topicMatrix(universe(), 100, { maxTopics: 10 });
t.eq(m.bands, [1500, 1600], "the matrix shares the curve's bands");
const arrayRow = m.rows.find((r) => r.topic === "array");
t.eq([arrayRow.total, arrayRow.solved], [10, 6], "a topic row totals its own problems");
t.eq(arrayRow.cells.map((c) => c.total), [10, 0], "a topic with nothing in a band gets a zero-total cell");
t.eq(arrayRow.cells[1].rate, null, "an empty cell has a null rate so it can be drawn hollow");
t.eq(m.rows[0].total >= m.rows[m.rows.length - 1].total, true, "rows come back ordered by how many problems the topic has");

// --- weakTopics -------------------------------------------------------------
const weak = A.weakTopics(universe(), 100, { minTotal: 5 });
const dp = weak.find((w) => w.topic === "dp");
const array = weak.find((w) => w.topic === "array");
t.eq([dp.total, dp.solved], [10, 1], "dp spans both bands and you solved one of them");
t.near(dp.expected, 5, 1e-9, "expected is the sum of your own coverage over that topic's bands: five at 0.6 plus five at 0.4");
t.near(dp.deficit, 4, 1e-9, "the deficit is expected minus solved, in problems");
t.near(array.deficit, 0, 1e-9, "a topic you solve at exactly your own rate has no deficit");
t.eq(weak[0].topic, "dp", "the list is sorted worst first");
t.eq(A.weakTopics(universe(), 100, { minTotal: 50 }).length, 0, "topics below the sample floor are dropped entirely");

// --- recommend --------------------------------------------------------------
const uni2 = universe().concat([
  { slug: "paid", title: "Paid", rating: 1600, solved: false, paidOnly: true, tags: ["dp"], index: "Q3", contest: "x" },
  { slug: "far", title: "Far", rating: 2400, solved: false, paidOnly: false, tags: ["dp"], index: "Q4", contest: "x" },
]);
const recs = A.recommend(uni2, { target: 1620, weakTopics: weak, count: 20 });
t.ok(recs.every((r) => r.slug !== "p0"), "a solved problem is never recommended");
t.ok(recs.every((r) => r.slug !== "paid"), "a premium problem is not recommended by default");
t.ok(recs.every((r) => r.slug !== "far"), "a problem far outside the window is not recommended");
t.ok(recs.length > 0, "something is recommended for a reachable target");
t.ok(recs.some((r) => r.tags.includes("dp")), "the weak topic shows up in the list");
const dpFirst = recs.findIndex((r) => r.tags.includes("dp"));
const greedyFirst = recs.findIndex((r) => r.tags.includes("greedy"));
t.ok(dpFirst < greedyFirst || greedyFirst === -1, "between problems of similar rating, the weak topic ranks higher");
t.eq(A.recommend(uni2, { target: 1620, includePaid: true, count: 50 }).some((r) => r.slug === "paid"), true,
  "premium problems come back when they are asked for");
t.eq(A.recommend(uni2, {}), [], "no target means no recommendations rather than a guess");

// --- revisionQueue ----------------------------------------------------------
const now = 1_760_000_000;
const day = 86400;
const q = A.revisionQueue(
  [
    { slug: "recent", title: "Recent", rating: 2000, solvedAt: now - 10 * day },
    { slug: "mid", title: "Mid", rating: 1800, solvedAt: now - 30 * day },
    { slug: "old-easy", title: "Old easy", rating: 1200, solvedAt: now - 100 * day },
  ],
  now,
  { level: 1600, count: 10 }
);
t.eq(q.map((x) => x.slug), ["mid", "old-easy"], "anything solved inside the minimum window is left out, and the rest rank by staleness weighted by how hard it was for you");
t.near(q[0].days, 30, 0.01, "the age is reported in days");
t.eq(A.revisionQueue([{ slug: "x", rating: 1500, solvedAt: NaN }], now, {}), [], "an item with no date is skipped rather than treated as epoch zero");

// --- calibration ------------------------------------------------------------
t.eq(A.calibration(1900, 1500).gap, 400, "the gap is practice minus contest");
t.ok(/time pressure/i.test(A.calibration(1900, 1500).reading), "a large positive gap reads as a time-pressure problem");
t.ok(/contest form/i.test(A.calibration(1300, 1700).reading), "a large negative gap reads the other way");
t.ok(/agree/i.test(A.calibration(1600, 1550).reading), "a small gap says the two measurements agree");
t.eq(A.calibration(null, 1500).gap, null, "a missing practice level gives a null gap, never a number");
t.eq(A.calibration(1600, null).reading, null, "a missing contest rating gives no reading at all");

// --- slotCoverage -----------------------------------------------------------
const slots = A.slotCoverage(universe());
t.eq(slots.map((s) => s.slot), ["Q1", "Q2", "Q3", "Q4"], "all four slots are always reported");
t.eq(slots[1], { slot: "Q2", total: 10, solved: 6, rate: 0.6 }, "a slot's rate is its own solved over its own total");
t.eq(slots[0].rate, null, "a slot with no problems has a null rate rather than dividing by zero");

process.exit(t.report("analysis") ? 1 : 0);

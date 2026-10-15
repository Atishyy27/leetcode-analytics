const t = require("./harness.cjs");
const S = require("../src/core/svg.js");

// --- escaping: the one that matters ----------------------------------------
// Problem titles come from LeetCode and land inside <title> elements in the
// charts. Nothing stops a title from containing a bracket.
t.eq(S.esc(`a & b < c > d " e ' f`), "a &amp; b &lt; c &gt; d &quot; e &#39; f", "all five markup characters are escaped");
t.eq(S.esc(null), "", "null escapes to an empty string rather than the word null");
t.eq(S.esc(0), "0", "a zero survives, which a truthiness check would have eaten");

const nasty = `</title><script>alert(1)</script>`;
const chart = S.scatterOverTime([
  { t: 1, rating: 1500, title: nasty, slug: "x" },
  { t: 2, rating: 1600, title: "ok", slug: "y" },
]);
t.ok(chart.indexOf("<script") === -1, "a problem title cannot open a script tag inside a chart");
t.ok(chart.indexOf("&lt;script&gt;") !== -1, "the hostile title is still shown, escaped");

// --- coverageChart ----------------------------------------------------------
const curve = [
  { bucket: 1500, solved: 6, total: 10, rate: 0.6 },
  { bucket: 1600, solved: 4, total: 10, rate: 0.4 },
  { bucket: 1700, solved: 0, total: 8, rate: 0 },
];
const cc = S.coverageChart(curve, { crossover: 1550 });
t.eq((cc.match(/<svg/g) || []).length, 1, "one chart is one svg element");
t.eq((cc.match(/<\/svg>/g) || []).length, 1, "and it is closed exactly once");
t.eq((cc.match(/class="lca-bar"/g) || []).length, 3, "one bar per band, including the band with nothing solved");
t.ok(cc.indexOf("half-solved at 1550") !== -1, "the crossover marker is labelled with its own number");
t.ok(cc.indexOf("solved 6 of 10") !== -1, "each bar carries a tooltip with the counts behind it");
t.ok(S.coverageChart([]).indexOf("No rated problems") !== -1, "an empty curve renders a message, not a broken axis");

// A crossover outside the charted range must not be drawn at the edge, which
// would be a line claiming something the data does not say.
t.ok(S.coverageChart(curve, { crossover: 900 }).indexOf("half-solved") === -1, "a crossover below the first band is not drawn");
t.ok(S.coverageChart(curve, { crossover: 2600 }).indexOf("half-solved") === -1, "a crossover above the last band is not drawn");

// --- heatmap ----------------------------------------------------------------
const matrix = {
  bands: [1500, 1600],
  rows: [
    { topic: "array", total: 10, solved: 6, rate: 0.6, cells: [
      { bucket: 1500, total: 10, solved: 6, rate: 0.6 },
      { bucket: 1600, total: 0, solved: 0, rate: null },
    ] },
  ],
};
const hm = S.heatmap(matrix);
t.eq((hm.match(/lca-cell-empty/g) || []).length, 1, "a band holding no problems with that tag is drawn hollow");
t.eq((hm.match(/<rect class="lca-cell"/g) || []).length, 1, "and the populated cell is a normal cell");
t.ok(hm.indexOf("array 1500: 6 of 10") !== -1, "every cell says what it is counting");
t.ok(S.heatmap({ bands: [], rows: [] }).indexOf("Not enough") !== -1, "an empty matrix says so");

// --- hbars ------------------------------------------------------------------
const bars = S.hbars([
  { label: "dp", value: 4, note: "1/10" },
  { label: "greedy", value: -2, note: "6/10" },
]);
t.eq((bars.match(/lca-bar-neg/g) || []).length, 1, "only the negative value gets the negative class");
t.ok(bars.indexOf(">dp<") !== -1, "labels are rendered");
t.ok(S.hbars([], { empty: "nothing here" }).indexOf("nothing here") !== -1, "an empty series renders the caller's message");

// A single bar must not divide by a zero maximum.
t.ok(S.hbars([{ label: "x", value: 0, note: "" }]).indexOf("<svg") === 0, "an all-zero series still renders");

// --- scatterOverTime --------------------------------------------------------
t.ok(S.scatterOverTime([{ t: 1, rating: 1500 }]).indexOf("Not enough") !== -1, "one point is not a scatter plot");
const sc = S.scatterOverTime([
  { t: 100, rating: 1500, title: "a" },
  { t: 200, rating: 1700, title: "b" },
  { t: 300, rating: 1600, title: "c" },
]);
t.eq((sc.match(/class="lca-dot"/g) || []).length, 3, "one dot per solve");
t.eq((sc.match(/class="lca-trend"/g) || []).length, 1, "exactly one trend line");

// All ratings identical would make the y-span zero; the guard must hold.
const flat = S.scatterOverTime([{ t: 1, rating: 1500 }, { t: 2, rating: 1500 }]);
t.ok(flat.indexOf("NaN") === -1, "a flat series produces no NaN coordinates");
t.ok(S.coverageChart(curve).indexOf("NaN") === -1, "no chart ever emits NaN into an attribute");

process.exit(t.report("svg") ? 1 : 0);

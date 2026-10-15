const t = require("./harness.cjs");
const R = require("../src/core/ratings.js");
const J = require("../src/core/join.js");

const table = R.parseTable([
  "# snapshot 2026-10-15\t2",
  "slug\trating\tid\tcontest\tindex\ttitle",
  "rated-one\t1700\t1\tweekly-contest-100\tQ3\tRated One",
  "rated-two\t2100\t2\tweekly-contest-101\tQ4\tRated Two",
].join("\n"));

const list = [
  { slug: "rated-one", title: "Rated One", difficulty: "Medium", solved: true, paidOnly: false, tags: ["Array"], acRate: 50 },
  { slug: "RATED-TWO", title: "Rated Two", difficulty: "Hard", solved: false, paidOnly: false, tags: ["DP"], acRate: 20 },
  { slug: "two-sum", title: "Two Sum", difficulty: "Easy", solved: true, paidOnly: false, tags: ["Array"], acRate: 55 },
  { slug: "never-in-a-contest", title: "Nope", difficulty: "Easy", solved: false, paidOnly: false, tags: [], acRate: 60 },
];

const j = J.build(list, table.bySlug);
t.eq(j.ratedTotal, 2, "only problems the rating table knows about enter the universe");
t.eq(j.ratedSolved, 1, "rated solves are counted");
t.eq(j.unratedTotal, 2, "problems with no community rating are counted, not discarded quietly");
t.eq(j.unratedSolved, 1, "and the ones you solved are counted separately, because that is the caveat worth printing");
t.eq(j.universe.find((p) => p.slug === "rated-two").rating, 2100, "a slug that differs only in case still matches");
t.eq(j.universe.find((p) => p.slug === "rated-two").solved, false, "solved status comes from LeetCode, not from the rating table");
t.eq(j.universe[0].index, "Q3", "contest slot comes from the rating table");
t.eq(j.universe[0].tags, ["Array"], "tags come from LeetCode, which is the only place they exist");

// --- CSV --------------------------------------------------------------------
const csv = J.toCsv([
  { slug: "x", title: 'Comma, "quote" and\nnewline', rating: 1500, difficulty: "Medium", contest: "weekly-contest-1", index: "Q1", tags: ["a", "b"], solved: true },
]);
const lines = csv.split("\n");
t.eq(lines[0], "slug,title,rating,difficulty,contest,index,tags,solved", "the header is fixed");
t.ok(csv.indexOf('"Comma, ""quote"" and\nnewline"', 0) !== -1, "a title containing a comma, a quote and a newline is quoted and doubled correctly");
t.ok(csv.trim().endsWith(",a b,1"), "tags are space-joined and solved is written as 1");

// --- fromRecent -------------------------------------------------------------
const fr = J.fromRecent(
  [
    { slug: "rated-one", title: "Rated One", solvedAt: 1000 },
    { slug: "two-sum", title: "Two Sum", solvedAt: 2000 },
  ],
  table.bySlug
);
t.eq(fr.items.length, 1, "only rated recent solves can be plotted");
t.eq(fr.unmatched, 1, "and the rest are counted so the chart can say what it left out");
t.eq(fr.items[0].solvedAt, 1000, "the solve timestamp is carried through");

process.exit(t.report("join") ? 1 : 0);

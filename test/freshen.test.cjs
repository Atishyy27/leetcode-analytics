// Laying the recent accepted list over a cached problem list.
const T = require("./harness.cjs");
const F = require("../src/core/freshen.js");
const pack = require("../src/core/pack.js");
const join = require("../src/core/join.js");

const rows = ["a", "b", "c", "d"].map((s, i) => ({ slug: s, title: s, difficulty: "Easy", solved: s === "d", paidOnly: false, tags: ["Array"], acRate: 50 }));
const bySlug = new Map(rows.map((r, i) => [r.slug, { rating: 1500 + i, id: String(i), contest: "weekly-contest-1", index: "Q1", title: r.slug }]));

// two of the three unsolved are in recent, plus one already solved
let r = F.applyRecent(rows, [{ slug: "a" }, { slug: "b" }, { slug: "d" }]);
T.eq(r.added, 2, "two newly solved problems are found");
T.eq(r.rows.filter((p) => p.solved).map((p) => p.slug), ["a", "b", "d"], "a, b and the old d are solved");
T.eq(r.maybeMore, false, "two new solves is not a full window");
T.eq(rows.filter((p) => p.solved).length, 1, "the cached rows are not mutated");

// the join counts move by exactly the added number
const before = join.build(rows, bySlug).ratedSolved;
const after = join.build(r.rows, bySlug).ratedSolved;
T.eq(after - before, 2, "ratedSolved goes up by 2");

// nothing new: the very same array comes back
r = F.applyRecent(rows, [{ slug: "d" }]);
T.eq(r.added, 0, "an already solved problem adds nothing");
T.ok(r.rows === rows, "no new array when nothing changed");

// unknown slug is ignored, never invented
r = F.applyRecent(rows, [{ slug: "not-in-the-list" }]);
T.eq(r.added, 0, "an unknown slug is ignored");
T.eq(r.rows.length, rows.length, "the list does not grow");

// case-insensitive slugs
r = F.applyRecent(rows, [{ slug: "A" }]);
T.eq(r.added, 1, "slug case does not matter");

// empty and junk input
T.eq(F.applyRecent(rows, []).added, 0, "empty recent adds nothing");
T.eq(F.applyRecent(rows, null).added, 0, "null recent adds nothing");
T.eq(F.applyRecent(rows, [null, {}, { slug: "" }]).added, 0, "junk entries add nothing");

// a full window of new solves may hide more
const many = Array.from({ length: 30 }, (_, i) => ({ slug: "p" + i, title: "p" + i, difficulty: "Easy", solved: false, paidOnly: false, tags: [], acRate: 1 }));
const recent20 = many.slice(0, 20).map((p) => ({ slug: p.slug }));
r = F.applyRecent(many, recent20);
T.eq(r.added, 20, "20 new solves are all added");
T.eq(r.maybeMore, true, "a full window flags that there may be more");
T.eq(r.rows.filter((p) => p.solved).length, 20, "the 10 older ones stay unsolved");

// survives the cache round trip the profile uses
const back = pack.unpack(pack.pack(rows, { me: "x" }));
T.eq(F.applyRecent(back, [{ slug: "c" }]).added, 1, "works on rows that came out of the cache format");

process.exit(T.report("freshen"));

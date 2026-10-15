const t = require("./harness.cjs");
const P = require("../src/core/pack.js");

const problems = [
  { slug: "a", title: "Alpha", difficulty: "Medium", solved: true, paidOnly: false, tags: ["Array", "Dynamic Programming"], acRate: 51.2345 },
  { slug: "b", title: "Beta", difficulty: "Hard", solved: false, paidOnly: true, tags: ["Dynamic Programming"], acRate: 12 },
  { slug: "c", title: "Gamma", difficulty: "Easy", solved: false, paidOnly: false, tags: [], acRate: null },
];

const blob = P.pack(problems, { me: "someone" });
const back = P.unpack(blob);

t.eq(blob.tags, ["Array", "Dynamic Programming"], "each tag string is written once and reused by index");
t.eq(blob.me, "someone", "caller metadata rides along");
t.eq(back.length, 3, "every problem comes back");
t.eq(back[0].tags, ["Array", "Dynamic Programming"], "tags round-trip through the dictionary in order");
t.eq(back[1].tags, ["Dynamic Programming"], "a problem sharing a tag gets the same string back");
t.eq(back[2].tags, [], "no tags stays no tags, not a null");
t.eq([back[0].solved, back[1].solved], [true, false], "solved survives as a boolean, not a 1");
t.eq([back[0].paidOnly, back[1].paidOnly], [false, true], "so does paidOnly");
t.eq(back.map((p) => p.difficulty), ["Medium", "Hard", "Easy"], "difficulty survives the integer encoding");
t.eq(back[0].acRate, 51.2, "acceptance rate is kept to one decimal, which is all the UI shows");
t.eq(back[2].acRate, null, "a missing acceptance rate stays missing rather than becoming zero");

t.eq(P.unpack(null), null, "unpacking nothing gives null");
t.eq(P.unpack({ v: 1, rows: [] }), null, "a blob from an older version is refused rather than misread");
t.eq(P.unpack({ v: P.VERSION }), null, "a blob with no rows is refused");

// The compression has to actually compress, or it is only risk.
const many = [];
for (let i = 0; i < 2000; i++) {
  many.push({ slug: "p" + i, title: "Problem " + i, difficulty: "Medium", solved: i % 3 === 0, paidOnly: false, tags: ["Array", "Hash Table", "Dynamic Programming"], acRate: 40 });
}
const rawBytes = JSON.stringify(many).length;
const packedBytes = JSON.stringify(P.pack(many)).length;
t.ok(packedBytes < rawBytes * 0.6, `packing 2000 problems saves at least 40% (${rawBytes} -> ${packedBytes} bytes)`);

process.exit(t.report("pack") ? 1 : 0);

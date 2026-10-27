// test/cf-core.test.cjs
// Proves the Codeforces data layer before any DOM work exists.
// Two halves: offline assertions on fixture data, then one live call to the real
// Codeforces API so a wrong endpoint or a changed response shape fails loudly here
// instead of silently inside a content script.
//
// Run: node test/cf-core.test.cjs [handle]

const CF = require("../core/codeforces.js");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log("PASS: " + name);
  } else {
    failures++;
    console.log("FAIL: " + name + (detail ? "  -> " + detail : ""));
  }
}

// ---------------------------------------------------------------- offline
const fixture = [
  { verdict: "OK", creationTimeSeconds: 100, problem: { contestId: 1, index: "A", name: "a", rating: 800, tags: ["math", "greedy"] } },
  { verdict: "OK", creationTimeSeconds: 200, problem: { contestId: 1, index: "A", name: "a", rating: 800, tags: ["math", "greedy"] } }, // resolve, must dedupe
  { verdict: "WRONG_ANSWER", creationTimeSeconds: 300, problem: { contestId: 1, index: "B", name: "b", rating: 900, tags: ["dp"] } },     // not solved
  { verdict: "OK", creationTimeSeconds: 400, problem: { contestId: 2, index: "C", name: "c", rating: 1249, tags: ["dp", "math"] } },
  { verdict: "OK", creationTimeSeconds: 500, problem: { contestId: 3, index: "D", name: "d", tags: ["graphs"] } }                          // unrated
];

const norm = CF.normalizeSubmissions(fixture);
check("dedupes re-solves and drops non-OK verdicts", norm.length === 3, "got " + norm.length + ", expected 3");
check("problem key is contestId-index", norm[0].key === "1-A", "got " + norm[0].key);

const buckets = CF.bucketByRating(norm);
check("1249 lands in the 1200 bucket", buckets.labels.includes("1200"), "labels " + JSON.stringify(buckets.labels));
check("buckets are 100 wide and sorted", JSON.stringify(buckets.labels) === JSON.stringify(["800", "1200"]), JSON.stringify(buckets.labels));
check("counts unrated separately", buckets.unrated === 1 && buckets.rated === 2, "rated " + buckets.rated + " unrated " + buckets.unrated);

const tags = CF.countTags(norm, 2);
check("tags sorted by count, topN respected", tags.labels.length === 2 && tags.labels[0] === "math", JSON.stringify(tags.labels));

// ---------------------------------------------------------------- live
const handle = process.argv[2] || "sethatishayjain";

if (typeof fetch !== "function") {
  failures++;
  console.log("FAIL: this node has no global fetch, need node 18 or newer");
  process.exit(1);
}

console.log("\nLive call: codeforces user.status for handle " + handle);

CF.fetchSolved(handle)
  .then(function (items) {
    check("live api returned solved problems", items.length > 0, "got " + items.length);
    const s = CF.summarize(items);
    check("at least some solved problems carry a rating", s.ratings.rated > 0, "rated " + s.ratings.rated);
    check("every item has a key and a tags array", items.every(function (i) { return i.key && Array.isArray(i.tags); }), "shape mismatch");

    console.log("\nsolved (deduped): " + s.solved);
    console.log("rated: " + s.ratings.rated + "   unrated: " + s.ratings.unrated);
    console.log("\nrating histogram:");
    s.ratings.labels.forEach(function (l, i) {
      console.log("  " + l + "  " + "#".repeat(Math.min(s.ratings.data[i], 60)) + " " + s.ratings.data[i]);
    });
    console.log("\ntop tags:");
    s.tags.labels.forEach(function (t, i) { console.log("  " + t + ": " + s.tags.data[i]); });
  })
  .catch(function (err) {
    failures++;
    console.log("FAIL: live codeforces call threw -> " + err.message);
  })
  .finally(function () {
    console.log("\n" + (failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"));
    process.exit(failures === 0 ? 0 : 1);
  });

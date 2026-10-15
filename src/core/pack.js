/**
 * Squeezing the problem set small enough to keep in chrome.storage.local.
 *
 * The full problemset is about 3,700 problems and every one carries three to
 * five topic tags out of a vocabulary of roughly seventy. Stored as plain
 * objects that is megabytes of repeated strings like "dynamic-programming",
 * against a 10MB quota shared with everything else the extension ever stores.
 *
 * So tags become indices into a dictionary written once, and the fields get
 * one-letter keys. It is the same data, and unpack(pack(x)) is asserted to
 * round-trip in the tests, because a compression bug here would show up as
 * quietly wrong tags on a chart rather than as an error.
 */
(function (root, factory) {
  const api = factory();
  root.LCA = root.LCA || {};
  root.LCA.pack = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";

  const VERSION = 2;

  function pack(problems, meta) {
    const tagIndex = new Map();
    const tags = [];

    function idOf(tag) {
      let i = tagIndex.get(tag);
      if (i === undefined) {
        i = tags.length;
        tags.push(tag);
        tagIndex.set(tag, i);
      }
      return i;
    }

    const rows = problems.map((p) => [
      p.slug,
      p.title || "",
      // Difficulty as 1/2/3 rather than the word.
      p.difficulty === "Easy" ? 1 : p.difficulty === "Medium" ? 2 : p.difficulty === "Hard" ? 3 : 0,
      p.solved ? 1 : 0,
      p.paidOnly ? 1 : 0,
      (p.tags || []).map(idOf),
      Number.isFinite(p.acRate) ? Math.round(p.acRate * 10) / 10 : null,
    ]);

    return Object.assign({ v: VERSION, tags: tags, rows: rows }, meta || {});
  }

  function unpack(blob) {
    if (!blob || blob.v !== VERSION || !Array.isArray(blob.rows)) return null;
    const tags = blob.tags || [];
    const DIFF = { 1: "Easy", 2: "Medium", 3: "Hard" };

    return blob.rows.map((r) => ({
      slug: r[0],
      title: r[1],
      difficulty: DIFF[r[2]] || "",
      solved: r[3] === 1,
      paidOnly: r[4] === 1,
      tags: (r[5] || []).map((i) => tags[i]).filter(Boolean),
      acRate: r[6],
    }));
  }

  return { VERSION, pack, unpack };
});

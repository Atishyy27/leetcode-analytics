/**
 * Joining LeetCode's problem list to the community rating table.
 *
 * Pure, and separated out, because this join is where a whole class of quiet
 * wrongness lives. Only about 2,600 of LeetCode's ~3,700 problems have a
 * community rating at all: everything that never appeared in a contest has
 * none. v1 counted those as "unrated" and dropped them, which is right, but
 * it dropped them silently into a sentence at the bottom. Here the unmatched
 * set is a first-class return value, split by whether you solved it, because
 * "412 of your solves are not in the rating table" is the single most
 * important caveat on the whole panel.
 */
(function (root, factory) {
  const api = factory();
  root.LCA = root.LCA || {};
  root.LCA.join = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";

  /**
   * problems: from the GraphQL list, each { slug, title, difficulty, solved, paidOnly, tags, acRate }
   * bySlug:   Map from parseTable
   */
  function build(problems, bySlug) {
    const universe = [];
    let unratedTotal = 0;
    let unratedSolved = 0;
    let ratedSolved = 0;

    for (const p of problems) {
      const key = String(p.slug || "").toLowerCase();
      const r = bySlug.get(key);
      if (!r) {
        unratedTotal += 1;
        if (p.solved) unratedSolved += 1;
        continue;
      }
      if (p.solved) ratedSolved += 1;
      universe.push({
        slug: key,
        title: p.title || r.title,
        rating: r.rating,
        id: r.id,
        contest: r.contest,
        index: r.index,
        difficulty: p.difficulty || "",
        tags: p.tags || [],
        paidOnly: !!p.paidOnly,
        acRate: p.acRate,
        solved: !!p.solved,
      });
    }

    return {
      universe: universe,
      ratedTotal: universe.length,
      ratedSolved: ratedSolved,
      unratedTotal: unratedTotal,
      unratedSolved: unratedSolved,
    };
  }

  /**
   * The thin path: another person's profile, where all we can see is their
   * recent accepted submissions. No universe, so no coverage and no
   * recommendations, only the ratings of what they just solved.
   */
  function fromRecent(recent, bySlug) {
    const items = [];
    let unmatched = 0;
    for (const s of recent) {
      const r = bySlug.get(String(s.slug || "").toLowerCase());
      if (!r) {
        unmatched += 1;
        continue;
      }
      items.push({
        slug: r.slug,
        title: s.title || r.title,
        rating: r.rating,
        index: r.index,
        contest: r.contest,
        solvedAt: s.solvedAt,
      });
    }
    return { items: items, unmatched: unmatched };
  }

  /** The solved set as CSV, for someone who would rather have the data. */
  function toCsv(universe) {
    const head = ["slug", "title", "rating", "difficulty", "contest", "index", "tags", "solved"];
    const esc = (v) => {
      const s = String(v === null || v === undefined ? "" : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [head.join(",")];
    for (const p of universe) {
      lines.push([p.slug, p.title, p.rating, p.difficulty, p.contest, p.index, (p.tags || []).join(" "), p.solved ? 1 : 0].map(esc).join(","));
    }
    return lines.join("\n") + "\n";
  }

  return { build, fromRecent, toCsv };
});

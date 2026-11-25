/**
 * Keeping what the panel shows honest about its age.
 *
 * applyRecent: the cached problem list is a full read of LeetCode and is
 * trusted for 12 hours. Your 20 latest accepted solves cost one request and
 * already say which of those problems are now done, so they are laid over the
 * cached list in memory. The cache itself is not rewritten, so its age stays
 * the age of the full read.
 */
(function (root, factory) {
  const api = factory();
  root.LCA = root.LCA || {};
  root.LCA.freshen = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";

  const RECENT_LIMIT = 20;

  /**
   * rows:   the unpacked problem list, { slug, solved, ... }
   * recent: [{ slug }] from the recent accepted list
   *
   * added counts problems that were unsolved in the cache and are solved in
   * recent. maybeMore is true when every recent slot was a new one, because
   * then the 20 that LeetCode returns may not be all of them.
   */
  function applyRecent(rows, recent) {
    const list = Array.isArray(recent) ? recent : [];
    const slugs = new Set();
    for (const r of list) {
      const s = String((r && r.slug) || "").toLowerCase();
      if (s) slugs.add(s);
    }
    if (slugs.size === 0) return { rows: rows, added: 0, maybeMore: false };

    let added = 0;
    const out = rows.map((p) => {
      if (p.solved || !slugs.has(String(p.slug || "").toLowerCase())) return p;
      added += 1;
      return Object.assign({}, p, { solved: true });
    });

    return { rows: added ? out : rows, added: added, maybeMore: added >= RECENT_LIMIT };
  }

  return { applyRecent, RECENT_LIMIT };
});

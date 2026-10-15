/**
 * Which LeetCode page is this.
 *
 * Pure and tested, because v1 got this wrong in a way that was invisible:
 * getUsername() took the last path segment and excluded six reserved words,
 * so /problemset/all/ resolved to the user "all" and the extension tried to
 * chart a profile that does not exist. The failure looked like a network
 * error, so the actual cause was unreachable from the symptom.
 *
 * The reserved list below is everything leetcode.com serves at the top level
 * that is not a username. A name wrongly treated as reserved costs that user
 * their panel; a reserved word wrongly treated as a name costs everyone a
 * broken page, so the list errs long.
 */
(function (root, factory) {
  const api = factory();
  root.LCA = root.LCA || {};
  root.LCA.route = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";

  const RESERVED = new Set([
    "problems", "problemset", "contest", "contests", "discuss", "explore", "interview",
    "study-plan", "studyplan", "list", "lists", "accounts", "account", "submissions",
    "store", "subscribe", "progress", "playground", "articles", "article", "tag",
    "company", "circle", "ranking", "notes", "profile", "settings", "description",
    "solutions", "editorial", "u", "assessment", "jobs", "events", "premium", "api",
    "graphql", "new", "search", "notifications", "problem-list", "course", "courses",
  ]);

  function parse(pathname) {
    const parts = String(pathname || "/").split("/").filter((p) => p !== "");

    if (parts.length === 0) return { kind: "none" };

    if (parts[0] === "problems" && parts[1]) {
      return { kind: "problem", slug: parts[1].toLowerCase() };
    }

    if (parts[0] === "problemset" || parts[0] === "problem-list" || parts[0] === "study-plan") {
      return { kind: "problemset" };
    }

    // The current profile shape.
    if (parts[0] === "u" && parts[1]) {
      return { kind: "profile", username: parts[1] };
    }

    // The old shape, still linked from plenty of places: /<username>/
    if (parts.length === 1 && !RESERVED.has(parts[0].toLowerCase())) {
      return { kind: "profile", username: parts[0] };
    }

    // Contest pages list problems too.
    if (parts[0] === "contest" && parts.length >= 2) {
      return { kind: "problemset" };
    }

    return { kind: "none" };
  }

  return { parse, RESERVED };
});

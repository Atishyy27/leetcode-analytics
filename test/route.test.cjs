const t = require("./harness.cjs");
const Rt = require("../src/core/route.js");

const cases = [
  ["/u/atishyy27/", { kind: "profile", username: "atishyy27" }, "the current profile URL shape"],
  ["/u/atishyy27", { kind: "profile", username: "atishyy27" }, "with or without the trailing slash"],
  ["/atishyy27/", { kind: "profile", username: "atishyy27" }, "the older bare-username profile URL still works"],
  ["/problems/two-sum/", { kind: "problem", slug: "two-sum" }, "a problem page"],
  ["/problems/Two-Sum/description/", { kind: "problem", slug: "two-sum" }, "a problem sub-tab, slug lowercased"],
  ["/problemset/all/", { kind: "problemset" }, "the problem set"],
  ["/problemset/", { kind: "problemset" }, "the problem set root"],
  ["/study-plan/leetcode-75/", { kind: "problemset" }, "a study plan lists problems too"],
  ["/contest/weekly-contest-400/", { kind: "problemset" }, "so does a contest page"],
  ["/", { kind: "none" }, "the home page is not a profile"],
  ["/explore/", { kind: "none" }, "explore is not a username"],
  ["/discuss/", { kind: "none" }, "neither is discuss"],
  ["/submissions/", { kind: "none" }, "neither is submissions"],
  ["/accounts/login/", { kind: "none" }, "neither is the login page"],
  ["", { kind: "none" }, "an empty path does not throw"],
];

for (const [path, expected, what] of cases) {
  t.eq(Rt.parse(path), expected, `${what}  (${path || "<empty>"})`);
}

// The exact v1 failure: getUsername() took the last path segment and excluded
// only six words, so the problem set resolved to a user named "all" and the
// extension tried to chart a profile that does not exist.
t.ok(Rt.parse("/problemset/all/").kind !== "profile", "the problem set is never mistaken for a user named all");
t.ok(Rt.parse("/contest/weekly-contest-400/").username === undefined, "a contest page never yields a username");

process.exit(t.report("route") ? 1 : 0);

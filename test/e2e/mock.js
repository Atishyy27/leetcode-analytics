// A stand-in for everything the extension talks to, loaded into a test page
// BEFORE the extension's own scripts. Test-only: nothing in the shipped
// extension reads this file or the ?s= scenario flag.
//
// It fakes three things:
//   chrome.storage / chrome.runtime   in memory, persisted in localStorage so a
//                                     reload keeps the cache like a real browser
//   the rating table                  300 synthetic problems, via LCA_RATINGS
//   LeetCode's GraphQL endpoint       fetch() to /graphql/ is answered here
//
// The scenario comes from the query string:  ?s=ok | ok-stale | signedout |
// error | neterr | flaky | slow | solve1 | solve2
(function () {
  "use strict";
  const scenario = new URLSearchParams(location.search).get("s") || "ok";
  const calls = [];
  window.__calls = calls;

  // ---- storage ----
  const STORE = "lca-mock-storage";
  const read = () => JSON.parse(localStorage.getItem(STORE) || "{}");
  const write = (o) => localStorage.setItem(STORE, JSON.stringify(o));
  const later = (cb, v) => setTimeout(() => cb && cb(v), 0);

  const fake = {
    storage: {
      local: {
        get(keys, cb) {
          const all = read();
          if (keys === null) return later(cb, all);
          const out = {};
          for (const k of keys) if (k in all) out[k] = all[k];
          later(cb, out);
        },
        set(obj, cb) {
          write(Object.assign(read(), obj));
          later(cb);
        },
        remove(keys, cb) {
          const all = read();
          for (const k of keys) delete all[k];
          write(all);
          later(cb);
        },
        getBytesInUse(_k, cb) {
          later(cb, JSON.stringify(read()).length);
        },
      },
    },
    runtime: {
      lastError: undefined,
      sendMessage(msg, cb) {
        if (msg && msg.type === "LCA_RATINGS") {
          return later(cb, { ok: true, text: ratingsText(), source: "bundled" });
        }
        later(cb, { ok: false, error: "unknown message" });
      },
    },
  };
  // Headless Chromium already has a window.chrome of its own; replace it.
  Object.defineProperty(window, "chrome", { value: fake, configurable: true, writable: true });

  // ---- synthetic data ----
  const N = 300;
  const TAGS = ["Array", "Dynamic Programming", "Graph", "String", "Math"];
  const pad = (i) => String(i).padStart(3, "0");
  const slugOf = (i) => "p-" + pad(i);

  function ratingsText() {
    const snap = scenario === "ok-stale" ? "2026-10-15" : new Date().toISOString().slice(0, 10);
    const rows = [];
    for (let i = 1; i <= N; i++) {
      rows.push([slugOf(i), String(1100 + Math.round((i - 1) * (1600 / (N - 1)))), String(i), "weekly-contest-" + (100 + (i % 50)), "Q" + (1 + (i % 4)), "Problem " + i].join("\t"));
    }
    return `# synthetic\n# snapshot ${snap}\t${N}\nslug\trating\tid\tcontest\tindex\ttitle\n` + rows.join("\n") + "\n";
  }

  // The first 100 are solved. solve1: after the first sync 3 more get solved on
  // LeetCode, which only the recent list knows about until the cache expires.
  const SOLVED_AT_SYNC = 100;
  function listPage(skip, limit) {
    const qs = [];
    for (let i = 1; i <= N + 30; i++) {
      const rated = i <= N;
      qs.push({
        titleSlug: rated ? slugOf(i) : "u-" + pad(i - N),
        title: rated ? "Problem " + i : "Unrated " + (i - N),
        difficulty: ["Easy", "Medium", "Hard"][i % 3],
        status: rated && i <= SOLVED_AT_SYNC ? "ac" : null,
        isPaidOnly: false,
        acRate: 40 + (i % 30),
        topicTags: [{ slug: "t", name: TAGS[i % TAGS.length] }, { slug: "u", name: TAGS[(i + 2) % TAGS.length] }],
      });
    }
    return { problemsetQuestionList: { total: qs.length, questions: qs.slice(skip, skip + limit) } };
  }

  const json = (data, status) => ({
    status: status || 200,
    ok: (status || 200) < 300,
    headers: { get: () => null },
    json: async () => ({ data: data }),
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let identityCalls = 0;

  window.fetch = async function (url, init) {
    if (!String(url).includes("graphql")) throw new Error("mock: unexpected fetch " + url);
    const body = JSON.parse(init.body);
    const op = body.operationName;
    calls.push(op);

    if (op === "globalData") {
      identityCalls += 1;
      if (scenario === "slow") await wait(2500);
      if (scenario === "error") return json(null, 500);
      if (scenario === "neterr") throw new TypeError("Failed to fetch");
      if (scenario === "flaky" && identityCalls <= 4) return json(null, 500);
      if (scenario === "signedout") return json({ userStatus: { username: "", isSignedIn: false } });
      return json({ userStatus: { username: "mockuser", isSignedIn: true } });
    }
    if (op === "problemsetQuestionList") {
      return json(listPage(body.variables.skip, body.variables.limit));
    }
    if (op === "recentAcSubmissions") {
      const now = Math.floor(Date.now() / 1000);
      const newer = scenario === "solve2" ? [101, 102, 103] : [];
      const seen = [5, 40, 90];
      const list = newer.concat(seen).map((i, k) => ({ id: String(k), title: "Problem " + i, titleSlug: slugOf(i), timestamp: String(now - k * 3600 - 86400 * 30) }));
      return json({ recentAcSubmissionList: list });
    }
    if (op === "userContestRankingInfo") return json({ userContestRanking: null });
    return json({});
  };
})();

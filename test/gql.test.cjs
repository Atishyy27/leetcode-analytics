// gql.js against a mocked fetch. No network: LeetCode is replaced by a script
// of canned responses, one per call, so every status the client has to survive
// can be forced.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const T = require("./harness.cjs");

function load(responses) {
  const calls = [];
  const sandbox = {
    document: { cookie: "csrftoken=abc" },
    DOMException: DOMException,
    JSON: JSON,
    Promise: Promise,
    Number: Number,
    Math: Math,
    Error: Error,
    // Backoff sleeps run at once, the delay logic is not what is under test.
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {},
    fetch: async (url, init) => {
      calls.push({ url: url, body: JSON.parse(init.body) });
      const next = responses.shift();
      if (!next) throw new Error("mock ran out of responses");
      if (next.throws) throw new TypeError(next.throws);
      return {
        status: next.status,
        ok: next.status >= 200 && next.status < 300,
        headers: { get: () => null },
        json: async () => next.json,
      };
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src", "platform", "gql.js"), "utf8"), sandbox);
  return { gql: sandbox.LCA.gql, calls: calls };
}

const ok = (data) => ({ status: 200, json: { data: data } });

(async () => {
  // signed in
  let m = load([ok({ userStatus: { username: "alice", isSignedIn: true } })]);
  T.eq(await m.gql.whoAmI(), { state: "user", username: "alice" }, "signed in gives the username");
  T.eq(m.calls.length, 1, "one request for the identity lookup");
  T.eq(m.calls[0].body.operationName, "globalData", "operation name is globalData");

  // signed out is its own answer, not an error
  m = load([ok({ userStatus: { username: "", isSignedIn: false } })]);
  T.eq(await m.gql.whoAmI(), { state: "signedOut" }, "signed out is reported as signed out");

  // userStatus missing entirely: LeetCode changed shape, so say error not signed out
  m = load([ok({})]);
  const odd = await m.gql.whoAmI();
  T.eq(odd.state, "error", "a missing userStatus is an error, not signed out");

  // 429 forever: 1 try + 3 retries then an error with the status in it
  m = load([{ status: 429 }, { status: 429 }, { status: 429 }, { status: 429 }]);
  const r429 = await m.gql.whoAmI();
  T.eq(r429.state, "error", "429 past the retries is an error");
  T.ok(/429/.test(r429.message), "the error names the 429");
  T.eq(m.calls.length, 4, "429 is tried 4 times, then given up");

  // 500 then success: the retry saves it
  m = load([{ status: 500 }, ok({ userStatus: { username: "bob", isSignedIn: true } })]);
  T.eq(await m.gql.whoAmI(), { state: "user", username: "bob" }, "a 500 followed by success recovers");

  // 500 forever
  m = load([{ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }]);
  T.eq((await m.gql.whoAmI()).state, "error", "500 past the retries is an error");

  // network failure (what a timeout looks like once fetch gives up)
  m = load([{ throws: "Failed to fetch" }, { throws: "Failed to fetch" }, { throws: "Failed to fetch" }, { throws: "Failed to fetch" }]);
  const net = await m.gql.whoAmI();
  T.eq(net.state, "error", "network failure is an error");
  T.ok(/Failed to fetch/.test(net.message), "the error carries the cause");

  // GraphQL errors field
  m = load([{ status: 200, json: { errors: [{ message: "rate limited" }] } }]);
  const gerr = await m.gql.whoAmI();
  T.eq(gerr.state, "error", "a graphql errors field is an error");

  // abort is not swallowed into an error screen
  const ac = new AbortController();
  m = load([{ throws: "x" }]);
  ac.abort();
  let aborted = false;
  try {
    await m.gql.pool([1], async () => 1, 1, ac.signal);
  } catch (e) {
    aborted = e && e.name === "AbortError";
  }
  T.ok(aborted, "an aborted pool stops with AbortError");

  // the whole problem list: pages of 100, count of requests
  const page = (n) => ({ problemsetQuestionList: { total: 250, questions: Array.from({ length: n }, (_, i) => ({ titleSlug: "p" + i, title: "P" + i, difficulty: "Easy", status: i === 0 ? "ac" : null, isPaidOnly: false, acRate: 50, topicTags: [{ name: "Array" }] })) } });
  m = load([ok(page(100)), ok(page(100)), ok(page(50))]);
  const uni = await m.gql.fetchUniverse();
  T.eq(uni.length, 250, "250 problems come back from 3 pages");
  T.eq(m.calls.length, 3, "250 problems is 3 requests");
  T.eq(uni[0].solved, true, "status ac means solved");
  T.eq(uni[1].solved, false, "null status means unsolved");

  process.exit(T.report("gql"));
})();

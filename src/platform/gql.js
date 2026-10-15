/**
 * Talking to LeetCode's own GraphQL endpoint, politely.
 *
 * What v1 did and why it is gone:
 *
 * 1. It asked the background worker for LEETCODE_SESSION and csrftoken and
 *    then set a "Cookie" header on fetch. Cookie is a forbidden header name:
 *    the browser strips it and never says so. The call worked anyway, because
 *    credentials:"include" on a same-origin request already sends the real
 *    cookies. So the entire cookie pipeline, and the "cookies" permission that
 *    paid for it, did nothing except make the permission prompt worse.
 *
 * 2. It fired one request per 50 problems, all at once, with Promise.all. On
 *    a 3,700 problem set that is roughly 74 simultaneous POSTs to an endpoint
 *    that rate limits. The first 429 then threw a TypeError, because the
 *    response was dereferenced as .data.problemsetQuestionList.total without
 *    a check.
 *
 * 3. In public mode it fetched tags one problem at a time, up to 500 round
 *    trips, for data that is identical for every user on earth.
 *
 * Here: pages of 100, three at a time, exponential backoff on 429 and 5xx,
 * every response shape checked before it is read, and the whole thing
 * cancellable because a user who navigates away should stop costing LeetCode
 * requests.
 */
(function (root) {
  "use strict";
  const LCA = (root.LCA = root.LCA || {});

  const ENDPOINT = "https://leetcode.com/graphql/";
  const PAGE = 100;
  const CONCURRENCY = 3;
  const MAX_RETRY = 3;

  function csrf() {
    const m = /(?:^|;\s*)csrftoken=([^;]+)/.exec(document.cookie || "");
    return m ? decodeURIComponent(m[1]) : null;
  }

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true }
        );
      }
    });
  }

  async function post(query, variables, opName, signal) {
    const token = csrf();
    const headers = { "Content-Type": "application/json" };
    if (token) headers["x-csrftoken"] = token;

    let attempt = 0;
    for (;;) {
      let res;
      try {
        res = await fetch(ENDPOINT, {
          method: "POST",
          headers: headers,
          credentials: "include",
          signal: signal,
          body: JSON.stringify({ operationName: opName || null, query: query, variables: variables || {} }),
        });
      } catch (err) {
        if (err && err.name === "AbortError") throw err;
        if (attempt >= MAX_RETRY) throw new Error(`network failed after ${attempt + 1} tries: ${err.message}`);
        await sleep(400 * Math.pow(2, attempt), signal);
        attempt++;
        continue;
      }

      if (res.status === 429 || res.status >= 500) {
        if (attempt >= MAX_RETRY) throw new Error(`LeetCode returned ${res.status} after ${attempt + 1} tries`);
        // Respect Retry-After when it is there, otherwise back off.
        const ra = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 600 * Math.pow(2, attempt);
        await sleep(Math.min(wait, 8000), signal);
        attempt++;
        continue;
      }

      if (!res.ok) throw new Error(`LeetCode returned ${res.status}`);

      let json;
      try {
        json = await res.json();
      } catch (err) {
        throw new Error("LeetCode returned something that is not JSON");
      }

      if (json && json.errors && json.errors.length) {
        throw new Error(json.errors.map((e) => e.message).join("; "));
      }
      if (!json || !json.data) throw new Error("LeetCode returned no data field");
      return json.data;
    }
  }

  /** Run tasks n at a time, in order, stopping early if aborted. */
  async function pool(items, worker, concurrency, signal) {
    const n = Math.max(1, concurrency || CONCURRENCY);
    const out = new Array(items.length);
    let next = 0;

    async function run() {
      for (;;) {
        if (signal && signal.aborted) throw new DOMException("aborted", "AbortError");
        const i = next++;
        if (i >= items.length) return;
        out[i] = await worker(items[i], i);
      }
    }

    await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
    return out;
  }

  const Q_ME = `query globalData { userStatus { username isSignedIn } }`;

  const Q_LIST = `query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList: questionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
    total: totalNum
    questions: data {
      titleSlug
      title
      difficulty
      status
      isPaidOnly
      acRate
      topicTags { slug name }
    }
  }
}`;

  const Q_RECENT = `query recentAcSubmissions($username: String!, $limit: Int!) {
  recentAcSubmissionList(username: $username, limit: $limit) { id title titleSlug timestamp }
}`;

  const Q_CONTEST = `query userContestRankingInfo($username: String!) {
  userContestRanking(username: $username) {
    attendedContestsCount
    rating
    globalRanking
    totalParticipants
    topPercentage
  }
}`;

  const Q_PROFILE = `query userPublicProfile($username: String!) {
  matchedUser(username: $username) {
    username
    profile { ranking realName userAvatar }
    submitStatsGlobal { acSubmissionNum { difficulty count } }
  }
}`;

  async function whoAmI(signal) {
    try {
      const d = await post(Q_ME, {}, "globalData", signal);
      const u = d.userStatus;
      return u && u.isSignedIn ? u.username : null;
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      return null;
    }
  }

  /**
   * The whole problem set, with your solved status on each row.
   *
   * status comes back for whoever is logged in, never for the profile being
   * viewed, which is the one thing about this endpoint that will mislead a
   * reader if it is not said out loud. The caller is responsible for only
   * treating it as "solved" on your own profile; every surface here does.
   */
  async function fetchUniverse(onProgress, signal) {
    const first = await post(
      Q_LIST,
      { categorySlug: "", skip: 0, limit: PAGE, filters: {} },
      "problemsetQuestionList",
      signal
    );
    const head = first && first.problemsetQuestionList;
    if (!head || !Array.isArray(head.questions)) throw new Error("problem list came back in an unexpected shape");

    const total = Number(head.total) || head.questions.length;
    const pages = [];
    for (let skip = PAGE; skip < total; skip += PAGE) pages.push(skip);

    const all = head.questions.slice();
    let done = 1;
    if (onProgress) onProgress(done, pages.length + 1);

    const rest = await pool(
      pages,
      async (skip) => {
        const d = await post(Q_LIST, { categorySlug: "", skip: skip, limit: PAGE, filters: {} }, "problemsetQuestionList", signal);
        done++;
        if (onProgress) onProgress(done, pages.length + 1);
        const box = d && d.problemsetQuestionList;
        return (box && box.questions) || [];
      },
      CONCURRENCY,
      signal
    );

    for (const chunk of rest) all.push.apply(all, chunk);

    return all.map((q) => ({
      slug: q.titleSlug,
      title: q.title,
      difficulty: q.difficulty,
      solved: q.status === "ac",
      paidOnly: !!q.isPaidOnly,
      acRate: Number(q.acRate),
      tags: (q.topicTags || []).map((t) => t.name),
    }));
  }

  async function fetchRecent(username, limit, signal) {
    try {
      const d = await post(Q_RECENT, { username: username, limit: limit || 20 }, "recentAcSubmissions", signal);
      return (d.recentAcSubmissionList || []).map((s) => ({
        slug: s.titleSlug,
        title: s.title,
        solvedAt: Number(s.timestamp),
      }));
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      return [];
    }
  }

  async function fetchContest(username, signal) {
    try {
      const d = await post(Q_CONTEST, { username: username }, "userContestRankingInfo", signal);
      return d.userContestRanking || null;
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      return null;
    }
  }

  async function fetchProfile(username, signal) {
    try {
      const d = await post(Q_PROFILE, { username: username }, "userPublicProfile", signal);
      return d.matchedUser || null;
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      return null;
    }
  }

  LCA.gql = { ENDPOINT, PAGE, CONCURRENCY, post, pool, whoAmI, fetchUniverse, fetchRecent, fetchContest, fetchProfile, csrf };
})(typeof globalThis !== "undefined" ? globalThis : self);

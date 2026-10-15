/**
 * The rating table and the statistics taken off it.
 *
 * Everything here is pure: text in, numbers out, no DOM and no network. That
 * is deliberate, because these are the functions whose wrongness is invisible.
 * A chart with a wrong percentile looks exactly like a chart with a right one,
 * so the only way to know is to assert on the numbers, and the only way to
 * assert on them from node is to keep them away from the browser.
 */
(function (root, factory) {
  const api = factory();
  root.LCA = root.LCA || {};
  root.LCA.ratings = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";

  const BUCKET = 100;

  /**
   * Parse data/ratings.tsv.
   * Returns a Map keyed by lowercase slug, plus the snapshot date so the UI can
   * say how old the numbers are instead of implying they are live.
   */
  function parseTable(text) {
    const bySlug = new Map();
    let snapshot = "";
    let declared = 0;

    const lines = String(text).split("\n");
    let header = null;

    for (const raw of lines) {
      const line = raw.replace(/\r$/, "");
      if (!line) continue;

      if (line.startsWith("#")) {
        const m = line.match(/snapshot\s+(\d{4}-\d{2}-\d{2})\t(\d+)/);
        if (m) {
          snapshot = m[1];
          declared = Number(m[2]);
        }
        continue;
      }

      const f = line.split("\t");
      if (!header) {
        header = f;
        continue;
      }
      const slug = (f[0] || "").toLowerCase();
      // Number("") is 0, not NaN. Without the emptiness check a row whose
      // rating field is blank would be stored as a rating of zero and would
      // then sit at the far left of every chart as a real problem.
      const ratingText = (f[1] || "").trim();
      const rating = ratingText === "" ? NaN : Number(ratingText);
      if (!slug || !Number.isFinite(rating) || rating <= 0) continue;

      bySlug.set(slug, {
        slug,
        rating,
        id: Number(f[2]) || 0,
        contest: f[3] || "",
        index: f[4] || "",
        title: f[5] || slug,
      });
    }

    return { bySlug, snapshot, declared, count: bySlug.size };
  }

  /** Lower edge of the 100-point band a rating falls in. */
  function bucketOf(rating, size) {
    const s = size || BUCKET;
    return Math.floor(rating / s) * s;
  }

  /**
   * A histogram with no holes.
   *
   * v1 built its labels from the brackets that happened to be present, so a
   * band you have never solved simply vanished and the bars either side sat
   * next to each other. That reads as "I solve 1500s and 1700s evenly" when
   * the truth is "there is a cliff at 1600". Every band between min and max is
   * emitted, zeroes included.
   */
  function histogram(values, size) {
    const s = size || BUCKET;
    const nums = values.filter((v) => Number.isFinite(v));
    if (nums.length === 0) return [];

    const lo = bucketOf(Math.min.apply(null, nums), s);
    const hi = bucketOf(Math.max.apply(null, nums), s);

    const counts = new Map();
    for (const v of nums) {
      const b = bucketOf(v, s);
      counts.set(b, (counts.get(b) || 0) + 1);
    }

    const out = [];
    for (let b = lo; b <= hi; b += s) {
      out.push({ bucket: b, count: counts.get(b) || 0 });
    }
    return out;
  }

  /**
   * Linear-interpolated percentile, the same definition numpy uses by default,
   * so a number quoted from here matches a number computed anywhere else.
   * p is 0..100.
   */
  function percentile(values, p) {
    const nums = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
    if (nums.length === 0) return null;
    if (nums.length === 1) return nums[0];

    const pos = ((nums.length - 1) * p) / 100;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return nums[lo];
    return nums[lo] + (nums[hi] - nums[lo]) * (pos - lo);
  }

  /**
   * Mean of the k hardest solved.
   *
   * The single hardest problem you ever solved is a bad summary: one lucky
   * contest Q4, or one problem you solved after reading the editorial, moves
   * it permanently. The mean of the top k moves only when you do it k times.
   */
  function topKMean(values, k) {
    const nums = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => b - a);
    if (nums.length === 0) return null;
    const n = Math.min(k, nums.length);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += nums[i];
    return sum / n;
  }

  /** Every headline number on the panel, computed once. */
  function summarise(values) {
    const nums = values.filter((v) => Number.isFinite(v));
    if (nums.length === 0) {
      return { n: 0, min: null, max: null, mean: null, median: null, p90: null, top10: null };
    }
    const sum = nums.reduce((a, b) => a + b, 0);
    return {
      n: nums.length,
      min: Math.min.apply(null, nums),
      max: Math.max.apply(null, nums),
      mean: sum / nums.length,
      median: percentile(nums, 50),
      p90: percentile(nums, 90),
      top10: topKMean(nums, 10),
    };
  }

  /**
   * Solve rate per contest slot.
   *
   * Q1 and Q2 are the warm-ups, Q3 is the interview-hard band, Q4 is the one
   * that decides contest rating. Counting them separately answers a question
   * the difficulty labels cannot: whether you are stuck because of topics or
   * because you never finish a contest.
   */
  function indexBreakdown(problems) {
    const out = { Q1: 0, Q2: 0, Q3: 0, Q4: 0, other: 0 };
    for (const p of problems) {
      const k = (p && p.index) || "";
      if (Object.prototype.hasOwnProperty.call(out, k) && k !== "other") out[k] += 1;
      else out.other += 1;
    }
    return out;
  }

  /** Weekly versus biweekly, from the contest slug. */
  function contestKind(slug) {
    if (/^biweekly-contest-/.test(slug)) return "biweekly";
    if (/^weekly-contest-/.test(slug)) return "weekly";
    return "other";
  }

  /** Contest number, for ordering problems by era rather than by rating. */
  function contestNumber(slug) {
    const m = String(slug || "").match(/-contest-(\d+)$/);
    return m ? Number(m[1]) : null;
  }

  return {
    BUCKET,
    parseTable,
    bucketOf,
    histogram,
    percentile,
    topKMean,
    summarise,
    indexBreakdown,
    contestKind,
    contestNumber,
  };
});

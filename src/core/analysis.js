/**
 * Everything the panel says that is not just a count.
 *
 * Pure like ratings.js, and for the same reason. These functions decide what
 * the extension claims about a person, so each one has to be checkable from a
 * test file without a browser in the room.
 *
 * Shape of the inputs, fixed once here:
 *   universe: [{ slug, rating, index, contest, title, tags:[String], paidOnly, solved:Boolean }]
 *   Only problems that carry a community rating are in the universe. Unrated
 *   problems are counted separately and never silently folded in.
 */
(function (root, factory) {
  const api = factory();
  root.LCA = root.LCA || {};
  root.LCA.analysis = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";

  const BUCKET = 100;

  function bucketOf(rating, size) {
    const s = size || BUCKET;
    return Math.floor(rating / s) * s;
  }

  /**
   * Solved / available, band by band.
   *
   * This is the chart the whole extension exists for. A raw count of solved
   * problems per band is mostly a picture of how many problems LeetCode has in
   * that band: there are far more 1500s than 2500s, so everyone's bar chart
   * peaks in the middle and everyone concludes they are a mid-rated solver.
   * Dividing by what was available removes that and leaves the actual shape of
   * one person's ability.
   */
  function coverageCurve(universe, size) {
    const s = size || BUCKET;
    const total = new Map();
    const done = new Map();

    for (const p of universe) {
      if (!Number.isFinite(p.rating)) continue;
      const b = bucketOf(p.rating, s);
      total.set(b, (total.get(b) || 0) + 1);
      if (p.solved) done.set(b, (done.get(b) || 0) + 1);
    }
    if (total.size === 0) return [];

    const keys = Array.from(total.keys()).sort((a, b) => a - b);
    const out = [];
    for (let b = keys[0]; b <= keys[keys.length - 1]; b += s) {
      const t = total.get(b) || 0;
      const d = done.get(b) || 0;
      out.push({ bucket: b, solved: d, total: t, rate: t ? d / t : null });
    }
    return out;
  }

  /**
   * The rating at which your coverage falls through a threshold.
   *
   * Interpolated between the two bands either side, so the answer moves
   * smoothly as you solve rather than jumping 100 points at a time. Bands with
   * fewer than minSample problems are skipped: a 1/1 band at 2900 would
   * otherwise read as 100% coverage and push the line off the end.
   *
   * Returns null when the curve never crosses, which is the honest answer for
   * someone who has solved almost nothing or almost everything.
   */
  function crossoverRating(curve, frac, minSample) {
    const f = typeof frac === "number" ? frac : 0.5;
    const min = typeof minSample === "number" ? minSample : 8;
    const pts = curve.filter((c) => c.total >= min && c.rate !== null);
    if (pts.length < 2) return null;

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a.rate >= f && b.rate < f) {
        const span = a.rate - b.rate;
        const t = span === 0 ? 0 : (a.rate - f) / span;
        return a.bucket + t * (b.bucket - a.bucket);
      }
    }
    return null;
  }

  /**
   * Topic by rating band, as a grid of solved counts and coverage.
   *
   * Returned sorted by how many rated problems exist in the topic, so the grid
   * reads top-down from the topics that matter most, not alphabetically.
   */
  function topicMatrix(universe, size, opts) {
    const s = size || BUCKET;
    const o = opts || {};
    const maxTopics = o.maxTopics || 18;

    const bands = [];
    const curve = coverageCurve(universe, s);
    for (const c of curve) bands.push(c.bucket);

    const byTopic = new Map();
    for (const p of universe) {
      if (!Number.isFinite(p.rating)) continue;
      const b = bucketOf(p.rating, s);
      for (const tag of p.tags || []) {
        let row = byTopic.get(tag);
        if (!row) {
          row = { topic: tag, total: 0, solved: 0, cells: new Map() };
          byTopic.set(tag, row);
        }
        row.total += 1;
        if (p.solved) row.solved += 1;
        let cell = row.cells.get(b);
        if (!cell) {
          cell = { total: 0, solved: 0 };
          row.cells.set(b, cell);
        }
        cell.total += 1;
        if (p.solved) cell.solved += 1;
      }
    }

    const rows = Array.from(byTopic.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, maxTopics)
      .map((row) => ({
        topic: row.topic,
        total: row.total,
        solved: row.solved,
        rate: row.total ? row.solved / row.total : 0,
        cells: bands.map((b) => {
          const c = row.cells.get(b) || { total: 0, solved: 0 };
          return {
            bucket: b,
            total: c.total,
            solved: c.solved,
            rate: c.total ? c.solved / c.total : null,
          };
        }),
      }));

    return { bands: bands, rows: rows };
  }

  /**
   * Which topics you are behind on, measured against yourself.
   *
   * Comparing topics by raw solve rate just ranks them by how hard the topic's
   * problems are: everyone's "segment tree" rate is low. So each topic is
   * scored against what your own overall coverage predicts for a topic with
   * that exact rating mix. Behind on dynamic programming means behind for
   * someone who solves what you solve, not behind in the abstract.
   *
   * deficit is in problems: how many more of that topic a person with your
   * band-by-band coverage would have solved.
   */
  function weakTopics(universe, size, opts) {
    const s = size || BUCKET;
    const o = opts || {};
    const minTotal = o.minTotal || 15;

    const curve = coverageCurve(universe, s);
    const rateByBand = new Map();
    for (const c of curve) rateByBand.set(c.bucket, c.rate === null ? 0 : c.rate);

    const byTopic = new Map();
    for (const p of universe) {
      if (!Number.isFinite(p.rating)) continue;
      const b = bucketOf(p.rating, s);
      for (const tag of p.tags || []) {
        let row = byTopic.get(tag);
        if (!row) {
          row = { topic: tag, total: 0, solved: 0, expected: 0 };
          byTopic.set(tag, row);
        }
        row.total += 1;
        row.expected += rateByBand.get(b) || 0;
        if (p.solved) row.solved += 1;
      }
    }

    return Array.from(byTopic.values())
      .filter((r) => r.total >= minTotal)
      .map((r) => ({
        topic: r.topic,
        total: r.total,
        solved: r.solved,
        expected: r.expected,
        deficit: r.expected - r.solved,
        rate: r.total ? r.solved / r.total : 0,
      }))
      .sort((a, b) => b.deficit - a.deficit);
  }

  /**
   * What to solve next.
   *
   * Rules, in order: it must be unsolved, it must be free, it must sit in a
   * band just above where your coverage breaks down, and among those it should
   * belong to a topic you are behind on. Everything is deterministic and comes
   * out of the same table the charts use, so there is no model here deciding
   * what you need.
   */
  function recommend(universe, opts) {
    const o = opts || {};
    const target = o.target;
    if (!Number.isFinite(target)) return [];

    const below = typeof o.below === "number" ? o.below : 60;
    const above = typeof o.above === "number" ? o.above : 180;
    const count = o.count || 12;
    const includePaid = !!o.includePaid;

    const weight = new Map();
    for (const w of o.weakTopics || []) {
      if (w.deficit > 0) weight.set(w.topic, w.deficit);
    }
    const maxDeficit = Math.max(1, ...Array.from(weight.values()));

    const pool = universe.filter(
      (p) =>
        !p.solved &&
        Number.isFinite(p.rating) &&
        p.rating >= target - below &&
        p.rating <= target + above &&
        (includePaid || !p.paidOnly)
    );

    const scored = pool.map((p) => {
      // Closeness to target, 1 at the target and falling to 0 at the window
      // edge, so a problem 10 points away never loses to a topic bonus.
      const dist = p.rating - target;
      const span = dist < 0 ? below : above;
      const near = span === 0 ? 1 : 1 - Math.abs(dist) / span;

      let topicScore = 0;
      for (const tag of p.tags || []) {
        topicScore = Math.max(topicScore, (weight.get(tag) || 0) / maxDeficit);
      }

      return { problem: p, score: near * 0.6 + topicScore * 0.4, near: near, topicScore: topicScore };
    });

    scored.sort((a, b) => b.score - a.score || a.problem.rating - b.problem.rating);
    return scored.slice(0, count).map((x) => ({
      slug: x.problem.slug,
      title: x.problem.title,
      rating: x.problem.rating,
      tags: x.problem.tags || [],
      index: x.problem.index,
      contest: x.problem.contest,
      score: x.score,
    }));
  }

  /**
   * What you have probably forgotten.
   *
   * There is no review history to work from, so this is not real spaced
   * repetition: it is staleness weighted by how far above your own level the
   * problem was. A 2100 you solved eight months ago is a different risk from a
   * 1300 you solved eight months ago, because the 1300 you could re-derive.
   *
   * items: [{ slug, title, rating, solvedAt }] with solvedAt in epoch seconds.
   */
  function revisionQueue(items, nowSec, opts) {
    const o = opts || {};
    const minDays = typeof o.minDays === "number" ? o.minDays : 21;
    const level = Number.isFinite(o.level) ? o.level : null;
    const count = o.count || 10;

    const out = [];
    for (const it of items) {
      if (!Number.isFinite(it.solvedAt) || !Number.isFinite(it.rating)) continue;
      const days = (nowSec - it.solvedAt) / 86400;
      if (days < minDays) continue;

      // Above your level counts double, below it counts less. Clamped so one
      // very old very hard problem cannot own the whole list.
      const rel = level === null ? 1 : 1 + Math.max(-0.6, Math.min(1, (it.rating - level) / 400));
      out.push({
        slug: it.slug,
        title: it.title,
        rating: it.rating,
        solvedAt: it.solvedAt,
        days: days,
        score: Math.log1p(days) * rel,
      });
    }

    out.sort((a, b) => b.score - a.score);
    return out.slice(0, count);
  }

  /**
   * Practice level against contest level.
   *
   * These measure different things and the gap is the interesting part: one is
   * what you can do with unlimited time and a hint tab open, the other is what
   * you can do in ninety minutes with a clock. A large positive gap is the
   * signature of someone who solves after reading editorials.
   *
   * Both inputs are optional; whatever is missing comes back null rather than
   * being guessed at.
   */
  function calibration(practiceLevel, contestRating) {
    if (!Number.isFinite(practiceLevel) || !Number.isFinite(contestRating)) {
      return { practice: practiceLevel ?? null, contest: contestRating ?? null, gap: null, reading: null };
    }
    const gap = practiceLevel - contestRating;
    let reading;
    if (gap > 250) reading = "You solve harder problems than you score. Time pressure, not ability, is the binding constraint.";
    else if (gap < -250) reading = "You score higher than your practice set suggests. Contest form is ahead of your practice depth.";
    else reading = "Practice and contest are within 250 points. The two measurements agree.";
    return { practice: practiceLevel, contest: contestRating, gap: gap, reading: reading };
  }

  /** Solved counts by contest slot, as a share of what exists in each slot. */
  function slotCoverage(universe) {
    const slots = ["Q1", "Q2", "Q3", "Q4"];
    const out = [];
    for (const q of slots) {
      let total = 0;
      let solved = 0;
      for (const p of universe) {
        if (p.index !== q) continue;
        total += 1;
        if (p.solved) solved += 1;
      }
      out.push({ slot: q, total: total, solved: solved, rate: total ? solved / total : null });
    }
    return out;
  }

  return {
    bucketOf,
    coverageCurve,
    crossoverRating,
    topicMatrix,
    weakTopics,
    recommend,
    revisionQueue,
    calibration,
    slotCoverage,
  };
});

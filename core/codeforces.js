// core/codeforces.js
// Codeforces data layer, shared by all three surfaces (CF page panel, the LeetCode
// panel's CF section, and the popup). Loads two ways on purpose:
//   - in the extension it is listed in manifest.json before the content script and
//     sets self.CFCore, matching how libs/chart.min.js is already loaded
//   - in node it exports via module.exports so the test can run with no browser
//
// Why Codeforces needs no rating dataset: user.status returns each submission with
// its problem object, and that object already carries `rating` and `tags`. LeetCode
// needs zerotrac because LeetCode publishes no numeric rating at all.

(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.CFCore = api;
  }
})(typeof self !== "undefined" ? self : this, function () {

  var API = "https://codeforces.com/api";

  // A solved problem is identified by contestId + index. The same problem can appear
  // in many submissions, so dedupe or every re-solve inflates the histogram.
  function problemKey(p) {
    if (!p) return null;
    var c = p.contestId != null ? p.contestId : (p.problemsetName || "x");
    if (p.index == null) return null;
    return c + "-" + p.index;
  }

  // Raw user.status response -> deduped list of solved problems.
  // Only verdict OK counts as solved.
  function normalizeSubmissions(result) {
    var seen = Object.create(null);
    var out = [];
    if (!Array.isArray(result)) return out;
    for (var i = 0; i < result.length; i++) {
      var s = result[i];
      if (!s || s.verdict !== "OK") continue;
      var key = problemKey(s.problem);
      if (!key || seen[key]) continue;
      seen[key] = true;
      out.push({
        key: key,
        name: s.problem.name || key,
        rating: typeof s.problem.rating === "number" ? s.problem.rating : null,
        tags: Array.isArray(s.problem.tags) ? s.problem.tags : [],
        solvedAt: s.creationTimeSeconds || null
      });
    }
    return out;
  }

  // Same 100-wide buckets the LeetCode panel already uses, so the two charts are
  // directly comparable instead of each inventing its own scale.
  function bucketByRating(items) {
    var counts = Object.create(null);
    var unrated = 0;
    for (var i = 0; i < items.length; i++) {
      var r = items[i].rating;
      if (typeof r !== "number" || !isFinite(r)) { unrated++; continue; }
      var b = Math.floor(r / 100) * 100;
      counts[b] = (counts[b] || 0) + 1;
    }
    var labels = Object.keys(counts).map(Number).sort(function (a, b) { return a - b; });
    return {
      labels: labels.map(String),
      data: labels.map(function (l) { return counts[l]; }),
      rated: items.length - unrated,
      unrated: unrated
    };
  }

  function countTags(items, topN) {
    var n = topN || 15;
    var counts = Object.create(null);
    for (var i = 0; i < items.length; i++) {
      var tags = items[i].tags || [];
      for (var j = 0; j < tags.length; j++) {
        counts[tags[j]] = (counts[tags[j]] || 0) + 1;
      }
    }
    var sorted = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, n);
    return {
      labels: sorted,
      data: sorted.map(function (t) { return counts[t]; }),
      backgroundColors: sorted.map(function (_, i) { return "hsl(" + ((i * 40) % 360) + ", 65%, 55%)"; })
    };
  }

  // fetchImpl is injected so node and the service worker both work, and so a test can
  // stub it. Returns the normalized solved list, or throws with the API's own comment.
  function fetchSolved(handle, fetchImpl) {
    var f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
    if (!f) return Promise.reject(new Error("no fetch available"));
    if (!handle) return Promise.reject(new Error("handle is required"));
    var url = API + "/user.status?handle=" + encodeURIComponent(handle) + "&from=1&count=100000";
    return f(url).then(function (res) {
      if (!res.ok) throw new Error("codeforces http " + res.status);
      return res.json();
    }).then(function (json) {
      if (!json || json.status !== "OK") {
        throw new Error("codeforces api: " + ((json && json.comment) || "unknown error"));
      }
      return normalizeSubmissions(json.result);
    });
  }

  function summarize(items) {
    return {
      solved: items.length,
      ratings: bucketByRating(items),
      tags: countTags(items, 15)
    };
  }

  return {
    problemKey: problemKey,
    normalizeSubmissions: normalizeSubmissions,
    bucketByRating: bucketByRating,
    countTags: countTags,
    fetchSolved: fetchSolved,
    summarize: summarize
  };
});

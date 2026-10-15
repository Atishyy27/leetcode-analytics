/**
 * Entry point and single-page-app routing.
 *
 * v1 watched the entire document with a MutationObserver purely to notice
 * that location.href had changed, then started a fresh 500ms polling interval
 * on every change without stopping the last one. On LeetCode, where the DOM
 * mutates constantly, that is a callback on nearly every frame and a growing
 * pile of intervals.
 *
 * Here: history.pushState and replaceState are wrapped, popstate is listened
 * to, and that is the whole navigation signal. Each route change aborts the
 * previous one through an AbortController, so an in-flight sync for the page
 * you just left stops making requests instead of finishing and painting into
 * a page that is gone.
 */
(function (root) {
  "use strict";
  const LCA = (root.LCA = root.LCA || {});

  let controller = null;
  let lastKey = null;

  function keyOf(r) {
    return r.kind + ":" + (r.username || r.slug || "");
  }

  async function dispatch() {
    const r = LCA.route.parse(location.pathname);
    const key = keyOf(r);
    if (key === lastKey) return;
    lastKey = key;

    if (controller) controller.abort();
    controller = new AbortController();
    const signal = controller.signal;

    LCA.problemset.stop();

    try {
      if (r.kind === "profile") await LCA.profile.run(r.username, signal);
      else if (r.kind === "problem") await LCA.problem.run(signal);
      else if (r.kind === "problemset") await LCA.problemset.run(signal);
    } catch (err) {
      if (err && err.name !== "AbortError") console.error("[LCA] route failed:", err);
    }
  }

  function hookHistory() {
    for (const name of ["pushState", "replaceState"]) {
      const original = history[name];
      history[name] = function () {
        const out = original.apply(this, arguments);
        // Let the framework finish its render before we look at the DOM.
        setTimeout(dispatch, 0);
        return out;
      };
    }
    window.addEventListener("popstate", () => setTimeout(dispatch, 0));
  }

  hookHistory();
  dispatch();
})(typeof globalThis !== "undefined" ? globalThis : self);

/**
 * Ratings in the problem list.
 *
 * The list is virtualised: rows are created and destroyed as you scroll, and
 * a row annotated once comes back unannotated. So this watches for new rows
 * instead of running once, marks what it has done with a data attribute, and
 * batches work into an animation frame so a fast scroll does not turn into
 * hundreds of layout passes.
 *
 * The observer disconnects itself when the route leaves the problem set,
 * which matters because an observer left running on a single-page app is a
 * leak that only shows up after twenty minutes of use.
 */
(function (root) {
  "use strict";
  const LCA = (root.LCA = root.LCA || {});
  const { el } = LCA.ui;

  const MARK = "lcaRated";
  let observer = null;
  let queued = false;

  function bandClass(rating) {
    if (rating < 1400) return "lca-b1";
    if (rating < 1700) return "lca-b2";
    if (rating < 2000) return "lca-b3";
    if (rating < 2400) return "lca-b4";
    return "lca-b5";
  }

  function annotate(table) {
    queued = false;
    const links = document.querySelectorAll('a[href^="/problems/"]:not([data-lca-rated])');
    for (const a of links) {
      a.dataset[MARK] = "1";

      const m = a.getAttribute("href").match(/^\/problems\/([^/?#]+)/);
      if (!m) continue;
      const info = table.bySlug.get(m[1].toLowerCase());
      if (!info) continue;

      // Only annotate links that look like a list row: a bare icon link to
      // the same problem should not get a second chip.
      const text = (a.textContent || "").trim();
      if (text.length < 3) continue;

      a.appendChild(
        el("span", { class: "lca-inline-rating " + bandClass(info.rating), text: String(info.rating), title: `${info.index} of ${info.contest}` })
      );
    }
  }

  function schedule(table) {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => annotate(table));
  }

  async function run(signal) {
    stop();
    const settings = await LCA.store.getSettings();
    if (!settings.onProblemset) return;

    const table = await LCA.data.load();
    if (signal && signal.aborted) return;

    schedule(table);
    observer = new MutationObserver(() => schedule(table));
    observer.observe(document.body, { childList: true, subtree: true });

    if (signal) signal.addEventListener("abort", stop, { once: true });
  }

  function stop() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  LCA.problemset = { run: run, stop: stop, bandClass: bandClass };
})(typeof globalThis !== "undefined" ? globalThis : self);

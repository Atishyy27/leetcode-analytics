/**
 * The rating chip on a problem page.
 *
 * This is the smallest surface and probably the most useful one. LeetCode
 * tells you "Medium". The community table knows this exact problem was Q3 of
 * weekly 106 and came out at 1711, which is a different sentence: it tells
 * you whether being stuck is reasonable. Nothing else in the extension
 * changes behaviour the way a number next to the title does.
 *
 * Costs no network. The rating table is already in memory and the solved
 * status, if there is any, comes out of the cache the profile page filled.
 */
(function (root) {
  "use strict";
  const LCA = (root.LCA = root.LCA || {});
  const { el, waitForAnchor } = LCA.ui;

  const CHIP_ID = "lca-chip";

  function slugFromPath() {
    const m = location.pathname.match(/^\/problems\/([^/]+)/);
    return m ? m[1].toLowerCase() : null;
  }

  function prettyContest(slug) {
    const m = String(slug || "").match(/^(biweekly|weekly)-contest-(\d+)$/);
    if (!m) return slug || "";
    return (m[1] === "biweekly" ? "Biweekly " : "Weekly ") + m[2];
  }

  /**
   * Band label, relative to the reader rather than in the abstract. "1711" is
   * information; "1711, above where you are at 50%" is a decision.
   */
  function relativeNote(rating, level) {
    if (!Number.isFinite(level)) return null;
    const d = rating - level;
    if (d > 300) return "well above your level";
    if (d > 80) return "above your level";
    if (d < -300) return "well below your level";
    if (d < -80) return "below your level";
    return "right at your level";
  }

  function anchors() {
    return [
      // The difficulty pill, by its text.
      () => {
        const pills = Array.from(document.querySelectorAll("div,span,a"));
        return pills.find((n) => {
          const t = (n.textContent || "").trim();
          return (t === "Easy" || t === "Medium" || t === "Hard") && n.children.length === 0;
        });
      },
      // The title link, which sits in the same row.
      () => document.querySelector('a[href^="/problems/"][class*="text-title"]'),
      // Anything describing the problem header.
      () => document.querySelector('div[data-track-load="description_content"]'),
    ];
  }

  async function run(signal) {
    const settings = await LCA.store.getSettings();
    if (!settings.onProblem) return;

    const slug = slugFromPath();
    if (!slug) return;

    const old = document.getElementById(CHIP_ID);
    if (old) old.remove();

    const table = await LCA.data.load();
    const info = table.bySlug.get(slug);

    const found = await waitForAnchor(anchors(), 10000);
    if (!found) return;
    if (signal && signal.aborted) return;

    // Guard against the SPA having moved on while we waited.
    if (slugFromPath() !== slug) return;

    let level = null;
    try {
      const me = await LCA.store.get("level");
      if (me && Number.isFinite(me.value)) level = me.value;
    } catch (err) {
      /* no level cached yet is the normal first-run case */
    }

    const chip = el("span", { class: "lca-chip", id: CHIP_ID });
    LCA.theme.bind(chip);

    if (!info) {
      chip.appendChild(el("span", { class: "lca-chip-dim", text: "no contest rating" }));
      chip.title = "This problem never appeared in a rated contest, so the community dataset has no rating for it.";
    } else {
      chip.appendChild(el("strong", { class: "lca-chip-rating", text: String(info.rating) }));
      chip.appendChild(el("span", { class: "lca-chip-sep", text: "·" }));
      chip.appendChild(el("span", { text: info.index || "" }));
      chip.appendChild(el("span", { class: "lca-chip-sep", text: "·" }));
      chip.appendChild(el("span", { text: prettyContest(info.contest) }));
      const note = relativeNote(info.rating, level);
      if (note) {
        chip.appendChild(el("span", { class: "lca-chip-sep", text: "·" }));
        chip.appendChild(el("span", { class: "lca-chip-dim", text: note }));
      }
      chip.title = `Community rating ${info.rating}, from the ${prettyContest(info.contest)} ${info.index} slot. Snapshot ${table.snapshot}.`;
    }

    const host = found.node;
    if (host.parentElement) host.parentElement.insertBefore(chip, host.nextSibling);
    else host.appendChild(chip);
  }

  LCA.problem = { run: run, slugFromPath: slugFromPath, prettyContest: prettyContest, relativeNote: relativeNote };
})(typeof globalThis !== "undefined" ? globalThis : self);

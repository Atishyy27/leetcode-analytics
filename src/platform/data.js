/**
 * Getting the rating table into the page.
 *
 * The file ships inside the extension, so the default install makes no
 * third-party request at all. It is loaded through the service worker rather
 * than exposed as a web-accessible resource, because a web-accessible
 * resource is readable by leetcode.com itself and turns the extension into
 * something the page can fingerprint. The worker can read its own files
 * without declaring anything.
 *
 * Parsed once per page, then held in memory. The parse is 2,600 lines of
 * split-on-tab, about 4ms, so caching the parsed Map in storage would cost
 * more in serialisation than it saves.
 */
(function (root) {
  "use strict";
  const LCA = (root.LCA = root.LCA || {});

  let cached = null;
  let inflight = null;

  function ask(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (res) => {
          if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
          resolve(res || { ok: false, error: "no response" });
        });
      } catch (err) {
        resolve({ ok: false, error: String(err && err.message) });
      }
    });
  }

  async function load() {
    if (cached) return cached;
    if (inflight) return inflight;

    inflight = (async () => {
      const settings = await LCA.store.getSettings();
      const res = await ask({ type: "LCA_RATINGS", live: !!settings.liveRatings });
      if (!res.ok || !res.text) {
        throw new Error("rating table did not load: " + (res.error || "empty"));
      }
      const parsed = LCA.ratings.parseTable(res.text);
      parsed.source = res.source || "bundled";
      parsed.fetchedAt = res.fetchedAt || null;
      cached = parsed;
      inflight = null;
      return parsed;
    })();

    return inflight;
  }

  LCA.data = { load, ask };
})(typeof globalThis !== "undefined" ? globalThis : self);

/**
 * chrome.storage.local with an expiry date on everything.
 *
 * v1 had no cache at all: every profile view re-downloaded the rating dataset
 * and re-walked the API. The opposite mistake is a cache with no expiry, which
 * is how an extension ends up confidently showing a count from three weeks ago.
 * So nothing goes in without a ttl, and get() returning null covers both
 * "never stored" and "too old" because the caller should treat them the same.
 */
(function (root) {
  "use strict";
  const LCA = (root.LCA = root.LCA || {});

  const PREFIX = "lca2:";
  const has = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;

  function key(k) {
    return PREFIX + k;
  }

  function get(k) {
    if (!has) return Promise.resolve(null);
    return new Promise((resolve) => {
      chrome.storage.local.get([key(k)], (res) => {
        if (chrome.runtime.lastError) return resolve(null);
        const box = res[key(k)];
        if (!box || typeof box !== "object") return resolve(null);
        if (Number.isFinite(box.exp) && Date.now() > box.exp) {
          // Drop it on read rather than leaving dead bytes in the quota.
          chrome.storage.local.remove([key(k)], () => void chrome.runtime.lastError);
          return resolve(null);
        }
        resolve({ value: box.v, at: box.at, exp: box.exp });
      });
    });
  }

  function set(k, value, ttlMs) {
    if (!has) return Promise.resolve(false);
    const box = { v: value, at: Date.now(), exp: Number.isFinite(ttlMs) ? Date.now() + ttlMs : null };
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key(k)]: box }, () => {
        // Over quota is the expected failure and it must not be fatal: the
        // caller can still work, just slower.
        if (chrome.runtime.lastError) {
          console.warn("[LCA] cache write failed:", chrome.runtime.lastError.message);
          return resolve(false);
        }
        resolve(true);
      });
    });
  }

  function del(k) {
    if (!has) return Promise.resolve();
    return new Promise((resolve) => chrome.storage.local.remove([key(k)], () => resolve()));
  }

  function clearAll() {
    if (!has) return Promise.resolve(0);
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (all) => {
        const mine = Object.keys(all || {}).filter((k) => k.startsWith(PREFIX));
        if (mine.length === 0) return resolve(0);
        chrome.storage.local.remove(mine, () => resolve(mine.length));
      });
    });
  }

  function bytes() {
    if (!has || !chrome.storage.local.getBytesInUse) return Promise.resolve(null);
    return new Promise((resolve) => chrome.storage.local.getBytesInUse(null, (b) => resolve(b)));
  }

  /** Settings are not cache: no ttl, survives a cache clear. */
  const SETTINGS_KEY = "settings";
  const DEFAULTS = {
    onProfile: true,
    onProblem: true,
    onProblemset: true,
    targetOffset: 100,
    liveRatings: false,
    bucket: 100,
  };

  function getSettings() {
    if (!has) return Promise.resolve(Object.assign({}, DEFAULTS));
    return new Promise((resolve) => {
      chrome.storage.local.get([key(SETTINGS_KEY)], (res) => {
        const raw = res && res[key(SETTINGS_KEY)];
        resolve(Object.assign({}, DEFAULTS, (raw && raw.v) || {}));
      });
    });
  }

  function setSettings(patch) {
    return getSettings().then((cur) => {
      const next = Object.assign({}, cur, patch);
      return new Promise((resolve) => {
        chrome.storage.local.set({ [key(SETTINGS_KEY)]: { v: next, at: Date.now(), exp: null } }, () => resolve(next));
      });
    });
  }

  LCA.store = { get, set, del, clearAll, bytes, getSettings, setSettings, DEFAULTS, PREFIX };
})(typeof globalThis !== "undefined" ? globalThis : self);

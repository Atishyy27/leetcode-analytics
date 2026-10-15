/**
 * Options. The only interesting part is the live-ratings toggle, which has to
 * request a host permission from inside a user gesture, and has to put the
 * checkbox back if the user says no. A toggle that stays on after a denied
 * permission prompt is a lie about what the extension is doing.
 */
const PREFIX = "lca2:";
const SETTINGS_KEY = PREFIX + "settings";
const UPSTREAM = { origins: ["https://raw.githubusercontent.com/*"] };

const DEFAULTS = {
  onProfile: true,
  onProblem: true,
  onProblemset: true,
  targetOffset: 100,
  liveRatings: false,
  bucket: 100,
};

const $ = (id) => document.getElementById(id);
const msg = (t) => {
  $("msg").textContent = t;
  if (t) setTimeout(() => ($("msg").textContent = ""), 3000);
};

function load() {
  return new Promise((resolve) => {
    chrome.storage.local.get([SETTINGS_KEY], (res) => {
      const raw = res && res[SETTINGS_KEY];
      resolve(Object.assign({}, DEFAULTS, (raw && raw.v) || {}));
    });
  });
}

function save(patch) {
  return load().then(
    (cur) =>
      new Promise((resolve) => {
        const next = Object.assign({}, cur, patch);
        chrome.storage.local.set({ [SETTINGS_KEY]: { v: next, at: Date.now(), exp: null } }, () => resolve(next));
      })
  );
}

function showCache() {
  chrome.storage.local.getBytesInUse(null, (bytes) => {
    chrome.storage.local.get(null, (all) => {
      const keys = Object.keys(all || {}).filter((k) => k.startsWith(PREFIX));
      $("cacheInfo").textContent = `${keys.length} cached item${keys.length === 1 ? "" : "s"}, ${(bytes / 1024).toFixed(0)}K in use.`;
    });
  });
}

async function init() {
  const s = await load();
  for (const id of ["onProfile", "onProblem", "onProblemset", "liveRatings"]) {
    $(id).checked = !!s[id];
  }
  showCache();

  for (const id of ["onProfile", "onProblem", "onProblemset"]) {
    $(id).addEventListener("change", async (e) => {
      await save({ [id]: e.target.checked });
      msg("Saved. Reload your LeetCode tab.");
    });
  }

  $("liveRatings").addEventListener("change", (e) => {
    const box = e.target;
    if (!box.checked) {
      save({ liveRatings: false }).then(() => {
        chrome.runtime.sendMessage({ type: "LCA_DROP_LIVE" }, () => void chrome.runtime.lastError);
        // Hand the permission back. Keeping a granted origin the feature no
        // longer uses is exactly the kind of leftover that makes a permission
        // list meaningless.
        chrome.permissions.remove(UPSTREAM, () => {
          msg("Turned off. Using the snapshot that ships with the extension.");
          showCache();
        });
      });
      return;
    }

    chrome.permissions.request(UPSTREAM, (granted) => {
      if (!granted) {
        box.checked = false;
        msg("Permission declined, so refresh stays off.");
        return;
      }
      save({ liveRatings: true }).then(() => msg("On. The dataset will refresh on your next profile view."));
    });
  });

  $("clear").addEventListener("click", () => {
    chrome.storage.local.get(null, (all) => {
      const keys = Object.keys(all || {}).filter((k) => k.startsWith(PREFIX) && k !== SETTINGS_KEY);
      chrome.storage.local.remove(keys, () => {
        msg(`Cleared ${keys.length} item${keys.length === 1 ? "" : "s"}. Settings kept.`);
        showCache();
      });
    });
  });
}

init();

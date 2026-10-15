/**
 * DOM plumbing shared by the three surfaces.
 *
 * Two rules here, both learned from v1. Nothing is built by assigning a
 * template string that contains data: markup and values are kept apart, so a
 * problem title can never become markup. And nothing waits on a single CSS
 * selector: LeetCode ships a new build most weeks and v1's one escaped
 * Tailwind class was a guaranteed expiry date.
 */
(function (root) {
  "use strict";
  const LCA = (root.LCA = root.LCA || {});

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v; // only ever given svg we built
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children || []) {
      if (c === null || c === undefined) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  function card(title, subtitle, body) {
    return el("section", { class: "lca-card" }, [
      el("header", { class: "lca-card-head" }, [
        el("h3", { class: "lca-card-title", text: title }),
        subtitle ? el("p", { class: "lca-card-sub", text: subtitle }) : null,
      ]),
      body,
    ]);
  }

  function stat(label, value, note) {
    return el("div", { class: "lca-stat" }, [
      el("div", { class: "lca-stat-value", text: value }),
      el("div", { class: "lca-stat-label", text: label }),
      note ? el("div", { class: "lca-stat-note", text: note }) : null,
    ]);
  }

  function svgBox(markup) {
    return el("div", { class: "lca-svg-box", html: markup });
  }

  function link(href, text, cls) {
    return el("a", { class: "lca-link " + (cls || ""), href: href, target: "_blank", rel: "noopener noreferrer", text: text });
  }

  /**
   * Wait for any of several anchors, then hand back the first that appears.
   *
   * Resolves null after timeoutMs instead of hanging, so the caller can say
   * "could not attach" out loud rather than leaving an empty page and a
   * console message nobody reads.
   */
  function waitForAnchor(finders, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 12000);

    function tryNow() {
      for (let i = 0; i < finders.length; i++) {
        try {
          const node = finders[i]();
          if (node) return { node: node, strategy: i };
        } catch (err) {
          /* a selector that throws is just a selector that failed */
        }
      }
      return null;
    }

    const first = tryNow();
    if (first) return Promise.resolve(first);

    return new Promise((resolve) => {
      const mo = new MutationObserver(() => {
        const hit = tryNow();
        if (hit) {
          mo.disconnect();
          clearInterval(timer);
          resolve(hit);
        }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });

      const timer = setInterval(() => {
        if (Date.now() > deadline) {
          mo.disconnect();
          clearInterval(timer);
          resolve(null);
        }
      }, 500);
    });
  }

  /** A tab strip whose panels are built lazily, so an unopened tab costs nothing. */
  function tabs(defs) {
    const strip = el("div", { class: "lca-tabs", role: "tablist" });
    const body = el("div", { class: "lca-tab-body" });
    const built = new Map();
    let current = null;

    function show(name) {
      if (current === name) return;
      current = name;
      for (const b of strip.children) b.classList.toggle("is-on", b.dataset.tab === name);
      body.textContent = "";
      let panel = built.get(name);
      if (!panel) {
        const def = defs.find((d) => d.name === name);
        panel = def ? def.build() : el("div");
        built.set(name, panel);
      }
      body.appendChild(panel);
    }

    for (const d of defs) {
      const b = el("button", { class: "lca-tab", type: "button", role: "tab", text: d.label, "data-tab": d.name });
      b.addEventListener("click", () => show(d.name));
      strip.appendChild(b);
    }

    show(defs[0].name);
    return { strip: strip, body: body, show: show, invalidate: () => built.clear() };
  }

  /** Download a string as a file. No permission needed, no server involved. */
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function fmt(nv, digits) {
    if (!Number.isFinite(nv)) return "—";
    return nv.toLocaleString("en-US", { maximumFractionDigits: digits === undefined ? 0 : digits });
  }

  function pct(x) {
    return Number.isFinite(x) ? Math.round(x * 100) + "%" : "—";
  }

  LCA.ui = { el, card, stat, svgBox, link, waitForAnchor, tabs, download, fmt, pct };
})(typeof globalThis !== "undefined" ? globalThis : self);

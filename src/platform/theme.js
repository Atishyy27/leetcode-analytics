/**
 * Follow LeetCode's own theme instead of picking one.
 *
 * v1 hardcoded a dark palette, so on light mode it painted grey text on a
 * dark card in the middle of a white page. LeetCode toggles a "dark" class on
 * <html>; that is the signal, and the luminance check is the fallback for the
 * day they stop. Either way the answer becomes one class on our root and the
 * rest is CSS variables.
 */
(function (root) {
  "use strict";
  const LCA = (root.LCA = root.LCA || {});

  function isDark() {
    const html = document.documentElement;
    if (html.classList.contains("dark")) return true;
    if (html.classList.contains("light")) return false;
    const attr = html.getAttribute("data-theme");
    if (attr === "dark") return true;
    if (attr === "light") return false;

    const bg = getComputedStyle(document.body).backgroundColor || "";
    const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return true;
    const lum = (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255;
    return lum < 0.5;
  }

  /** Apply now and keep applying; returns a stop function. */
  function bind(node) {
    const apply = () => {
      const dark = isDark();
      node.classList.toggle("lca-dark", dark);
      node.classList.toggle("lca-light", !dark);
    };
    apply();

    const mo = new MutationObserver(apply);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => mo.disconnect();
  }

  LCA.theme = { isDark, bind };
})(typeof globalThis !== "undefined" ? globalThis : self);

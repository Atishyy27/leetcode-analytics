/**
 * The charts, drawn by hand as SVG strings.
 *
 * v1 shipped Chart.js, 200K of UMD bundle, loaded into every leetcode.com page
 * including the problem editor, to draw one bar chart and one donut. Four
 * reasons it is gone: the weight landed on pages that never render a chart; a
 * canvas chart is invisible to the one thing that matters on a portfolio piece,
 * which is being able to read the numbers back out; inline SVG inherits CSS
 * custom properties, so light and dark themes cost nothing here and cost a
 * full re-render with Chart.js; and a chart built as a pure string function is
 * testable from node, which a canvas is not.
 *
 * Every function returns a string. Nothing here touches the DOM.
 */
(function (root, factory) {
  const api = factory();
  root.LCA = root.LCA || {};
  root.LCA.svg = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";

  /**
   * Escape before interpolation, every time, no exceptions for "it is just a
   * number". Problem titles come from LeetCode and go straight into markup;
   * one with an ampersand in it would otherwise break the whole chart, and one
   * with a bracket in it is a worse problem than that.
   */
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function n(v, d) {
    return Number.isFinite(v) ? Number(v.toFixed(d === undefined ? 2 : d)) : 0;
  }

  function open(w, h, cls) {
    return (
      `<svg class="lca-svg ${esc(cls || "")}" viewBox="0 0 ${n(w, 0)} ${n(h, 0)}" ` +
      `width="100%" height="${n(h, 0)}" preserveAspectRatio="xMidYMid meet" role="img">`
    );
  }

  /**
   * Solved count as bars, coverage as a line, on one pair of axes.
   *
   * The two series answer the two halves of the question. Bars say how much
   * work is in each band; the line says what fraction of that band exists and
   * is still unsolved. Reading them together is the point, which is why they
   * share an x-axis instead of sitting in two cards.
   */
  function coverageChart(curve, opts) {
    const o = opts || {};
    const W = o.width || 720;
    const H = o.height || 260;
    const padL = 42;
    const padR = 46;
    const padT = 16;
    const padB = 34;

    if (!curve || curve.length === 0) {
      return emptyBox(W, 120, "No rated problems to chart yet.");
    }

    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const step = innerW / curve.length;
    const maxCount = Math.max(1, ...curve.map((c) => c.solved));

    let bars = "";
    let line = "";
    let ticks = "";
    let pts = [];

    curve.forEach((c, i) => {
      const x = padL + i * step;
      const bw = Math.max(2, step * 0.72);
      const bx = x + (step - bw) / 2;
      const bh = (c.solved / maxCount) * innerH;
      const by = padT + innerH - bh;

      bars +=
        `<rect class="lca-bar" x="${n(bx)}" y="${n(by)}" width="${n(bw)}" height="${n(bh)}" rx="2">` +
        `<title>${esc(c.bucket)} to ${esc(c.bucket + 99)}: solved ${esc(c.solved)} of ${esc(c.total)}</title></rect>`;

      if (c.rate !== null) {
        pts.push([x + step / 2, padT + innerH - c.rate * innerH]);
      }

      // Label every other band, so the axis stays readable when there are 20.
      if (i % 2 === 0) {
        ticks +=
          `<text class="lca-axis" x="${n(x + step / 2)}" y="${n(H - 12)}" text-anchor="middle">${esc(c.bucket)}</text>`;
      }
    });

    if (pts.length > 1) {
      line =
        `<polyline class="lca-line" fill="none" points="${pts.map((p) => n(p[0]) + "," + n(p[1])).join(" ")}" />` +
        pts.map((p) => `<circle class="lca-dot" cx="${n(p[0])}" cy="${n(p[1])}" r="2.5" />`).join("");
    }

    // Right axis for the coverage line: 0, 50, 100 percent.
    let rAxis = "";
    for (const f of [0, 0.5, 1]) {
      const y = padT + innerH - f * innerH;
      rAxis +=
        `<line class="lca-grid" x1="${padL}" y1="${n(y)}" x2="${n(W - padR)}" y2="${n(y)}" />` +
        `<text class="lca-axis" x="${n(W - padR + 6)}" y="${n(y + 3)}">${Math.round(f * 100)}%</text>`;
    }

    // Left axis for the count bars.
    let lAxis = "";
    for (const f of [0, 0.5, 1]) {
      const y = padT + innerH - f * innerH;
      lAxis += `<text class="lca-axis" x="${padL - 6}" y="${n(y + 3)}" text-anchor="end">${Math.round(f * maxCount)}</text>`;
    }

    let marker = "";
    if (Number.isFinite(o.crossover)) {
      const first = curve[0].bucket;
      const last = curve[curve.length - 1].bucket;
      if (o.crossover >= first && o.crossover <= last + 100) {
        const frac = (o.crossover - first) / Math.max(1, last - first + 100);
        const x = padL + frac * innerW;
        marker =
          `<line class="lca-marker" x1="${n(x)}" y1="${padT}" x2="${n(x)}" y2="${n(padT + innerH)}" />` +
          `<text class="lca-marker-label" x="${n(x + 4)}" y="${padT + 10}">half-solved at ${Math.round(o.crossover)}</text>`;
      }
    }

    return (
      open(W, H, "lca-coverage") +
      rAxis +
      lAxis +
      bars +
      line +
      marker +
      ticks +
      "</svg>"
    );
  }

  /**
   * Topic by band, as a grid.
   *
   * Colour is coverage, not count, for the same reason the curve divides by
   * what exists: a dark cell at 1500 would otherwise mean nothing more than
   * "LeetCode has a lot of 1500 array problems". An empty cell, where the band
   * holds no problems with that tag at all, is drawn hollow so it cannot be
   * mistaken for a zero.
   */
  function heatmap(matrix, opts) {
    const o = opts || {};
    const labelW = o.labelW || 150;
    const cell = o.cell || 26;
    const gap = 2;
    const rows = matrix.rows || [];
    const bands = matrix.bands || [];

    if (rows.length === 0 || bands.length === 0) {
      return emptyBox(600, 100, "Not enough tagged problems to build the grid.");
    }

    const W = labelW + bands.length * (cell + gap) + 10;
    const H = 24 + rows.length * (cell + gap) + 6;

    let out = open(W, H, "lca-heatmap");

    bands.forEach((b, i) => {
      const x = labelW + i * (cell + gap) + cell / 2;
      if (i % 2 === 0) {
        out += `<text class="lca-axis" x="${n(x)}" y="14" text-anchor="middle">${esc(b)}</text>`;
      }
    });

    rows.forEach((row, r) => {
      const y = 24 + r * (cell + gap);
      out += `<text class="lca-axis lca-rowlabel" x="${labelW - 8}" y="${n(y + cell * 0.68)}" text-anchor="end">${esc(row.topic)}</text>`;

      row.cells.forEach((c, i) => {
        const x = labelW + i * (cell + gap);
        if (c.total === 0) {
          out += `<rect class="lca-cell lca-cell-empty" x="${n(x)}" y="${n(y)}" width="${cell}" height="${cell}" rx="3" />`;
          return;
        }
        const op = 0.1 + 0.9 * (c.rate || 0);
        out +=
          `<rect class="lca-cell" x="${n(x)}" y="${n(y)}" width="${cell}" height="${cell}" rx="3" ` +
          `style="opacity:${n(op, 3)}"><title>${esc(row.topic)} ${esc(c.bucket)}: ${esc(c.solved)} of ${esc(c.total)}</title></rect>`;
      });
    });

    return out + "</svg>";
  }

  /**
   * Horizontal bars, used for the topics you are behind on and for contest
   * slots. Values can be negative, which is why the zero line is computed
   * rather than assumed to be the left edge.
   */
  function hbars(items, opts) {
    const o = opts || {};
    const labelW = o.labelW || 150;
    const rowH = o.rowH || 22;
    const W = o.width || 620;
    const H = Math.max(1, items.length) * rowH + 8;

    if (items.length === 0) return emptyBox(W, 60, o.empty || "Nothing to show.");

    const innerW = W - labelW - 60;
    const maxAbs = Math.max(1, ...items.map((it) => Math.abs(it.value)));
    const hasNeg = items.some((it) => it.value < 0);
    const zeroX = hasNeg ? labelW + innerW / 2 : labelW;
    const scale = hasNeg ? innerW / 2 / maxAbs : innerW / maxAbs;

    let out = open(W, H, "lca-hbars");
    items.forEach((it, i) => {
      const y = i * rowH + 4;
      const w = Math.abs(it.value) * scale;
      const x = it.value < 0 ? zeroX - w : zeroX;
      out +=
        `<text class="lca-axis lca-rowlabel" x="${labelW - 8}" y="${n(y + rowH * 0.62)}" text-anchor="end">${esc(it.label)}</text>` +
        `<rect class="lca-bar ${it.value < 0 ? "lca-bar-neg" : ""}" x="${n(x)}" y="${n(y + 3)}" ` +
        `width="${n(Math.max(1, w))}" height="${rowH - 9}" rx="2"><title>${esc(it.title || it.label)}</title></rect>` +
        `<text class="lca-value" x="${n(Math.max(x + w, zeroX) + 6)}" y="${n(y + rowH * 0.62)}">${esc(it.note || "")}</text>`;
    });
    return out + "</svg>";
  }

  /**
   * Solved problems over time, one dot per solve, y is the rating.
   *
   * A line would be a lie here: these are independent events, not a series,
   * and connecting them implies a trajectory between two problems solved an
   * hour apart. The trend line is a real least-squares fit over the dots and
   * is labelled as one.
   */
  function scatterOverTime(points, opts) {
    const o = opts || {};
    const W = o.width || 720;
    const H = o.height || 220;
    const padL = 42;
    const padR = 16;
    const padT = 14;
    const padB = 28;

    const pts = points.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.rating));
    if (pts.length < 2) return emptyBox(W, 100, "Not enough dated solves yet.");

    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const t0 = Math.min.apply(null, pts.map((p) => p.t));
    const t1 = Math.max.apply(null, pts.map((p) => p.t));
    const r0 = Math.min.apply(null, pts.map((p) => p.rating));
    const r1 = Math.max.apply(null, pts.map((p) => p.rating));
    const tSpan = Math.max(1, t1 - t0);
    const rSpan = Math.max(1, r1 - r0);

    const X = (t) => padL + ((t - t0) / tSpan) * innerW;
    const Y = (r) => padT + innerH - ((r - r0) / rSpan) * innerH;

    let dots = "";
    for (const p of pts) {
      dots +=
        `<circle class="lca-dot" cx="${n(X(p.t))}" cy="${n(Y(p.rating))}" r="3">` +
        `<title>${esc(p.title || p.slug)} — ${esc(Math.round(p.rating))}</title></circle>`;
    }

    // Least squares on (t, rating).
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of pts) {
      sx += p.t; sy += p.rating; sxx += p.t * p.t; sxy += p.t * p.rating;
    }
    const nn = pts.length;
    const denom = nn * sxx - sx * sx;
    let trend = "";
    if (denom !== 0) {
      const slope = (nn * sxy - sx * sy) / denom;
      const intercept = (sy - slope * sx) / nn;
      trend =
        `<line class="lca-trend" x1="${n(X(t0))}" y1="${n(Y(slope * t0 + intercept))}" ` +
        `x2="${n(X(t1))}" y2="${n(Y(slope * t1 + intercept))}" />`;
    }

    let axis = "";
    for (const f of [0, 0.5, 1]) {
      const r = r0 + f * rSpan;
      axis += `<text class="lca-axis" x="${padL - 6}" y="${n(Y(r) + 3)}" text-anchor="end">${Math.round(r)}</text>`;
    }
    axis +=
      `<text class="lca-axis" x="${padL}" y="${H - 8}">${esc(o.fromLabel || "")}</text>` +
      `<text class="lca-axis" x="${W - padR}" y="${H - 8}" text-anchor="end">${esc(o.toLabel || "")}</text>`;

    return open(W, H, "lca-scatter") + axis + trend + dots + "</svg>";
  }

  function emptyBox(w, h, msg) {
    return (
      open(w, h, "lca-empty") +
      `<text class="lca-axis" x="${n(w / 2)}" y="${n(h / 2)}" text-anchor="middle">${esc(msg)}</text>` +
      "</svg>"
    );
  }

  return { esc, coverageChart, heatmap, hbars, scatterOverTime, emptyBox };
});

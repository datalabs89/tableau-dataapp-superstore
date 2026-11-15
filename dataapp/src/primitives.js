// ============================================================================
// SVG chart primitives. Plain SVG, no library, so the shipped package has no
// external origin to declare and nothing to load at runtime.
//
// Shared mark specs (dataviz):
//   bars capped at 24px, 4px rounded data-end only, square at the baseline
//   lines 2px round cap/join; markers >= 8px with a 2px surface ring
//   2px surface gap between adjacent/stacked fills
//   gridlines are solid hairlines one step off the surface - never dashed
//   a legend whenever there are >= 2 series; direct labels used sparingly
// ============================================================================
(function (SV) {
  'use strict';
  var el = SV.el, svg = SV.svg, fill = SV.fill;

  var BAR_MAX = 24;      // px cap on bar thickness
  var GAP = 2;           // the surface gap
  var RADIUS = 4;        // rounded data-end

  /** Rounded-top bar path: square at the baseline, 4px corners at the data end. */
  function barPath(x, y, w, h, r, horizontal, dir) {
    if (h <= 0) return '';
    r = Math.min(r, w / 2, h);
    if (!horizontal) {
      // growing up from (x, y+h)
      return 'M' + x + ' ' + (y + h) +
        'V' + (y + r) +
        'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + (-r) +
        'h' + (w - 2 * r) +
        'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + r +
        'V' + (y + h) + 'Z';
    }
    if (dir === 'left') {
      // growing left from x+w
      return 'M' + (x + w) + ' ' + y +
        'H' + (x + r) +
        'a' + r + ' ' + r + ' 0 0 1 ' + (-r) + ' ' + r +
        'v' + (h - 2 * r) +
        'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + r +
        'H' + (x + w) + 'Z';
    }
    return 'M' + x + ' ' + y +
      'H' + (x + w - r) +
      'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + r +
      'v' + (h - 2 * r) +
      'a' + r + ' ' + r + ' 0 0 1 ' + (-r) + ' ' + r +
      'H' + x + 'Z';
  }

  /**
   * Column growing from a zero baseline: 4px rounded corners at the data end,
   * square where it meets the baseline. `h` may be negative (grows downward)
   * for values below zero - the rounding then sits on the bottom edge.
   */
  function columnPath(x, yBase, w, h, r) {
    if (h === 0) return '';
    if (h > 0) return barPath(x, yBase - h, w, h, r);
    var hh = -h;
    r = Math.min(r, w / 2, hh);
    var yb = yBase + hh;
    return 'M' + x + ' ' + yBase +
      'V' + (yb - r) +
      'a' + r + ' ' + r + ' 0 0 0 ' + r + ' ' + r +
      'h' + (w - 2 * r) +
      'a' + r + ' ' + r + ' 0 0 0 ' + r + ' ' + (-r) +
      'V' + yBase + 'Z';
  }

  /** Nice axis ticks covering [lo, hi]. */
  function ticks(lo, hi, count) {
    var span = hi - lo;
    if (!isFinite(span) || span === 0) return [lo];
    var raw = span / (count || 5);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    var start = Math.ceil(lo / step) * step;
    var out = [];
    for (var v = start; v <= hi + step * 1e-9; v += step) {
      out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    }
    return out;
  }

  function gridlines(g, x1, x2, vals, y, theme, fmt) {
    vals.forEach(function (v) {
      var gy = y(v);
      g.appendChild(svg('line', { x1: x1, x2: x2, y1: gy, y2: gy,
        stroke: theme.grid, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }));
      if (fmt) {
        g.appendChild(svg('text', { x: x1 - 8, y: gy + 4, 'text-anchor': 'end',
          class: 'axis-txt', fill: theme.muted }, fmt(v)));
      }
    });
  }

  function emptyState(msg, theme) {
    var d = el('div', { class: 'chart-empty' });
    d.appendChild(el('p', {}, msg));
    d.textContent = msg;
    return d;
  }

  SV.primitives = {
    BAR_MAX: BAR_MAX, GAP: GAP, RADIUS: RADIUS,
    barPath: barPath, columnPath: columnPath, ticks: ticks, gridlines: gridlines,
    emptyState: emptyState, svg: svg, el: el, fill: fill,
  };
})((window.SV = window.SV || {}));

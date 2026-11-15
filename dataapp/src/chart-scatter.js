// ============================================================================
// Chart: discount against profit margin, one point per order line.
//
// This is the "why" behind the loss: margin falls as discount rises, and the
// points below the zero rule are the loss-making orders. A zero line is drawn
// because the sign is the story. Dense scatter needs a nearest-point hit layer
// rather than pinpoint dots, so hover is resolved by closest x.
// ============================================================================
(function (SV) {
  'use strict';
  var P = SV.primitives, svg = P.svg, fill = P.fill;

  function render(host, rows, theme, tip, opts) {
    opts = opts || {};
    var pts = rows.scatter;
    if (!pts || !pts.count) {
      fill(host, [P.emptyState(
        'No order lines in this slice to plot.', theme)]);
      return;
    }

    var W = 980, H = 300, M = { t: 16, r: 16, b: 46, l: 62 };
    var iw = W - M.l - M.r, ih = H - M.t - M.b;

    // Margin domain: clip the long outliers so the mass is readable, and say so.
    var ms = pts.margin.slice().sort(function (a, b) { return a - b; });
    var q = function (p) { return ms[Math.min(ms.length - 1, Math.max(0, Math.round(p * (ms.length - 1))))]; };
    var lo = Math.min(q(0.01), -0.5) * 1.02;
    var hi = Math.max(q(0.99), 0.6) * 1.02;
    var nClipped = ms.filter(function (v) { return v < lo || v > hi; }).length;

    var x = function (d) { return M.l + (d / 1.0) * iw; };
    var y = function (m) { return M.t + ih - ((m - lo) / (hi - lo)) * ih; };

    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart',
      role: 'img', 'aria-label': 'Profit margin against discount rate, one point per order line' });
    var g = svg('g');

    // Horizontal gridlines at margin ticks + the zero rule.
    P.gridlines(g, M.l, M.l + iw, P.ticks(lo, hi, 5), y, theme, function (v) {
      return SV.pct(v, 0);
    });
    g.appendChild(svg('line', { x1: M.l, x2: M.l + iw, y1: y(0), y2: y(0),
      stroke: theme.axis, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }));

    // The 30% discount threshold the headline finding uses. Solid, per the
    // rule that gridlines and rules are never dashed - a dash reads as
    // "projection" when this is a real, computed threshold.
    g.appendChild(svg('line', { x1: x(0.30), x2: x(0.30), y1: M.t, y2: M.t + ih,
      stroke: theme.axis, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }));
    g.appendChild(svg('text', { x: x(0.30) + 6, y: M.t + 12, class: 'axis-txt',
      fill: theme.muted }, '30% discount'));

    // Marks: one dot per line, colored by sign - the polarity IS the story.
    // Drawn as two passes so the loss points sit on top and stay visible.
    var pass = function (wantLoss) {
      for (var i = 0; i < pts.count; i++) {
        var m = pts.margin[i];
        var isLoss = m < 0;
        if (isLoss !== wantLoss) continue;
        if (m < lo || m > hi) continue;
        g.appendChild(svg('circle', {
          cx: x(pts.discount[i]).toFixed(1), cy: y(m).toFixed(1), r: 2.4,
          fill: isLoss ? theme.diverging[0] : theme.series[0],
          'fill-opacity': 0.42, 'pointer-events': 'none',
        }));
      }
    };
    pass(false);
    pass(true);

    // Nearest-point hit layer: the pointer only has to be closest, never exact.
    var overlay = svg('rect', { x: M.l, y: M.t, width: iw, height: ih, fill: 'transparent' });
    overlay.addEventListener('pointermove', function (ev) {
      var r = host.getBoundingClientRect();
      var px = (ev.clientX - r.left) / (r.width / W);
      var py = (ev.clientY - r.top) / (r.height / H);
      var dx = (px - M.l) / iw;                    // 0..1 discount
      var dy = lo + (1 - (py - M.t) / ih) * (hi - lo);
      var best = -1, bestD = Infinity;
      // Coarse nearest neighbour over the plotted points.
      for (var i = 0; i < pts.count; i++) {
        var m = pts.margin[i];
        if (m < lo || m > hi) continue;
        var ddx = (pts.discount[i] - dx) * 3;      // weight discount axis
        var ddy = (m - dy);
        var d2 = ddx * ddx + ddy * ddy;
        if (d2 < bestD) { bestD = d2; best = i; }
      }
      if (best < 0) { tip.hide(); return; }
      tip.show(ev.clientX - r.left, ev.clientY - r.top,
        'Discount ' + SV.pct(pts.discount[best], 0) + ' · line item', [
          { value: SV.pct(pts.margin[best], 1), label: 'Profit margin' },
          { value: SV.money(pts.sales[best], { cents: true }), label: 'Sales' },
          { value: SV.SUB_ORDER[pts.subIdx[best]], label: 'Sub-category' },
        ]);
    });
    overlay.addEventListener('pointerleave', function () { tip.hide(); });
    g.appendChild(overlay);

    // x axis
    [0, 0.1, 0.2, 0.3, 0.4, 0.5].forEach(function (d) {
      g.appendChild(svg('text', { x: x(d), y: M.t + ih + 18, 'text-anchor': 'middle',
        class: 'axis-txt', fill: theme.muted }, SV.pct(d, 0)));
    });
    g.appendChild(svg('text', { x: M.l + iw / 2, y: H - 8, 'text-anchor': 'middle',
      class: 'axis-txt', fill: theme.ink2 }, 'Discount rate'));

    // Legend: two sign classes, so a legend is required.
    var leg = svg('g');
    leg.appendChild(svg('circle', { cx: M.l + 5, cy: M.t + 6, r: 4, fill: theme.diverging[0] }));
    leg.appendChild(svg('text', { x: M.l + 14, y: M.t + 10, class: 'axis-txt',
      fill: theme.ink2 }, 'Loss-making line'));
    leg.appendChild(svg('circle', { cx: M.l + 148, cy: M.t + 6, r: 4, fill: theme.series[0] }));
    leg.appendChild(svg('text', { x: M.l + 158, y: M.t + 10, class: 'axis-txt',
      fill: theme.ink2 }, 'Profitable line'));
    g.appendChild(leg);

    s.appendChild(g);
    fill(host, [s]);

    if (nClipped) {
      host.appendChild(P.el('p', { class: 'card-footnote' },
        SV.num(nClipped) + ' of ' + SV.num(pts.count) +
        ' plotted lines fall outside the margin range and are not drawn' +
        (pts.sampled ? ' (the totals come from the aggregate queries, not this sample)'
                     : ' (they stay in the totals)') + '.'));
    }
    if (pts.sampled && pts.limit) {
      host.appendChild(P.el('p', { class: 'card-footnote' },
        'Showing ' + SV.num(pts.count) + ' order lines — the first ' +
        SV.num(pts.limit) + ' returned by the datasource. Totals and every other ' +
        'panel use the full set.'));
    }

    if (opts.table) {
      // A table of every line would be huge; summarize by discount band instead.
      SV.renderTable(opts.table, ['Discount', 'Lines', 'Sales', 'Profit', 'Margin'],
        opts.bandRows || []);
    }
  }

  SV.chartScatter = render;
})((window.SV = window.SV || {}));

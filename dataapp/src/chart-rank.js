// ============================================================================
// Chart: sub-categories ranked by profit, worst first.
//
// The job is compare-magnitude with a sign, so the color is the diverging pair
// (loss red / gain blue) - not a value ramp on nominal categories, which would
// double-encode length as hue. One bar per sub-category, on one baseline.
// ============================================================================
(function (SV) {
  'use strict';
  var P = SV.primitives, svg = P.svg, fill = P.fill;

  /** Truncates a label with an ellipsis so it cannot overrun its gutter. */
  function clipText(s, max) {
    s = String(s);
    return s.length <= max ? s : s.slice(0, max - 1) + '…';
  }

  function render(host, agg, theme, tip, opts) {
    opts = opts || {};
    var data = (agg.subcategory || []).slice();
    if (!data.length) { fill(host, [P.emptyState('No orders in this slice.', theme)]); return; }
    data.sort(function (a, b) { return a.profit - b.profit; });
    if (opts.limit) data = data.slice(0, opts.limit);

    var rowH = 22, labW = 132;
    var W = 980, H = data.length * rowH + 34;
    var M = { t: 8, r: 92, b: 26, l: labW };
    var iw = W - M.l - M.r;
    var vals = data.map(function (d) { return d.profit; });
    // The longest bar sits at one end of the domain, so its value label would
    // land on top of the category gutter without extra headroom. 1.35 pads both
    // ends enough that every label clears the gutter.
    var lo = Math.min(0, Math.min.apply(null, vals)) * 1.35;
    var hi = Math.max(0, Math.max.apply(null, vals)) * 1.12;
    var x = function (v) { return M.l + ((v - lo) / (hi - lo)) * iw; };
    var zero = x(0);
    var bh = Math.min(P.BAR_MAX, rowH - 8);

    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart chart-rank',
      role: 'img', 'aria-label': 'Sub-categories ranked by profit, worst first' });
    var g = svg('g');

    // Vertical gridlines: the scale here runs along x.
    P.ticks(lo, hi, 5).forEach(function (v) {
      var gx = x(v);
      g.appendChild(svg('line', { x1: gx, x2: gx, y1: M.t, y2: M.t + data.length * rowH,
        stroke: theme.grid, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }));
      g.appendChild(svg('text', { x: gx, y: H - 8, 'text-anchor': 'middle',
        class: 'axis-txt', fill: theme.muted }, SV.money(v, { compact: true })));
    });

    data.forEach(function (d, i) {
      var yTop = M.t + i * rowH + (rowH - bh) / 2;
      var yMid = M.t + i * rowH + rowH / 2;
      var isLoss = d.profit < 0;
      var w = Math.abs(x(d.profit) - zero);
      var rect = svg('rect', {
        x: isLoss ? x(d.profit) : zero, y: yTop, width: Math.max(w, 1), height: bh,
        rx: P.RADIUS, ry: P.RADIUS,
        fill: isLoss ? theme.diverging[0] : theme.series[0], class: 'mark',
        tabindex: '0', role: 'button',
        'aria-label': d.subCategory + ': profit ' + SV.money(d.profit) +
          ', sales ' + SV.money(d.sales) + ', margin ' + SV.pct(d.margin, 1),
      });
      rect.addEventListener('pointermove', function (ev) {
        var r = host.getBoundingClientRect();
        tip.show(ev.clientX - r.left, ev.clientY - r.top, d.subCategory, [
          { value: SV.money(d.profit), label: 'Profit' },
          { value: SV.money(d.sales), label: 'Sales' },
          { value: SV.pct(d.margin, 1), label: 'Margin' },
          { value: SV.pct(d.avgDiscount, 1), label: 'Avg discount' },
        ]);
      });
      rect.addEventListener('pointerleave', function () { tip.hide(); });
      rect.addEventListener('focus', function () {
        tip.show(x(d.profit), yMid, d.subCategory, [
          { value: SV.money(d.profit), label: 'Profit' },
          { value: SV.money(d.sales), label: 'Sales' },
          { value: SV.pct(d.margin, 1), label: 'Margin' },
        ]);
      });
      rect.addEventListener('blur', function () { tip.hide(); });
      if (opts.onSub) {
        rect.style.cursor = 'pointer';
        var go = function () { opts.onSub(d.subCategory); };
        rect.addEventListener('click', go);
        rect.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); }
        });
      }
      g.appendChild(rect);

      // Category name, right-aligned in its gutter. A long name would collide
      // with the value label, so it is ellipsized to the gutter, never allowed
      // to overrun it.
      g.appendChild(svg('text', { x: labW - 10, y: yMid + 4, 'text-anchor': 'end',
        class: 'axis-txt', fill: theme.ink2 }, clipText(d.subCategory, 15)));
      // Direct label at the bar tip.
      var lx = isLoss ? x(d.profit) - 6 : x(d.profit) + 6;
      g.appendChild(svg('text', { x: lx, y: yMid + 4,
        'text-anchor': isLoss ? 'end' : 'start', class: 'lbl-val',
        fill: isLoss ? theme.diverging[0] : theme.ink2 }, SV.money(d.profit, { compact: true })));
    });

    // Zero rule last, so it sits above the bars.
    g.appendChild(svg('line', { x1: zero, x2: zero, y1: M.t, y2: M.t + data.length * rowH,
      stroke: theme.axis, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }));

    s.appendChild(g);
    fill(host, [s]);

    if (opts.table) {
      SV.renderTable(opts.table,
        ['Sub-category', 'Category', 'Sales', 'Profit', 'Margin', 'Avg discount', 'Units'],
        data.map(function (d) {
          return [d.subCategory, SV.SUB_TO_CAT[d.subCategory], SV.money(d.sales),
            SV.money(d.profit), SV.pct(d.margin, 1), SV.pct(d.avgDiscount, 1),
            SV.num(Math.round(d.quantity))];
        }));
    }
  }

  SV.chartRank = render;
})((window.SV = window.SV || {}));

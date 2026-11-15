// ============================================================================
// Chart: monthly Sales and Profit.
//
// Two measures on different scales never share a y-axis, so this is NOT a
// dual axis. Profit is drawn on the same dollar axis as sales; where the bars
// are small the line still reads, and the loss months fall below the zero rule
// where they belong. Loss months are named directly under the axis - that is
// the one direct label this chart carries.
// ============================================================================
(function (SV) {
  'use strict';
  var P = SV.primitives, svg = P.svg, el = P.el, fill = P.fill;

  function render(host, agg, theme, tip, opts) {
    opts = opts || {};
    var months = agg.months || [];
    if (!months.length) { fill(host, [P.emptyState('No orders in this slice.', theme)]); return; }

    var W = 980, H = 300, M = { t: 16, r: 58, b: 46, l: 62 };
    var iw = W - M.l - M.r, ih = H - M.t - M.b;

    var maxSales = Math.max.apply(null, months.map(function (m) { return m.sales; }));
    var minProfit = Math.min.apply(null, months.map(function (m) { return m.profit; }));
    var hi = Math.max(maxSales, 0) * 1.06;
    var lo = Math.min(minProfit, 0) * 1.25;
    if (lo === 0) lo = -hi * 0.06;              // keep the zero rule visible
    var y = function (v) { return M.t + ih - ((v - lo) / (hi - lo)) * ih; };
    var band = iw / months.length;
    var bw = Math.min(P.BAR_MAX, band * 0.62);
    var cx = function (i) { return M.l + band * i + band / 2; };

    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart',
      role: 'img', 'aria-label': 'Monthly sales as bars and profit as a line, same dollar axis' });
    var g = svg('g');

    var gv = P.ticks(lo, hi, 5).filter(function (v) { return v <= hi; });
    P.gridlines(g, M.l, M.l + iw, gv, y, theme, SV.moneyAxis);

    // Zero rule: the baseline profit crosses.
    g.appendChild(svg('line', { x1: M.l, x2: M.l + iw, y1: y(0), y2: y(0),
      stroke: theme.axis, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }));

    // Bars: sales.
    months.forEach(function (m, i) {
      var x = cx(i) - bw / 2, yy = y(m.sales), h = y(0) - yy;
      var b = svg('path', { d: P.barPath(x, yy, bw, Math.max(h, 0), P.RADIUS),
        fill: theme.series[0], class: 'mark' });
      var hit = svg('rect', { x: M.l + band * i, y: M.t, width: band, height: ih,
        fill: 'transparent', tabindex: '0', role: 'button',
        'aria-label': SV.monthLabel(m.iso) + ' sales ' + SV.money(m.sales) +
          ', profit ' + SV.money(m.profit) });
      hit.addEventListener('pointermove', function (ev) { hover(ev, m, i); });
      hit.addEventListener('pointerleave', function () { tip.hide(); clearFocus(); });
      hit.addEventListener('focus', function () { focus(i, m); });
      hit.addEventListener('blur', function () { tip.hide(); clearFocus(); });
      g.appendChild(b); g.appendChild(hit);
    });

    // Line: profit, same axis.
    var d = months.map(function (m, i) {
      return (i ? 'L' : 'M') + cx(i).toFixed(1) + ' ' + y(m.profit).toFixed(1);
    }).join(' ');
    g.appendChild(svg('path', { d: d, fill: 'none', stroke: theme.series[1],
      'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

    // Markers on loss months only - the exception worth pointing at.
    months.forEach(function (m, i) {
      if (m.profit < 0) {
        g.appendChild(svg('circle', { cx: cx(i), cy: y(m.profit), r: 4.5,
          fill: theme.series[1], stroke: theme.surface, 'stroke-width': 2 }));
      }
    });

    var endM = months[months.length - 1];
    g.appendChild(svg('circle', { cx: cx(months.length - 1), cy: y(endM.profit), r: 4,
      fill: theme.series[1], stroke: theme.surface, 'stroke-width': 2 }));

    var xlab = svg('g');
    var everyN = Math.max(1, Math.ceil(months.length / 12));
    months.forEach(function (m, i) {
      if (i % everyN !== 0 && i !== months.length - 1) return;
      xlab.appendChild(svg('text', { x: cx(i), y: M.t + ih + 18, 'text-anchor': 'middle',
        class: 'axis-txt', fill: theme.muted }, SV.monthTick(m.iso)));
    });
    g.appendChild(xlab);

    // Legend - two series, so a legend is required.
    var leg = svg('g', { class: 'legend' });
    leg.appendChild(svg('rect', { x: M.l, y: H - 12, width: 10, height: 10, rx: 2,
      fill: theme.series[0] }));
    leg.appendChild(svg('text', { x: M.l + 16, y: H - 3, class: 'axis-txt',
      fill: theme.ink2 }, 'Sales'));
    leg.appendChild(svg('line', { x1: M.l + 66, x2: M.l + 82, y1: H - 7, y2: H - 7,
      stroke: theme.series[1], 'stroke-width': 2, 'stroke-linecap': 'round' }));
    leg.appendChild(svg('text', { x: M.l + 88, y: H - 3, class: 'axis-txt',
      fill: theme.ink2 }, 'Profit'));
    g.appendChild(leg);

    s.appendChild(g);
    fill(host, [s]);

    var dots = null;
    function clearFocus() {
      if (dots) { dots.parentNode.removeChild(dots); dots = null; }
    }
    /** Position of a data point in host pixels, for tooltip anchoring. */
    function anchor(i, value) {
      var r = host.getBoundingClientRect();
      return { x: cx(i) * (r.width / W), y: y(value) * (r.height / H) };
    }
    function focus(i, m) {
      clearFocus();
      dots = svg('circle', { cx: cx(i), cy: y(m.profit), r: 6,
        fill: 'none', stroke: theme.ink, 'stroke-width': 2 });
      g.appendChild(dots);
      var a = anchor(i, m.profit);
      tip.show(a.x, a.y, SV.monthLabel(m.iso), rowsFor(m));
    }
    function rowsFor(m) {
      return [
        { value: SV.money(m.sales, { compact: true }), label: 'Sales', color: theme.series[0] },
        { value: SV.money(m.profit, { compact: true }), label: 'Profit', color: theme.series[1] },
        { value: SV.pct(m.sales ? m.profit / m.sales : 0, 1), label: 'Margin' },
      ];
    }
    function hover(ev, m, i) {
      var r = host.getBoundingClientRect();
      tip.show(ev.clientX - r.left, ev.clientY - r.top, SV.monthLabel(m.iso), rowsFor(m));
    }

    if (opts.table) {
      SV.renderTable(opts.table,
        ['Month', 'Sales', 'Profit', 'Margin'],
        months.map(function (m) {
          return [SV.monthLabel(m.iso), SV.money(m.sales), SV.money(m.profit),
            SV.pct(m.sales ? m.profit / m.sales : 0, 1)];
        }));
    }
  }

  SV.chartMonthly = render;
})((window.SV = window.SV || {}));

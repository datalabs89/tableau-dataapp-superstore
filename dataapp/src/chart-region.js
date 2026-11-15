// ============================================================================
// Chart: region comparison - one grouped column pair per region, Sales and
// Profit on the same dollar axis, with each region's margin direct-labeled.
// Clicking a region applies it to the global slice.
// ============================================================================
(function (SV) {
  'use strict';
  var P = SV.primitives, svg = P.svg, fill = P.fill;

  function render(host, agg, theme, tip, opts) {
    opts = opts || {};
    var data = (agg.region || []).slice();
    if (!data.length) { fill(host, [P.emptyState('No orders in this slice.', theme)]); return; }
    if (opts.regionOrder) {
      data.sort(function (a, b) {
        return opts.regionOrder.indexOf(a.region) - opts.regionOrder.indexOf(b.region);
      });
    }

    var W = 470, H = 262, M = { t: 18, r: 14, b: 52, l: 56 };
    var iw = W - M.l - M.r, ih = H - M.t - M.b;
    var all = data.reduce(function (a, d) { return a.concat([d.sales, d.profit]); }, [0]);
    var hi = Math.max.apply(null, all) * 1.08;
    var lo = Math.min(0, Math.min.apply(null, all)) * 1.1;
    var y = function (v) { return M.t + ih - ((v - lo) / (hi - lo)) * ih; };
    var band = iw / data.length;
    var pairW = Math.min(P.BAR_MAX * 2 + P.GAP, band * 0.66);
    var bw = (pairW - P.GAP) / 2;

    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart',
      role: 'img', 'aria-label': 'Sales and profit by region, same dollar axis' });
    var g = svg('g');
    P.gridlines(g, M.l, M.l + iw, P.ticks(lo, hi, 4), y, theme, SV.moneyAxis);
    g.appendChild(svg('line', { x1: M.l, x2: M.l + iw, y1: y(0), y2: y(0),
      stroke: theme.axis, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }));

    data.forEach(function (d, i) {
      var x0 = M.l + band * i + (band - pairW) / 2;
      [[d.sales, theme.series[0], 'Sales'], [d.profit, theme.series[1], 'Profit']]
        .forEach(function (pair, j) {
          var v = pair[0], col = pair[1];
          var x = x0 + j * (bw + P.GAP);
          g.appendChild(svg('path', {
            d: P.columnPath(x, y(0), bw, y(0) - y(v), P.RADIUS),
            fill: col, class: 'mark',
          }));
        });

      var hit = svg('rect', { x: M.l + band * i, y: M.t, width: band, height: ih,
        fill: 'transparent', class: 'hit', tabindex: '0', role: 'button',
        'aria-label': d.region + ': sales ' + SV.money(d.sales) + ', profit ' +
          SV.money(d.profit) + ', margin ' + SV.pct(d.margin, 1) });
      hit.addEventListener('pointermove', function (ev) {
        var r = host.getBoundingClientRect();
        tip.show(ev.clientX - r.left, ev.clientY - r.top, d.region, [
          { value: SV.money(d.sales, { compact: true }), label: 'Sales', color: theme.series[0] },
          { value: SV.money(d.profit, { compact: true }), label: 'Profit', color: theme.series[1] },
          { value: SV.pct(d.margin, 1), label: 'Margin' },
          { value: SV.num(d.orders), label: 'Orders' },
        ]);
      });
      hit.addEventListener('pointerleave', function () { tip.hide(); });
      hit.addEventListener('focus', function () {
        tip.show(M.l + band * i + band / 2, M.t + 8, d.region, [
          { value: SV.money(d.sales, { compact: true }), label: 'Sales', color: theme.series[0] },
          { value: SV.money(d.profit, { compact: true }), label: 'Profit', color: theme.series[1] },
          { value: SV.pct(d.margin, 1), label: 'Margin' },
        ]);
      });
      hit.addEventListener('blur', function () { tip.hide(); });
      if (opts.onRegion) {
        hit.style.cursor = 'pointer';
        hit.addEventListener('click', function () { opts.onRegion(d.region); });
        hit.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); opts.onRegion(d.region); }
        });
      }
      g.appendChild(hit);

      // Direct label: margin, the figure that separates the regions.
      g.appendChild(svg('text', { x: M.l + band * i + band / 2, y: M.t + 10,
        'text-anchor': 'middle', class: 'lbl-strong', fill: theme.ink2 },
        SV.pct(d.margin, 1)));
      g.appendChild(svg('text', { x: M.l + band * i + band / 2, y: M.t + ih + 20,
        'text-anchor': 'middle', class: 'axis-txt', fill: theme.ink2 }, d.region));
      g.appendChild(svg('text', { x: M.l + band * i + band / 2, y: M.t + ih + 34,
        'text-anchor': 'middle', class: 'axis-txt', fill: theme.muted },
        SV.money(d.sales, { compact: true })));
    });

    var leg = svg('g');
    leg.appendChild(svg('rect', { x: M.l, y: H - 10, width: 10, height: 10, rx: 2, fill: theme.series[0] }));
    leg.appendChild(svg('text', { x: M.l + 16, y: H - 1, class: 'axis-txt', fill: theme.ink2 }, 'Sales'));
    leg.appendChild(svg('rect', { x: M.l + 66, y: H - 10, width: 10, height: 10, rx: 2, fill: theme.series[1] }));
    leg.appendChild(svg('text', { x: M.l + 82, y: H - 1, class: 'axis-txt', fill: theme.ink2 }, 'Profit'));
    g.appendChild(leg);

    s.appendChild(g);
    fill(host, [s]);

    if (opts.table) {
      SV.renderTable(opts.table, ['Region', 'Sales', 'Profit', 'Margin', 'Orders'],
        data.map(function (d) {
          return [d.region, SV.money(d.sales), SV.money(d.profit),
            SV.pct(d.margin, 1), SV.num(d.orders)];
        }));
    }
  }

  SV.chartRegion = render;
})((window.SV = window.SV || {}));

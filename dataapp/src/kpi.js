// ============================================================================
// KPI row: five stat tiles (label, value, delta, sparkline). The tiles are the
// headline figures; the sparkline is the only chart mark in them, drawn in the
// de-emphasis hue with the current month in the accent.
// ============================================================================
(function (SV) {
  'use strict';
  var el = SV.el, svg = SV.svg, fill = SV.fill;

  function sparkline(values, w, h, theme) {
    var s = svg('svg', { viewBox: '0 0 ' + w + ' ' + h, class: 'spark',
      preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
    if (!values || values.length < 2) return s;
    var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
    var span = (hi - lo) || 1;
    var pad = 2;
    var stepX = (w - pad * 2) / (values.length - 1);
    var y = function (v) { return h - pad - ((v - lo) / span) * (h - pad * 2); };
    var d = values.map(function (v, i) {
      return (i ? 'L' : 'M') + (pad + i * stepX).toFixed(1) + ' ' + y(v).toFixed(1);
    }).join(' ');
    s.appendChild(svg('path', { d: d, fill: 'none', stroke: theme.deEmph,
      'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    // Current point emphasized: an 8px-class end dot with a surface ring.
    var lx = pad + (values.length - 1) * stepX, ly = y(values[values.length - 1]);
    s.appendChild(svg('circle', { cx: lx.toFixed(1), cy: ly.toFixed(1), r: 4,
      fill: theme.series[0], stroke: theme.surface, 'stroke-width': 2 }));
    return s;
  }

  /**
   * @param {object} o
   *   label, value, delta ({value, goodWhenUp, note}), trend (number[]), theme
   */
  function statTile(o) {
    var theme = o.theme;
    var tile = el('div', { class: 'tile' });
    tile.appendChild(el('div', { class: 'tile-label' }, o.label));
    var row = el('div', { class: 'tile-valrow' });
    row.appendChild(el('strong', { class: 'tile-value' }, o.value));
    if (o.trend && o.trend.length > 1) {
      row.appendChild(sparkline(o.trend, 88, 26, theme));
    }
    tile.appendChild(row);
    if (o.delta) {
      var d = o.delta;
      var up = d.value > 0;
      var good = d.goodWhenUp === false ? !up : up;
      var cls = Math.abs(d.value) < 1e-9 ? 'flat' : (good ? 'up' : 'down');
      var line = el('div', { class: 'tile-delta ' + cls });
      var arrow = Math.abs(d.value) < 1e-9 ? '' : (up ? '▲' : '▼');
      line.appendChild(el('span', { class: 'delta-arrow' }, arrow));
      line.appendChild(el('span', { class: 'delta-val' }, SV.signedPct(d.value, 1)));
      line.appendChild(el('span', { class: 'delta-note' }, d.note || ''));
      tile.appendChild(line);
    }
    if (o.foot) tile.appendChild(el('div', { class: 'tile-foot' }, o.foot));
    return tile;
  }

  /** Last-period-over-previous comparison on a monthly series. */
  function deltaFrom(months, pick) {
    if (!months || months.length < 4) return null;
    var n = months.length;
    var half = Math.max(1, Math.floor(n / 2));
    var prev = months.slice(Math.max(0, n - half * 2), n - half);
    var cur = months.slice(n - half);
    if (!prev.length || !cur.length) return null;
    var a = prev.reduce(function (s, m) { return s + pick(m); }, 0);
    var b = cur.reduce(function (s, m) { return s + pick(m); }, 0);
    if (!a) return null;
    return { value: (b - a) / Math.abs(a), note: 'vs prior ' + half + ' mo' };
  }

  function kpiRow(agg, theme, host) {
    var k = agg.kpi;
    var months = agg.months || [];
    var row = el('div', { class: 'kpi-row' });

    var salesDelta = deltaFrom(months, function (m) { return m.sales; });
    var profitDelta = deltaFrom(months, function (m) { return m.profit; });
    var marginDelta = deltaFrom(months, function (m) {
      return m.sales ? m.profit / m.sales : 0;
    });

    // The tile shows the compact form; the exact figure rides along in a title
    // and a data attribute so it is readable without hovering and checkable.
    function tile(o, exact) {
      var t = statTile(o);
      t.querySelector('.tile-value').setAttribute('data-exact', String(exact));
      t.querySelector('.tile-value').title = o.label + ': ' + exact;
      return t;
    }

    row.appendChild(tile({
      label: 'Total sales', value: SV.money(k.sales, { compact: true }),
      theme: theme, trend: months.map(function (m) { return m.sales; }),
      delta: salesDelta, foot: SV.num(k.orders) + ' orders',
    }, SV.money(k.sales, { cents: true })));
    row.appendChild(tile({
      label: 'Profit', value: SV.money(k.profit, { compact: true }),
      theme: theme, trend: months.map(function (m) { return m.profit; }),
      delta: profitDelta,
      foot: SV.money(k.orders ? k.profit / k.orders : 0, { cents: true }) + ' per order',
    }, SV.money(k.profit, { cents: true })));
    row.appendChild(tile({
      label: 'Profit margin', value: SV.pct(k.margin, 1), theme: theme,
      trend: months.map(function (m) { return m.sales ? m.profit / m.sales : 0; }),
      delta: marginDelta, foot: 'of ' + SV.money(k.sales, { compact: true }) + ' sales',
    }, SV.pct(k.margin, 2)));
    row.appendChild(statTile({
      label: 'Units sold', value: SV.num(Math.round(k.qty)), theme: theme,
      foot: SV.num(k.customers) + ' customers',
    }));
    row.appendChild(tile({
      label: 'Avg discount', value: SV.pct(k.avgDiscount, 1), theme: theme,
      delta: null, foot: 'across ' + SV.num(k.lines) + ' line items',
    }, SV.pct(k.avgDiscount, 2)));
    fill(host, [row]);
  }

  SV.kpiRow = kpiRow;
  SV.statTile = statTile;
  SV.sparkline = sparkline;
  SV.deltaFrom = deltaFrom;
})((window.SV = window.SV || {}));

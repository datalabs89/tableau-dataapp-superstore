// ============================================================================
// Chart: profit by sub-category x region.
//
// Profit crosses zero, so the scale is DIVERGING: red arm for losses, blue arm
// for gains, neutral gray midpoint - not a one-hue sequential ramp, which would
// have to pretend the sign away. The value is printed in every cell (that is
// also the relief the palette's sub-3:1 light steps require) and the whole grid
// is in the table view.
// ============================================================================
(function (SV) {
  'use strict';
  var P = SV.primitives, svg = P.svg, el = P.el, fill = P.fill;

  /** Diverging binning around zero: 2 loss bins, 2 gain bins, symmetric domain. */
  function bins(values, theme) {
    var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
    var m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    function pick(v) {
      if (v >= 0) return v > m * 0.5 ? 3 : 2;
      return v < -m * 0.5 ? 0 : 1;
    }
    return { pick: pick, max: m, colors: theme.diverging };
  }

  function render(host, agg, theme, tip, opts) {
    opts = opts || {};
    var heat = agg.heat;
    if (!heat || !heat.subCategories.length) {
      fill(host, [P.emptyState('No orders in this slice.', theme)]); return;
    }

    var subs = opts.subOrder || heat.subCategories;
    var regs = heat.regions;
    var cellW = 96, cellH = 26, labW = 132, topH = 26;
    var W = labW + regs.length * cellW + 10;
    var H = topH + subs.length * cellH + 8;

    var flat = [];
    subs.forEach(function (_, i) { regs.forEach(function (_, j) { flat.push(heat.profit[i][j]); }); });
    var B = bins(flat, theme);

    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart chart-heat',
      role: 'img', 'aria-label': 'Profit by sub-category and region' });
    var g = svg('g');

    regs.forEach(function (name, j) {
      g.appendChild(svg('text', { x: labW + j * cellW + cellW / 2, y: 16,
        'text-anchor': 'middle', class: 'lbl-strong', fill: theme.ink2 }, name));
    });

    subs.forEach(function (name, i) {
      var rowY = topH + i * cellH;
      g.appendChild(svg('text', { x: labW - 10, y: rowY + cellH / 2 + 4,
        'text-anchor': 'end', class: 'axis-txt', fill: theme.ink2 }, name));
      regs.forEach(function (rname, j) {
        var v = heat.profit[i][j];
        var ci = B.pick(v);
        var col = v === 0 ? theme.divergingMid : B.colors[ci];
        var x = labW + j * cellW;
        // 2px surface gap between cells, achieved by insetting the fill.
        var rect = svg('rect', {
          x: x + P.GAP / 2, y: rowY + P.GAP / 2,
          width: cellW - P.GAP, height: cellH - P.GAP, rx: 3,
          fill: col, class: 'cell', tabindex: '0', role: 'button',
          'aria-label': name + ' in ' + rname + ': profit ' + SV.money(v) +
            ', sales ' + SV.money(heat.sales[i][j]),
        });
        // Label color by the fill's luminance: the two documented values only.
        var dark = (ci === 2 || v === 0);
        var txt = svg('text', { x: x + cellW / 2, y: rowY + cellH / 2 + 4,
          'text-anchor': 'middle', class: 'cell-txt',
          fill: dark ? '#0b0b0b' : '#ffffff' }, SV.money(v, { compact: true }));
        txt.setAttribute('pointer-events', 'none');
        rect.addEventListener('pointermove', function (ev) {
          var r = host.getBoundingClientRect();
          tip.show(ev.clientX - r.left, ev.clientY - r.top, name + ' · ' + rname, [
            { value: SV.money(v), label: 'Profit' },
            { value: SV.money(heat.sales[i][j]), label: 'Sales' },
            { value: SV.num(heat.orders[i][j]), label: 'Line items' },
          ]);
        });
        rect.addEventListener('pointerleave', function () { tip.hide(); });
        rect.addEventListener('focus', function () {
          tip.show(labW + j * cellW, rowY, name + ' · ' + rname, [
            { value: SV.money(v), label: 'Profit' },
            { value: SV.money(heat.sales[i][j]), label: 'Sales' },
          ]);
        });
        rect.addEventListener('blur', function () { tip.hide(); });
        if (opts.onCell) {
          rect.style.cursor = 'pointer';
          var go = function () { opts.onCell(name, rname); };
          rect.addEventListener('click', go);
          rect.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); }
          });
        }
        g.appendChild(rect);
        g.appendChild(txt);
      });
    });

    s.appendChild(g);
    fill(host, [s]);

    // Scale legend: the diverging bins, named, with the neutral in the middle.
    var lg = el('div', { class: 'scale-legend' });
    lg.appendChild(el('span', { class: 'sl-abbr' }, 'Loss'));
    [-1, -0.5, 0.5, 1].forEach(function (k, i) {
      var sw = el('span', { class: 'sl-sw' });
      sw.style.background = theme.diverging[i];
      sw.title = i < 2 ? 'loss' : 'gain';
      lg.appendChild(sw);
    });
    lg.appendChild(el('span', { class: 'sl-abbr' }, 'Gain'));
    lg.appendChild(el('span', { class: 'sl-note' },
      'Bins split at ' + SV.money(B.max * 0.5, { compact: true }) + ' either side of zero.'));
    host.appendChild(lg);

    if (opts.table) {
      var headers = ['Sub-category'].concat(regs).concat(['Total']);
      var rows = subs.map(function (name, i) {
        var tot = regs.reduce(function (a, _, j) { return a + heat.profit[i][j]; }, 0);
        return [name].concat(regs.map(function (_, j) {
          return SV.money(heat.profit[i][j]);
        })).concat([SV.money(tot)]);
      });
      SV.renderTable(opts.table, headers, rows);
    }
  }

  SV.chartHeat = render;
})((window.SV = window.SV || {}));

// ============================================================================
// The editorial findings row: four cards, each with a kicker, the figure, and
// the sentence that explains it. Every card is derived from the CURRENT slice,
// so the findings follow the filters instead of going stale.
//
// Each card carries an action that applies its subject to the global slice -
// the "click to filter" that makes the row a starting point, not a caption.
// ============================================================================
(function (SV) {
  'use strict';
  var el = SV.el, fill = SV.fill;

  function findings(agg, onFilter) {
    var subs = (agg.subcategory || []).slice().sort(function (a, b) { return a.profit - b.profit; });
    var bands = agg.discountBands || [];
    var regions = (agg.region || []).slice();
    var heat = agg.heat;

    var out = [];

    // 1. Discounting
    var heavy = bands.filter(function (b) { return b.band === '30% or more'; })[0];
    var none = bands.filter(function (b) { return b.band === 'No discount'; })[0];
    if (heavy && heavy.rows) {
      out.push({
        kicker: 'Discounting',
        value: SV.money(heavy.profit, { compact: true }),
        tone: heavy.profit < 0 ? 'loss' : 'gain',
        body: heavy.profit < 0
          ? 'Orders discounted 30% or more are ' + SV.pct(heavy.sales / totalSales(bands), 0) +
            ' of sales and lose ' + SV.money(Math.abs(heavy.profit), { compact: true }) + '. ' +
            (none && none.rows ? 'Undiscounted orders earn a ' + SV.pct(none.margin, 1) + ' margin.' : '')
          : 'Orders discounted 30% or more still return ' + SV.money(heavy.profit, { compact: true }) +
            ', at a ' + SV.pct(heavy.margin, 1) + ' margin.',
        filter: { discountBands: ['30% or more'] },
        filterLabel: '30% or more',
      });
    }

    // 2. Product mix - the worst sub-category
    if (subs.length) {
      var worst = subs[0];
      var negCount = subs.filter(function (d) { return d.profit < 0; }).length;
      out.push({
        kicker: 'Product mix',
        value: SV.money(worst.profit, { compact: true }),
        tone: worst.profit < 0 ? 'loss' : 'gain',
        body: worst.profit < 0
          ? worst.subCategory + ' is the biggest loss-maker: ' + SV.money(Math.abs(worst.profit), { compact: true }) +
            ' lost on ' + SV.money(worst.sales, { compact: true }) + ' of sales at a ' +
            SV.pct(worst.avgDiscount, 1) + ' average discount. ' + negCount + ' of ' + subs.length +
            ' sub-categories lose money.'
          : worst.subCategory + ' is the weakest sub-category but still profitable, at ' +
            SV.money(worst.profit, { compact: true }) + '.',
        filter: { subcats: [worst.subCategory] },
        filterLabel: worst.subCategory,
      });
    }

    // 3. Hot spot - the worst cell on the grid
    if (heat && heat.profit.length) {
      var best = null;
      heat.subCategories.forEach(function (sn, i) {
        heat.regions.forEach(function (rn, j) {
          var v = heat.profit[i][j];
          if (best === null || v < best.v) best = { v: v, sub: sn, region: rn };
        });
      });
      if (best) {
        out.push({
          kicker: 'Hot spot',
          value: SV.money(best.v, { compact: true }),
          tone: best.v < 0 ? 'loss' : 'gain',
          body: best.sub + ' in the ' + best.region + ' is the worst cell on the grid: ' +
            SV.money(Math.abs(best.v), { compact: true }) + (best.v < 0 ? ' lost' : ' earned') +
            '. Click the region to scope every panel to it.',
          filter: { regions: [best.region] },
          filterLabel: best.region,
        });
      }
    }

    // 4. Regional spread
    if (regions.length > 1) {
      var byMargin = regions.slice().sort(function (a, b) { return b.margin - a.margin; });
      var hiR = byMargin[0], loR = byMargin[byMargin.length - 1];
      var spread = hiR.margin - loR.margin;
      out.push({
        kicker: 'Regions',
        value: SV.pct(hiR.margin, 1),
        tone: 'neutral',
        body: 'The ' + hiR.region + ' runs at a ' + SV.pct(hiR.margin, 1) + ' margin; the ' +
          loR.region + ' only reaches ' + SV.pct(loR.margin, 1) + ', a spread of ' +
          SV.pct(spread, 1).replace('%', '') + ' points.',
        filter: { regions: [loR.region] },
        filterLabel: loR.region,
      });
    }

    return out;
  }

  function totalSales(bands) {
    var t = bands.reduce(function (s, b) { return s + b.sales; }, 0);
    return t || 1;
  }

  function render(host, agg, theme, onFilter) {
    var items = findings(agg, onFilter);
    var row = el('div', { class: 'findings' });
    items.forEach(function (f) {
      var c = el('div', { class: 'finding tone-' + f.tone });
      c.appendChild(el('div', { class: 'f-kicker' }, f.kicker));
      c.appendChild(el('div', { class: 'f-value' }, f.value));
      c.appendChild(el('p', { class: 'f-body' }, f.body));
      if (f.filter && onFilter) {
        var b = el('button', { class: 'f-action', type: 'button' },
          'Filter to ' + f.filterLabel);
        b.addEventListener('click', function () { onFilter(f.filter); });
        c.appendChild(b);
      }
      row.appendChild(c);
    });
    fill(host, [row]);
  }

  SV.findings = render;
  SV.findingItems = findings;
})((window.SV = window.SV || {}));

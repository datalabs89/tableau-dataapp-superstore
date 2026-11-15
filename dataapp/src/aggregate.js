// ============================================================================
// Aggregation layer. Every figure the app draws is computed HERE, from a
// filtered slice of rows, so the runtime path and the offline preview run the
// same arithmetic and cannot drift apart.
//
// The query surface is the slice of Superstore this app actually uses:
//   { regions, subcats, discountBands, dateFrom, dateTo, segments }
// An empty array means "no restriction on that dimension".
// ============================================================================
(function (SV) {
  'use strict';

  var C = SV.REGIONS, S = SV.SEGMENTS, SUB = SV.SUB_ORDER, BANDS = SV.BANDS;

  function emptySlice() {
    return { regions: [], subcats: [], discountBands: [], segments: [],
             dateFrom: null, dateTo: null };
  }

  /** day index (days since 2023-01-01) -> 'YYYY-MM-DD' */
  function dayToIso(d) {
    var ms = Date.UTC(2023, 0, 1) + d * 86400000;
    var dt = new Date(ms);
    var m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    var dd = String(dt.getUTCDate()).padStart(2, '0');
    return dt.getUTCFullYear() + '-' + m + '-' + dd;
  }
  function isoToDay(iso) {
    var p = String(iso).split('-').map(Number);
    return Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(2023, 0, 1)) / 86400000);
  }
  function dayToMonthIdx(d) {
    var dt = new Date(Date.UTC(2023, 0, 1) + d * 86400000);
    return (dt.getUTCFullYear() - 2023) * 12 + dt.getUTCMonth();
  }
  function monthIdxToIso(i) {
    var y = 2023 + Math.floor(i / 12), m = (i % 12) + 1;
    return y + '-' + String(m).padStart(2, '0') + '-01';
  }

  function bandIndex(discount) {
    for (var i = 0; i < BANDS.length; i++) {
      var b = BANDS[i];
      if (b.zero) { if (discount === 0) return i; }
      else if (discount > b.lo && discount <= b.hi) return i;
    }
    return -1;
  }

  /**
   * Index of rows passing the slice. Returns a plain array of row indices so
   * callers can aggregate without copying the columns.
   */
  function selectRows(store, slice) {
    var cols = store.cols, n = cols.day.length;
    var rSel = slice.regions.length ? slice.regions.map(function (r) { return C.indexOf(r); }) : null;
    var sSel = slice.segments.length ? slice.segments.map(function (s) { return S.indexOf(s); }) : null;
    var uSel = slice.subcats.length ? slice.subcats.map(function (s) { return SUB.indexOf(s); }) : null;
    var bSel = slice.discountBands.length ? slice.discountBands.map(function (b) {
      return BANDS.findIndex(function (x) { return x.label === b; });
    }) : null;
    var from = slice.dateFrom ? isoToDay(slice.dateFrom) : -Infinity;
    var to = slice.dateTo ? isoToDay(slice.dateTo) : Infinity;

    var out = [];
    for (var i = 0; i < n; i++) {
      if (rSel && rSel.indexOf(cols.region[i]) < 0) continue;
      if (sSel && sSel.indexOf(cols.segment[i]) < 0) continue;
      if (uSel && uSel.indexOf(cols.subcat[i]) < 0) continue;
      var day = cols.day[i];
      if (day < from || day > to) continue;
      if (bSel && bSel.indexOf(bandIndex(cols.discount[i])) < 0) continue;
      out.push(i);
    }
    return out;
  }

  /**
   * Aggregates a row-index set into every shape the views need. One pass over
   * the selected rows - no per-chart re-scan of the full table.
   */
  function aggregate(store, rows) {
    var cols = store.cols;
    var nM = store.meta.months;

    var kpi = { sales: 0, profit: 0, qty: 0, discountSum: 0, rows: 0 };
    var monthSales = new Float64Array(nM), monthProfit = new Float64Array(nM);
    var regionSales = zeros(C.length), regionProfit = zeros(C.length), regionOrders = [];
    var segSales = zeros(S.length), segProfit = zeros(S.length), segOrders = [];
    var subSales = zeros(SUB.length), subProfit = zeros(SUB.length);
    var subDiscSum = zeros(SUB.length), subQty = zeros(SUB.length);
    var bandSales = zeros(BANDS.length), bandProfit = zeros(BANDS.length), bandRows = zeros(BANDS.length);
    var heatProfit = [], heatSales = [], heatOrders = [];
    for (var i = 0; i < SUB.length; i++) {
      heatProfit.push(zeros(C.length)); heatSales.push(zeros(C.length)); heatOrders.push(zeros(C.length));
    }
    var catSales = zeros(SV.CATEGORIES.length), catProfit = zeros(SV.CATEGORIES.length);
    var stateSales = Object.create(null), stateProfit = Object.create(null);
    var stateOrders = Object.create(null), stateSeen = Object.create(null);
    var seenOrder = new Set(), seenCust = new Set();
    var retSales = 0, retProfit = 0, retOrders = new Set();

    for (var k = 0; k < rows.length; k++) {
      var r = rows[k];
      var sale = cols.sales[r], prof = cols.profit[r], disc = cols.discount[r];
      var qty = cols.qty[r];
      var rg = cols.region[r], sg = cols.segment[r], sc = cols.subcat[r];

      kpi.sales += sale; kpi.profit += prof; kpi.qty += qty;
      kpi.discountSum += disc; kpi.rows++;
      seenOrder.add(cols.order[r]); seenCust.add(cols.cust[r]);

      monthSales[dayToMonthIdx(cols.day[r])] += sale;
      monthProfit[dayToMonthIdx(cols.day[r])] += prof;

      regionSales[rg] += sale; regionProfit[rg] += prof; regionOrders.push(rg);
      segSales[sg] += sale; segProfit[sg] += prof; segOrders.push(sg);
      subSales[sc] += sale; subProfit[sc] += prof;
      subDiscSum[sc] += disc; subQty[sc] += qty;

      var bi = bandIndex(disc);
      if (bi >= 0) { bandSales[bi] += sale; bandProfit[bi] += prof; bandRows[bi]++; }

      heatProfit[sc][rg] += prof; heatSales[sc][rg] += sale; heatOrders[sc][rg]++;

      if (cols.returned[r]) {
        retSales += sale; retProfit += prof; retOrders.add(cols.order[r]);
      }

      var st = store.meta.stateByRow ? store.meta.stateByRow[r] : null;
      if (st != null) {
        if (stateSales[st] == null) { stateSales[st] = 0; stateProfit[st] = 0; stateOrders[st] = 0; stateSeen[st] = 0; }
        stateSales[st] += sale; stateProfit[st] += prof; stateSeen[st]++;
      }
    }

    // COUNTD(order) per region/segment: count distinct order ids in each group.
    var regOrdSet = C.map(function () { return new Set(); });
    var segOrdSet = S.map(function () { return new Set(); });
    var subOrdSet = SUB.map(function () { return new Set(); });
    for (var j = 0; j < rows.length; j++) {
      var rr = rows[j];
      regOrdSet[cols.region[rr]].add(cols.order[rr]);
      segOrdSet[cols.segment[rr]].add(cols.order[rr]);
      subOrdSet[cols.subcat[rr]].add(cols.order[rr]);
    }

    var months = [];
    for (var mi = 0; mi < nM; mi++) {
      months.push({ idx: mi, iso: monthIdxToIso(mi), sales: monthSales[mi], profit: monthProfit[mi] });
    }
    var activeMonths = months.filter(function (m) { return m.sales !== 0 || m.profit !== 0; });

    var region = C.map(function (name, i) {
      return { region: name, sales: regionSales[i], profit: regionProfit[i],
               margin: regionSales[i] ? regionProfit[i] / regionSales[i] : 0,
               orders: regOrdSet[i].size };
    }).filter(function (d) { return d.sales !== 0 || d.profit !== 0; });

    var segment = S.map(function (name, i) {
      return { segment: name, sales: segSales[i], profit: segProfit[i],
               margin: segSales[i] ? segProfit[i] / segSales[i] : 0,
               orders: segOrdSet[i].size };
    }).filter(function (d) { return d.sales !== 0 || d.profit !== 0; });

    var subcategory = SUB.map(function (name, i) {
      return { subCategory: name, category: SV.SUB_TO_CAT[name],
               sales: subSales[i], profit: subProfit[i],
               margin: subSales[i] ? subProfit[i] / subSales[i] : 0,
               avgDiscount: 0, // per-row mean, computed in the pass below
               quantity: subQty[i], orders: subOrdSet[i].size };
    });

    // avg discount must be per ROW, not per order: recompute properly.
    subcategory.forEach(function (d) { d.avgDiscount = 0; d._n = 0; });
    for (var q = 0; q < rows.length; q++) {
      var qr = rows[q];
      subcategory[cols.subcat[qr]].avgDiscount += cols.discount[qr];
      subcategory[cols.subcat[qr]]._n++;
    }
    subcategory.forEach(function (d) { d.avgDiscount = d._n ? d.avgDiscount / d._n : 0; delete d._n; });

    var category = SV.CATEGORIES.map(function (name) {
      var idxs = SUB.map(function (s, i) { return SV.SUB_TO_CAT[s] === name ? i : -1; })
        .filter(function (i) { return i >= 0; });
      var sl = 0, pf = 0;
      idxs.forEach(function (i) { sl += subSales[i]; pf += subProfit[i]; });
      return { category: name, sales: sl, profit: pf, margin: sl ? pf / sl : 0 };
    }).filter(function (d) { return d.sales !== 0 || d.profit !== 0; });

    var discountBands = BANDS.map(function (b, i) {
      return { band: b.label, sales: bandSales[i], profit: bandProfit[i],
               margin: bandSales[i] ? bandProfit[i] / bandSales[i] : 0,
               rows: bandRows[i] };
    });

    var heat = {
      regions: C.slice(),
      subCategories: SUB.slice(),
      profit: heatProfit, sales: heatSales, orders: heatOrders,
    };

    var states = Object.keys(stateSales).map(function (st) {
      return { state: st, sales: stateSales[st], profit: stateProfit[st],
               margin: stateSales[st] ? stateProfit[st] / stateSales[st] : 0,
               lines: stateSeen[st] };
    }).sort(function (a, b) { return b.sales - a.sales; });

    return {
      kpi: {
        sales: kpi.sales, profit: kpi.profit, qty: kpi.qty,
        margin: kpi.sales ? kpi.profit / kpi.sales : 0,
        avgDiscount: kpi.rows ? kpi.discountSum / kpi.rows : 0,
        orders: seenOrder.size, customers: seenCust.size, lines: kpi.rows,
      },
      months: activeMonths,
      allMonths: months,
      region: region,
      segment: segment,
      subcategory: subcategory,
      category: category,
      discountBands: discountBands,
      heat: heat,
      states: states,
      returns: { sales: retSales, profit: retProfit, orders: retOrders.size },
    };
  }

  function zeros(n) { var a = new Array(n); for (var i = 0; i < n; i++) a[i] = 0; return a; }

  /** Worker for the label form of a slice, used in the subtitle. */
  function describeSlice(slice, meta) {
    var bits = [];
    if (slice.regions.length) bits.push(slice.regions.join(', '));
    if (slice.segments.length) bits.push(slice.segments.join(', '));
    if (slice.subcats.length) bits.push(slice.subcats.length === 1 ? slice.subcats[0] : slice.subcats.length + ' sub-categories');
    if (slice.discountBands.length) bits.push('discount ' + slice.discountBands.join('/'));
    if (slice.dateFrom && slice.dateTo) {
      bits.push(SV.monthLabel(slice.dateFrom) + ' - ' + SV.monthLabel(slice.dateTo));
    }
    return bits.length ? bits.join(' · ') : 'All orders, ' + SV.monthLabel(meta.dateMin) + ' - ' + SV.monthLabel(meta.dateMax);
  }

  Object.assign(SV, {
    emptySlice: emptySlice, selectRows: selectRows, aggregate: aggregate,
    describeSlice: describeSlice, dayToIso: dayToIso, isoToDay: isoToDay,
    dayToMonthIdx: dayToMonthIdx, monthIdxToIso: monthIdxToIso, bandIndex: bandIndex,
  });
})((window.SV = window.SV || {}));

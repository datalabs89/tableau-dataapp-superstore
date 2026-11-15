// ============================================================================
// Data access. Two backends, ONE output contract.
//
// Both backends resolve to the same `agg` object shape (see aggregate.js), so
// every view is written once and cannot tell which one is running:
//
//   PreviewStore  - fetches the bundled columnar rows and aggregates in JS.
//                   Lets the app be reviewed offline, before it is published.
//   TableauStore  - runs VizQL Data Service queries through
//                   ds.queryAsync(), so Tableau does the aggregation against
//                   the live published datasource. This is the runtime path.
//
// The arithmetic therefore happens in two different engines on purpose: the
// preview proves what the layout looks like, and the runtime proves the app
// reads governed Tableau data. When published, the app's Data pane shows the
// authored and executed query for every number either way.
// ============================================================================
(function (SV) {
  'use strict';

  var C = SV.REGIONS, S = SV.SEGMENTS, SUB = SV.SUB_ORDER, BANDS = SV.BANDS;

  // The scatter is the one view that needs individual rows rather than
  // aggregates. Tableau will not return an unbounded row set, so the app asks
  // for a bounded sample and reports the count it received.
  var SCATTER_LIMIT = 5000;

  // --------------------------------------------------------------------------
  // Preview backend
  // --------------------------------------------------------------------------
  function PreviewStore(basePath) {
    this.base = basePath || 'data/';
    this.store = null;
  }

  PreviewStore.prototype.load = function () {
    var self = this;
    // The rows may arrive inline (a single-file build with no fetch available)
    // or from a sibling file. Both are the same bundle, so the install path is
    // shared and the two cannot diverge.
    var ready = SV.PREVIEW_ROWS
      ? Promise.resolve(SV.PREVIEW_ROWS)
      : fetch(self.base + 'rows.json').then(function (r) {
        if (!r.ok) throw new Error('rows.json -> HTTP ' + r.status);
        return r.json();
      });
    return ready
      .then(function (payload) {
        self.store = payload;
        self.meta = {
          dateMin: SV.dayToIso(Math.min.apply(null, payload.cols.day)),
          dateMax: SV.dayToIso(Math.max.apply(null, payload.cols.day)),
          months: payload.meta.months,
          rowCount: payload.meta.rowCount,
          stateByRow: null,
        };
        return self;
      });
  };

  PreviewStore.prototype.run = function (slice) {
    var rows = SV.selectRows(this.store, slice);
    var agg = SV.aggregate(this.store, rows);
    agg.meta = this.meta;
    agg.source = 'preview';
    agg.rowCount = rows.length;
    return Promise.resolve(agg);
  };

  // --------------------------------------------------------------------------
  // Runtime backend - VizQL Data Service via the Extensions API
  // --------------------------------------------------------------------------

  /** Reads an aliased VDS column, falling back to the FUNC(Caption) key. */
  function val(row, alias, funcCap) {
    if (row[alias] != null) return row[alias];
    if (funcCap != null && row[funcCap] != null) return row[funcCap];
    return null;
  }
  function n(v) { return Number(v) || 0; }

  function setFilter(caption, values) {
    return values && values.length
      ? [{ field: { fieldCaption: caption }, filterType: 'SET', values: values.slice() }]
      : [];
  }

  function TableauStore(ds) {
    this.ds = ds;
    this.meta = null;
  }

  TableauStore.prototype.query = function (fields, filters, limit) {
    var req = { fields: fields, filters: filters || [] };
    if (limit) req.limit = limit;
    return this.ds
      .queryAsync(req)
      .then(function (res) { return (res && Array.isArray(res.data)) ? res.data : []; });
  };

  /** Discovers the date domain once, so the slice bounds are real. */
  TableauStore.prototype.load = function () {
    var self = this;
    return self.query([
      { fieldCaption: 'Order Date', function: 'MIN', fieldAlias: 'MinD' },
      { fieldCaption: 'Order Date', function: 'MAX', fieldAlias: 'MaxD' },
    ]).then(function (rows) {
      var r = rows[0] || {};
      function iso(x) {
        if (x == null) return null;
        var m = String(x).match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
      }
      var lo = iso(val(r, 'MinD')), hi = iso(val(r, 'MaxD'));
      if (!lo || !hi) throw new Error('Order Date domain unavailable from the datasource.');
      self.meta = {
        dateMin: lo, dateMax: hi,
        months: (Number(hi.slice(0, 4)) - Number(lo.slice(0, 4))) * 12 +
                (Number(hi.slice(5, 7)) - Number(lo.slice(5, 7))) + 1,
        rowCount: null, stateByRow: null,
      };
      return self;
    });
  };

  TableauStore.prototype.filtersFor = function (slice) {
    var f = [];
    f = f.concat(setFilter('Region', slice.regions));
    f = f.concat(setFilter('Segment', slice.segments));
    f = f.concat(setFilter('Sub-Category', slice.subcats));
    // Discount bands are derived, not a field in Superstore, so they are
    // expressed as QUANTITATIVE_NUMBER range filters on the real Discount
    // column. A band whose range is contiguous with its neighbours (1-10%,
    // 11-20%, ...) becomes one filter; "No discount" is the exact zero.
    f = f.concat(discountFilters(slice.discountBands));
    if (slice.dateFrom && slice.dateTo) {
      f.push({
        field: { fieldCaption: 'Order Date' },
        filterType: 'QUANTITATIVE_DATE',
        quantitativeFilterType: 'RANGE',
        minDate: slice.dateFrom,
        maxDate: slice.dateTo,
      });
    }
    return f;
  };

  /**
   * Maps band labels onto Discount range filters. Kept in step with the BANDS
   * table in constants.js - the labels are the contract between the two.
   */
  function discountFilters(labels) {
    if (!labels || !labels.length) return [];
    var out = [];
    labels.forEach(function (label) {
      var b = BANDS.filter(function (x) { return x.label === label; })[0];
      if (!b) return;
      if (b.zero) {
        out.push({ field: { fieldCaption: 'Discount' }, filterType: 'QUANTITATIVE_NUMBER',
          quantitativeFilterType: 'RANGE', min: 0, max: 0 });
      } else {
        out.push({ field: { fieldCaption: 'Discount' }, filterType: 'QUANTITATIVE_NUMBER',
          quantitativeFilterType: 'RANGE', min: b.lo, max: b.hi });
      }
    });
    return out;
  }

  TableauStore.prototype.run = function (slice) {
    var self = this;
    var filters = self.filtersFor(slice);

    // No COUNTD row-count trick: `__row_count` is not a Superstore field and a
    // query naming it would fail. Line-item counts come from the band query,
    // which is the only place the app actually reports them.
    var kpiQ = self.query([
      { fieldCaption: 'Sales', function: 'SUM', fieldAlias: 'Sales' },
      { fieldCaption: 'Profit', function: 'SUM', fieldAlias: 'Profit' },
      { fieldCaption: 'Quantity', function: 'SUM', fieldAlias: 'Qty' },
      { fieldCaption: 'Discount', function: 'AVG', fieldAlias: 'Disc' },
      { fieldCaption: 'Order ID', function: 'COUNTD', fieldAlias: 'Orders' },
      { fieldCaption: 'Customer Name', function: 'COUNTD', fieldAlias: 'Custs' },
      // Line-item count. COUNT() is the right aggregate here and is supported by
      // the Data Service; without it the scope line and the "across N line
      // items" footnote read zero on the live path, which looks like a broken
      // query even though every other figure is correct.
      { fieldCaption: 'Row ID', function: 'COUNT', fieldAlias: 'Lines' },
    ], filters);

    var monthQ = self.query([
      { fieldCaption: 'Order Date', function: 'TRUNC_MONTH', fieldAlias: 'Month' },
      { fieldCaption: 'Sales', function: 'SUM', fieldAlias: 'Sales' },
      { fieldCaption: 'Profit', function: 'SUM', fieldAlias: 'Profit' },
    ], filters);

    var regionQ = self.query([
      { fieldCaption: 'Region' },
      { fieldCaption: 'Sales', function: 'SUM', fieldAlias: 'Sales' },
      { fieldCaption: 'Profit', function: 'SUM', fieldAlias: 'Profit' },
      { fieldCaption: 'Order ID', function: 'COUNTD', fieldAlias: 'Orders' },
    ], filters);

    var segQ = self.query([
      { fieldCaption: 'Segment' },
      { fieldCaption: 'Sales', function: 'SUM', fieldAlias: 'Sales' },
      { fieldCaption: 'Profit', function: 'SUM', fieldAlias: 'Profit' },
      { fieldCaption: 'Order ID', function: 'COUNTD', fieldAlias: 'Orders' },
    ], filters);

    var subQ = self.query([
      { fieldCaption: 'Sub-Category' },
      { fieldCaption: 'Sales', function: 'SUM', fieldAlias: 'Sales' },
      { fieldCaption: 'Profit', function: 'SUM', fieldAlias: 'Profit' },
      { fieldCaption: 'Discount', function: 'AVG', fieldAlias: 'Disc' },
      { fieldCaption: 'Quantity', function: 'SUM', fieldAlias: 'Qty' },
      { fieldCaption: 'Order ID', function: 'COUNTD', fieldAlias: 'Orders' },
    ], filters);

    // Discount is grouped by its real value (Superstore uses a small set of
    // discrete rates) and binned into the band table here. Querying a
    // "Discount Band" field would be a phantom field and return nothing.
    var bandQ = self.query([
      { fieldCaption: 'Discount' },
      { fieldCaption: 'Sales', function: 'SUM', fieldAlias: 'Sales' },
      { fieldCaption: 'Profit', function: 'SUM', fieldAlias: 'Profit' },
      { fieldCaption: 'Order ID', function: 'COUNTD', fieldAlias: 'Orders' },
    ], filters);

    var heatQ = self.query([
      { fieldCaption: 'Sub-Category' },
      { fieldCaption: 'Region' },
      { fieldCaption: 'Sales', function: 'SUM', fieldAlias: 'Sales' },
      { fieldCaption: 'Profit', function: 'SUM', fieldAlias: 'Profit' },
      { fieldCaption: 'Order ID', function: 'COUNTD', fieldAlias: 'Orders' },
    ], filters);

    var stateQ = self.query([
      { fieldCaption: 'State/Province' },
      { fieldCaption: 'Sales', function: 'SUM', fieldAlias: 'Sales' },
      { fieldCaption: 'Profit', function: 'SUM', fieldAlias: 'Profit' },
    ], filters);

    // Row-level points for the scatter. This is the one query that asks for
    // individual rows rather than aggregates, so it carries an explicit limit
    // and the caller is told how many of the total it received.
    var scatterQ = self.query([
      { fieldCaption: 'Discount' },
      { fieldCaption: 'Sales' },
      { fieldCaption: 'Profit' },
      { fieldCaption: 'Sub-Category' },
    ], filters, SCATTER_LIMIT).catch(function () { return []; });

    return Promise.all([kpiQ, monthQ, regionQ, segQ, subQ, bandQ, heatQ, stateQ, scatterQ])
      .then(function (res) {
        return shapeRuntime(self.meta, {
          kpi: res[0], months: res[1], region: res[2], segment: res[3],
          sub: res[4], band: res[5], heat: res[6], states: res[7], scatter: res[8],
        });
      });
  };

  /** Maps the VDS result set onto the shared `agg` contract. */
  function shapeRuntime(meta, R) {
    var k = R.kpi[0] || {};
    var kpi = {
      sales: n(val(k, 'Sales', 'SUM(Sales)')),
      profit: n(val(k, 'Profit', 'SUM(Profit)')),
      qty: n(val(k, 'Qty', 'SUM(Quantity)')),
      avgDiscount: n(val(k, 'Disc', 'AVG(Discount)')),
      orders: n(val(k, 'Orders', 'COUNTD(Order ID)')),
      customers: n(val(k, 'Custs', 'COUNTD(Customer Name)')),
      lines: n(val(k, 'Lines', 'COUNT(Row ID)')),
    };
    kpi.margin = kpi.sales ? kpi.profit / kpi.sales : 0;

    var months = R.months.map(function (r) {
      var m = val(r, 'Month', 'TRUNC_MONTH(Order Date)');
      return {
        iso: m ? String(m).slice(0, 10) : null,
        sales: n(val(r, 'Sales', 'SUM(Sales)')),
        profit: n(val(r, 'Profit', 'SUM(Profit)')),
      };
    }).filter(function (m) { return m.iso; })
      .sort(function (a, b) { return a.iso < b.iso ? -1 : 1; });

    function rollup(rows, key, labelKey) {
      var order = key === 'Region' ? C : S;
      var out = order.map(function (name) {
        var r = rows.find(function (x) { return x[key] === name; });
        if (!r) return null;
        var sl = n(val(r, 'Sales', 'SUM(Sales)')), pf = n(val(r, 'Profit', 'SUM(Profit)'));
        var o = { sales: sl, profit: pf, margin: sl ? pf / sl : 0,
                  orders: n(val(r, 'Orders', 'COUNTD(Order ID)')) };
        o[labelKey] = name;
        return o;
      }).filter(Boolean);
      // Any group outside the known vocabulary still has to be shown.
      rows.forEach(function (r) {
        var name = r[key];
        if (!name || order.indexOf(name) >= 0) return;
        var sl = n(val(r, 'Sales', 'SUM(Sales)')), pf = n(val(r, 'Profit', 'SUM(Profit)'));
        var o = { sales: sl, profit: pf, margin: sl ? pf / sl : 0,
                  orders: n(val(r, 'Orders', 'COUNTD(Order ID)')) };
        o[labelKey] = name;
        out.push(o);
      });
      return out;
    }

    var subByName = Object.create(null);
    R.sub.forEach(function (r) { subByName[r['Sub-Category']] = r; });
    var subcategory = SUB.map(function (name) {
      var r = subByName[name] || {};
      var sl = n(val(r, 'Sales', 'SUM(Sales)')), pf = n(val(r, 'Profit', 'SUM(Profit)'));
      return {
        subCategory: name, category: SV.SUB_TO_CAT[name],
        sales: sl, profit: pf, margin: sl ? pf / sl : 0,
        avgDiscount: n(val(r, 'Disc', 'AVG(Discount)')),
        quantity: n(val(r, 'Qty', 'SUM(Quantity)')),
        orders: n(val(r, 'Orders', 'COUNTD(Order ID)')),
      };
    });

    var category = SV.CATEGORIES.map(function (name) {
      var idxs = SUB.filter(function (s) { return SV.SUB_TO_CAT[s] === name; });
      var sl = 0, pf = 0;
      idxs.forEach(function (s) {
        var d = subcategory.find(function (x) { return x.subCategory === s; });
        if (d) { sl += d.sales; pf += d.profit; }
      });
      return { category: name, sales: sl, profit: pf, margin: sl ? pf / sl : 0 };
    }).filter(function (d) { return d.sales !== 0 || d.profit !== 0; });

    // Tableau returns one row per distinct Discount value; the bands are
    // assembled here with the same bandIndex() the preview path uses, so both
    // engines produce the same five bands from the same rates.
    var bandAcc = BANDS.map(function () { return { sales: 0, profit: 0, rows: 0 }; });
    R.band.forEach(function (r) {
      var d = Number(r.Discount);
      if (!isFinite(d)) return;
      var i = SV.bandIndex(d);
      if (i < 0) return;
      bandAcc[i].sales += n(val(r, 'Sales', 'SUM(Sales)'));
      bandAcc[i].profit += n(val(r, 'Profit', 'SUM(Profit)'));
      bandAcc[i].rows += n(val(r, 'Orders', 'COUNTD(Order ID)'));
    });
    var discountBands = BANDS.map(function (b, i) {
      var a = bandAcc[i];
      return { band: b.label, sales: a.sales, profit: a.profit,
               margin: a.sales ? a.profit / a.sales : 0, rows: a.rows };
    });

    var heatProfit = [], heatSales = [], heatOrders = [];
    SUB.forEach(function () { heatProfit.push(C.map(function () { return 0; }));
      heatSales.push(C.map(function () { return 0; }));
      heatOrders.push(C.map(function () { return 0; })); });
    R.heat.forEach(function (r) {
      var i = SUB.indexOf(r['Sub-Category']), j = C.indexOf(r.Region);
      if (i < 0 || j < 0) return;
      heatProfit[i][j] = n(val(r, 'Profit', 'SUM(Profit)'));
      heatSales[i][j] = n(val(r, 'Sales', 'SUM(Sales)'));
      heatOrders[i][j] = n(val(r, 'Orders', 'COUNTD(Order ID)'));
    });

    var states = R.states.map(function (r) {
      var sl = n(val(r, 'Sales', 'SUM(Sales)')), pf = n(val(r, 'Profit', 'SUM(Profit)'));
      return { state: r['State/Province'], sales: sl, profit: pf,
               margin: sl ? pf / sl : 0 };
    }).filter(function (d) { return d.state; })
      .sort(function (a, b) { return b.sales - a.sales; });

    // Row-level points for the scatter. Tableau caps how many rows come back,
    // so the count actually received is reported and the chart says so rather
    // than implying it drew every line.
    var scatter = null;
    if (R.scatter && R.scatter.length) {
      var disc = [], marg = [], sale = [], sub = [];
      R.scatter.forEach(function (r) {
        var d = Number(r.Discount), s = Number(r.Sales), p = Number(r.Profit);
        if (!isFinite(d) || !isFinite(s)) return;
        disc.push(d); sale.push(s);
        marg.push(s ? p / s : 0);
        var idx = SUB.indexOf(r['Sub-Category']);
        sub.push(idx >= 0 ? idx : 0);
      });
      scatter = { discount: disc, margin: marg, sales: sale, subIdx: sub,
                  count: disc.length, sampled: true, limit: SCATTER_LIMIT };
    }

    return {
      meta: meta, source: 'tableau', kpi: kpi, months: months,
      allMonths: months,
      region: rollup(R.region, 'Region', 'region'),
      segment: rollup(R.segment, 'Segment', 'segment'),
      subcategory: subcategory, category: category,
      discountBands: discountBands,
      heat: { regions: C.slice(), subCategories: SUB.slice(),
              profit: heatProfit, sales: heatSales, orders: heatOrders },
      states: states,
      scatter: scatter,
      returns: { sales: 0, profit: 0, orders: 0, unavailable: true },
      rowCount: kpi.lines || null,
    };
  }

  /**
   * The queries that produce every figure, described for the Data tab. The
   * runtime backend really issues these; the preview backend issues none, and
   * says so rather than claiming otherwise.
   */
  function describeQueries(slice) {
    var scope = [];
    if (slice.regions.length) scope.push('Region in (' + slice.regions.join(', ') + ')');
    if (slice.segments.length) scope.push('Segment in (' + slice.segments.join(', ') + ')');
    if (slice.subcats.length) scope.push('Sub-Category in (' + slice.subcats.join(', ') + ')');
    if (slice.discountBands.length) {
      scope.push('Discount in (' + slice.discountBands.join(', ') + ')');
    }
    if (slice.dateFrom && slice.dateTo) {
      scope.push('Order Date ' + slice.dateFrom + ' .. ' + slice.dateTo);
    }
    var scopeNote = scope.length ? scope.join('; ') : 'no filters (full datasource)';

    return [
      {
        name: 'kpis', tag: 'semantic', note: 'Headline figures. Scope: ' + scopeNote,
        fields: ['SUM(Sales)', 'SUM(Profit)', 'SUM(Quantity)', 'AVG(Discount)',
          'COUNTD(Order ID)', 'COUNTD(Customer Name)'],
      },
      {
        name: 'monthly', tag: 'semantic', note: 'Sales and profit per month. Scope: ' + scopeNote,
        fields: ['TRUNC_MONTH(Order Date)', 'SUM(Sales)', 'SUM(Profit)'],
      },
      {
        name: 'region', tag: 'semantic', note: 'Region rollup. Scope: ' + scopeNote,
        fields: ['Region', 'SUM(Sales)', 'SUM(Profit)', 'COUNTD(Order ID)'],
      },
      {
        name: 'segment', tag: 'semantic', note: 'Segment rollup, used by the findings row. Scope: ' + scopeNote,
        fields: ['Segment', 'SUM(Sales)', 'SUM(Profit)', 'COUNTD(Order ID)'],
      },
      {
        name: 'subcategory', tag: 'semantic', note: 'Sub-category rollup for the ranked bars and the detail table. Scope: ' + scopeNote,
        fields: ['Sub-Category', 'SUM(Sales)', 'SUM(Profit)', 'AVG(Discount)',
          'SUM(Quantity)', 'COUNTD(Order ID)'],
      },
      {
        name: 'discountBands', tag: 'semantic',
        note: 'Discount grouped by its real value, then binned client-side into the five bands. Scope: ' + scopeNote,
        fields: ['Discount', 'SUM(Sales)', 'SUM(Profit)', 'COUNTD(Order ID)'],
      },
      {
        name: 'heat', tag: 'semantic', note: 'Sub-category by region grid. Scope: ' + scopeNote,
        fields: ['Sub-Category', 'Region', 'SUM(Sales)', 'SUM(Profit)', 'COUNTD(Order ID)'],
      },
      {
        name: 'states', tag: 'semantic', note: 'State rollup, for the detail table ordering. Scope: ' + scopeNote,
        fields: ['State/Province', 'SUM(Sales)', 'SUM(Profit)'],
      },
      {
        name: 'scatter', tag: 'row-level',
        note: 'Row-level points for the margin-vs-discount chart. The only non-aggregate ' +
          'query; bounded to ' + SCATTER_LIMIT + ' rows. Scope: ' + scopeNote,
        fields: ['Discount', 'Sales', 'Profit', 'Sub-Category'],
      },
    ];
  }

  Object.assign(SV, {
    PreviewStore: PreviewStore,
    TableauStore: TableauStore,
    shapeRuntime: shapeRuntime,
    describeQueries: describeQueries,
  });
})((window.SV = window.SV || {}));

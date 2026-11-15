// ============================================================================
// The app. Owns the slice, the store, and the render loop.
//
// Rendering rule: while a new slice is being resolved, the previous render is
// held at reduced opacity - never a skeleton flash, never a layout jump.
// ============================================================================
(function (SV) {
  'use strict';
  var el = SV.el, fill = SV.fill;

  function App(root, store, opts) {
    this.root = root;
    this.store = store;
    this.opts = opts || {};
    this.slice = SV.emptySlice();
    this.activeCategory = null;
    this.tab = 'preview';
    this.agg = null;
    this.tableState = { key: 'profit', dir: 1 };
    this.busy = 0;
    this.log = [];
    this.build(opts);
  }

  App.prototype.build = function (opts) {
    var self = this;
    var shell = el('div', { class: 'viz-root' });

    // ---- top bar --------------------------------------------------------
    var bar = el('header', { class: 'topbar' });
    var brand = el('div', { class: 'brand' });
    brand.appendChild(el('span', { class: 'brand-name' }, 'Superstore Executive'));
    brand.appendChild(el('span', { class: 'brand-sub' }, 'Tableau Data App'));
    bar.appendChild(brand);

    var tabs = el('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'View' });
    self.tabButtons = {};
    [['preview', 'Preview'], ['code', 'Code'], ['data', 'Data']].forEach(function (pair) {
      var b = el('button', {
        class: 'tab' + (pair[0] === self.tab ? ' is-on' : ''),
        type: 'button', role: 'tab', 'aria-selected': pair[0] === self.tab ? 'true' : 'false',
        id: 'tab-' + pair[0], 'aria-controls': 'panel-' + pair[0],
      }, pair[1]);
      b.addEventListener('click', function () { self.setTab(pair[0]); });
      tabs.appendChild(b);
      self.tabButtons[pair[0]] = b;
    });
    bar.appendChild(el('div', { class: 'tabs-wrap' }, [tabs]));

    var right = el('div', { class: 'topbar-right' });
    self.sourceBadge = el('span', { class: 'src-badge' }, describeSource(self.store));
    self.sourceBadge.title = self.sourceBadge.textContent;
    right.appendChild(self.sourceBadge);
    var themeBtn = el('button', { class: 'btn-ghost', type: 'button',
      'aria-label': 'Toggle dark mode', title: 'Toggle light and dark' }, 'Theme');
    themeBtn.addEventListener('click', function () { self.toggleTheme(); });
    right.appendChild(themeBtn);
    bar.appendChild(right);
    shell.appendChild(bar);

    // ---- filter row -----------------------------------------------------
    self.filterHost = el('div', { class: 'filterbar', role: 'group', 'aria-label': 'Filters' });
    shell.appendChild(self.filterHost);

    // ---- panels ---------------------------------------------------------
    self.previewPanel = el('div', { class: 'panel', id: 'panel-preview', role: 'tabpanel',
      'aria-labelledby': 'tab-preview' });
    self.scopeLine = el('p', { class: 'scope-line' });
    self.kpiHost = el('div', { class: 'kpi-host' });
    self.findingsHost = el('div', { class: 'findings-host' });
    self.grid = el('div', { class: 'grid' });
    self.previewPanel.appendChild(self.scopeLine);
    self.previewPanel.appendChild(self.kpiHost);
    self.previewPanel.appendChild(self.findingsHost);
    self.previewPanel.appendChild(self.grid);

    self.codePanel = el('div', { class: 'panel', id: 'panel-code', role: 'tabpanel',
      'aria-labelledby': 'tab-code' });
    self.codePanel.hidden = true;
    self.dataPanel = el('div', { class: 'panel', id: 'panel-data', role: 'tabpanel',
      'aria-labelledby': 'tab-data' });
    self.dataPanel.hidden = true;

    shell.appendChild(self.previewPanel);
    shell.appendChild(self.codePanel);
    shell.appendChild(self.dataPanel);

    shell.appendChild(el('footer', { class: 'foot' },
      'Queries against the published datasource at runtime; each figure is traceable in the Data pane.'));

    fill(self.root, [shell]);
    self.shell = shell;

    // Initial theme from the preference, not a forced value.
    // Resolve the theme but do NOT stamp data-theme here: an explicit choice by
    // the viewer must win, and forcing the attribute from the OS setting would
    // override it. The attribute is written only when the toggle is used.
    self.themeName = resolveTheme();
    self.applyTheme();

    // Follow the OS setting while no explicit choice has been made.
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () {
        if (document.documentElement.hasAttribute('data-theme')) return;
        self.themeName = resolveTheme();
        self.applyTheme();
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }

    self.refresh();
  };

  /** The active theme: a saved choice wins, then an explicit root attribute, else the OS. */
  function resolveTheme() {
    var saved = null;
    try { saved = localStorage.getItem('superstore-theme'); } catch (e) { saved = null; }
    if (saved === 'dark' || saved === 'light') {
      document.documentElement.setAttribute('data-theme', saved);
      return saved;
    }
    var stamped = document.documentElement.getAttribute('data-theme');
    if (stamped === 'dark' || stamped === 'light') return stamped;
    if (window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
  }

  App.prototype.applyTheme = function () {
    this.theme = SV.THEME[this.themeName];
    this.renderAll();
  };

  /** The toggle is the only place an explicit choice is recorded. */
  App.prototype.toggleTheme = function () {
    this.themeName = this.themeName === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', this.themeName);
    this.applyTheme();
    try { localStorage.setItem('superstore-theme', this.themeName); } catch (e) { /* per-viewer only */ }
  };

  App.prototype.setTab = function (name) {
    this.tab = name;
    ['preview', 'code', 'data'].forEach(function (k) {
      // eslint-disable-next-line no-undef
    });
    var map = { preview: this.previewPanel, code: this.codePanel, data: this.dataPanel };
    Object.keys(map).forEach(function (k) {
      var on = k === name;
      map[k].hidden = !on;
      this.tabButtons[k].classList.toggle('is-on', on);
      this.tabButtons[k].setAttribute('aria-selected', on ? 'true' : 'false');
    }, this);
    if (name === 'code') this.renderCode();
    if (name === 'data') this.renderData();
  };

  App.prototype.refresh = function () {
    var self = this;
    self.busy++;
    self.shell.classList.add('is-busy');
    var t0 = performance.now();
    return self.store.run(self.slice)
      .then(function (agg) {
        self.agg = agg;
        self.busy--;
        self.shell.classList.remove('is-busy');
        self.log.push({
          n: self.log.length + 1,
          slice: JSON.stringify(self.slice),
          ms: Math.round(performance.now() - t0),
          rows: agg.rowCount,
          at: new Date().toLocaleTimeString('en-US', { hour12: false }),
        });
        self.renderAll();
      })
      .catch(function (err) {
        self.busy--;
        self.shell.classList.remove('is-busy');
        showError(self.previewPanel, err);
      });
  };

  App.prototype.renderAll = function () {
    if (!this.agg) return;
    var theme = this.theme;
    var agg = this.agg;

    // Filter row
    SV.filterBar(this.filterHost, {
      slice: this.slice, meta: this.agg.meta || this.store.meta, agg: agg,
      activeCategory: this.activeCategory,
      // A chip toggles the shared slice in place, so the app has to re-resolve
      // and re-render - otherwise the control moves and the figures do not.
      onChange: function () { this.refresh(); }.bind(this),
      onCategory: function (c) {
        this.activeCategory = c;
        this.slice.subcats = [];
        this.renderAll();
      }.bind(this),
      onReset: function () {
        this.slice = SV.emptySlice();
        this.activeCategory = null;
        // refresh(), not renderAll(): renderAll() would redraw from the old
        // aggregate and show the previous slice's figures under a cleared
        // filter row.
        this.refresh();
      }.bind(this),
    });

    // Scope line
    var m = agg.meta || this.store.meta;
    this.scopeLine.textContent = SV.describeSlice(this.slice, m) +
      '  ·  ' + SV.num(agg.rowCount || agg.kpi.lines || 0) + ' line items' +
      (agg.source === 'preview' ? '  ·  preview data' : '  ·  live from Tableau');

    SV.kpiRow(agg, theme, this.kpiHost);
    SV.findings(this.findingsHost, agg, theme, this.applyPatch.bind(this));

    // Grid
    var self = this;
    var tip = this.tip || (this.tip = new SV.Tooltip(this.previewPanel));
    var subOrder = this.activeCategory ? SV.SUB_CATEGORIES[this.activeCategory] : SV.SUB_ORDER;

    var bandRows = (agg.discountBands || []).map(function (b) {
      return [b.band, SV.num(b.rows), SV.money(b.sales), SV.money(b.profit), SV.pct(b.margin, 1)];
    });

    var cards = [
      SV.card({
        id: 'c-monthly', title: 'Sales and profit by month',
        subtitle: 'Both measures on one dollar axis — never two scales.',
        badge: 'monthly', span: 2,
        note: agg.months.filter(function (x) { return x.profit < 0; }).length
          ? 'Loss months: ' + agg.months.filter(function (x) { return x.profit < 0; })
            .map(function (x) { return SV.monthLabel(x.iso) + ' (' + SV.money(x.profit, { compact: true }) + ')'; })
            .join(', ')
          : 'No loss months in this slice.',
        render: function (body, table) {
          SV.chartMonthly(body, agg, theme, tip, { table: table });
        },
      }),
      SV.card({
        id: 'c-region', title: 'Sales and profit by region',
        subtitle: 'Margin direct-labeled. Click a region to scope the app.',
        badge: 'region',
        render: function (body, table) {
          SV.chartRegion(body, agg, theme, tip, {
            table: table, regionOrder: SV.REGIONS,
            onRegion: function (r) { self.applyPatch({ regions: [r] }); },
          });
        },
      }),
      SV.card({
        id: 'c-rank', title: 'Sub-categories, worst profit first',
        subtitle: 'Red bars lose money. Click a bar to scope the app.',
        badge: 'subcategory',
        render: function (body, table) {
          SV.chartRank(body, agg, theme, tip, {
            table: table, subOrder: subOrder,
            onSub: function (s) { self.applyPatch({ subcats: [s] }); },
          });
        },
      }),
      SV.card({
        id: 'c-heat', title: 'Profit by sub-category and region',
        subtitle: 'Diverging scale around zero: red loses, blue earns, grey is flat.',
        badge: 'heat',
        render: function (body, table) {
          SV.chartHeat(body, agg, theme, tip, {
            table: table, subOrder: subOrder,
            onCell: function (sub, region) {
              self.applyPatch({ subcats: [sub], regions: [region] });
            },
          });
        },
      }),
      SV.card({
        id: 'c-scatter', title: 'Margin against discount rate',
        subtitle: 'Every order line. The zero line is the break-even point.',
        badge: 'discount',
        render: function (body, table) {
          SV.chartScatter(body, self.rowsForScatter(), theme, tip,
            { table: table, bandRows: bandRows });
        },
      }),
      SV.card({
        id: 'c-detail', title: 'Every sub-category',
        subtitle: 'Sortable. Click a row to scope the app to it.',
        badge: 'detail', span: 2,
        render: function (body) {
          SV.detailTable(body, agg, theme, function (patch) { self.applyPatch(patch); },
            self.tableState);
        },
      }),
    ];

    var ordered = [cards[0], cards[1], cards[2], cards[3], cards[4], cards[5]];
    fill(this.grid, ordered);
  };

  /** The scatter needs row-level points; only the preview store carries them. */
  App.prototype.rowsForScatter = function () {
    if (this.store.store && this.store.store.cols) {
      var st = this.store.store;
      var rows = SV.selectRows(st, this.slice);
      var disc = [], marg = [], sale = [], sub = [];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var s = st.cols.sales[r];
        disc.push(st.cols.discount[r]);
        sale.push(s);
        marg.push(s ? st.cols.profit[r] / s : 0);
        sub.push(st.cols.subcat[r]);
      }
      return { scatter: { discount: disc, margin: marg, sales: sale, subIdx: sub,
        count: rows.length } };
    }
    return { scatter: null };
  };

  /** Applies a partial slice patch and re-renders. */
  App.prototype.applyPatch = function (patch) {
    var s = this.slice;
    Object.keys(patch).forEach(function (k) {
      if (k === 'dateFrom' || k === 'dateTo') s[k] = patch[k];
      else s[k] = patch[k].slice();
    });
    // A sub-category filter implies its category, so the chip row stays honest.
    if (patch.subcats && patch.subcats.length === 1) {
      this.activeCategory = SV.SUB_TO_CAT[patch.subcats[0]] || null;
    }
    this.renderAll();
    this.refresh();
  };

  App.prototype.renderCode = function () {
    var self = this;
    var host = this.codePanel;
    var wrap = el('div', { class: 'code-wrap' });
    wrap.appendChild(el('p', { class: 'code-lede' },
      'The interface is plain HTML, CSS, and JavaScript. There is no build step and no ' +
      'external origin: the package ships exactly these files. Runtime data access goes ' +
      'through the Extensions API.'));
    var pre = el('pre', { class: 'code' });
    pre.textContent = [
      '// The entire data path, from the shipped app:',
      'await tableau.extensions.initializeAsync();',
      'const sources = await tableau.extensions.workbook.getAllDataSourcesAsync();',
      "const ds = sources.find((s) => s.name === 'Superstore');",
      '',
      '// VizQL Data Service shape; Tableau does the aggregation.',
      'const { data } = await ds.queryAsync({',
      '  fields: [',
      "    { fieldCaption: 'Region' },",
      "    { fieldCaption: 'Sales',  function: 'SUM', fieldAlias: 'Sales' },",
      "    { fieldCaption: 'Profit', function: 'SUM', fieldAlias: 'Profit' },",
      '  ],',
      '  filters: [',
      "    { field: { fieldCaption: 'Region' }, filterType: 'SET', values: ['West'] },",
      '    { field: { fieldCaption: \'Order Date\' }, filterType: \'QUANTITATIVE_DATE\',',
      "      quantitativeFilterType: 'RANGE', minDate: '2025-01-01', maxDate: '2026-12-31' },",
      '  ],',
      '});',
    ].join('\n');
    wrap.appendChild(pre);

    var files = el('div', { class: 'files' });
    wrap.appendChild(el('h3', { class: 'code-h' }, 'Package contents'));
    (self.opts.manifest || []).forEach(function (f) {
      var row = el('div', { class: 'file-row' });
      row.appendChild(el('code', { class: 'file-path' }, f.path));
      row.appendChild(el('span', { class: 'file-note' }, f.note));
      files.appendChild(row);
    });
    wrap.appendChild(files);

    wrap.appendChild(el('h3', { class: 'code-h' }, 'Requests this app makes'));
    wrap.appendChild(el('p', { class: 'code-lede' },
      'Superstore is a single published datasource; no REST paths and no external ' +
      'origins are required.'));
    var ul = el('ul', { class: 'req-list' });
    [
      'Extensions API: queryAsync() — aggregations and filters.',
      'Extensions API: readMetadata() — field discovery.',
      'Extensions API: workbook.getAllDataSourcesAsync() — datasource handle.',
      'No fetch() calls, so no Tableau REST API paths to approve.',
      'No external origins, so no CDN or third-party host to allow.',
    ].forEach(function (t) { ul.appendChild(el('li', {}, t)); });
    wrap.appendChild(ul);

    fill(host, [wrap]);
  };

  App.prototype.renderData = function () {
    var self = this;
    var host = this.dataPanel;
    var wrap = el('div', { class: 'data-wrap' });
    wrap.appendChild(el('p', { class: 'code-lede' },
      'Every figure in this app comes from one of the queries below over the ' +
      'current slice. In Tableau\'s Data pane, hovering a component highlights its ' +
      'query and The Query tab shows the authored query, the executed query, and a ' +
      'sample of the actual rows.'));

    var queries = SV.describeQueries(this.slice);

    var list = el('div', { class: 'q-list' });
    queries.forEach(function (q) {
      var row = el('div', { class: 'q-row' });
      var head = el('div', { class: 'q-head' });
      head.appendChild(el('code', { class: 'q-name' }, q.name));
      head.appendChild(el('span', { class: 'q-meta' }, q.fields.length + ' fields'));
      if (q.tag) head.appendChild(el('span', { class: 'badge' }, q.tag));
      row.appendChild(head);
      if (q.note) row.appendChild(el('p', { class: 'q-note' }, q.note));
      var fl = el('div', { class: 'q-fields' });
      q.fields.forEach(function (f) { fl.appendChild(el('code', { class: 'q-field' }, f)); });
      row.appendChild(fl);
      list.appendChild(row);
    });
    wrap.appendChild(list);

    wrap.appendChild(el('h3', { class: 'code-h' }, 'Query log (this session)'));
    var log = el('div', { class: 'q-list' });
    (this.log || []).slice().reverse().forEach(function (e, i) {
      var row = el('div', { class: 'q-row q-row-log' });
      row.appendChild(el('span', { class: 'q-meta' }, '#' + (self.log.length - i) + '  ' + e.at));
      row.appendChild(el('span', { class: 'q-meta' }, e.ms + ' ms'));
      row.appendChild(el('span', { class: 'q-meta' }, (e.rows == null ? '—' : SV.num(e.rows)) + ' rows'));
      row.appendChild(el('code', { class: 'q-slice' }, e.slice));
      log.appendChild(row);
    });
    if (!this.log.length) log.appendChild(el('p', { class: 'q-note' }, 'No queries yet.'));
    wrap.appendChild(log);

    fill(host, [wrap]);
  };

  function describeSource(store) {
    return store instanceof SV.TableauStore ? 'Live · Tableau' : 'Preview · bundled data';
  }

  function showError(host, err) {
    var box = el('div', { class: 'error-box', role: 'alert' });
    box.appendChild(el('h2', {}, 'The app could not load its data.'));
    box.appendChild(el('p', {}, String(err && (err.message || err.errorCode) || err)));
    box.appendChild(el('p', { class: 'dim' },
      'Check that the datasource is connected to this workbook and that you have ' +
      'Connect and View access to it.'));
    fill(host, [box]);
  }

  SV.App = App;
  SV.showError = showError;
})((window.SV = window.SV || {}));

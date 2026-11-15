// ============================================================================
// The detail table: every sub-category with its figures, sortable, and each row
// scopes the app to that sub-category. This is the readable fallback for the
// ranked bars and the heatmap, so no value is reachable only by hovering.
// ============================================================================
(function (SV) {
  'use strict';
  var el = SV.el, fill = SV.fill;

  var COLS = [
    { key: 'subCategory', label: 'Sub-category', type: 'text' },
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'sales', label: 'Sales', type: 'money' },
    { key: 'profit', label: 'Profit', type: 'money' },
    { key: 'margin', label: 'Margin', type: 'pct' },
    { key: 'avgDiscount', label: 'Avg discount', type: 'pct' },
    { key: 'quantity', label: 'Units', type: 'num' },
    { key: 'orders', label: 'Orders', type: 'num' },
  ];

  function render(host, agg, theme, onFilter, state) {
    var data = (agg.subcategory || []).filter(function (d) { return d.sales !== 0 || d.profit !== 0; });
    if (!data.length) { host.textContent = 'No sub-categories in this slice.'; return; }
    state = state || { key: 'profit', dir: 1 };

    data.sort(function (a, b) {
      var av = a[state.key], bv = b[state.key];
      if (typeof av === 'string') return state.dir * av.localeCompare(bv);
      return state.dir * (av - bv);
    });

    var wrap = el('div', { class: 'tbl-wrap' });
    var t = el('table', { class: 'tbl tbl-detail' });
    var thead = el('thead');
    var hr = el('tr');
    COLS.forEach(function (c) {
      var th = el('th', { scope: 'col', class: c.type === 'text' ? 'lead' : 'num' });
      var btn = el('button', { class: 'th-sort', type: 'button',
        'aria-label': 'Sort by ' + c.label }, c.label);
      if (state.key === c.key) {
        btn.appendChild(el('span', { class: 'th-arrow' }, state.dir > 0 ? '▲' : '▼'));
      }
      btn.addEventListener('click', function () {
        if (state.key === c.key) state.dir = -state.dir;
        else { state.key = c.key; state.dir = c.type === 'text' ? 1 : -1; }
        render(host, agg, theme, onFilter, state);
      });
      th.appendChild(btn);
      hr.appendChild(th);
    });
    hr.appendChild(el('th', { scope: 'col', class: 'num' }, 'Status'));
    thead.appendChild(hr);
    t.appendChild(thead);

    var tb = el('tbody');
    data.forEach(function (d) {
      var tr = el('tr', { tabindex: '0', role: 'button',
        'aria-label': 'Filter to ' + d.subCategory });
      tr.appendChild(el('td', { class: 'lead' }, d.subCategory));
      tr.appendChild(el('td', { class: 'lead dim' }, SV.SUB_TO_CAT[d.subCategory]));
      tr.appendChild(el('td', { class: 'num' }, SV.money(d.sales)));
      tr.appendChild(el('td', { class: 'num' + (d.profit < 0 ? ' neg' : '') }, SV.money(d.profit)));
      tr.appendChild(el('td', { class: 'num' }, SV.pct(d.margin, 1)));
      tr.appendChild(el('td', { class: 'num' }, SV.pct(d.avgDiscount, 1)));
      tr.appendChild(el('td', { class: 'num' }, SV.num(Math.round(d.quantity))));
      tr.appendChild(el('td', { class: 'num' }, SV.num(d.orders)));

      // Status chip: an icon + a label, never color alone.
      var status = d.profit < 0
        ? { cls: 'crit', icon: '●', text: 'Losing money' }
        : (d.margin < 0.08
          ? { cls: 'warn', icon: '◐', text: 'Thin margin' }
          : { cls: 'good', icon: '✓', text: 'Healthy' });
      var tdc = el('td', { class: 'num' });
      var chip = el('span', { class: 'chip chip-' + status.cls });
      chip.appendChild(el('span', { class: 'chip-icon', 'aria-hidden': 'true' }, status.icon));
      chip.appendChild(el('span', {}, status.text));
      tdc.appendChild(chip);
      tr.appendChild(tdc);

      var activate = function () { onFilter({ subcats: [d.subCategory] }); };
      tr.addEventListener('click', activate);
      tr.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); activate(); }
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    fill(host, [wrap]);
  }

  SV.detailTable = render;
})((window.SV = window.SV || {}));

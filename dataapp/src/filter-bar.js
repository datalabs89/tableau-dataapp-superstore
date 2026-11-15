// ============================================================================
// The filter row. One row, above everything it scopes - never inside a chart
// card, never per-chart. Every stat, chart, and table below re-renders against
// the same slice, so the numbers can never disagree with each other.
//
// Date range is composed of month presets plus a custom pair, because a 48-month
// domain is too wide for a calendar grid to be the first thing anyone reaches for.
// ============================================================================
(function (SV) {
  'use strict';
  var el = SV.el, fill = SV.fill;

  function render(host, ctx) {
    var slice = ctx.slice;
    var meta = ctx.meta;
    var rows = [];

    // ---- date range ------------------------------------------------------
    var allMonths = (ctx.agg && ctx.agg.allMonths) || [];
    var presets = buildPresets(meta);

    var dateGroup = el('div', { class: 'fg fg-date' });
    dateGroup.appendChild(el('label', { class: 'fg-label' }, 'Order date'));

    var menu = el('div', { class: 'menu' });
    var menuBtn = el('button', {
      class: 'ctl ctl-date', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false',
    });
    updateDateLabel(menuBtn, slice);

    var panel = el('div', { class: 'menu-panel' });
    panel.hidden = true;
    presets.forEach(function (p) {
      var active = slice.dateFrom === p.from && slice.dateTo === p.to;
      var row = el('button', {
        class: 'menu-row' + (active ? ' is-active' : ''), type: 'button',
        'aria-pressed': active ? 'true' : 'false',
      });
      row.appendChild(el('span', { class: 'menu-check', 'aria-hidden': 'true' }, active ? '✓' : ''));
      row.appendChild(el('span', { class: 'menu-name' }, p.label));
      row.appendChild(el('span', { class: 'menu-note' }, p.note || ''));
      row.addEventListener('click', function () {
        slice.dateFrom = p.from; slice.dateTo = p.to;
        closeMenu();
        ctx.onChange();
      });
      panel.appendChild(row);
    });

    var custom = el('div', { class: 'menu-foot' });
    custom.appendChild(el('div', { class: 'menu-foot-label' }, 'Custom range'));
    var f1 = el('input', { type: 'month', class: 'ctl ctl-month', 'aria-label': 'From month',
      min: meta.dateMin.slice(0, 7), max: meta.dateMax.slice(0, 7) });
    var f2 = el('input', { type: 'month', class: 'ctl ctl-month', 'aria-label': 'To month',
      min: meta.dateMin.slice(0, 7), max: meta.dateMax.slice(0, 7) });
    f1.value = slice.dateFrom ? slice.dateFrom.slice(0, 7) : meta.dateMin.slice(0, 7);
    f2.value = slice.dateTo ? slice.dateTo.slice(0, 7) : meta.dateMax.slice(0, 7);
    var apply = el('button', { class: 'ctl ctl-apply', type: 'button' }, 'Apply');
    apply.addEventListener('click', function () {
      slice.dateFrom = f1.value + '-01';
      slice.dateTo = endOfMonth(f2.value);
      closeMenu();
      ctx.onChange();
    });
    custom.appendChild(el('div', { class: 'menu-foot-fields' }, [f1, el('span', { class: 'to' }, 'to'), f2, apply]));
    panel.appendChild(custom);

    menuBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var on = panel.hidden;
      panel.hidden = !on;
      menuBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
      menuBtn.classList.toggle('is-open', on);
    });
    document.addEventListener('click', function (ev) {
      if (!menu.contains(ev.target)) closeMenu();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closeMenu();
    });
    function closeMenu() {
      panel.hidden = true;
      menuBtn.setAttribute('aria-expanded', 'false');
      menuBtn.classList.remove('is-open');
    }

    menu.appendChild(menuBtn);
    menu.appendChild(panel);
    dateGroup.appendChild(menu);
    rows.push(dateGroup);

    // ---- region ----------------------------------------------------------
    rows.push(chipGroup('Region', SV.REGIONS, slice.regions, function (v) {
      toggle(slice.regions, v); ctx.onChange();
    }));

    // ---- segment ---------------------------------------------------------
    rows.push(chipGroup('Segment', SV.SEGMENTS, slice.segments, function (v) {
      toggle(slice.segments, v); ctx.onChange();
    }));

    // ---- category (drives the sub-category set shown) --------------------
    var catGroup = el('div', { class: 'fg' });
    catGroup.appendChild(el('label', { class: 'fg-label' }, 'Category'));
    var catWrap = el('div', { class: 'chips' });
    SV.CATEGORIES.forEach(function (c) {
      var on = ctx.activeCategory === c;
      var b = el('button', {
        class: 'chip-btn' + (on ? ' is-on' : ''), type: 'button',
        'aria-pressed': on ? 'true' : 'false',
      }, c);
      b.addEventListener('click', function () { ctx.onCategory(on ? null : c); });
      catWrap.appendChild(b);
    });
    catGroup.appendChild(catWrap);
    rows.push(catGroup);

    // ---- reset -----------------------------------------------------------
    if (hasFilters(slice)) {
      var reset = el('button', { class: 'ctl ctl-reset', type: 'button' }, 'Reset all');
      reset.addEventListener('click', function () { ctx.onReset(); });
      var rg = el('div', { class: 'fg fg-reset' }, [reset]);
      rows.push(rg);
    }

    fill(host, rows);
  }

  function hasFilters(s) {
    return !!(s.regions.length || s.segments.length || s.subcats.length ||
      s.discountBands.length);
  }

  function buildPresets(meta) {
    var min = meta.dateMin, max = meta.dateMax;
    function monthBefore(iso, n) {
      var p = iso.split('-').map(Number);
      var t = (p[0] * 12 + (p[1] - 1)) - n;
      var y = Math.floor(t / 12), m = (t % 12) + 1;
      return y + '-' + String(m).padStart(2, '0') + '-01';
    }
    var out = [{ label: 'Full range', from: min, to: max,
      note: SV.monthLabel(min) + ' - ' + SV.monthLabel(max) }];
    out.push({ label: 'Last 12 months', from: monthBefore(max, 11), to: max, note: 'the most recent year' });
    out.push({ label: 'Last 24 months', from: monthBefore(max, 23), to: max, note: '' });
    out.push({ label: 'Last 6 months', from: monthBefore(max, 5), to: max, note: '' });
    // Year-to-date of the final year present.
    var y = max.slice(0, 4);
    out.push({ label: y + ' year to date', from: y + '-01-01', to: max, note: '' });
    return out;
  }

  function endOfMonth(ym) {
    var p = ym.split('-').map(Number);
    var last = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
    return ym + '-' + String(last).padStart(2, '0');
  }

  function updateDateLabel(btn, slice) {
    fill(btn, []);
    var t = (slice.dateFrom && slice.dateTo)
      ? SV.monthLabel(slice.dateFrom) + ' - ' + SV.monthLabel(slice.dateTo)
      : 'Full range';
    btn.appendChild(el('span', {}, t));
    btn.appendChild(el('span', { class: 'caret', 'aria-hidden': 'true' }, '▾'));
  }

  function chipGroup(label, values, selected, onToggle) {
    var g = el('div', { class: 'fg' });
    g.appendChild(el('label', { class: 'fg-label' }, label));
    var wrap = el('div', { class: 'chips' });
    values.forEach(function (v) {
      var on = selected.indexOf(v) >= 0;
      var b = el('button', {
        class: 'chip-btn' + (on ? ' is-on' : ''), type: 'button',
        'aria-pressed': on ? 'true' : 'false',
      }, v);
      b.addEventListener('click', function () { onToggle(v); });
      wrap.appendChild(b);
    });
    g.appendChild(wrap);
    return g;
  }

  function toggle(arr, v) {
    var i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1); else arr.push(v);
  }

  SV.filterBar = render;
})((window.SV = window.SV || {}));

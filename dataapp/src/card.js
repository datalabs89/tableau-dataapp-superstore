// ============================================================================
// Chart card shell + table-view toggle. Every chart ships a table view (its
// WCAG-clean twin), which is also the relief the palette's sub-3:1 contrast
// WARN requires.
// ============================================================================
(function (SV) {
  'use strict';
  var el = SV.el, fill = SV.fill;

  /**
   * @param {object} o
   *   id, title, subtitle, span (grid columns), note, tableHeaders, tableRows
   *   render(body) -> draws the chart into `body`
   */
  function card(o) {
    var body = el('div', { class: 'card-body' });
    var table = el('div', { class: 'card-table' });
    table.hidden = true;

    var toggle = el('button', {
      class: 'btn-ghost', type: 'button',
      'aria-pressed': 'false',
      title: 'Show the values as a table',
    }, 'Table');
    toggle.addEventListener('click', function () {
      var on = table.hidden;
      table.hidden = !on;
      body.hidden = on;
      toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
      toggle.classList.toggle('is-on', on);
    });

    var head = el('div', { class: 'card-head' });
    var titles = el('div', { class: 'card-titles' });
    titles.appendChild(el('h3', { class: 'card-title' }, o.title));
    if (o.subtitle) titles.appendChild(el('p', { class: 'card-sub' }, o.subtitle));
    head.appendChild(titles);
    var tools = el('div', { class: 'card-tools' });
    if (o.badge) tools.appendChild(el('span', { class: 'badge' }, o.badge));
    tools.appendChild(toggle);
    head.appendChild(tools);

    var fig = el('figure', { class: 'card', id: o.id });
    fig.appendChild(head);
    fig.appendChild(body);
    fig.appendChild(table);
    if (o.note) fig.appendChild(el('figcaption', { class: 'card-note' }, o.note));

    if (o.render) o.render(body, table, fig);
    return fig;
  }

  /** Builds the table-view twin from a header list and row list. */
  function renderTable(table, headers, rows) {
    fill(table, []);
    var t = el('table', { class: 'tbl' });
    var thead = el('thead');
    var hr = el('tr');
    headers.forEach(function (h, i) {
      hr.appendChild(el('th', { scope: 'col', class: i === 0 ? 'lead' : 'num' }, h));
    });
    thead.appendChild(hr);
    t.appendChild(thead);
    var tb = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr');
      r.forEach(function (cell, i) {
        var td = el('td', { class: i === 0 ? 'lead' : 'num' });
        if (cell && cell.nodeType) td.appendChild(cell);
        else td.textContent = cell == null ? '' : String(cell);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    table.appendChild(t);
  }

  SV.card = card;
  SV.renderTable = renderTable;
})((window.SV = window.SV || {}));

// ============================================================================
// One shared tooltip element. Values lead, labels follow; each series row is
// keyed by a short line-stroke rather than a filled box. All text goes in via
// textContent.
// ============================================================================
(function (SV) {
  'use strict';
  var el = SV.el;

  function Tooltip(root) {
    this.node = el('div', { class: 'tt', role: 'status', 'aria-live': 'polite' });
    this.node.hidden = true;
    root.appendChild(this.node);
    this.root = root;
  }

  Tooltip.prototype.show = function (x, y, title, rows) {
    var t = this.node;
    SV.clear(t);
    if (title) t.appendChild(el('div', { class: 'tt-title' }, title));
    (rows || []).forEach(function (r) {
      var row = el('div', { class: 'tt-row' });
      if (r.color) {
        row.appendChild(el('span', { class: 'tt-key', style: 'background:' + r.color }));
      }
      row.appendChild(el('span', { class: 'tt-val' }, r.value));
      row.appendChild(el('span', { class: 'tt-label' }, r.label));
      t.appendChild(row);
    });
    if (rows && rows.length) {
      var lead = t.querySelector('.tt-row');
      if (lead) lead.classList.add('is-lead');
    }
    t.hidden = false;
    this.move(x, y);
  };

  Tooltip.prototype.move = function (x, y) {
    var t = this.node;
    var b = this.root.getBoundingClientRect();
    var w = t.offsetWidth, h = t.offsetHeight;
    var left = x - b.left + 14;
    var top = y - b.top - h - 12;
    if (left + w > b.width - 6) left = x - b.left - w - 14;
    if (left < 6) left = 6;
    if (top < 4) top = y - b.top + 18;
    t.style.left = left + 'px';
    t.style.top = top + 'px';
  };

  Tooltip.prototype.hide = function () { this.node.hidden = true; };

  SV.Tooltip = Tooltip;
})((window.SV = window.SV || {}));

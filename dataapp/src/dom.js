// ============================================================================
// Tiny DOM helpers. Everything that touches text uses textContent or
// createTextNode - series and category names are untrusted data, so no
// innerHTML string building anywhere in this app.
// ============================================================================
(function (SV) {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, content) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null) return;
        if (k === 'class') n.className = v;
        else if (k === 'dataset') Object.assign(n.dataset, v);
        else n.setAttribute(k, v);
      });
    }
    // `content` is either a string (text) or an array of nodes. Treating an
    // array as text would silently stringify it, so the two cases are explicit.
    if (typeof content === 'string' || typeof content === 'number') {
      n.textContent = String(content);
    } else if (content && content.length != null) {
      Array.prototype.forEach.call(content, function (c) {
        if (c == null) return;
        n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return n;
  }

  function svg(tag, attrs, text) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null) return;
        n.setAttribute(k, v);
      });
    }
    if (text != null) n.appendChild(document.createTextNode(text));
    return n;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function mount(node, children) {
    clear(node);
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  /** Replaces an element's children with `nodes`, skipping nulls. */
  function fill(node, nodes) { return mount(node, nodes); }

  Object.assign(SV, { el: el, svg: svg, clear: clear, mount: mount, fill: fill, SVGNS: SVGNS });
})((window.SV = window.SV || {}));

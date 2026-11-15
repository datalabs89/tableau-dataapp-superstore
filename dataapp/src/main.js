// ============================================================================
// Entry point. Decides which backend to use, then starts the app.
//
// Inside Tableau the Extensions API is present, so the app initializes it,
// finds the published datasource, and queries it live. Outside Tableau (a plain
// browser, for review before publishing) that initialization cannot succeed, so
// the app falls back to the bundled rows and says so in the badge.
//
// This fallback exists ONLY so the app can be reviewed offline. The published
// artifact always takes the Tableau path: there is no bundled data in the
// package, so a viewer is never shown stale figures.
// ============================================================================
(function (SV) {
  'use strict';

  var DATASOURCE_NAME = 'Superstore';   // the published datasource caption

  function boot() {
    var root = document.getElementById('root');
    if (!root) return;

    // A Tableau extension always runs inside an iframe that Tableau hosts; the
    // library being present is NOT sufficient, because the package ships it and
    // a plain browser will therefore define window.tableau too. In that case
    // initializeAsync() never settles - it waits forever for a parent that is
    // not there - so the frameless case is treated as the offline preview.
    var framed = false;
    try { framed = window.self !== window.top; } catch (e) { framed = true; }
    var hasApi = !!(window.tableau && window.tableau.extensions);

    if (!hasApi || !framed) {
      startPreview(root, hasApi ? 'not running inside Tableau' : 'Extensions API not present');
      return;
    }

    // Even inside a frame, do not hang forever: if Tableau never answers, fall
    // back rather than leaving a blank pane.
    withTimeout(window.tableau.extensions.initializeAsync(), 8000,
      'Tableau did not respond to initializeAsync()')
      .then(function () {
        return window.tableau.extensions.workbook.getAllDataSourcesAsync();
      }).then(function (sources) {
      var ds = null;
      for (var i = 0; i < sources.length; i++) {
        var s = sources[i];
        var name = s.name || s.caption || '';
        if (String(name).toLowerCase().indexOf(DATASOURCE_NAME.toLowerCase()) >= 0) { ds = s; break; }
      }
      if (!ds && sources.length === 1) ds = sources[0];
      if (!ds) {
        throw new Error('No datasource named "' + DATASOURCE_NAME +
          '" is connected to this workbook. Set DATASOURCE_NAME in main.js to the ' +
          'published datasource caption. Available: ' +
          sources.map(function (s) { return s.name; }).join(', '));
      }
      var store = new SV.TableauStore(ds);
      return store.load().then(function () {
        SV.store = store;
        new SV.App(root, store, { manifest: SV.MANIFEST });
      });
    }).catch(function (err) {
      // A Tableau context that failed to attach is a real error, not a reason
      // to quietly show bundled numbers. Report it and offer the preview.
      var box = SV.el('div', { class: 'error-box', role: 'alert' });
      box.appendChild(SV.el('h2', {}, 'This data app could not connect to Tableau.'));
      box.appendChild(SV.el('p', {}, String(err && (err.message || err.errorCode) || err)));
      var b = SV.el('button', { class: 'f-action', type: 'button' }, 'Continue with bundled preview data');
      b.addEventListener('click', function () { startPreview(root, 'Tableau connection failed'); });
      box.appendChild(b);
      SV.fill(root, [box]);
    });
  }

  function withTimeout(promise, ms, message) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var t = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error(message));
      }, ms);
      Promise.resolve(promise).then(function (v) {
        if (done) return;
        done = true; clearTimeout(t); resolve(v);
      }, function (e) {
        if (done) return;
        done = true; clearTimeout(t); reject(e);
      });
    });
  }

  function startPreview(root, why) {
    var store = new SV.PreviewStore('data/');
    store.load().then(function () {
      SV.store = store;
      new SV.App(root, store, { manifest: SV.MANIFEST, previewReason: why });
    }).catch(function (err) {
      var box = SV.el('div', { class: 'error-box', role: 'alert' });
      box.appendChild(SV.el('h2', {}, 'Preview data unavailable.'));
      box.appendChild(SV.el('p', {}, String(err && err.message || err)));
      SV.fill(root, [box]);
    });
  }

  SV.MANIFEST = SV.MANIFEST || [];

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})((window.SV = window.SV || {}));

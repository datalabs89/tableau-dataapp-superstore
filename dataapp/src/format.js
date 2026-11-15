// ============================================================================
// Number and date formatting. Compact forms on axes, full forms in tables and
// tooltips; the hero and stat-tile values keep proportional figures (tabular
// is reserved for columns that must align vertically).
// ============================================================================
(function (SV) {
  'use strict';

  var MONTH_SHORT = SV.MONTH_NAMES;

  function money(v, opts) {
    opts = opts || {};
    var n = Number(v) || 0;
    var sign = n < 0 ? '-' : '';
    var a = Math.abs(n);
    if (opts.compact) {
      if (a >= 1e9) return sign + '$' + trim(a / 1e9) + 'B';
      if (a >= 1e6) return sign + '$' + trim(a / 1e6) + 'M';
      if (a >= 1e3) return sign + '$' + trim(a / 1e3) + 'K';
      return sign + '$' + Math.round(a);
    }
    return sign + '$' + a.toLocaleString('en-US', {
      minimumFractionDigits: opts.cents ? 2 : 0,
      maximumFractionDigits: opts.cents ? 2 : 0,
    });
  }

  /** Compact money that keeps one decimal only when it adds information. */
  function moneyAxis(v) {
    var n = Number(v) || 0;
    var sign = n < 0 ? '-' : '';
    var a = Math.abs(n);
    if (a >= 1e6) return sign + '$' + trim(a / 1e6) + 'M';
    if (a >= 1e3) return sign + '$' + trim(a / 1e3) + 'K';
    return sign + '$' + Math.round(a);
  }

  function trim(x) {
    var s = x.toFixed(1);
    return s.endsWith('.0') ? s.slice(0, -2) : s;
  }

  function num(v, opts) {
    opts = opts || {};
    var n = Number(v) || 0;
    if (opts.compact) {
      var a = Math.abs(n), sign = n < 0 ? '-' : '';
      if (a >= 1e6) return sign + trim(a / 1e6) + 'M';
      if (a >= 1e3) return sign + trim(a / 1e3) + 'K';
    }
    return n.toLocaleString('en-US', {
      minimumFractionDigits: opts.decimals || 0,
      maximumFractionDigits: opts.decimals || 0,
    });
  }

  function pct(v, decimals) {
    var d = decimals == null ? 1 : decimals;
    return ((Number(v) || 0) * 100).toFixed(d) + '%';
  }

  function signedPct(v, decimals) {
    var d = decimals == null ? 1 : decimals;
    var n = Number(v) || 0;
    return (n > 0 ? '+' : n < 0 ? '' : '') + (n * 100).toFixed(d) + '%';
  }

  function signedMoney(v, opts) {
    var n = Number(v) || 0;
    return (n > 0 ? '+' : n < 0 ? '-' : '') + money(Math.abs(n), opts);
  }

  /** 'YYYY-MM-DD' -> 'Mar 2024' */
  function monthLabel(iso) {
    var p = String(iso).split('-');
    return MONTH_SHORT[Number(p[1]) - 1] + ' ' + p[0];
  }

  /** 'YYYY-MM-DD' -> 'Mar 24' (axis ticks) */
  function monthTick(iso) {
    var p = String(iso).split('-');
    return MONTH_SHORT[Number(p[1]) - 1] + " '" + p[0].slice(2);
  }

  Object.assign(SV, {
    money: money, moneyAxis: moneyAxis, num: num, pct: pct,
    signedPct: signedPct, signedMoney: signedMoney,
    monthLabel: monthLabel, monthTick: monthTick,
  });
})((window.SV = window.SV || {}));

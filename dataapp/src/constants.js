// ============================================================================
// Fixed vocabularies, chart-zone layout, and the validated color palette.
//
// Categorical identity is assigned in a stable order and never cycled, so a
// series keeps its color no matter how the filters change the row count.
// ============================================================================
(function (SV) {
  'use strict';

  var REGIONS = ['Central', 'East', 'South', 'West'];
  var SEGMENTS = ['Consumer', 'Corporate', 'Home Office'];
  var CATEGORIES = ['Furniture', 'Office Supplies', 'Technology'];
  var SUB_CATEGORIES = {
    Furniture: ['Bookcases', 'Chairs', 'Furnishings', 'Tables'],
    'Office Supplies': ['Appliances', 'Art', 'Binders', 'Envelopes', 'Fasteners',
      'Labels', 'Paper', 'Storage', 'Supplies'],
    Technology: ['Accessories', 'Copiers', 'Machines', 'Phones'],
  };
  var SUB_ORDER = CATEGORIES.reduce(function (acc, c) {
    return acc.concat(SUB_CATEGORIES[c]);
  }, []);
  var SUB_TO_CAT = (function () {
    var m = Object.create(null);
    CATEGORIES.forEach(function (c) {
      SUB_CATEGORIES[c].forEach(function (s) { m[s] = c; });
    });
    return m;
  })();

  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Discount bands. The 30%+ edge is deliberate: it is the threshold the
  // headline finding uses, so the band has to exist as its own class.
  var BANDS = [
    { label: 'No discount', lo: 0.0, hi: 0.0, zero: true },
    { label: '1-10%', lo: 0.0, hi: 0.10 },
    { label: '11-20%', lo: 0.10, hi: 0.20 },
    { label: '21-30%', lo: 0.20, hi: 0.30 },
    { label: '30% or more', lo: 0.30, hi: 1.01 },
  ];

  // ---------------------------------------------------------------------------
  // Colors. Every categorical set below was checked with the dataviz
  // validator (`validate_palette.js`) against the surface it renders on:
  //   light series 1-4  -> ALL CHECKS PASS (worst adjacent CVD dE 9.1)
  //   dark  series 1-4  -> ALL CHECKS PASS (worst adjacent CVD dE 8.4)
  //   diverging 4 bins  -> CVD + normal-vision PASS both modes, contrast WARN
  //                        on the two light steps -> values are printed in
  //                        every heat cell and a table view exists (the
  //                        relief the WARN obligates).
  // Do not hand-edit a hex here; re-run the validator instead.
  // ---------------------------------------------------------------------------
  var THEME = {
    light: {
      surface: '#fcfcfb', page: '#f9f9f7', raised: '#ffffff',
      ink: '#0b0b0b', ink2: '#52514e', muted: '#898781',
      grid: '#e1e0d9', axis: '#c3c2b7',
      series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'],
      good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b',
      deltaGood: '#006300',
      // diverging profit scale: strong loss -> weak loss -> weak gain -> strong gain
      diverging: ['#b03030', '#ec9a98', '#9ec5f4', '#256abf'],
      divergingMid: '#f0efec',
      deEmph: '#c3c2b7',
      areaWash: 0.10,
    },
    dark: {
      surface: '#1a1a19', page: '#0d0d0d', raised: '#1f1f1e',
      ink: '#f0efec', ink2: '#c3c2b7', muted: '#898781',
      grid: '#2c2c2a', axis: '#383835',
      series: ['#3987e5', '#d95926', '#199e70', '#c98500'],
      good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b',
      deltaGood: '#0ca30c',
      diverging: ['#e66767', '#8f3b3b', '#6da7ec', '#256abf'],
      divergingMid: '#383835',
      deEmph: '#4a4a47',
      areaWash: 0.12,
    },
  };

  Object.assign(SV, {
    REGIONS: REGIONS,
    SEGMENTS: SEGMENTS,
    CATEGORIES: CATEGORIES,
    SUB_CATEGORIES: SUB_CATEGORIES,
    SUB_ORDER: SUB_ORDER,
    SUB_TO_CAT: SUB_TO_CAT,
    MONTH_NAMES: MONTH_NAMES,
    BANDS: BANDS,
    THEME: THEME,
  });
})((window.SV = window.SV || {}));

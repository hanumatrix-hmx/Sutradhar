// audit-3 follow-up cases: SVG non-rendering containers (the first run found <defs>/<symbol> text reported verified).
const S = (inner, w = 600) => `<svg width="${w}" height="70">${inner}</svg>`;
const TX = (t, extra = '') => `<text x="0" y="45" fill="#ff00fe" font-size="34" font-weight="bold" ${extra}>${t}</text>`;
export const CASES2 = [
  { id: 'svg2-defs', label: 'excluded', html: (t) => S(`<defs>${TX(t)}</defs>`) },
  { id: 'svg2-symbol', label: 'excluded', html: (t) => S(`<symbol id="s1">${TX(t)}</symbol>`) },
  { id: 'svg2-mask', label: 'excluded', html: (t) => S(`<mask id="m1">${TX(t)}</mask>`) },
  { id: 'svg2-clippath', label: 'excluded', html: (t) => S(`<clipPath id="c1">${TX(t)}</clipPath>`) },
  { id: 'svg2-pattern-unused', label: 'excluded', html: (t) => S(`<pattern id="p1" width="600" height="70">${TX(t)}</pattern>`) },
  { id: 'svg2-marker-unused', label: 'excluded', html: (t) => S(`<marker id="k1">${TX(t)}</marker>`) },
  { id: 'svg2-switch-unselected', label: 'excluded', html: (t) => S(`<switch><text x="0" y="45" systemLanguage="xx-nonexistent" fill="#ff00fe" font-size="34">${t}</text><text x="0" y="45" font-size="20">fallback</text></switch>`) },
  { id: 'svg2-foreignobject-in-defs', label: 'excluded', html: (t) => S(`<defs><foreignObject width="600" height="70"><div xmlns="http://www.w3.org/1999/xhtml" style="color:#ff00fe;font:bold 34px monospace">${t}</div></foreignObject></defs>`) },
  { id: 'svg2-defs-in-shadow', label: 'excluded', html: (t) => `<div id="h"></div><script>document.getElementById('h').attachShadow({mode:'open'}).innerHTML=${JSON.stringify(S(`<defs>${TX(t)}</defs>`))}</script>` },
  { id: 'svg2-use-of-symbol', label: 'counted', html: (t) => S(`<symbol id="s2">${TX(t)}</symbol><use href="#s2"></use>`) },
  { id: 'P-svg2-visible', label: 'counted', html: (t) => S(TX(t)) },
  { id: 'details-direct-text-bold2', label: 'excluded', html: (t) => `<details style="color:#ff00fe;font:bold 34px monospace"><summary style="color:#000">s</summary>${t}</details>` },
];

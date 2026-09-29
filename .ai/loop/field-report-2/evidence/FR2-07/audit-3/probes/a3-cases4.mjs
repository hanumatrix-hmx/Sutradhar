// audit-3 follow-up: other replaced-element fallbacks and MathML.
import { T, b64 } from './a3-server.mjs';
export const CASES4 = [
  { id: 'object-loaded-fallback-text', label: 'excluded', frames: 1, html: (t, o) => `<object type="text/html" data="${o.xo}/f?b=${b64('<p>obj</p>')}" width="300" height="60">${T(t)}</object>` },
  { id: 'mathml-annotation', label: 'excluded', html: (t) => `<math><semantics><mi>x</mi><annotation encoding="text/plain">${t}</annotation></semantics></math>` },
  { id: 'svg-nested-svg-in-defs', label: 'excluded', html: (t) => `<svg width="600" height="70"><defs><svg><text x="0" y="45" fill="#ff00fe" font-size="34">${t}</text></svg></defs></svg>` },
  { id: 'xo-frame-svg-defs', label: 'excluded', frames: 1, html: (t, o) => `<iframe width="420" height="70" style="border:0" src="${o.xo}/f?b=${b64(`<svg width="400" height="60"><defs><text x="0" y="40" fill="#ff00fe" font-size="30">${t}</text></defs></svg>`)}"></iframe>` },
];

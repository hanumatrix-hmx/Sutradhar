// FR2-07 fix-2: fixture pages for the GENERATED `expect.text` live matrix (hiding mechanism x placement).
// Served by fr2-07-server.mjs under /matrix, /matrix-frame, /matrix-mid, /matrix-hang. Each case page holds one
// token (never in a script source that the product could confuse for text) placed by a PLACEMENT, hidden (or not)
// by a MECHANISM applied either to the text container / frame element ("inner") or to an ancestor ("outer").
//
// `counted` is the contract's intended verdict (see EXPECT_TEXT_CONTRACT in
// packages/browser/src/verifier/execution-verifier.ts): true = the text is RENDERED so it counts, false = it does not.
// The live harness compares the product against an INDEPENDENT observer's ground truth, and the label against the
// observer too, so a wrong label cannot hide a wrong product.

/** @typedef {{name:string, counted:boolean, text:string, frame?:string, wrap?:(inner:string)=>string, ancestorOnly?:boolean, noOuterForFrames?:boolean}} Mech */

/** @type {Mech[]} */
export const MECHS = [
  { name: 'display-none', counted: false, text: 'style="display:none"' },
  { name: 'visibility-hidden', counted: false, text: 'style="visibility:hidden"' },
  { name: 'content-visibility-hidden', counted: false, text: 'style="content-visibility:hidden"' },
  { name: 'hidden-attr', counted: false, text: 'hidden' },
  { name: 'zero-area', counted: false, text: 'style="font-size:0"', frame: 'style="width:0;height:0;border:0"', noOuterForFrames: true },
  { name: 'closed-details', counted: false, text: '', ancestorOnly: true, wrap: (inner) => `<details><summary>s</summary>${inner}</details>` },
  { name: 'opacity-0', counted: true, text: 'style="opacity:0"' },
  { name: 'aria-hidden', counted: true, text: 'aria-hidden="true"' },
  { name: 'off-screen', counted: true, text: 'style="position:absolute;left:-9999px"' },
  { name: 'clipped-0x0-box', counted: true, text: 'style="width:0;height:0;overflow:hidden"' },
];

const attrsOf = (m, kind) => (kind === 'frame' && m.frame !== undefined ? m.frame : m.text);
/** Wrap `inner` in the mechanism's ANCESTOR form. */
const outer = (m, inner, kind = 'text') => (m.wrap ? m.wrap(inner) : `<div ${attrsOf(m, kind)}>${inner}</div>`);
const js = (s) => JSON.stringify(s);
const shadowScript = (hostId, shadowHtml) =>
  `<script>document.getElementById(${js(hostId)}).attachShadow({mode:'open'}).innerHTML=${js(shadowHtml)};</script>`;

/** Placements of TEXT inside one document. Each returns `{html, frames}` (frames = child frames that must attach). */
const TEXT_PLACEMENTS = {
  'main-element': (m, where, tok) => ({
    html: where === 'inner' ? `<p ${attrsOf(m, 'text')}>${tok}</p>` : outer(m, `<section><p>${tok}</p></section>`),
    frames: 0,
  }),
  'shadow-element': (m, where, tok) => ({
    html:
      where === 'inner'
        ? `<div id="h"></div>${shadowScript('h', `<p ${attrsOf(m, 'text')}>${tok}</p>`)}`
        : outer(m, `<div id="h"></div>${shadowScript('h', `<p>${tok}</p>`)}`),
    frames: 0,
  }),
  'shadow-bare-text': (m, where, tok) => ({
    // text directly in the shadow root (no element): the audit-2 A2-4 shape
    html:
      where === 'inner'
        ? `<div id="h" ${attrsOf(m, 'text')}></div>${shadowScript('h', tok)}`
        : outer(m, `<div id="h"></div>${shadowScript('h', tok)}`),
    frames: 0,
  }),
  'slotted-element': (m, where, tok) => ({
    html:
      where === 'inner'
        ? `<div id="h"><span ${attrsOf(m, 'text')}>${tok}</span></div>${shadowScript('h', '<b>x</b><slot></slot>')}`
        : outer(m, `<div id="h"><span>${tok}</span></div>${shadowScript('h', '<b>x</b><slot></slot>')}`),
    frames: 0,
  }),
  'slotted-bare-text-in-shadow-wrapper': (m, where, tok) => ({
    // the light-DOM text node is rendered inside a wrapper that lives in the SHADOW tree
    html:
      where === 'inner'
        ? `<div id="h">${tok}</div>${shadowScript('h', `<div ${attrsOf(m, 'text')}><slot></slot></div>`)}`
        : outer(m, `<div id="h">${tok}</div>${shadowScript('h', '<div><slot></slot></div>')}`),
    frames: 0,
  }),
  'nested-shadow': (m, where, tok) => {
    const inner = `<p ${where === 'inner' ? attrsOf(m, 'text') : ''}>${tok}</p>`;
    const boot =
      `<script>var o=document.getElementById('oh').attachShadow({mode:'open'});o.innerHTML='<div id="ih"></div>';` +
      `o.getElementById('ih').attachShadow({mode:'open'}).innerHTML=${js(inner)};</script>`;
    return { html: where === 'inner' ? `<div id="oh"></div>${boot}` : outer(m, `<div id="oh"></div>${boot}`), frames: 0 };
  },
  'deep-dom': (m, where, tok) => {
    // 10050 levels (past the old 10000-level guard that FAILED OPEN) whenever the mechanism keeps the tree out of
    // layout (display:none / [hidden] on an ancestor). A VISIBLE tree that deep breaks Chrome's own
    // layout (every tool call hangs, observed live), so the rendered variants use 600 levels.
    const unrendered = where === 'outer' && ['display-none', 'hidden-attr'].includes(m.name);
    const depth = unrendered ? 10050 : 600;
    const p = `<p ${where === 'inner' ? attrsOf(m, 'text') : ''}>${tok}</p>`;
    const boot =
      `<script>(function(){var e=document.getElementById('dr');for(var i=0;i<${depth};i++){var c=document.createElement('div');e.appendChild(c);e=c;}` +
      `var h=document.createElement('div');e.appendChild(h);h.attachShadow({mode:'open'}).innerHTML=${js(p)};})();</script>`;
    return { html: where === 'inner' ? `<div id="dr"></div>${boot}` : outer(m, `<div id="dr"></div>${boot}`), frames: 0 };
  },
};

/** Placements of a document inside an <iframe> (the FRAME ELEMENT carries the mechanism, or an ancestor does). */
const frameOf = (kind, tok, xo, iattrs) => {
  if (kind === 'same-origin') return `<iframe ${iattrs} src="/matrix-frame?tok=${tok}"></iframe>`;
  if (kind === 'srcdoc') return `<iframe ${iattrs} srcdoc="<p>${tok}</p>"></iframe>`;
  if (kind === 'sandboxed') return `<iframe ${iattrs} sandbox="" srcdoc="<p>${tok}</p>"></iframe>`;
  return `<iframe ${iattrs} src="${xo}/matrix-frame?tok=${tok}"></iframe>`; // cross-origin (out-of-process)
};
const FRAME_KINDS = ['same-origin', 'srcdoc', 'sandboxed', 'cross-origin'];

/** All matrix cases: `{id, group, counted, frames, html(xo,tok), mid?(xo,tok)}`. */
export function matrixCases() {
  const out = [];
  for (const [pname, build] of Object.entries(TEXT_PLACEMENTS)) {
    for (const m of MECHS) {
      for (const where of ['inner', 'outer']) {
        if (m.ancestorOnly && where === 'inner') continue;
        out.push({ id: `${pname}|${m.name}|${where}`, group: 'text', counted: m.counted, frames: 0, html: (xo, tok) => build(m, where, tok).html });
      }
    }
    out.push({ id: `${pname}|none|-`, group: 'text', counted: true, frames: 0, html: (xo, tok) => build({ name: 'none', text: '', counted: true, wrap: (x) => x }, 'inner', tok).html, control: true });
  }
  for (const kind of FRAME_KINDS) {
    for (const m of MECHS) {
      for (const where of ['inner', 'outer']) {
        if (m.ancestorOnly && where === 'inner') continue;
        if (m.noOuterForFrames && where === 'outer') continue;
        out.push({
          id: `iframe-${kind}|${m.name}|${where}`,
          group: 'frame',
          counted: m.counted,
          frames: 1,
          html: (xo, tok) =>
            where === 'inner' ? frameOf(kind, tok, xo, attrsOf(m, 'frame')) : outer(m, frameOf(kind, tok, xo, ''), 'frame'),
        });
      }
    }
    out.push({ id: `iframe-${kind}|none|-`, group: 'frame', counted: true, frames: 1, html: (xo, tok) => frameOf(kind, tok, xo, ''), control: true });
  }
  // nested: main -> same-origin mid page -> cross-origin inner page holding the token
  for (const m of MECHS) {
    for (const on of ['outer-frame-element', 'inner-frame-element', 'ancestor-of-outer-frame-element']) {
      if (m.ancestorOnly && on !== 'ancestor-of-outer-frame-element') continue;
      if (m.noOuterForFrames && on === 'ancestor-of-outer-frame-element') continue;
      const oa = on === 'outer-frame-element' ? attrsOf(m, 'frame') : '';
      const ia = on === 'inner-frame-element' ? attrsOf(m, 'frame') : '';
      out.push({
        id: `nested-iframes|${m.name}|${on}`,
        group: 'nested',
        counted: m.counted,
        frames: 2,
        html: (xo, tok) => {
          const el = `<iframe ${oa} src="/matrix-mid?case=${encodeURIComponent(`nested-iframes|${m.name}|${on}`)}&tok=${tok}"></iframe>`;
          return on === 'ancestor-of-outer-frame-element' ? outer(m, el, 'frame') : el;
        },
        mid: (xo, tok) => `<p>mid text</p><iframe ${ia} src="${xo}/matrix-frame?tok=${tok}"></iframe>`,
      });
    }
  }
  // structural "never rendered" placements (audit-2 attack list) and controls
  const S = (id, counted, html, extra = {}) => out.push({ id: `structural|${id}`, group: 'structural', counted, frames: 0, html: (xo, tok) => html(tok), ...extra });
  S('script-only', false, (t) => `<script>var x=${js(t)};</script>`);
  S('style-only', false, (t) => `<style>/* ${t} */</style>`);
  S('template', false, (t) => `<template><p>${t}</p></template>`);
  S('noscript', false, (t) => `<noscript><p>${t}</p></noscript>`);
  S('dialog-closed', false, (t) => `<dialog><p>${t}</p></dialog>`);
  S('popover-closed', false, (t) => `<div popover>${t}</div>`);
  S('details-closed-direct-text', false, (t) => `<details>${t}<summary>s</summary></details>`);
  S('details-closed-summary-text', true, (t) => `<details><summary>${t}</summary>x</details>`);
  S('details-open', true, (t) => `<details open><summary>s</summary><p>${t}</p></details>`);
  S('unslotted-light-child', false, (t) => `<div id="h"><span>${t}</span></div>${shadowScript('h', '<b>x</b>')}`);
  S('display-contents-host', true, (t) => `<div id="h" style="display:contents"></div>${shadowScript('h', `<p>${t}</p>`)}`);
  S('svg-text', true, (t) => `<svg width="300" height="40"><text x="0" y="20">${t}</text></svg>`);
  S('svg-text-display-none', false, (t) => `<svg width="300" height="40" style="display:none"><text x="0" y="20">${t}</text></svg>`);
  S('visible-child-of-hidden-parent', true, (t) => `<div style="visibility:hidden"><span style="visibility:visible">${t}</span></div>`);
  S('hidden-child-of-visible-parent', false, (t) => `<div><span style="visibility:hidden">${t}</span></div>`);
  S('split-over-inline-siblings', true, (t) => `<p>${t.slice(0, 5)}<span>${t.slice(5)}</span></p>`);
  S('whitespace-collapse', true, (t) => `<p>${t.slice(0, 5)}      ${t.slice(5)}</p>`, { expectText: (t) => `${t.slice(0, 5)} ${t.slice(5)}` });
  S('large-dom-visible', true, (t) => `<div id="big"></div><script>(function(){var b=document.getElementById('big');var h='';for(var i=0;i<100000;i++)h+='<span>w</span>';b.innerHTML=h;})();</script><p>${t}</p>`);
  S('many-hidden-matches', false, (t) => `<div id="big" style="display:none"></div><script>(function(){var b=document.getElementById('big');for(var i=0;i<3000;i++){var h=document.createElement('div');b.appendChild(h);h.attachShadow({mode:'open'}).innerHTML=${js(`<p>${t}</p>`)};}})();</script>`);
  return out;
}

/** Page shell shared by every case: five click targets (rotated so the engine's duplicate-click guard never trips). */
export const shell = (body, tok) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>fr2-07 matrix</title></head><body>` +
  `<button id="go-${tok}">go</button>` +
  `\n${body}\n<script>window.__mx=1</script></body></html>`;

/**
 * HUNG-FRAME pages (audit-2 A2-2): a main page with the token, plus `n` cross-origin frames one of which runs an
 * parked in a synchronous XHR after load (its renderer never answers an evaluate). The hung frame lives on a THIRD site
 * (`hangOrigin`, the IPv6 loopback) so it owns its renderer process: same-site frames share one main thread, which would
 * hang the healthy ones too. `tokIn` = which frame index carries the token
 * ('main' or a number), so both "found in main while one hangs" and "absent everywhere while one hangs" are covered.
 */
export function hungPage(xo, tok, { n = 8, hungIndex = 3, tokIn = 'main', hangOrigin = xo } = {}) {
  let frames = '';
  for (let i = 0; i < n; i++) {
    frames +=
      i === hungIndex
        ? `<iframe src="${hangOrigin}/matrix-hang"></iframe>`
        : `<iframe src="${xo}/matrix-frame?tok=${tokIn === i ? tok : `other-frame-${i}`}"></iframe>`;
  }
  return shell(`<p>${tokIn === 'main' ? tok : 'main text without the token'}</p>${frames}`, tok);
}
// The frame blocks its OWN main thread in a SYNCHRONOUS XHR whose response the server holds until the harness calls
// releaseHeld() (a busy loop would leave a stuck renderer that later same-site frames get routed into).
export const HUNG_FRAME_PAGE =
  '<!doctype html><html><body><p>this frame is about to hang</p><script>window.addEventListener("load",function(){setTimeout(function(){var x=new XMLHttpRequest();x.open("GET","/matrix-hold",false);try{x.send();}catch(e){}},30);});</script></body></html>';

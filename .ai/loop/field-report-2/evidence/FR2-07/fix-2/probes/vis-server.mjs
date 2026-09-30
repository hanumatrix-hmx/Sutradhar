// Auditor-2 fixture server: one page per visibility case. Main origin 127.0.0.1:P, cross-site origin localhost:P.
import http from 'node:http';

const b64 = (s) => Buffer.from(s).toString('base64');
// JS helper that decodes a token so the literal token never appears in any script source.
const T = (tok) => `atob('${b64(tok)}')`;
const deepNone = (tok, depth) => `<div id="dn" style="display:none"></div><script>
(function(){var e=document.getElementById('dn');for(var i=0;i<${depth};i++){var c=document.createElement('div');e.appendChild(c);e=c;}
var h=document.createElement('div');e.appendChild(h);var sr=h.attachShadow({mode:'open'});var p=document.createElement('p');p.textContent=${T(tok)};sr.appendChild(p);})();</script>`;

export function cases(xo) {
  const shadow = (hostStyle, inner) => `<div id="h" style="${hostStyle}"></div><script>(function(){var sr=document.getElementById('h').attachShadow({mode:'open'});${inner}})();</script>`;
  const sp = (tok) => `var p=document.createElement('p');p.textContent=${T(tok)};sr.appendChild(p);`;
  return [
    // [id, want ('visible'|'hidden'|'info'), htmlFn(tok), expectOverride?]
    ['ctl-plain', 'visible', (t) => `<p>${t}</p>`],
    ['disp-none', 'hidden', (t) => `<div style="display:none">${t}</div>`],
    ['vis-hidden', 'hidden', (t) => `<div style="visibility:hidden">${t}</div>`],
    ['hidden-attr', 'hidden', (t) => `<div hidden>${t}</div>`],
    ['opacity0', 'info', (t) => `<div style="opacity:0">${t}</div>`],
    ['zero-size-clip', 'info', (t) => `<div style="width:0;height:0;overflow:hidden">${t}</div>`],
    ['offscreen', 'info', (t) => `<div style="position:absolute;left:-9999px">${t}</div>`],
    ['clip-rect', 'info', (t) => `<div style="position:absolute;clip:rect(0 0 0 0)">${t}</div>`],
    ['aria-hidden', 'info', (t) => `<div aria-hidden="true">${t}</div>`],
    ['details-closed', 'hidden', (t) => `<details><summary>s</summary><p>${t}</p></details>`],
    ['details-open', 'visible', (t) => `<details open><summary>s</summary><p>${t}</p></details>`],
    ['template', 'hidden', (t) => `<template><p>${t}</p></template>`],
    ['script-only', 'hidden', (t) => `<script>var x="${t}";</script>`],
    ['style-only', 'hidden', (t) => `<style>/* ${t} */</style>`],
    ['noscript', 'hidden', (t) => `<noscript><p>${t}</p></noscript>`],
    ['content-vis-hidden', 'hidden', (t) => `<div style="content-visibility:hidden">${t}</div>`],
    ['dialog-closed', 'hidden', (t) => `<dialog><p>${t}</p></dialog>`],
    ['popover-closed', 'hidden', (t) => `<div popover>${t}</div>`],
    ['svg-text', 'visible', (t) => `<svg width="300" height="40"><text x="0" y="20">${t}</text></svg>`],
    ['svg-text-none', 'hidden', (t) => `<svg width="300" height="40" style="display:none"><text x="0" y="20">${t}</text></svg>`],
    ['input-value', 'info', (t) => `<input value="${t}">`],
    ['select-option', 'info', (t) => `<select><option>a</option><option>${t}</option></select>`],
    ['shadow-visible', 'visible', (t) => shadow('', sp(t))],
    ['shadow-host-none', 'hidden', (t) => shadow('display:none', sp(t))],
    ['shadow-host-vis-hidden', 'hidden', (t) => shadow('visibility:hidden', sp(t))],
    ['shadow-host-cv-hidden', 'hidden', (t) => shadow('content-visibility:hidden', sp(t))],
    ['shadow-direct-text', 'visible', (t) => shadow('', `sr.appendChild(document.createTextNode(${T(t)}));`)],
    ['shadow-style-child', 'hidden', (t) => shadow('', `var s=document.createElement('style');s.textContent='/* '+${T(t)}+' */';sr.appendChild(s);`)],
    ['shadow-child-none', 'hidden', (t) => shadow('', `var d=document.createElement('div');d.style.display='none';d.textContent=${T(t)};sr.appendChild(d);`)],
    ['shadow-grandchild-none', 'hidden', (t) => shadow('', `var d=document.createElement('div');var e=document.createElement('span');e.style.display='none';e.textContent=${T(t)};d.appendChild(e);sr.appendChild(d);`)],
    ['shadow-nested-inner-none', 'hidden', (t) => shadow('', `var h2=document.createElement('div');h2.style.display='none';sr.appendChild(h2);var sr2=h2.attachShadow({mode:'open'});var p=document.createElement('p');p.textContent=${T(t)};sr2.appendChild(p);`)],
    ['shadow-nested-outer-none', 'hidden', (t) => shadow('display:none', `var h2=document.createElement('div');sr.appendChild(h2);var sr2=h2.attachShadow({mode:'open'});var p=document.createElement('p');p.textContent=${T(t)};sr2.appendChild(p);`)],
    ['shadow-nested-visible', 'visible', (t) => shadow('', `var h2=document.createElement('div');sr.appendChild(h2);var sr2=h2.attachShadow({mode:'open'});var p=document.createElement('p');p.textContent=${T(t)};sr2.appendChild(p);`)],
    ['shadow-display-contents-host', 'visible', (t) => shadow('display:contents', sp(t))],
    ['shadow-in-closed-details', 'hidden', (t) => `<details><summary>s</summary>${shadow('', sp(t))}</details>`],
    ['slot-into-visible', 'visible', (t) => `<div id="h"><span>${t}</span></div><script>(function(){var sr=document.getElementById('h').attachShadow({mode:'open'});sr.innerHTML='<b>x</b><slot></slot>';})();</script>`],
    ['slot-in-hidden-wrapper', 'hidden', (t) => `<div id="h"><span>${t}</span></div><script>(function(){var sr=document.getElementById('h').attachShadow({mode:'open'});sr.innerHTML='<b>x</b><div style="display:none"><slot></slot></div>';})();</script>`],
    ['unslotted', 'hidden', (t) => `<div id="h"><span>${t}</span></div><script>(function(){var sr=document.getElementById('h').attachShadow({mode:'open'});sr.innerHTML='<b>x</b>';})();</script>`],
    ['iframe-srcdoc-visible', 'visible', (t) => `<iframe srcdoc="<p>${t}</p>"></iframe>`],
    ['iframe-srcdoc-none', 'hidden', (t) => `<iframe style="display:none" srcdoc="<p>${t}</p>"></iframe>`],
    ['iframe-srcdoc-vis-hidden', 'hidden', (t) => `<iframe style="visibility:hidden" srcdoc="<p>${t}</p>"></iframe>`],
    ['iframe-in-vis-hidden-div', 'hidden', (t) => `<div style="visibility:hidden"><iframe srcdoc="<p>${t}</p>"></iframe></div>`],
    ['iframe-in-none-div', 'hidden', (t) => `<div style="display:none"><iframe srcdoc="<p>${t}</p>"></iframe></div>`],
    ['iframe-in-closed-details', 'hidden', (t) => `<details><summary>s</summary><iframe srcdoc="<p>${t}</p>"></iframe></details>`],
    ['iframe-zero-size', 'info', (t) => `<iframe width="0" height="0" style="border:0" srcdoc="<p>${t}</p>"></iframe>`],
    ['iframe-in-shadow-of-none-host', 'hidden', (t) => shadow('display:none', `var f=document.createElement('iframe');f.srcdoc='<p>'+${T(t)}+'</p>';sr.appendChild(f);`)],
    ['iframe-sandbox-visible', 'visible', (t) => `<iframe sandbox="" srcdoc="<p>${t}</p>"></iframe>`],
    ['iframe-sandbox-none', 'hidden', (t) => `<iframe sandbox="" style="display:none" srcdoc="<p>${t}</p>"></iframe>`],
    ['iframe-sandbox-vis-hidden', 'hidden', (t) => `<iframe sandbox="" style="visibility:hidden" srcdoc="<p>${t}</p>"></iframe>`],
    ['main-visible-plus-sandbox-frames', 'visible', (t) => `<p>${t}</p><iframe sandbox="" srcdoc="<p>x</p>"></iframe><iframe sandbox="allow-same-origin" srcdoc="<p>y</p>"></iframe>`],
    ['xo-visible', 'visible', (t) => `<iframe src="${xo}/xo?t=${t}"></iframe>`],
    ['xo-none', 'hidden', (t) => `<iframe style="display:none" src="${xo}/xo?t=${t}"></iframe>`],
    ['xo-in-none-div', 'hidden', (t) => `<div style="display:none"><iframe src="${xo}/xo?t=${t}"></iframe></div>`],
    ['xo-vis-hidden', 'hidden', (t) => `<iframe style="visibility:hidden" src="${xo}/xo?t=${t}"></iframe>`],
    ['xo-in-vis-hidden-div', 'hidden', (t) => `<div style="visibility:hidden"><iframe src="${xo}/xo?t=${t}"></iframe></div>`],
    ['xo-in-closed-details', 'hidden', (t) => `<details><summary>s</summary><iframe src="${xo}/xo?t=${t}"></iframe></details>`],
    ['xo-cv-hidden-div', 'hidden', (t) => `<div style="content-visibility:hidden"><iframe src="${xo}/xo?t=${t}"></iframe></div>`],
    ['xo-zero', 'info', (t) => `<iframe width="0" height="0" style="border:0" src="${xo}/xo?t=${t}"></iframe>`],
    ['xo-offscreen', 'info', (t) => `<iframe style="position:absolute;left:-9999px" src="${xo}/xo?t=${t}"></iframe>`],
    ['xo-inner-body-none', 'hidden', (t) => `<iframe src="${xo}/xo?bodynone=1&t=${t}"></iframe>`],
    ['split-inline', 'visible', (t) => `<p>${t.slice(0, 4)}<span>${t.slice(4)}</span></p>`],
    ['split-block', 'info', (t) => `<div>${t.slice(0, 4)}</div><div>${t.slice(4)}</div>`, (t) => `${t.slice(0, 4)} ${t.slice(4)}`],
    ['case-mismatch', 'info', (t) => `<p>${t}</p>`, (t) => t.toLowerCase()],
    ['text-transform', 'info', (t) => `<p style="text-transform:lowercase">${t}</p>`],
    ['whitespace-collapse', 'visible', (t) => `<p>${t.slice(0, 4)}     ${t.slice(4)}</p>`, (t) => `${t.slice(0, 4)} ${t.slice(4)}`],
    ['deep-none-2000', 'hidden', (t) => deepNone(t, 2000)],
    ['deep-none-10050', 'hidden', (t) => deepNone(t, 10050)],
    ['large-dom-visible', 'visible', (t) => `<div id="big"></div><script>(function(){var b=document.getElementById('big');var h='';for(var i=0;i<100000;i++)h+='<span>w</span>';b.innerHTML=h;})();</script><p>${t}</p>`],
    ['many-hidden-shadow-matches', 'hidden', (t) => `<div id="big" style="display:none"></div><script>(function(){var b=document.getElementById('big');for(var i=0;i<3000;i++){var h=document.createElement('div');b.appendChild(h);var sr=h.attachShadow({mode:'open'});var p=document.createElement('p');p.textContent=${T(t)};sr.appendChild(p);}})();</script>`],
  ];
}

export async function startVisServer() {
  const ref = { xo: '' };
  const handler = (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const html = (s) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(s); };
    if (u.pathname === '/xo') {
      const t = u.searchParams.get('t') ?? '';
      const bodyStyle = u.searchParams.get('bodynone') ? ' style="display:none"' : '';
      return html('<!doctype html><html><body' + bodyStyle + '><p>' + t + '</p></body></html>');
    }
    if (u.pathname === '/case') {
      const id = u.searchParams.get('id'); const tok = u.searchParams.get('tok');
      const c = cases(ref.xo).find((x) => x[0] === id);
      if (!c) { res.writeHead(404); return res.end('nf'); }
      return html('<!doctype html><html><head><meta charset="utf-8"><title>' + id + '</title></head><body><button id="noop">noop</button>\n' + c[2](tok) + '\n<script>window.__ready=1</script></body></html>');
    }
    if (u.pathname === '/blank') return html('<!doctype html><p>blank</p>');
    res.writeHead(404); res.end('nf');
  };
  const s4 = http.createServer(handler);
  await new Promise((r) => s4.listen(0, '127.0.0.1', r));
  const port = s4.address().port;
  const s6 = http.createServer(handler);
  let has6 = true;
  await new Promise((r) => { s6.once('error', () => { has6 = false; r(); }); s6.listen(port, '::1', r); });
  ref.xo = 'http://localhost:' + port;
  return { origin: 'http://127.0.0.1:' + port, xo: ref.xo, has6, close: async () => { await new Promise((r) => s4.close(r)); if (has6) await new Promise((r) => s6.close(r)); } };
}

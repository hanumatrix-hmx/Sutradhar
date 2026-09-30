// Auditor's own fixture server (independent of the builder's fr2-07 fixtures).
import http from 'node:http';

const PAGE = (xoOrigin) => `<!doctype html><html><head><meta charset="utf-8"><title>audit</title>
<script>
window.__a = { real: 0, covered: 0, overlay: 0, xo: 0, swallowCapture: 0, ready: false };
window.addEventListener('click', function (e) {
  if (e.target && e.target.id === 'cap-swallow') { window.__a.swallowCapture++; e.stopImmediatePropagation(); }
}, true);
window.addEventListener('message', function (e) { if (e.data === 'xo-click') window.__a.xo++; });
</script></head><body style="margin:0">
<input id="txt" style="position:absolute;left:10px;top:10px">
<input id="ro" readonly value="x" style="position:absolute;left:200px;top:10px">
<input id="dis" disabled style="position:absolute;left:400px;top:10px">
<input id="resetter" style="position:absolute;left:600px;top:10px">
<div id="nofocus" style="position:absolute;left:10px;top:60px">plain div</div>
<button id="real" style="position:absolute;left:40px;top:300px;width:120px;height:40px">real</button>
<button id="covered" style="position:absolute;left:200px;top:300px;width:120px;height:40px">covered</button>
<div id="overlay" style="position:absolute;left:200px;top:300px;width:120px;height:40px;z-index:10;background:transparent"></div>
<button id="cap-swallow" style="position:absolute;left:40px;top:400px;width:120px;height:40px">swallow</button>
<button id="noop" style="position:absolute;left:200px;top:400px;width:120px;height:40px">noop</button>
<button id="trig" style="position:absolute;left:40px;top:460px">upload</button>
<button id="trig-detached" style="position:absolute;left:200px;top:460px">det</button>
<input type="file" id="f" style="display:none">
<div id="out" style="position:absolute;left:400px;top:460px"></div>
<div id="hidden-host" style="display:none"></div>
<iframe id="hid-frame" style="display:none" srcdoc="<p>IFRAME&#45;HIDDEN&#45;TEXT</p>"></iframe>
<div style="visibility:hidden;position:absolute;top:600px">VIS-HIDDEN-TEXT</div>
<div style="display:none">DISPLAY-NONE-TEXT</div>
<div style="opacity:0;position:absolute;top:620px">OPACITY-ZERO-TEXT</div>
<iframe id="xo" src="${xoOrigin}/xo.html" style="position:absolute;left:400px;top:300px;width:300px;height:120px;border:0"></iframe>
<script>
(function(){
  var A = window.__a;
  document.getElementById('real').onclick = function(){ A.real++; };
  document.getElementById('covered').onclick = function(){ A.covered++; document.getElementById('out').textContent = 'COVERED ' + 'CLICKED'; };
  document.getElementById('overlay').onclick = function(){ A.overlay++; };
  document.getElementById('trig').onclick = function(){ document.getElementById('f').click(); };
  document.getElementById('f').onchange = function(e){ var f = e.target.files[0]; document.getElementById('out').textContent = f ? f.name + ':' + f.size : ''; };
  document.getElementById('trig-detached').onclick = function(){ var i=document.createElement('input'); i.type='file'; i.onchange=function(){ window.__detGot = i.files[0] && i.files[0].name; }; i.click(); };
  document.getElementById('resetter').addEventListener('input', function(e){ e.target.value = ''; });
  var sr = document.getElementById('hidden-host').attachShadow({mode:'open'});
  var p = document.createElement('p'); p.textContent = 'SHADOW-' + 'HIDDEN-TEXT'; sr.appendChild(p);
  A.ready = true;
})();
</script></body></html>`;

const XO = `<!doctype html><html><body style="margin:0">
<button id="xb" style="position:absolute;left:10px;top:10px;width:100px;height:40px">x</button>
<input id="xin" style="position:absolute;left:150px;top:10px">
<script>window.__xb=0; document.getElementById('xb').onclick=function(){ window.__xb++; parent.postMessage('xo-click','*'); };</script>
</body></html>`;

const SPOOF = `<!doctype html><html><head><meta charset="utf-8"><script>
var __last = '';
navigator.clipboard.writeText = async function (t) { __last = t; };
navigator.clipboard.readText = async function () { return __last; };
</script></head><body><p>spoof</p></body></html>`;

const EVIL = `<!doctype html><html><head><meta charset="utf-8"><script>
var orig = navigator.clipboard.writeText.bind(navigator.clipboard);
navigator.clipboard.writeText = function (t) { return orig('EVIL-REPLACED'); };
</script></head><body><p>evil</p></body></html>`;

function handler(xoOriginRef) {
  return (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const html = (s, code = 200) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(s); };
    if (u.pathname === '/p.html') return html(PAGE(xoOriginRef.value));
    if (u.pathname === '/xo.html') return html(XO);
    if (u.pathname === '/spoof.html') return html(SPOOF);
    if (u.pathname === '/evil.html') return html(EVIL);
    if (u.pathname === '/a') return html('<h1>A</h1><a id="toB" href="/b">b</a>');
    if (u.pathname === '/b') return html('<h1>B</h1>');
    if (u.pathname === '/redirect') { res.writeHead(302, { Location: '/a?from=redirect', 'Cache-Control': 'no-store' }); return res.end(); }
    if (u.pathname.startsWith('/status/')) {
      const code = Number(u.pathname.split('/')[2]);
      if (code === 204) { res.writeHead(204, { 'Cache-Control': 'no-store' }); return res.end(); }
      return html(`<h1>status ${code}</h1>`, code);
    }
    if (u.pathname === '/dlpage') {
      return html(`<a id="dl" href="/dl?size=4321&n=${u.searchParams.get('n') ?? ''}">dl</a> <a id="dl0" href="/dl?size=0&n=${u.searchParams.get('n') ?? ''}">dl0</a>`);
    }
    if (u.pathname === '/dl') {
      const size = Number(u.searchParams.get('size') ?? '0');
      const name = `audit-${size}-${u.searchParams.get('n') ?? ''}.bin`;
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size), 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
      return res.end(Buffer.alloc(size, 0x41));
    }
    res.writeHead(404); res.end('nf');
  };
}

export async function startAuditServer() {
  const ref = { value: '' };
  const s4 = http.createServer(handler(ref));
  await new Promise((r) => s4.listen(0, '127.0.0.1', r));
  const port = s4.address().port;
  const s6 = http.createServer(handler(ref));
  let has6 = true;
  await new Promise((r) => { s6.once('error', () => { has6 = false; r(); }); s6.listen(port, '::1', r); });
  const origin = `http://127.0.0.1:${port}`;
  ref.value = `http://localhost:${port}`;
  return {
    origin, xoOrigin: ref.value, port,
    close: async () => { await new Promise((r) => s4.close(r)); if (has6) await new Promise((r) => s6.close(r)); },
  };
}

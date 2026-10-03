// AUDIT-2 observer: HTTP server recording every request (Host header) + page self-reports (beacons), and the
// sha256 of every file it serves. Plus chrome.exe PID lookup by a command-line marker (my scratch path).
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
export async function observer() {
  const hits = []; const served = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://h');
    const tag = u.searchParams.get('t') || '';
    hits.push({ host: (req.headers.host || '').split(':')[0], path: u.pathname, tag, k: u.searchParams.get('k'), v: u.searchParams.get('v') });
    if (u.pathname === '/page') {
      const T = JSON.stringify(tag);
      const body = '<!doctype html><title>' + tag + '</title><a id="dl" href="/file?t=' + encodeURIComponent(tag) + '">d</a><input id="up" type="file"><button id="pq">q</button>' +
        '<script>const T=' + T + ';const s=(k,v)=>{new Image().src="/s?t="+encodeURIComponent(T)+"&k="+k+"&v="+encodeURIComponent(v)+"&n="+Math.random()};' +
        's("vp",innerWidth+"x"+innerHeight);document.getElementById("up").onchange=e=>{const f=e.target.files[0];s("up",f?f.name:"none")};' +
        'document.getElementById("pq").onclick=()=>{const r=prompt("Q","");s("pq",r===null?"NULL":r)};</script>';
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); res.end(body); return;
    }
    if (u.pathname === '/file') {
      const b = crypto.randomBytes(2048); served.push({ tag, sha: crypto.createHash('sha256').update(b).digest('hex') });
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="a2-' + tag.replace(/[^A-Za-z0-9_-]/g, '_') + '.bin"', 'content-length': b.length });
      res.end(b); return;
    }
    res.writeHead(204); res.end();
  });
  await new Promise((r) => srv.listen(0, '0.0.0.0', r));
  const port = srv.address().port;
  return {
    port, hits, served,
    url: (host, tag) => 'http://' + host + ':' + port + '/page?t=' + encodeURIComponent(tag),
    reached: (tag) => hits.filter((h) => h.path === '/page' && h.tag === tag).map((h) => h.host),
    sig: (tag, k) => hits.filter((h) => h.path === '/s' && h.tag === tag && h.k === k).map((h) => h.v),
    close: () => new Promise((r) => srv.close(r)),
  };
}
const Q = String.fromCharCode(39);
export function chromePids(marker) {
  const m = marker.split(Q).join(Q + Q);
  const ps = 'Get-CimInstance Win32_Process -Filter "Name=' + Q + 'chrome.exe' + Q + '" | Where-Object { $_.CommandLine -like ' + Q + '*' + m + '*' + Q + ' } | ForEach-Object { $_.ProcessId }';
  return new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 60000 }, (e, so) => resolve(e ? null : so.split(/[^0-9]+/).filter(Boolean).map(Number))));
}
export const until = async (fn, ms, step = 150) => { const end = performance.now() + ms; for (;;) { const v = await fn(); if (v !== undefined && v !== false) return v; if (performance.now() > end) return undefined; await new Promise((r) => setTimeout(r, step)); } };

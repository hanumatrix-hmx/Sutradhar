// AUDIT-1 independent observer: an HTTP server that logs every request (with Host header) and every
// beacon the PAGE sends about itself (innerWidth/innerHeight, upload result, prompt() result), plus
// every file it served (sha256). Nothing here trusts the tool's own report.
import http from 'node:http';
import crypto from 'node:crypto';
export async function startObserver() {
  const log = []; const served = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const c = u.searchParams.get('c') || '';
    log.push({ t: Date.now(), host: req.headers.host, path: u.pathname, c, q: Object.fromEntries(u.searchParams) });
    if (u.pathname === '/p') {
      const html = '<!doctype html><title>a1 ' + c + '</title><body>' +
        '<a id="dl" href="/f?c=' + encodeURIComponent(c) + '">dl</a>' +
        '<input type="file" id="f"><button id="pr">p</button><div id="o"></div>' +
        '<script>var C=' + JSON.stringify(c) + ';function b(k,v){var i=new Image();i.src="/b?c="+encodeURIComponent(C)+"&k="+k+"&v="+encodeURIComponent(v)+"&r="+Math.random();}' +
        'b("vp",innerWidth+"x"+innerHeight);' +
        'document.getElementById("f").onchange=function(e){var f=e.target.files[0];b("up",f?f.name+":"+f.size:"none");};' +
        'document.getElementById("pr").onclick=function(){var r=prompt("q"+C,"");b("prompt",r===null?"<null>":r);};' +
        '</script></body>';
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); res.end(html); return;
    }
    if (u.pathname === '/f') {
      const body = crypto.randomBytes(4096);
      served.push({ c, sha256: crypto.createHash('sha256').update(body).digest('hex') });
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="a1-' + c.replace(/[^A-Za-z0-9_.-]/g, '_') + '.bin"', 'content-length': body.length, 'cache-control': 'no-store' });
      res.end(body); return;
    }
    res.writeHead(204); res.end();
  });
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  const beacons = (c, k) => log.filter((e) => e.path === '/b' && e.c === c && (!k || e.q.k === k)).map((e) => e.q.v);
  const pageHits = (c) => log.filter((e) => e.path === '/p' && e.c === c).map((e) => e.host.split(':')[0]);
  return { port, log, served, beacons, pageHits, close: () => new Promise((r) => srv.close(r)) };
}

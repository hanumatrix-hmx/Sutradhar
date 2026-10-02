// Fixture HTTP server for the FR2-14 (.sutradhar.json) live-verify. It is the INDEPENDENT observer
// for what a page really did: it records every request (`hits`) and every download it served
// (`served`, with sha256), and the page itself reports back what it saw (its own innerWidth, the
// result of a confirm(), the file it was given by an upload) in query strings, so no assertion has
// to trust the CLI/MCP/SDK's own reading of the page.
//
// listen(0) with NO host: dual-stack, reachable as both `localhost` and `127.0.0.1` (preflight L0
// proves this), which lets allowedDomains be tested with a real, reachable "other" host.
import http from 'node:http';
import crypto from 'node:crypto';

export async function startConfigServer() {
  const served = [];
  const hits = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const n = url.searchParams.get('n') ?? '0';
    hits.push({ path: url.pathname, n, host: req.headers.host, q: Object.fromEntries(url.searchParams) });

    if (url.pathname === '/page') {
      const html =
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>fr2-14 ${n}</title></head><body>` +
        `<a id="dl" href="/file?n=${encodeURIComponent(n)}">download</a>` +
        `<input type="file" id="f"><div id="out"></div><div id="log"></div>` +
        `<button id="confirm">confirm</button>` +
        `<script>` +
        `var N=${JSON.stringify(n)};` +
        `function rep(q){try{fetch('/hit?n='+encodeURIComponent(N)+'&'+q,{keepalive:true});}catch(e){}}` +
        `rep('w='+innerWidth+'&h='+innerHeight);` +
        `document.getElementById('f').addEventListener('change',function(e){var f=e.target.files[0];` +
        `var s=f?(f.name+':'+f.size):'';document.getElementById('out').textContent=s;rep('up='+encodeURIComponent(s));});` +
        `document.getElementById('confirm').addEventListener('click',function(){var r=confirm('fr2-14 '+N);` +
        `localStorage.setItem('fr2-14:'+N,String(r));document.getElementById('log').textContent=String(r);rep('confirm='+r);});` +
        `</script></body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
    if (url.pathname === '/file') {
      const body = Buffer.concat([Buffer.from(`fr2-14 n=${n}\n`), crypto.randomBytes(65536)]);
      served.push({ n, size: body.length, sha256: crypto.createHash('sha256').update(body).digest('hex'), name: `fr2-14-${n}.bin` });
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(body.length),
        'Content-Disposition': `attachment; filename="fr2-14-${n}.bin"`,
        'Cache-Control': 'no-store',
      });
      res.end(body);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' }); // /hit and anything else
    res.end('ok');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => resolve(undefined));
  });
  const port = server.address().port;
  return {
    port,
    url: (host, n) => `http://${host}:${port}/page?n=${encodeURIComponent(n)}`,
    served,
    hits,
    close: () => new Promise((r) => server.close(() => r(undefined))),
  };
}

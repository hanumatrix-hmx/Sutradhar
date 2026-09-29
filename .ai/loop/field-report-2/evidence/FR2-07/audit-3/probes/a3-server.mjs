// audit-3 probe server (independent of the builder's fixtures). Listens on 127.0.0.1:P and [::1]:P.
// Main origin http://127.0.0.1:P ; cross-origin http://localhost:P (a different site -> OOPIF).
import http from 'node:http';
export const T = (tok) => `<span class="t" style="font:bold 34px monospace;color:#ff00fe">${tok}</span>`;
export const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
export async function startServer(cases) {
  let port = 0;
  const h = (req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (body) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); };
    if (u.pathname === '/f') {
      const body = Buffer.from(u.searchParams.get('b') || '', 'base64url').toString('utf8');
      return send(`<!doctype html><html><head><meta charset=utf-8><style>body{margin:0;background:#fff}</style></head><body>${body}</body></html>`);
    }
    if (u.pathname === '/case') {
      const c = cases.get(u.searchParams.get('id'));
      const tok = u.searchParams.get('tok');
      if (!c) { res.writeHead(404); return res.end('no case'); }
      const o = { xo: `http://localhost:${port}`, so: `http://127.0.0.1:${port}` };
      const body = c.html(tok, o);
      return send(`<!doctype html><html><head><meta charset=utf-8><title>a3 ${c.id}</title><style>body{margin:0;background:#fff;font:14px sans-serif}</style></head><body><button id="go" style="position:fixed;right:4px;bottom:4px" ${c.onclick ? `onclick="${c.onclick}"` : ''}>go</button>${body}<script>window.__a3ready=1</script></body></html>`);
    }
    res.writeHead(404); res.end('nf');
  };
  const s1 = http.createServer(h);
  await new Promise((r) => s1.listen(0, '127.0.0.1', r));
  port = s1.address().port;
  const s2 = http.createServer(h);
  await new Promise((r) => s2.listen(port, '::1', r)).catch(() => {});
  return { port, origin: `http://127.0.0.1:${port}`, close: () => { s1.close(); s2.close(); } };
}

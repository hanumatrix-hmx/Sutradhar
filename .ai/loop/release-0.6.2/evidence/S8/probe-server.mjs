// S8 auditor probe fixture (own, product-independent). Two HTTP servers on 127.0.0.1 (A = main, B = second origin).
// Prints one JSON line {a, b} on stdout; reads "quit" on stdin.
import http from 'node:http';
const html = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
const LINE = (i) => `G${String(i).padStart(6, '0')} abcdefghijklmnopqrstuvwxyz0123`;
let A, B;
const handler = (which) => (req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (s) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(s); };
  const p = u.pathname;
  if (p === '/child') return send(html('child', `<p>child ${which}</p><button id="inner-btn" onclick="window.__c=(window.__c||0)+1">Inner</button>`));
  if (p === '/xo') {
    // k iframes navigated every ms between two origins (B on 127.0.0.1 and B via localhost = cross-site)
    const k = Number(u.searchParams.get('k') ?? 4), ms = Number(u.searchParams.get('ms') ?? 40);
    return send(html('xo', `<h1>XO churn</h1><button id="b1">B1</button><div id="fr"></div><script>
      const srcs = ['http://127.0.0.1:${B.port}/child?x', 'http://localhost:${B.port}/child?y', 'http://127.0.0.1:${A.port}/child?z'];
      window.__navs = 0; const fr = [];
      for (let i = 0; i < ${k}; i++) { const f = document.createElement('iframe'); f.src = srcs[i % 3]; document.getElementById('fr').appendChild(f); fr.push(f); }
      let t = 0; setInterval(() => { t++; fr.forEach((f, i) => { f.src = srcs[(t + i) % 3] + '&t=' + t; window.__navs++; }); }, ${ms});
    </script>`));
  }
  if (p === '/selfnav') {
    // the main frame navigates itself (same origin) every ms; 3 child iframes detach on every navigation
    const ms = Number(u.searchParams.get('ms') ?? 250); const n = Number(u.searchParams.get('n') ?? 0);
    return send(html('selfnav', `<h1>selfnav ${n}</h1><button id="go" onclick="window.__go=1">Go</button>
      <iframe src="/child?a"></iframe><iframe src="/child?b"></iframe><iframe src="/child?c"></iframe>
      <script>setTimeout(() => location.replace('/selfnav?ms=${ms}&n=${n + 1}'), ${ms});</script>`));
  }
  if (p === '/grow') {
    const start = Number(u.searchParams.get('start') ?? 600), add = Number(u.searchParams.get('add') ?? 400), ms = Number(u.searchParams.get('ms') ?? 30);
    let body = ''; for (let i = 0; i < start; i++) body += `<div>${LINE(i)}</div>`;
    return send(html('grow', `<div id="g">${body}</div><script>
      const L = ${LINE.toString()}; let i = ${start}; window.__done = false;
      const t = setInterval(() => { const d = document.createElement('div'); d.textContent = L(i++); document.getElementById('g').appendChild(d); if (i >= ${start + add}) { clearInterval(t); window.__done = true; } }, ${ms});
    </script>`));
  }
  if (p === '/plain') return send(html('plain', `<h1>plain</h1><p>history hash probe</p>`));
  if (p === '/ids') return send(html('ids', `<button id="hv" onmouseover="window.__hover=(window.__hover||0)+1">Hover me</button>
      <select id="sel"><option value="a">A</option><option value="b">B</option></select><input id="inp" placeholder="Inp">`));
  res.writeHead(404); res.end('nf');
};
A = await new Promise((r) => { const s = http.createServer(handler('A')).listen(0, '127.0.0.1', () => r({ s, port: s.address().port })); });
B = await new Promise((r) => { const s = http.createServer(handler('B')).listen(0, '127.0.0.1', () => r({ s, port: s.address().port })); });
process.stdout.write(JSON.stringify({ a: `http://127.0.0.1:${A.port}`, b: `http://127.0.0.1:${B.port}` }) + '\n');
process.stdin.on('data', (d) => { if (String(d).includes('quit')) { A.s.close(); B.s.close(); process.exit(0); } });

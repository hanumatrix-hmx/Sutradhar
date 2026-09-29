import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import { makeRoot, makeCli, readState, puppeteer, delay, cleanupRoot, pageTargets } from './lib.mjs';

const USE_GUARD = process.argv[2] === 'guard';
const violations = [];
function guard(session) {
  const send = session.send.bind(session);
  session.send = (method, ...rest) => {
    if (method !== 'Runtime.evaluate' && method !== 'Target.getTargetInfo') {
      violations.push(method);
      return Promise.reject(new Error(`observer guard: refused to send ${method}`));
    }
    return send(method, ...rest);
  };
  return session;
}

const root = await makeRoot('g230dbg3');
const cli = makeCli(root);
const popupServer = http.createServer((req, res) => {
  const n = new URL(req.url, 'http://x').searchParams.get('n') ?? 'none';
  res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  res.end(`<!doctype html><title>pop</title><script>alert('gap230-${n}')</script>pop`);
});
await new Promise((r) => popupServer.listen(0, '127.0.0.1', r));
const popupBase = `http://127.0.0.1:${popupServer.address().port}/?n=`;

const server = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end('<title>opener</title>opener'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const cd = path.join(root.R, 'st');
try {
  const n = 'dbg3';
  await cli(['nav', `${BASE}?n=${n}`], cd);
  const st = await readState(cd);
  const b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
  const opener = pageTargets(b).find((x) => x.url().includes(n));
  let os_ = await opener.createCDPSession();
  if (USE_GUARD) os_ = guard(os_);
  await os_.send('Runtime.evaluate', { expression: `void window.open('${popupBase}${n}')`, userGesture: true }).catch((e) => console.log('evaluate err', e.message));
  await delay(800);
  const acc = await cli(['dialog', 'accept'], cd, { capMs: 20000 });
  console.log('accept', acc.code, acc.ms, acc.stdout.trim());
  const tabs = await cli(['tabs'], cd, { capMs: 15000 });
  console.log('tabs', tabs.code, tabs.ms, tabs.killedAtCap, tabs.stdout.trim(), tabs.stderr.trim().slice(0, 200));
  console.log('violations', violations);
  await os_.detach().catch((e) => console.log('detach err', e.message));
  await b.disconnect().catch((e) => console.log('disconnect err', e.message));
  await cli(['close'], cd, { capMs: 15000 });
} finally {
  server.close(); popupServer.close();
  const lo = await cleanupRoot(root, cli, [cd]);
  console.log('leftovers', JSON.stringify(lo));
}

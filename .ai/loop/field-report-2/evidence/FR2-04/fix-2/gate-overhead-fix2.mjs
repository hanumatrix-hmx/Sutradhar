// FR2-04 audit-2: per-command latency of the BUILT CLI, run once against HEAD's dist and once
// against HEAD~1's dist (pre-FR2-04 code; HEAD~1 = 369cfee only adds audit-1 evidence). Same
// machine, same page, established session, sequential commands, warmups discarded.
// Usage: node gate-overhead.mjs <label> [iterations]
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import { makeRoot, makeCli, cleanupRoot, here, delay } from './lib.mjs';

const LABEL = process.argv[2] ?? 'head';
const N = Number(process.argv[3] ?? 15);
const root = await makeRoot('ovh-' + LABEL);
const cli = makeCli(root);
const server = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end('<!doctype html><title>ovh</title><h1>overhead</h1><button id=b>b</button><a href=#x>x</a>'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;
const stats = (a) => { const s = [...a].sort((x, y) => x - y); return { median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], min: s[0], max: s[s.length - 1], all: a }; };
const dirs = []; const out = { label: LABEL, at: new Date().toISOString(), n: N };
try {
  const d = path.join(root.R, 'st'); dirs.push(d);
  const t0 = Date.now(); const first = await cli(['nav', URL_], d); out.firstNavMs = Date.now() - t0; out.firstNavCode = first.code;
  for (const [name, args] of [['snap', ['snap']], ['eval', ['eval', '1']], ['tabs', ['tabs']], ['click', ['click', '#b']]]) {
    for (let w = 0; w < 2; w++) await cli(args, d);
    const times = []; const codes = [];
    for (let i = 0; i < N; i++) { const r = await cli(args, d); times.push(r.ms); codes.push(r.code); }
    out[name] = { ...stats(times), codes: [...new Set(codes)] };
    console.log(LABEL, name, JSON.stringify({ median: out[name].median, p90: out[name].p90, codes: out[name].codes }));
  }
  // 6 open tabs (5 extra) — the gate lists every target
  for (let i = 0; i < 5; i++) await cli(['newtab', URL_ + '?t=' + i], d);
  for (let w = 0; w < 2; w++) await cli(['snap'], d);
  const times = []; for (let i = 0; i < N; i++) times.push((await cli(['snap'], d)).ms);
  out.snap6tabs = stats(times);
  console.log(LABEL, 'snap6tabs', JSON.stringify({ median: out.snap6tabs.median, p90: out.snap6tabs.p90 }));
} finally {
  server.close();
  out.leftovers = await cleanupRoot(root, cli, dirs);
  await fs.writeFile(path.join(here, `gate-overhead-${LABEL}.json`), JSON.stringify(out, null, 2));
  process.exit(0);
}

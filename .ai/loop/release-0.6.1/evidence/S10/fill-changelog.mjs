// Fills the S10 template from evidence files (no version typed by hand) and inserts it under [Unreleased].
// Usage (from the worktree root): node .ai/loop/release-0.6.1/evidence/S10/fill-changelog.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const EV = '.ai/loop/release-0.6.1/evidence';
const moved = readFileSync(`${EV}/S3a/moved-keys.txt`, 'utf-8').split(/\r?\n/);
// A moved-keys line looks like:  +  '@hono/node-server@2.1.3(hono@4.13.12)':   or   -  fast-uri@3.1.5: {}
const pick = (sign, name) => {
  const vs = new Set();
  for (const line of moved) {
    if (line[0] !== sign) continue;
    const key = line.slice(1).trim().replace(/^'/, '');
    if (!key.startsWith(`${name}@`)) continue;
    vs.add(key.slice(name.length + 1).split(/[:'(]/)[0]);
  }
  if (vs.size !== 1) throw new Error(`${sign} ${name}: expected exactly 1 version, got ${JSON.stringify([...vs])}`);
  return [...vs][0];
};
const nv = (name) => `${pick('+', name)} (was ${pick('-', name)})`;
const dist = readFileSync(`${EV}/S3a/dist-fast-uri.txt`, 'utf-8').match(/fast-uri@([0-9][^\s/]*)/)[1];
if (dist !== pick('+', 'fast-uri')) throw new Error(`dist fast-uri ${dist} != lockfile ${pick('+', 'fast-uri')}`);
const vals = {
  FAST_URI: `${dist} (was ${pick('-', 'fast-uri')})`,
  QS: nv('qs'),
  HONO: nv('hono'),
  HONO_NODE: nv('@hono/node-server'),
  IP_ADDRESS: nv('ip-address'),
  // S7 README "Measured timings": p50 of the whole close = 1092 ms; sweep 0 ms when nothing to sweep, ~0.5 s with a stale-named candidate.
  CLOSE_P50: 'about 1.1 s',
  SWEEP_P50: 'typically under a millisecond when there is nothing to sweep, about half a second when a stale temp dir exists',
};
let t = readFileSync(`${EV}/S10/template.txt`, 'utf-8').replace(/\r\n/g, '\n').replace(/\n+$/, '\n');
for (const [k, v] of Object.entries(vals)) t = t.split(`<${k}>`).join(v);
const file = 'docs/22-changelog.md';
const raw = readFileSync(file, 'utf-8');
const crlf = raw.includes('\r\n');
let s = raw.replace(/\r\n/g, '\n');
const anchor = '## [Unreleased]\n\nNothing yet.\n\n## [0.6.0] - 2026-10-03';
if (!s.includes(anchor)) throw new Error('anchor not found');
s = s.replace(anchor, `## [Unreleased]\n\nNothing yet.\n\n${t}\n## [0.6.0] - 2026-10-03`);
writeFileSync(file, crlf ? s.replace(/\n/g, '\r\n') : s);
console.log(JSON.stringify(vals, null, 2), 'crlf=' + crlf);

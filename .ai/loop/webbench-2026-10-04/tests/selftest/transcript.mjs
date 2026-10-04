#!/usr/bin/env node
// Offline test for transcript-check.mjs (review-3 finding 8): an honest transcript/log pair passes; a log record the
// transcript never produced (T3), a direct cli-bin.js call (T1), and a WebFetch use (T2) are each flagged.
//   node tests/selftest/transcript.mjs [workDir]
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { genesis, hashRecord } from '../../lib.mjs';

const LOOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const work = process.argv[2] ?? path.join(os.tmpdir(), `wb-transcript-${process.pid}`);
rmSync(work, { recursive: true, force: true });
const SLOT = 'B1'; const ID = '1172';
function chain(steps) {
  let prev = genesis(SLOT, ID);
  return steps.map((s, i) => { const base = { seq: i + 1, ts: 't', slot: SLOT, taskId: ID, attempt: 'a1', exit: 0, stdout: '', stderr: '', ...s, prevHash: prev }; const r = { ...base, hash: hashRecord(base) }; prev = r.hash; return r; });
}
const steps = [
  { kind: 'cli', verb: 'nav', argv: ['nav', 'https://msu.edu', '--settle'] }, { kind: 'auto-href', verb: 'auto-href', forSeq: 1, argv: [] },
  { kind: 'cli', verb: 'text', argv: ['text'], stdout: 'Tutoring Center, Counseling and Psychiatric Services' }, { kind: 'auto-href', verb: 'auto-href', forSeq: 3, argv: [] },
  { kind: 'cli', verb: 'close', argv: ['close'] }, { kind: 'check-clean', verb: '--check-clean', argv: ['--check-clean'] },
];
const tu = (id, command) => JSON.stringify({ message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
const tr = (id, content) => JSON.stringify({ message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const D = `node "${LOOP}/drive.mjs" ${SLOT} ${ID} a1`;
const honest = [tu('u1', `${D} nav "https://msu.edu" --settle`), tr('u1', 'Navigated\n[drive.mjs] logged B1/1172 a1 seq 1 exit 0'),
  tu('u2', `${D} text`), tr('u2', 'Tutoring...\n[drive.mjs] logged B1/1172 a1 seq 3 exit 0'),
  tu('u3', `${D} close`), tr('u3', 'Session closed.\n[drive.mjs] logged B1/1172 a1 seq 5 exit 0'),
  tu('u4', `${D} --check-clean`), tr('u4', '{"clean":true}')];
const cases = [
  { name: 'honest', lines: honest, steps, expect: null },
  { name: 'forged-extra-log-record', lines: honest, steps: [...steps.slice(0, 4), { kind: 'cli', verb: 'text', argv: ['text'], stdout: 'Zylophone' }, { kind: 'auto-href', verb: 'auto-href', forSeq: 5, argv: [] }, ...steps.slice(4)], expect: 'T3' },
  { name: 'forged-direct-cli', lines: [...honest, tu('u9', 'node E:/x/v061/inst/node_modules/sutradhar/dist/cli-bin.js text'), tr('u9', 'page')], steps, expect: 'T1' },
  { name: 'forged-webfetch', lines: [...honest, JSON.stringify({ message: { content: [{ type: 'tool_use', id: 'w1', name: 'WebFetch', input: { url: 'https://msu.edu' } }] } })], steps, expect: 'T2' },
];
let ok = true;
for (const c of cases) {
  const dir = path.join(work, c.name);
  mkdirSync(path.join(dir, 'runs', SLOT, 'raw'), { recursive: true });
  writeFileSync(path.join(dir, 'runs', SLOT, 'raw', `${ID}.jsonl`), chain(c.steps).map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(path.join(dir, 'agent.jsonl'), c.lines.join('\n') + '\n');
  const r = spawnSync(process.execPath, [path.join(LOOP, 'transcript-check.mjs'), path.join(dir, 'agent.jsonl'), path.join(dir, 'runs'), SLOT], { encoding: 'utf8' });
  const pass = c.expect === null ? r.status === 0 : r.status === 1 && r.stdout.includes(`FLAG ${c.expect}`);
  if (!pass) ok = false;
  console.log(`${pass ? 'ok  ' : 'BAD '} ${c.name.padEnd(26)} expect=${c.expect ?? 'OK'} :: ${r.stdout.trim().split('\n').filter((l) => l.startsWith('FLAG') || l.startsWith('TRANSCRIPT')).join(' | ')}`);
}
console.log(ok ? 'TRANSCRIPT SELFTEST OK' : 'TRANSCRIPT SELFTEST FAILED');
process.exit(ok ? 0 : 1);

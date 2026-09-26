// FR2-04 audit-3, point 7: WHERE does the per-command overhead go? Runs `snap` with a temporary,
// instrumented COPY of dist/cli.js (next to it, deleted in finally; dist/cli.js sha verified
// unchanged) that writes performance.now() marks (ms since process start) to stderr at each phase.
// Anchors are single lines (dist/cli.js has mixed CRLF/LF line endings).
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { makeRoot, makeCli, cleanupRoot, here, repoRoot } from './lib.mjs';

const N = Number(process.argv[2] ?? 12);
const DIST = path.join(repoRoot, 'packages/cli/dist');
const ORIG = path.join(DIST, 'cli.js');
const COPY = path.join(DIST, 'cli.audit3-timing.js');
const sha = async (f) => crypto.createHash('sha256').update(await fs.readFile(f)).digest('hex');
const shaBefore = await sha(ORIG);
let src = await fs.readFile(ORIG, 'utf-8');
const mark = (name) => `process.stderr.write('AUDIT3MARK ${name} ' + performance.now().toFixed(1) + '\\n');`;
const GATE = "            const result = await runDialogGate(verb, broker, policy, 'command');";
const RACE = "    if (raced.kind === 'dialog') {";
const RET = '    return raced.value;';
const FEND = '        setTimeout(() => process.exit(process.exitCode ?? 0), 3000).unref();';
const ENS = '        await ensureWarden({ stateDir: STATE_DIR, wsEndpoint: nowState.wsEndpoint }).catch(() => undefined);';
const edits = [
  ['async function main() {', 'async function main() {' + mark('main-start')],
  [GATE, mark('gate-start') + GATE + mark('gate-end')],
  ['            activeSessionId = sid;', '            activeSessionId = sid;' + mark('reattach-end')],
  [ENS, mark('ensure-start') + ENS + mark('ensure-end')],
  ['    const raced = await raceWithDialog(work,', mark('fn-start') + '    const raced = await raceWithDialog(work,'],
  [RACE, mark('race-done') + RACE],
  [RET, mark('reported') + RET],
  ['        .finally(async () => {', '        .finally(async () => {' + mark('finally-start')],
  [FEND, mark('finally-end') + FEND],
];
const missing = [];
for (const [a, b] of edits) { if (src.split(a).length !== 2) missing.push(a.slice(0, 60)); else src = src.replace(a, () => b); }
const nl = src.indexOf('\n') + 1; // keep the shebang first
src = src.slice(0, nl) + "process.on('exit', () => { process.stderr.write('AUDIT3MARK exit ' + performance.now().toFixed(1) + '\\n'); });\n" + src.slice(nl);
await fs.writeFile(COPY, src);
const root = await makeRoot('phase');
const cliCopy = makeCli(root, COPY);
const cliOrig = makeCli(root, ORIG);
const server = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end('<title>go</title><body>go <button id="b">b</button></body>'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;
const d = path.join(root.R, 'st');
const out = { shaBefore, missingAnchors: missing, runs: [] };
try {
  await cliOrig(['nav', URL_], d);
  const warm = await cliCopy(['snap'], d);
  out.warm = { code: warm.code, ms: warm.ms, err: warm.stderr.slice(0, 400) };
  for (let i = 0; i < N; i++) {
    const r = await cliCopy(['snap'], d);
    const marks = Object.fromEntries([...r.stderr.matchAll(/AUDIT3MARK (\S+) ([\d.]+)/g)].map((m) => [m[1], Number(m[2])]));
    out.runs.push({ wallMs: r.ms, code: r.code, marks });
  }
  const keys = ['main-start', 'gate-start', 'gate-end', 'reattach-end', 'ensure-start', 'ensure-end', 'fn-start', 'race-done', 'reported', 'finally-start', 'finally-end', 'exit'];
  const med = (a) => { const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  out.medianMarks = Object.fromEntries(keys.map((k) => [k, med(out.runs.map((r) => r.marks[k]))]));
  const ph = (a, b) => med(out.runs.map((r) => r.marks[b] - r.marks[a]));
  out.medianPhases = {
    'process start -> main (module load)': med(out.runs.map((r) => r.marks['main-start'])),
    'main -> gate start (readState etc.)': ph('main-start', 'gate-start'),
    'gate (getBroker health + warden list)': ph('gate-start', 'gate-end'),
    'reattach (runtime.attach etc.)': ph('gate-end', 'reattach-end'),
    'afterAttach incl. ensureWarden': ph('reattach-end', 'fn-start'),
    '  of which ensureWarden': ph('ensure-start', 'ensure-end'),
    'command body until race resolves': ph('fn-start', 'race-done'),
    'reportDialogs': ph('race-done', 'reported'),
    'reported -> finally start': ph('reported', 'finally-start'),
    'finally (disconnect)': ph('finally-start', 'finally-end'),
    'finally end -> process exit (event-loop linger)': ph('finally-end', 'exit'),
    'process start -> exit event': med(out.runs.map((r) => r.marks.exit)),
    wallMedian: med(out.runs.map((r) => r.wallMs)),
  };
  console.log(JSON.stringify({ missing, warm: out.warm.code, phases: out.medianPhases }, null, 1));
} finally {
  server.close();
  out.leftovers = await cleanupRoot(root, cliOrig, [d]);
  await fs.rm(COPY, { force: true });
  out.shaAfter = await sha(ORIG);
  out.distUntouched = out.shaAfter === shaBefore;
  out.copyRemoved = !(await fs.stat(COPY).catch(() => null));
  await fs.writeFile(path.join(here, 'phase-timing.json'), JSON.stringify(out, null, 2));
  console.log('distUntouched', out.distUntouched, 'copyRemoved', out.copyRemoved, 'leftovers', JSON.stringify(out.leftovers));
  process.exit(0);
}

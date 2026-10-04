// S4 source mutants. Run under the isolation preamble (Git Bash), env SP and WT set.
// Each mutant: copy-restore of ONE source file (sha256 before, apply with an exact expected replacement count, run the
// suite that must catch it, restore, sha256 equal). A mutant that does not fail the suite SURVIVES = FAIL.
// Files may be CRLF in the working tree: find/replace run on LF-normalised text and the original EOL is restored.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const SP = process.env.SP, WT = process.env.WT;
if (!SP || !WT || !norm(os.tmpdir()).startsWith(norm(SP) + '/')) { console.error('ISOLATION GUARD (mutants)'); process.exit(97); }
const sha = (b) => createHash('sha256').update(b).digest('hex');
const B = `${WT}/packages/browser`, C = `${WT}/packages/capability-runtime`;
const BAE = `${B}/src/actions/browser-action-engine.ts`, DOM = `${B}/src/dom/dom-semantic-engine.ts`, PC = `${B}/src/verifier/post-conditions.ts`, FC = `${B}/src/actions/frame-call.ts`, RT = `${C}/src/runtime.ts`;
const SYNC = '((fr: any, op: any) => op(fr))('; // identical call shape, but NOT async: a synchronous throw escapes (the pre-fix behaviour)
const revert = (id, note, file, find, suite = 'browser') => ({ id, note, file, find, repl: find.replace('frameCall(', SYNC), count: 1, suite });
const mutants = [
  revert('M-047a', 'resolveElement loop wrapper reverted', BAE, 'const match = await frameCall(frame, (f) =>'),
  revert('M-047b', 'buildGraph wrapper reverted', DOM, 'const scrape = frameCall(frame, (f) =>'),
  {
    id: 'M-047c', note: 'frameCall non-async (op(f).catch(e => { throw e }))', file: FC, count: 1, suite: 'browser',
    find: 'export async function frameCall<F, T>(frame: F, op: (frame: F) => T | Promise<T>): Promise<T> {\n  return op(frame);\n}',
    repl: 'export function frameCall<F, T>(frame: F, op: (frame: F) => T | Promise<T>): Promise<T> {\n  return (op(frame) as Promise<T>).catch((e) => { throw e; });\n}',
  },
  revert('M-047d', 'single-frame path reverted', BAE, 'return frameCall(only, (f) =>'),
  revert('M-047e', 'head start reverted', BAE, 'const mainFrameMatch = await frameCall(mainFrame, (f) =>'),
  { id: 'M-047f', note: 'per-frame catch clears allNodes', file: DOM, count: 1, suite: 'browser', find: '        } catch (e) {\n          if (e === FRAME_TIMEOUT) {', repl: '        } catch (e) {\n          allNodes.length = 0;\n          if (e === FRAME_TIMEOUT) {' },
  revert('M-047h', 'post-conditions disposeKeyObservation (631)', PC, "frameCall(pre.frame, (f) => f.evaluate(readKeyObservationInPage, pre.token!, '')),"),
  revert('M-047i', 'post-conditions finishKeyObservation (647)', PC, 'frameCall(pre.frame, (f) => f.evaluate(readKeyObservationInPage, pre.token!, params.key)),'),
  revert('M-047j', 'post-conditions NavigationProbe.finish status read (1197)', PC, 'frameCall(page.mainFrame(), (f) =>'),
  revert('M-047k', 'post-conditions finishPointObservation (1548)', PC, 'frameCall(arm.frame, (f) => f.evaluate(readPointInPage, arm.token!)),'),
  revert('M-047l', 'post-conditions observeUploadTargets (1735)', PC, 'frameCall(frame, (f) => f.evaluate(armUploadListenerInPage, token))'),
  revert('M-047m', 'post-conditions removeUploadListener (1743)', PC, 'frameCall(arm.frame, (f) => f.evaluate(readUploadObservationInPage, arm.token!, true)),'),
  { id: 'M-047g', note: 'runtime uploadFileViaTrigger page.click reverted to a bare array element', file: RT, count: 1, suite: 'runtime', find: '(async () => page.click(selector))()', repl: 'page.click(selector)' },
];

const run = (suite) => {
  const cwd = suite === 'browser' ? B : C;
  const file = suite === 'browser' ? 'tests/unit/frame-detach.spec.ts' : 'tests/unit/upload-frame-detach.spec.ts';
  const r = spawnSync(process.execPath, [`${WT}/node_modules/vitest/vitest.mjs`, 'run', '--globals', file], { cwd, timeout: 600000, encoding: 'utf8', env: { ...process.env } });
  const clean = ((r.stdout ?? '') + (r.stderr ?? '')).replace(/\x1b\[[0-9;]*m/g, '');
  const failed = [...clean.matchAll(/^\s*(?:FAIL|×|❯)\s+tests\/unit\/\S+ > (.*)$/gm)].map((m) => m[1].trim().slice(0, 110));
  return { status: r.status, tests: /Tests\s+(.*)/.exec(clean)?.[1] ?? '?', failed: [...new Set(failed)] };
};

const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
let survivors = 0; const rows = [];
for (const s of ['browser', 'runtime']) { const b = run(s); console.log(`BASELINE ${s} exit=${b.status} tests=${b.tests}`); if (b.status !== 0) { console.log('baseline failed; abort'); process.exit(2); } }
for (const m of mutants) {
  if (only && !only.includes(m.id)) continue;
  const orig = readFileSync(m.file); const shaBefore = sha(orig);
  const raw = orig.toString('utf8'); const crlf = raw.includes('\r\n'); const text = raw.replace(/\r\n/g, '\n');
  const n = text.split(m.find).length - 1;
  if (n !== m.count) { console.log(`${m.id} BAD-APPLY expected ${m.count} replacement(s), got ${n}`); process.exit(3); }
  let mutated = text.split(m.find).join(m.repl); if (crlf) mutated = mutated.replace(/\n/g, '\r\n');
  let res;
  try { writeFileSync(m.file, mutated); res = run(m.suite); } finally { writeFileSync(m.file, orig); }
  const shaAfter = sha(readFileSync(m.file));
  const killed = res.status !== 0; if (!killed) survivors++;
  rows.push({ id: m.id, killed });
  console.log(`${m.id} ${killed ? 'KILLED' : 'SURVIVED'} exit=${res.status} (${res.tests}) restored-sha-equal=${shaBefore === shaAfter} :: ${m.note}`);
  for (const f of res.failed.slice(0, 4)) console.log(`    killed by: ${f}`);
  if (shaBefore !== shaAfter) { console.log('RESTORE MISMATCH'); process.exit(4); }
}
console.log(`SUMMARY mutants=${rows.length} killed=${rows.filter((r) => r.killed).length} survivors=${survivors}`);
process.exitCode = survivors === 0 ? 0 : 1;

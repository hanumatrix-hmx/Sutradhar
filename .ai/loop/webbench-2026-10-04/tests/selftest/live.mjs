#!/usr/bin/env node
// Live wrapper self-test (review-2 findings 1, 5, 7). Drives the REAL published CLI through a COPY of the frozen
// tools placed in <workDir> (so logs never land in the repo), slot M, pseudo tasks selftest1/selftest2
// (example.com / iana.org only). Asserts every wrapper guard and dry-runs every verb in driver-brief.md's table.
// Ends with close + --check-clean. Kills nothing.
//   node tests/selftest/live.mjs <workDir>
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const work = process.argv[2];
if (!work) { console.error('usage: node live.mjs <workDir>'); process.exit(2); }
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
for (const f of ['lib.mjs', 'drive.mjs', 'check-evidence.mjs', 'log-view.mjs', 'selection.json', 'task-fields.json']) copyFileSync(path.join(LOOP, f), path.join(work, f));

let ok = true;
const results = [];
function d(task, att, ...cmd) {
  const r = spawnSync(process.execPath, [path.join(work, 'drive.mjs'), 'M', task, att, ...cmd], { encoding: 'utf8', timeout: 300000 });
  return { exit: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}
function expect(name, r, want, contains) {
  const pass = (Array.isArray(want) ? want.includes(r.exit) : r.exit === want) && (!contains || r.out.includes(contains));
  if (!pass) ok = false;
  results.push(`${pass ? 'ok  ' : 'BAD '} ${name.padEnd(44)} exit=${r.exit} want=${want}${pass ? '' : ' :: ' + r.out.slice(0, 300).replace(/\s+/g, ' ')}`);
  return r;
}
const seqOf = (r) => Number(/seq (\d+) exit/.exec(r.out)?.[1]);

const S1 = 'selftest1';
expect('97 verb before any session', d(S1, 'a1', 'text'), 97, 'no live session');
expect('98 forbidden verb', d(S1, 'a1', 'download', 'x'), 98, 'forbidden verb');
expect('98 forbidden flag', d(S1, 'a1', 'nav', 'https://example.com/', '--viewport', '390x844'), 98, 'forbidden flag');
expect('93 first nav must be startingUrl', d(S1, 'a1', 'nav', 'https://www.iana.org/'), 93, 'must be the task');
expect('nav startingUrl', d(S1, 'a1', 'nav', 'https://example.com/', '--settle'), 0, 'Navigated');
expect('93 off-domain newtab', d(S1, 'a1', 'newtab', 'https://www.wikipedia.org/'), 93, 'outside');
expect('96 other task cannot use this session', d('selftest2', 'a1', 'text'), 96, 'belongs to selftest1:a1');
writeFileSync(path.join('E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad/w/M', 'lock'), 'test');
expect('95 concurrent call (lock held)', d(S1, 'a1', 'text'), 95, 'one at a time');
rmSync('E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad/w/M/lock', { force: true });
// dry-run of every verb in the brief's table
expect('href', d(S1, 'a1', 'href'), 0, 'example.com');
const tx = expect('text', d(S1, 'a1', 'text'), 0, 'documentation examples');
expect('snap', d(S1, 'a1', 'snap'), 0, 'Learn more');
expect('axsnap', d(S1, 'a1', 'axsnap'), 0);
expect('read <css>', d(S1, 'a1', 'read', 'p'), 0, 'documentation');
expect('links <css>', d(S1, 'a1', 'links', 'a'), 0, 'iana.org');
expect('count <css>', d(S1, 'a1', 'count', 'a'), 0, '1');
expect('status', d(S1, 'a1', 'status'), 0, '200');
expect('waitfor --text', d(S1, 'a1', 'waitfor', '5000', '--text', 'Learn more'), 0, 'Condition met');
expect('wait <css>', d(S1, 'a1', 'wait', 'a', '5000'), 0);
expect('scroll down', d(S1, 'a1', 'scroll', 'down', '300'), [0, 1]);
expect('type into missing input (arg form only)', d(S1, 'a1', 'type', '#nope', 'abc'), 1);
expect('select on missing select (arg form only)', d(S1, 'a1', 'select', '#nope', 'v'), 1);
expect('press <ref> Tab', d(S1, 'a1', 'press', 'a', 'Tab'), [0, 1]);
expect('screenshot (path forced out of repo)', d(S1, 'a1', 'screenshot', 'repo-file.png'), 0, '/w/M/shots/'.replace(/\//g, '\\'));
expect('click --expect-url-changed --settle', d(S1, 'a1', 'click', 'a', '--expect-url-changed', '--settle'), 0);
expect('href after click is iana.org', d(S1, 'a1', 'href'), 0, 'iana.org');
expect('back', d(S1, 'a1', 'back'), 0);
expect('waitfor --url after back', d(S1, 'a1', 'waitfor', '10000', '--url', 'example.com'), 0);
expect('clicktext --expect-url-changed', d(S1, 'a1', 'clicktext', 'Learn more', '--expect-url-changed', '--settle'), 0);
expect('tabs', d(S1, 'a1', 'tabs'), 0);
// review-3: attrs evidence verb, allow-list, waitfor --js taint vs the pre-registered interstitial expression
expect('attrs <css> <names>', d(S1, 'a1', 'attrs', 'a', 'href,class'), 0, '| href=/');
expect('98 attrs with a prose attribute name (review-4 B)', d(S1, 'a1', 'attrs', 'a', 'Release date by Zylophone Studios'), 98, 'plain attribute names');
expect('98 verb not in allow-list (hover)', d(S1, 'a1', 'hover', 'a'), 98, 'allow-list');
expect('98 audit forbidden', d(S1, 'a1', 'audit', 'https://example.com/'), 98, 'forbidden verb audit');
expect('interstitial waitfor --js (no taint)', d(S1, 'a1', 'waitfor', '3000', '--js', '!/Just a moment|Verif/i.test(document.title)'), 0, 'Condition met');
expect('driver waitfor --js (taints)', d(S1, 'a1', 'waitfor', '3000', '--js', 'document.title.length > 0'), 0, 'Condition met');
const ev = expect('raw eval (taints)', d(S1, 'a1', 'eval', "'injected marker 12345'"), 0, 'injected marker');
expect('close', d(S1, 'a1', 'close'), 0, 'Session closed');
expect('97 verb after close', d(S1, 'a1', 'text'), 97, 'no live session');
expect('check-clean', d(S1, 'a1', '--check-clean'), 0, '"clean":true');

// checker on the real log: honest record PASSes, eval-echo record FAILs
const runs = path.join(work, 'runs');
const honest = { id: S1, classification: 'COMPLETED', answerFields: [{ field: 'page_sentence', value: 'documentation examples', logSeq: seqOf(tx), excerpt: 'This domain is for use in documentation examples' }] };
writeFileSync(path.join(runs, 'M', `${S1}.json`), JSON.stringify(honest));
let c = spawnSync(process.execPath, [path.join(work, 'check-evidence.mjs'), runs], { encoding: 'utf8' });
expect('checker PASS on honest live record', { exit: c.status, out: c.stdout }, 0, 'PASS');
writeFileSync(path.join(runs, 'M', `${S1}.json`), JSON.stringify({ ...honest, answerFields: [{ field: 'page_sentence', value: 'injected marker 12345', logSeq: seqOf(ev), excerpt: 'injected marker 12345 from the page' }] }));
c = spawnSync(process.execPath, [path.join(work, 'check-evidence.mjs'), runs], { encoding: 'utf8' });
expect('checker FAIL on eval-echo live record', { exit: c.status, out: c.stdout }, 1, 'C2a');
const lg = readFileSync(path.join(runs, 'M', 'raw', `${S1}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const wj = lg.filter((r) => r.kind === 'cli' && r.verb === 'waitfor' && r.argv.includes('--js'));
expect('log marks driver waitfor --js as JS, interstitial not', { exit: wj.length === 2 && wj[0].runsDriverJs === false && wj[1].runsDriverJs === true ? 0 : 1, out: JSON.stringify(wj.map((r) => r.runsDriverJs)) }, 0);
const lv = spawnSync(process.execPath, [path.join(work, 'log-view.mjs'), path.join(runs, 'M', 'raw', `${S1}.jsonl`)], { encoding: 'utf8' });
expect('log-view lists calls', { exit: lv.status, out: lv.stdout }, 0, 'waitfor');
const fp = readFileSync(path.join(runs, 'M', 'raw', `${S1}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((r) => r.kind === 'auto-href');
results.push(`info fingerprint: ${fp?.stdout.trim()}`);
console.log(results.join('\n'));
console.log(ok ? 'LIVE SELFTEST OK' : 'LIVE SELFTEST FAILED');
process.exit(ok ? 0 : 1);

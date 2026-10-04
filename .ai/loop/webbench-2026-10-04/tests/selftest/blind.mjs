#!/usr/bin/env node
// Offline test for make-verify-input.mjs (review-2 finding 2): the blind tree must contain no class-revealing
// field or file, the chain must still verify on the stripped copy, a canary mutation must be applied to the copy
// only, and a "checker-passing" canary (a genuine page substring presented as a wrong answer) must PASS the
// mechanical checker, i.e. only a reading verifier can catch it.
//   node tests/selftest/blind.mjs [workDir]
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { genesis, hashRecord } from '../../lib.mjs';

const LOOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const work = process.argv[2] ?? path.join(os.tmpdir(), `wb-blind-${process.pid}`);
rmSync(work, { recursive: true, force: true });
const START = 'https://www.realsimple.com';
const PAGE = 'Organizing Latest: How to Declutter a Closet in 5 Steps | 12 Pantry Ideas That Work | Why Bins Beat Baskets | The 10-Minute Tidy | Label Everything Smartly | Shop Our Picks Newsletter Sign Up';
function chain(slot, id, steps) {
  let prev = genesis(slot, id); let lastCli = 0;
  return steps.map((s, i) => {
    const base = { seq: i + 1, ts: '2026-10-04T00:00:00.000Z', slot, taskId: id, attempt: 'a1', exit: 0, durationMs: 1, stderr: '', ...s, prevHash: prev };
    if (s.kind === 'auto-href') base.forSeq = lastCli;
    const r = { ...base, hash: hashRecord(base) }; prev = r.hash; if (s.kind === 'cli') lastCli = r.seq; return r;
  });
}
const auto = { kind: 'auto-href', verb: 'auto-href', argv: ['eval', 'AUTO'], stdout: JSON.stringify({ href: START + '/organizing', inner: [800, 600] }) };
const steps = [
  { kind: 'cli', verb: 'nav', argv: ['nav', START, '--settle'], stdout: 'Navigated' }, auto,
  { kind: 'cli', verb: 'text', argv: ['text'], stdout: PAGE }, auto,
  { kind: 'cli', verb: 'close', argv: ['close'], stdout: 'Session closed.' },
  { kind: 'check-clean', verb: '--check-clean', argv: ['--check-clean'], stdout: '{"clean":true}' },
];
const titles = ['How to Declutter a Closet in 5 Steps', '12 Pantry Ideas That Work', 'Why Bins Beat Baskets', 'The 10-Minute Tidy', 'Label Everything Smartly'];
const af = (v) => ({ field: 'article_title', value: v, logSeq: 3, excerpt: v.length >= 20 ? v : `${v} | ` + titles.find((t) => t !== v) });
const runs = path.join(work, 'runs');
mkdirSync(path.join(runs, 'K', 'raw'), { recursive: true });
writeFileSync(path.join(runs, 'K', 'raw', '1414.jsonl'), chain('K', '1414', steps).map((r) => JSON.stringify(r)).join('\n') + '\n');
writeFileSync(path.join(runs, 'K', '1414.json'), JSON.stringify({ id: 1414, classification: 'COMPLETED', subflag: 'strict', disclosure: '', notes: 'driver notes', toolDefects: [], answerFields: titles.map(af) }));
writeFileSync(path.join(runs, 'K', 'summary.md'), '| 1414 | COMPLETED | strict |');
// Second reserve record (1310, field program min 5) claiming 5 values that are all the same string: blind C7 must catch it.
const PAGE2 = 'Undergraduate Programs: Accounting, Biology, Chemistry, Dance, Economics and more';
writeFileSync(path.join(runs, 'K', 'raw', '1310.jsonl'), chain('K', '1310', steps.map((x) => (x.verb === 'text' ? { ...x, stdout: PAGE2 } : x.kind === 'cli' && x.verb === 'nav' ? { ...x, argv: ['nav', 'https://www.osu.edu', '--settle'] } : x.kind === 'auto-href' ? { ...x, stdout: JSON.stringify({ href: 'https://www.osu.edu/academics', inner: [800, 600] }) } : x))).map((r) => JSON.stringify(r)).join('\n') + '\n');
writeFileSync(path.join(runs, 'K', '1310.json'), JSON.stringify({ id: 1310, classification: 'COMPLETED', answerFields: Array(5).fill({ field: 'program', value: 'Accounting', logSeq: 3, excerpt: 'Undergraduate Programs: Accounting, Biology' }) }));
// Canary: replace the 5 titles with 5 genuine page substrings that are NOT article titles (nav/footer text).
const fake = ['Shop Our Picks Newsletter Sign Up', 'Organizing Latest: How to Declutter', 'Newsletter Sign Up', 'Shop Our Picks', 'Organizing Latest'];
writeFileSync(path.join(work, 'mutations.json'), JSON.stringify([{ slot: 'K', id: 1414, answerFields: fake.map((v) => { const i = PAGE.indexOf(v); return { field: 'article_title', value: v, logSeq: 3, excerpt: PAGE.slice(Math.max(0, i - 10), i + Math.max(v.length, 20) + 5) }; }) }]));
let ok = true;
const t = (name, cond) => { if (!cond) ok = false; console.log(`${cond ? 'ok  ' : 'BAD '} ${name}`); };

const out = path.join(work, 'verify-input');
const r = spawnSync(process.execPath, [path.join(LOOP, 'make-verify-input.mjs'), runs, out, '--mutations', path.join(work, 'mutations.json')], { encoding: 'utf8' });
t('make-verify-input exit 0', r.status === 0);
const rec = readFileSync(path.join(out, 'K', '1414.json'), 'utf8');
t('stripped record has no class-revealing fields', !/classification|subflag|disclosure|toolDefects|notes/.test(rec));
t('summary.md not copied', !existsSync(path.join(out, 'K', 'summary.md')));
t('blind check-evidence.json has no classification', !readFileSync(path.join(out, 'check-evidence.json'), 'utf8').includes('classification'));
t('mutation applied to the copy', JSON.parse(rec).answerFields[0].value === fake[0]);
t('original record untouched', JSON.parse(readFileSync(path.join(runs, 'K', '1414.json'), 'utf8')).answerFields[0].value === titles[0]);
const ce = JSON.parse(readFileSync(path.join(out, 'check-evidence.json'), 'utf8'));
t('canary passes the mechanical checker (only a reading verifier can catch it)', ce.find((x) => x.id === '1414')?.pass === true);
t('blind mode applies C7 with distinct values (5 identical values rejected)', ce.find((x) => x.id === '1310')?.problems.some((q) => q.startsWith('C7')) === true);
console.log(ok ? 'BLIND SELFTEST OK' : 'BLIND SELFTEST FAILED');
process.exit(ok ? 0 : 1);

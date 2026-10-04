#!/usr/bin/env node
// log-view.mjs: read-only viewer for drive.mjs raw logs (review-3 finding 7). Frozen; named in verifier-brief.md.
//   node log-view.mjs <raw/<id>.jsonl>                         one line per record: seq attempt kind verb argv exit href len flags
//   node log-view.mjs <log> --seq N [--max 20000]             full stdout/stderr of one record (capped)
//   node log-view.mjs <log> --record <<id>.json> [--window 400]  for every answerField: value, seq, and +/- window chars
//                                                              of that seq's (normalised) output around the excerpt
//   node log-view.mjs <log> --grep "<text>"                    every record whose output contains <text> (case-insensitive)
import { readFileSync } from 'node:fs';
import { norm, normLower, runsDriverJs } from './lib.mjs';

const [file] = process.argv.slice(2);
const opt = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
if (!file) { console.error('usage: node log-view.mjs <log.jsonl> [--seq N | --record rec.json | --grep text]'); process.exit(2); }
const log = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const bySeq = new Map(log.map((r) => [r.seq, r]));
const hrefFor = (seq) => { const a = log.find((r) => r.kind === 'auto-href' && r.forSeq === seq); try { return JSON.parse(a.stdout.trim()).href; } catch { return '-'; } };
const one = (s, n) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);

if (opt('--seq')) {
  const r = bySeq.get(Number(opt('--seq')));
  if (!r) { console.error('no such seq'); process.exit(1); }
  const max = Number(opt('--max') ?? 20000);
  console.log(`seq ${r.seq} ${r.attempt} ${r.kind} ${r.verb} exit=${r.exit} href=${hrefFor(r.seq)}\nargv: ${JSON.stringify(r.argv)}\n--- stdout (${r.stdout?.length ?? 0} chars${(r.stdout?.length ?? 0) > max ? `, first ${max}` : ''}) ---\n${String(r.stdout ?? '').slice(0, max)}\n--- stderr ---\n${one(r.stderr, 2000)}`);
} else if (opt('--record')) {
  const rec = JSON.parse(readFileSync(opt('--record'), 'utf8'));
  const w = Number(opt('--window') ?? 400);
  for (const [i, af] of (rec.answerFields ?? []).entries()) {
    const r = bySeq.get(af.logSeq);
    const out = norm(r?.stdout ?? '');
    const at = out.indexOf(norm(af.excerpt));
    console.log(`\n[${i}] field=${af.field} value=${JSON.stringify(af.value)} seq=${af.logSeq} (${r ? `${r.kind}/${r.verb} exit=${r.exit} href=${hrefFor(r.seq)}` : 'NO SUCH SEQ'})`);
    console.log(at < 0 ? '    EXCERPT NOT FOUND in that output' : `    ...${out.slice(Math.max(0, at - w), at)}[[${out.slice(at, at + norm(af.excerpt).length)}]]${out.slice(at + norm(af.excerpt).length, at + norm(af.excerpt).length + w)}...`);
  }
  if (rec.shortList) console.log(`\nshortList seq=${rec.shortList.logSeq}: ${one(rec.shortList.excerpt, 300)}`);
} else if (opt('--grep')) {
  const g = normLower(opt('--grep'));
  for (const r of log) {
    const o = normLower(r.stdout ?? '');
    const i = o.indexOf(g);
    if (i >= 0) console.log(`seq ${r.seq} ${r.attempt} ${r.kind}/${r.verb}: ...${o.slice(Math.max(0, i - 120), i + g.length + 120)}...`);
  }
} else {
  console.log('seq att  kind        verb        exit  href                                              len    flags  argv');
  for (const r of log) {
    if (r.kind === 'auto-href') continue;
    const flags = [runsDriverJs(r.verb, r.argv ?? []) && r.kind === 'cli' ? 'JS' : '', r.tainted ? 'tainted' : '', r.timedOut ? 'timeout' : ''].filter(Boolean).join(',');
    console.log(`${String(r.seq).padEnd(4)}${r.attempt.padEnd(5)}${r.kind.padEnd(12)}${String(r.verb).padEnd(12)}${String(r.exit).padEnd(6)}${one(hrefFor(r.seq), 48).padEnd(50)}${String(r.stdout?.length ?? 0).padEnd(7)}${flags.padEnd(7)}${one(JSON.stringify(r.argv), 100)}`);
  }
}

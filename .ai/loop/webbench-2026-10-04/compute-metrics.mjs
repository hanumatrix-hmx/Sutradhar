#!/usr/bin/env node
// Final-class derivation and protocol 4.2 metrics for the 2026-10-04 WebBench run.
// Usage: node compute-metrics.mjs            (run from <LOOP>; prints JSON + writes runs/final-classes.json)
// Inputs: selection.json, runs/<slot>/<id>.json (driver records), verify/phase1.json, verify/phase2.json,
//         and the OVERRIDES table below, transcribed from verify/adjudication.md (orchestrator rulings, authoritative).
// No hand arithmetic: Wilson and Newcombe (method 10) intervals are computed here.
import fs from 'node:fs';

const Z = 1.959963984540054;

export function wilson(x, n) {
  if (n === 0) return { p: NaN, lo: NaN, hi: NaN };
  const p = x / n, z2 = Z * Z;
  const d = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / d;
  const h = (Z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / d;
  return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

// Newcombe (1998) method 10: square-and-add of the two Wilson score intervals, difference p1 - p2.
export function newcombe(x1, n1, x2, n2) {
  const a = wilson(x1, n1), b = wilson(x2, n2);
  const diff = a.p - b.p;
  const lo = diff - Math.sqrt((a.p - a.lo) ** 2 + (b.hi - b.p) ** 2);
  const hi = diff + Math.sqrt((a.hi - a.p) ** 2 + (b.p - b.lo) ** 2);
  return { diff, lo, hi };
}

const pct = (v) => (v * 100).toFixed(1);
const fmt = (x, n) => { const w = wilson(x, n); return `${x}/${n} = ${pct(w.p)}% [${pct(w.lo)}, ${pct(w.hi)}]`; };
const fmtD = (x1, n1, x2, n2) => { const d = newcombe(x1, n1, x2, n2); return `${(d.diff * 100 >= 0 ? '+' : '')}${pct(d.diff)} pp [${pct(d.lo)}, ${pct(d.hi)}]`; };

// ---- Orchestrator rulings (verify/adjudication.md), keyed by id: [class, subflag, basis]
const OVERRIDES = {
  2561: ['AGENT-FAIL', 'reasoning', 'adjudication: causation contested -> less favourable; D1 confirmed separately'],
  1979: ['AGENT-FAIL', 'substitution', 'adjudication: values read from /benefits, not from the requested search'],
  1379: ['AGENT-FAIL', 'reasoning', 'adjudication: drift not proven (repeat read + 4000-char-truncated read)'],
  2687: ['AGENT-FAIL', 'reasoning', 'adjudication: truncated read + guessed URL; Android listing unchecked'],
  696:  ['AGENT-FAIL', 'reasoning', 'adjudication: checks only prove "no site search"; latest match page reachable'],
  597:  ['AGENT-FAIL', 'substitution', 'adjudication: "highly cited" unsupported; PROB-044 probe PASS regardless'],
  41:   ['AGENT-FAIL', 'substitution', 'adjudication: first all-terms match (#3) skipped; type-append probe PASS regardless'],
  2253: ['COMPLETED', 'strict', 'adjudication: protocol 2.5 names eur-lex.europa.eu as on-site for this task'],
};
// Classes that the driver and verifier shared but with different subflag: take the verifier's phase-1 subflag
// (class was not in dispute, so no ruling was recorded; both subflags are shown in the report).
const VERIFIER_SUBFLAG_FOR = new Set([1789, 2582, 982]);
// 1434: both EXTERNAL-BLOCK; driver 'challenge', verifier+replay 'edge-deny' (HTTP 429 rate-limit page). Keep driver subflag, show both.
// 1329: driver and verifier agree TASK-INVALID/drift. 192: driver COMPLETED/interpreted+linked-org, verifier COMPLETED/linked-org.
// 392: protocol 2.6 curl-control mapping (curl 200 HTTP/1.1 vs Chrome ERR_HTTP2_PROTOCOL_ERROR) -> EXTERNAL-BLOCK(client-fingerprint).
const RETEST_SUBFLAG = { 392: 'client-fingerprint (curl control 200 HTTP/1.1)', 192: 'interpreted, linked-org' };

const sel = JSON.parse(fs.readFileSync('selection.json', 'utf8'));
const p1 = Object.fromEntries(JSON.parse(fs.readFileSync('verify/phase1.json', 'utf8')).map((r) => [r.id, r]));
const p2 = Object.fromEntries(JSON.parse(fs.readFileSync('verify/phase2.json', 'utf8')).map((r) => [r.id, r]));
const primaryIds = sel.primary.map((t) => t.id);
const retestIds = sel.retest.map((t) => t.id);

const rows = [];
for (const slot of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']) {
  for (const f of fs.readdirSync(`runs/${slot}`).filter((x) => /^\d+\.json$/.test(x))) {
    const r = JSON.parse(fs.readFileSync(`runs/${slot}/${f}`, 'utf8'));
    const v = p1[r.id] || {};
    const w = p2[r.id] || {};
    let fin = [r.classification, r.subflag];
    let basis = 'driver class stands (verifier agrees on class)';
    if (OVERRIDES[r.id]) { fin = [OVERRIDES[r.id][0], OVERRIDES[r.id][1]]; basis = OVERRIDES[r.id][2]; }
    else if (VERIFIER_SUBFLAG_FOR.has(r.id)) { fin = [v.class, v.subflag]; basis = 'class agreed; subflag from verifier (driver: ' + r.subflag + ')'; }
    if (RETEST_SUBFLAG[r.id]) fin[1] = RETEST_SUBFLAG[r.id];
    // the canaries' verifier phase-1 record is of a mutated copy: never use it as a verifier class
    const canary = [1925, 2336, 2554].includes(r.id);
    rows.push({
      slot, id: r.id, set: primaryIds.includes(r.id) ? 'primary' : retestIds.includes(r.id) ? 'retest' : '??',
      attempts: r.attempts.join('+'),
      driver: `${r.classification}/${r.subflag}`,
      verifier: canary ? 'canary copy (not a verifier class)' : `${v.class}/${v.subflag || ''}`,
      replay: w.replayClass || 'not replayed',
      final: fin[0], finalSub: fin[1], basis,
      a2AfterBlock: false,
    });
  }
}
rows.sort((a, b) => (a.set === b.set ? 0 : a.set === 'primary' ? -1 : 1));
fs.writeFileSync('runs/final-classes.json', JSON.stringify(rows, null, 1) + '\n');

const prim = rows.filter((r) => r.set === 'primary');
if (prim.length !== 30) throw new Error('expected 30 primary rows, got ' + prim.length);
const cnt = (arr, cls) => arr.filter((r) => r.final === cls).length;
const strict = prim.filter((r) => r.final === 'COMPLETED' && r.finalSub === 'strict').length;
const interp = prim.filter((r) => r.final === 'COMPLETED' && r.finalSub !== 'strict').length;
const ext = cnt(prim, 'EXTERNAL-BLOCK'), af = cnt(prim, 'AGENT-FAIL'), ti = cnt(prim, 'TASK-INVALID'), sf = cnt(prim, 'SUTRADHAR-FAIL');
const inScope = 30 - ti;
// H1'/H2': move a2-after-block completions out of COMPLETED. A completion is a2-after-block iff its attempts include a2.
const a2c = prim.filter((r) => r.final === 'COMPLETED' && r.attempts.includes('a2'));
const strictP = strict - a2c.filter((r) => r.finalSub === 'strict').length;
const lenientP = strict + interp - a2c.length;

const assertEq = (name, got, want) => { if (got !== want) throw new Error(`MISMATCH ${name}: got ${got}, expected ${want}`); };
assertEq('strict', strict, 6); assertEq('interpreted', interp, 1); assertEq('EXT', ext, 13);
assertEq('AGENT-FAIL', af, 9); assertEq('TASK-INVALID', ti, 1); assertEq('SUTRADHAR-FAIL', sf, 0);

// Clean August baseline (protocol section 1): in-scope n=107; strict 59, lenient 71; H2 denominators 71 (107 - 36 EXT).
const B = { n: 107, strict: 59, lenient: 71, ext: 36 };
const bH2n = B.n - B.ext;
const m = {
  inScope, strict, interp, ext, af, ti, sf, a2AfterBlockCompletions: a2c.length,
  H1: fmt(strict, inScope), H1lenient: fmt(strict + interp, inScope),
  H2: fmt(strict, inScope - ext), H2lenient: fmt(strict + interp, inScope - ext),
  H1prime: fmt(strictP, inScope), H2prime: fmt(strictP, inScope - ext),
  H1lenientPrime: fmt(lenientP, inScope), H2lenientPrime: fmt(lenientP, inScope - ext),
  baseline: {
    H1strict: fmt(B.strict, B.n), H1lenient: fmt(B.lenient, B.n),
    H2strict: fmt(B.strict, bH2n), H2lenient: fmt(B.lenient, bH2n),
  },
  diff: {
    H1_vs_strict: fmtD(strict, inScope, B.strict, B.n),
    H1lenient_vs_lenient: fmtD(strict + interp, inScope, B.lenient, B.n),
    H2_vs_strict: fmtD(strict, inScope - ext, B.strict, bH2n),
    H2lenient_vs_lenient: fmtD(strict + interp, inScope - ext, B.lenient, bH2n),
    extShare_vs_baseline: fmtD(ext, 30, B.ext, 117),
  },
  extShareOct: fmt(ext, 30), extShareAug: fmt(B.ext, 117),
  retests: rows.filter((r) => r.set === 'retest').map((r) => `${r.id}:${r.final}/${r.finalSub}`),
};
// Baseline sanity: reproduce the protocol-1 table values (Wilson).
const chk = (s, want) => { if (!s.includes(want)) throw new Error(`baseline mismatch: ${s} lacks ${want}`); };
chk(m.baseline.H1strict, '55.1% [45.7, 64.2]'); chk(m.baseline.H1lenient, '66.4% [57.0, 74.6]');
chk(m.baseline.H2strict, '83.1% [72.7, 90.1]'); chk(m.baseline.H2lenient, '100.0% [94.9, 100.0]');
// Sensitivity: the drivers' own classes, before verification and adjudication (shows how much of the gap is adjudication).
const dcls = (r) => r.driver.split('/')[0];
const dStrict = prim.filter((r) => dcls(r) === 'COMPLETED' && r.driver.split('/')[1] === 'strict').length;
const dInterp = prim.filter((r) => dcls(r) === 'COMPLETED' && r.driver.split('/')[1] !== 'strict').length;
const dTI = prim.filter((r) => dcls(r) === 'TASK-INVALID').length, dExt = prim.filter((r) => dcls(r) === 'EXTERNAL-BLOCK').length;
const dIn = 30 - dTI;
m.driverAsReported = { strict: dStrict, interpreted: dInterp, taskInvalid: dTI, ext: dExt, inScope: dIn,
  H1: fmt(dStrict, dIn), H1lenient: fmt(dStrict + dInterp, dIn), H2: fmt(dStrict, dIn - dExt), H2lenient: fmt(dStrict + dInterp, dIn - dExt) };
// Per-class subflag tallies (final classes)
const tally = {};
for (const r of prim) { const k = r.final + '/' + r.finalSub; tally[k] = (tally[k] || 0) + 1; }
m.finalTally = tally;
m.a2Used = prim.filter((r) => r.attempts.includes('a2')).map((r) => r.id);
console.log(JSON.stringify(m, null, 2));

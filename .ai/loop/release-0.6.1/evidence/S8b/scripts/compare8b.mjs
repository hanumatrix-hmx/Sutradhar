import fs from 'node:fs'; import path from 'node:path';
const D = process.argv[2]; const J = (l, k) => JSON.parse(fs.readFileSync(path.join(D, `result-${l}-${k}.json`), 'utf8'));
let bad = 0; const ck = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' :: ' + d : ''}`); if (!ok) bad++; };
const base = (m) => typeof m.code === 'number' && !m.timedOut && m.signal === null && m.code !== 0 && !!m.errno && /(^|[\\/])st[\\/]state\.json$/.test(m.fatalStatePath ?? '') && !m.sessionClosed;
const headExtra = (m) => m.phaseKill && !m.stateCleared && m.removedIdx >= 0 && m.removedIdx < m.fatalIdx && !m.couldNotClear && !m.dirAtReturn;
const pred = (r, isHead) => base(r.measured) && r.chromeGoneFinal === true && !r.measured.aliveAtReturn && (!isHead || headExtra(r.measured));
for (const k of ['close', 'selfheal']) {
  const v = J('v060', k), h = J('head', k), c = J('ctl', k);
  for (const r of [v, h, c]) ck(`${k} ${r.label}: harness had 0 failing checks`, r.fails === 0);
  ck(`${k}: 0.6.0 meets the base AC (exit!=0 number, no timeout, Fatal errno on state.json, no "Session closed.")`, pred(v, false), JSON.stringify({ code: v.measured.code, errno: v.measured.errno }));
  ck(`${k}: HEAD meets base AC + debug-order AC (phase kill, no state-cleared, removed(dir) before Fatal, no warning, dir gone at return)`, pred(h, true), JSON.stringify({ code: h.measured.code, errno: h.measured.errno, removedIdx: h.measured.removedIdx, fatalIdx: h.measured.fatalIdx }));
  ck(`${k}: exit codes equal and non-zero`, v.measured.code === h.measured.code && h.measured.code !== 0, `${v.measured.code}/${h.measured.code}`);
  ck(`${k}: same errno`, v.measured.errno === h.measured.errno, `${v.measured.errno}/${h.measured.errno}`);
  if (k === 'selfheal') ck(`${k}: both printed the unreachable note (self-heal path really ran)`, v.measured.noteUnreachable && h.measured.noteUnreachable);
  ck(`${k}: 0.6.0 leaked the dir (harness removed it); HEAD removed it itself`, v.measured.dirAtReturn === true && h.measured.dirAtReturn === false);
  ck(`${k}: both left chromePid recorded (as 0.6.0) - harness deleted state.json`, !!v.stateAfter?.chromePid && !!h.stateAfter?.chromePid);
  ck(`${k}: NEGATIVE CONTROL bff46db FAILS the AC`, !pred(c, true), JSON.stringify({ code: c.measured.code, sessionClosed: c.measured.sessionClosed, couldNotClear: c.measured.couldNotClear }));
}
const e = J('mutB2e', 'close'), d = J('mutB2d', 'selfheal');
ck('live mutant M-B2e (cmdClose .catch) FAILS the close AC', !pred(e, true), JSON.stringify({ code: e.measured.code, sessionClosed: e.measured.sessionClosed }));
ck('live mutant M-B2d (self-heal .catch) FAILS the self-heal AC', !pred(d, true), JSON.stringify({ code: d.measured.code }));
console.log(`compare-bad=${bad}`); process.exit(bad ? 1 : 0);

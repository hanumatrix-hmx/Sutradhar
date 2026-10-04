// Cross-run comparison for the S6g live A/B (reads result-*.json written by s6g-ab.mjs). Exit 1 on any violated expectation.
import fs from 'node:fs'; import path from 'node:path';
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const R = {}; for (const f of fs.readdirSync(dir)) { const m = /^result-(.+)\.json$/.exec(f); if (m) R[m[1]] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
let bad = 0; const out = [];
const ok = (n, c, d = '') => { out.push(`${c ? 'PASS' : 'FAIL'} ${n}${d ? ' :: ' + d : ''}`); if (!c) bad++; };
const SHA = { v060: 'd71da59253c09746ebf720d266bef1d9c9e8130aa8bde6f7a79966113e026c2d', ctl: '48c1756c0b7944351f9352151ab79c39d3ddc60382aa45278b3481e25a657ac4' };
out.push('label        case      exit  signal errno   Fatal  "Session closed."  Chrome-dead-when-CLI-returned  profile-dir-removed-by-CLI  state.json-after(chromePid)  AC-predicate  binary-sha256');
for (const k of Object.keys(R).sort()) { const r = R[k]; out.push(`${r.label.padEnd(12)} ${r.case.padEnd(9)} ${String(r.status).padEnd(5)} ${String(r.signal ?? '-').padEnd(6)} ${String(r.errnoCode).padEnd(7)} ${String(!!r.fatalLine).padEnd(6)} ${String(r.sessionClosedPrinted).padEnd(18)} ${String(!r.aliveRightAfter).padEnd(30)} ${String(r.productRemovedProfileDir).padEnd(27)} ${r.stateAfter?.present ? 'present(' + r.stateAfter.chromePid + ')' : 'absent'}`.padEnd(150) + ` ${r.acPredicate}  ${r.binSha256.slice(0, 12)}`); }
for (const c of ['close', 'selfheal']) {
  const a = R[`v060-${c}`], h = R[`head-${c}`], ctl = R[`ctl-${c}`];
  ok(`${c}: 0.6.0 and HEAD both ran`, !!a && !!h);
  if (a && h) {
    ok(`${c}: exit codes equal and non-zero`, a.status === h.status && typeof a.status === 'number' && a.status !== 0, `0.6.0=${a.status} HEAD=${h.status}`);
    ok(`${c}: same errno code on both`, a.errnoCode === h.errnoCode && a.errnoCode !== null, `0.6.0=${a.errnoCode} HEAD=${h.errnoCode}`);
    ok(`${c}: both Fatal lines name the same state.json path`, (/'([^']+state\.json)'/.exec(a.fatalLine)?.[1] ?? 'x').toLowerCase() === (/'([^']+state\.json)'/.exec(h.fatalLine)?.[1] ?? 'y').toLowerCase());
    ok(`${c}: r.error undefined (no spawnSync timeout) in both`, a.errorCode === null && h.errorCode === null && a.signal == null && h.signal == null);
    ok(`${c}: Session closed. absent in both`, !a.sessionClosedPrinted && !h.sessionClosedPrinted);
    ok(`${c}: Chrome gone in both (final) and HEAD's was dead when the CLI returned (awaited kill)`, a.chromeGoneFinal && h.chromeGoneFinal && !h.aliveRightAfter);
    ok(`${c}: HEAD removed the temp dir before exiting; 0.6.0 leaked it (harness removed it)`, h.productRemovedProfileDir === true && a.productRemovedProfileDir === false);
    ok(`${c}: HEAD debug: phase kill present, state-cleared absent, removed(path) line BEFORE the Fatal line, no 'could not clear' warning`, h.debug.phaseKill && !h.debug.stateCleared && h.debug.removedIdx >= 0 && h.debug.removedIdx < h.debug.fatalIdx && !h.debug.couldNotClearWarning, JSON.stringify({ removedIdx: h.debug.removedIdx, fatalIdx: h.debug.fatalIdx }));
    ok(`${c}: state.json still records chromePid after the failed clear on BOTH (so the harness had to delete it; no 2nd CLI command ran)`, a.stateAfter.present && h.stateAfter.present && !!a.stateAfter.chromePid && !!h.stateAfter.chromePid);
  }
  if (ctl) { ok(`${c}: NEGATIVE CONTROL (bff46db build) FAILS the AC: exit 0${c === 'close' ? ' and "Session closed." printed' : ' (self-heal swallowed, fresh session started)'}`, ctl.status === 0 && ctl.acPredicate === false && (c !== 'close' || ctl.sessionClosedPrinted === true), `exit=${ctl.status} sessionClosed=${ctl.sessionClosedPrinted}`); ok(`${c}: control binary is the bff46db build (sha 48c1756c...)`, ctl.binSha256 === SHA.ctl); }
}
const m1 = R['mutB2e-close'], m2 = R['mutB2d-selfheal'];
ok('M-B2e live (swallow at the cmdClose call site) FAILS the close AC', !!m1 && m1.status === 0 && m1.acPredicate === false && m1.sessionClosedPrinted === true, m1 ? `exit=${m1.status} sessionClosed=${m1.sessionClosedPrinted}` : 'missing');
ok('M-B2d live (swallow at the self-heal call site) FAILS the self-heal AC', !!m2 && m2.status === 0 && m2.acPredicate === false, m2 ? `exit=${m2.status}` : 'missing');
ok('0.6.0 binary is the published 0.6.0 cli-bin.js (sha d71da592...)', (R['v060-close']?.binSha256 === SHA.v060) && (R['v060-selfheal']?.binSha256 === SHA.v060));
ok('HEAD binary differs from the pre-S6g build (sha != 48c1756c...)', R['head-close']?.binSha256 !== SHA.ctl && R['head-close']?.binSha256 === R['head-selfheal']?.binSha256, R['head-close']?.binSha256);
ok('every run: real TEMP identical, no leftover process, holder exited, 0 harness check failed', Object.values(R).every((r) => r.realTempIdentical && r.leftoverProcesses.length === 0 && r.holderExited && r.fails === 0), Object.values(R).map((r) => `${r.label}-${r.case}:fails=${r.fails}`).join(' '));
fs.writeFileSync(path.join(dir, 'ab-summary.txt'), out.join('\n') + '\n'); console.log(out.join('\n')); process.exitCode = bad ? 1 : 0;

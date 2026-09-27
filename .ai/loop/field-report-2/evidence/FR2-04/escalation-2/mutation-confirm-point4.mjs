// FR2-04 escalation-2, GAP-255 (test-integrity for point 1): confirms the NEW tests
// (dialog-warden.spec.ts's "FR2-04-escalation-2" describe block) actually kill the four named
// mutations from audit-5's mutations-a5.mjs — E3, E4, E6, E7 — against the CURRENT (post-fix)
// source, not just against a hypothetical.
//
// E6 and E7 target a line that escalation-2 did NOT touch (the reactive-confirmation loop inside
// listWithLiveness) — reused VERBATIM from mutations-a5.mjs's find/repl.
//
// E3 and E4's ORIGINAL mutations targeted the `bootstrap ? 0 : (this.opts.proactiveConfirmDelayMs
// ?? DEFAULT_PROACTIVE_CONFIRM_DELAY_MS)` ternary, which escalation-2 REMOVED entirely (the fix IS
// "probe immediately for everyone" — audit-5's own E3 description). Re-created here as the CLOSEST
// still-meaningful equivalent against the new source, matching the escalation-2 brief's own
// instruction to distinguish "probe immediately after Page.enable acks" (now correct) from "probe
// without ever waiting for the ack at all" (E3's real danger) and "bootstrap silently gets its own
// fast path again regardless of configured delay" (E4's real danger):
//   E3' — moves the proactive-probe scheduling OUT of the `Page.enable` `.then()` entirely (schedules
//         it immediately in `track()`, before `Page.enable` is even sent) — this is the version of
//         "probe immediately" that IS still a bug post-fix (skips the ack precondition), as opposed
//         to what escalation-2 actually ships (immediate, but still inside the ack's `.then()`).
//   E4' — reintroduces a bootstrap-only 0ms fast path that ignores whatever `proactiveConfirmDelayMs`
//         is configured to, i.e. exactly the shape of danger E4 represented (bootstrap silently
//         exempted from the configured delay) even though the code no longer has a literal ternary
//         to mutate.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const W = path.join(repoRoot, 'packages/browser/src/session/dialog-warden.ts');
const VITEST = path.join(repoRoot, 'node_modules/.bin/vitest.CMD');

const M = [
  {
    id: 'E6-no-reactive-confirmation (verbatim from audit-5 mutations-a5.mjs)',
    find: "      if (states.get(info.targetId) === 'responsive' && this.pageEnableAckedAt.has(info.targetId) && !this.confirmedResponsiveSince.has(info.targetId)) {",
    repl: '      if (false) {',
  },
  {
    id: 'E7-reactive-confirm-without-ack (verbatim from audit-5 mutations-a5.mjs)',
    find: "      if (states.get(info.targetId) === 'responsive' && this.pageEnableAckedAt.has(info.targetId) && !this.confirmedResponsiveSince.has(info.targetId)) {",
    repl: "      if (states.get(info.targetId) === 'responsive' && !this.confirmedResponsiveSince.has(info.targetId)) {",
  },
  {
    id: "E3'-probe-without-waiting-for-enable-ack (the real danger E3's name could be confused with)",
    // Moves the whole "schedule a proactive probe" block so it fires as soon as track() attaches,
    // WITHOUT waiting for Page.enable's ack at all — reads pageEnableAckedAt.has() unconditionally
    // true isn't even required; simplest faithful mutation: schedule the probe timer immediately in
    // track(), right after the session is obtained, instead of inside the `Page.enable` `.then()`.
    find: "    try {\n      // Sent, not awaited past a short cap",
    // We can't easily relocate a large block with a single find/replace without restructuring, so
    // instead we simulate "no ack precondition" the same way E7 does but for the PROACTIVE path:
    // drop the requirement that this only runs after `Page.enable` resolved by firing the probe
    // immediately (delay 0, unconditionally) INSIDE track() itself, in parallel with (not sequenced
    // after) the Page.enable send.
    replFn: null, // handled specially below (structural change, not a plain string replace)
  },
  {
    id: "E4'-bootstrap-fast-path-reintroduced (ignores configured proactiveConfirmDelayMs for bootstrap)",
    find: 'const delayMs = this.opts.proactiveConfirmDelayMs ?? DEFAULT_PROACTIVE_CONFIRM_DELAY_MS;',
    repl: "const delayMs = /* E4' mutation: bootstrap silently exempted again */ 0;",
  },
];

async function runVitest() {
  const r = spawnSync(VITEST, ['run', 'tests/unit/dialog-warden.spec.ts'], { cwd: path.join(repoRoot, 'packages/browser'), encoding: 'utf-8', shell: true, timeout: 300000 });
  const outText = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  const summary = (outText.match(/Tests\s+.*\(\d+\)/g) || []).pop() ?? '(no summary line found)';
  const failedNames = [...outText.matchAll(/(?:FAIL|×)\s+(.{0,200})/g)].map((x) => x[1].trim());
  return { exitCode: r.status, summary, failedCount: failedNames.length, failedNames: failedNames.slice(0, 40) };
}

const results = [];
const orig = await fs.readFile(W);
const origSha = sha(orig);

try {
  for (const m of M) {
    const text = (await fs.readFile(W)).toString('utf-8');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    let mutated;
    if (m.id.startsWith("E3'")) {
      // Structural mutation: add an EXTRA, immediate (no Page.enable wait) proactive probe schedule
      // right where the session is obtained in track(), reading confirmedResponsiveSince/dialogs the
      // same way the real one does, but with NO dependency on Page.enable having acked at all.
      const anchor = "    this.sessions.set(targetId, session);\n";
      const inject =
        "    this.sessions.set(targetId, session);\n" +
        "    // E3' mutation (test-integrity check): probe WITHOUT waiting for Page.enable's ack.\n" +
        "    if (!this.confirmedResponsiveSince.has(targetId) && !this.dialogs.has(targetId)) {\n" +
        "      livenessProbe(session, LIVENESS_PROBE_MS).then((state) => {\n" +
        "        if (state === 'responsive' && !this.confirmedResponsiveSince.has(targetId) && !this.dialogs.has(targetId)) {\n" +
        "          this.confirmedResponsiveSince.set(targetId, Date.now());\n" +
        "        }\n" +
        "      }).catch(() => {});\n" +
        "    }\n";
      if (!text.includes(anchor)) throw new Error(`E3' anchor not found`);
      mutated = text.replace(anchor, inject.split('\n').join(eol));
    } else {
      const find = m.find.replace(/\n/g, eol);
      const repl = m.repl.replace(/\n/g, eol);
      const count = text.split(find).length - 1;
      if (count !== 1) throw new Error(`${m.id}: find matched ${count} times, expected 1`);
      mutated = text.replace(find, repl);
    }
    await fs.writeFile(W, mutated);
    const r = await runVitest();
    results.push({ id: m.id, ...r, killed: r.exitCode !== 0 });
    console.log(`${r.exitCode !== 0 ? 'KILLED  ' : 'SURVIVED'} ${m.id} :: ${r.summary} :: ${r.failedNames.slice(0, 3).join(' | ')}`);
    // restore before the next mutation
    await fs.writeFile(W, orig);
    const afterSha = sha(await fs.readFile(W));
    if (afterSha !== origSha) {
      console.error('RESTORE FAILED after', m.id);
      process.exit(2);
    }
  }
} finally {
  // final restore + verify, defense in depth
  await fs.writeFile(W, orig);
  const finalSha = sha(await fs.readFile(W));
  await fs.writeFile(path.join(here, 'revert-confirm-point4-mutations.txt'), JSON.stringify({ at: new Date().toISOString(), results, finalRestoreOk: finalSha === origSha }, null, 2));
  console.log('finalRestoreOk', finalSha === origSha);
  if (finalSha !== origSha) process.exit(2);
}

const allKilled = results.every((r) => r.killed);
console.log(allKilled ? 'ALL 4 MUTATIONS KILLED' : 'SOME MUTATIONS SURVIVED — see revert-confirm-point4-mutations.txt');
process.exit(allKilled ? 0 : 1);

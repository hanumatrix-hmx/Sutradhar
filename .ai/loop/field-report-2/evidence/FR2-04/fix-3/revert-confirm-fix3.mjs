// FR2-04 fix-3: revert-and-confirm for each of the 8 binding decision points (decisions.md
// "Decisions for fix-3"). Same mechanism as audit-3's mutations.mjs (copied into this dir): for
// each point, apply a targeted EOL-aware find/replace that undoes exactly that point's fix in the
// REAL source file, run the specific test(s) that should catch its absence, record PASS (tests
// failed without the fix -> the fix is real and tested) or FAIL (tests still passed -> the test
// doesn't actually cover this point), then restore the original bytes and verify sha256.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { repoRoot, here } from './lib.mjs';

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const VITEST = path.join(repoRoot, 'node_modules/.bin/vitest.CMD');
const W = 'packages/browser/src/session/dialog-warden.ts';
const CDP = 'packages/browser/src/session/dialog-cdp.ts';
const CLI_ = 'packages/cli/src/dialog-cli.ts';
const BRK = 'packages/cli/src/dialog-broker.ts';

const POINTS = [
  {
    id: 'point1-attribution',
    desc: 'GAP-236: if attributeDialogHolders is short-circuited (every busy target reported as its own holder, never collateral), the popup+opener test must fail',
    file: W,
    find: '      const blockedBy = attribution.get(info.targetId);',
    repl: '      const blockedBy = undefined; void attribution;',
    pkg: 'browser',
    tests: ['tests/unit/dialog-warden.spec.ts'],
  },
  {
    id: 'point2-probe-blank-targets',
    desc: 'GAP-238: if about:blank targets are excluded from listPageTargets again, the B5 test (and blank-popup detection) must fail',
    file: CDP,
    find: ".filter((t) => t.type() === 'page')",
    repl: ".filter((t) => t.type() === 'page' && t.url() !== 'about:blank')",
    pkg: 'browser',
    tests: ['tests/unit/dialog-cdp.spec.ts'],
  },
  {
    id: 'point3-recovery-scoping',
    desc: 'GAP-236/244: if the warden recovery path never checks blockedBy before closing, the popup+opener redirect test must fail (it would close the opener instead of redirecting)',
    file: W,
    find: '    if (entry.blockedBy) {\n      const holder = dialogs.find((d) => d.targetId === entry.blockedBy);\n      return { closed: false, redirectTo: entry.blockedBy, redirectUrl: holder?.url };\n    }',
    repl: '    void entry.blockedBy;',
    pkg: 'browser',
    tests: ['tests/unit/dialog-warden.spec.ts'],
  },
  {
    id: 'point4-tabs-gated',
    desc: "GAP-237: if 'tabs' is re-added to EXEMPT_VERBS, classifyVerb('tabs') must no longer be 'guarded'",
    file: CLI_,
    find: "const EXEMPT_VERBS = new Set(['dialog', 'doctor', 'profile', 'sessions', 'close', '__dialog-warden']);",
    repl: "const EXEMPT_VERBS = new Set(['dialog', 'doctor', 'profile', 'sessions', 'close', 'tabs', '__dialog-warden']);",
    pkg: 'cli',
    tests: ['tests/unit/dialog-cli.spec.ts'],
  },
  {
    id: 'point5-fail-closed-on-timeout',
    desc: "GAP-239/241: if a 'timeout' reason is treated the same as 'clear' again, the fail-closed-on-timeout test must fail",
    file: BRK,
    find: "      if (listed.status === 'unknown') {\n        if (listed.reason === 'timeout') {\n          return blockWith([timeoutPlaceholder()], 'the dialog check could not finish in time; try the command again.');\n        }\n        return { status: 'clear' };\n      }",
    repl: "      if (listed.status === 'unknown') {\n        return { status: 'clear' };\n      }",
    pkg: 'cli',
    tests: ['tests/unit/dialog-broker.spec.ts'],
  },
  {
    id: 'point6a-no-auto-handle-hint',
    desc: 'GAP-240: if the policy loop stops splitting real vs hint dialogs and auto-handles everything again, the "never auto-handle unknown" test must fail',
    file: BRK,
    find: "      const real = listed.dialogs.filter((d) => d.dialogType !== 'unknown');\n      const hint = listed.dialogs.filter((d) => d.dialogType === 'unknown');",
    repl: '      const real = listed.dialogs;\n      const hint = [];',
    pkg: 'cli',
    tests: ['tests/unit/dialog-broker.spec.ts'],
  },
  {
    id: 'point6b-isolated-refusal',
    desc: 'GAP-240: if the isolated-target (no sibling) refusal check is removed, an isolated busy target would be closed again',
    file: W,
    find: '    const hasCollateralSibling = dialogs.some((d) => d.blockedBy === targetId);\n    if (!hasCollateralSibling) {\n      return { closed: false, isolated: true };\n    }',
    repl: '    void dialogs;',
    pkg: 'browser',
    tests: ['tests/unit/dialog-warden.spec.ts'],
  },
  {
    id: 'point7-preserve-handled-records',
    desc: 'GAP-242: if blockWith stops threading records onto the blocked result/thrown error, the dropped-records test must fail',
    file: BRK,
    find: "  const blockWith = (dialogs: BrokerDialog[], extra?: string): GateResult => {\n    if (mode === 'close') return { status: 'blocked', dialogs, records };\n    throw new DialogBlockedError(verb, dialogs, 'blocked', extra, records);\n  };",
    repl:
      "  const blockWith = (dialogs: BrokerDialog[], extra?: string): GateResult => {\n    if (mode === 'close') return { status: 'blocked', dialogs };\n    throw new DialogBlockedError(verb, dialogs, 'blocked', extra);\n  };",
    pkg: 'cli',
    tests: ['tests/unit/dialog-broker.spec.ts'],
  },
  {
    id: 'point8-clear-timer',
    desc: 'overhead: if cancellableDelay stops clearing its own timer on race settlement, the getTimerCount()===0 test must fail',
    file: CLI_,
    find: '  } finally {\n    stopped = true;\n    if (pendingTimer !== undefined) {\n      clearTimeout(pendingTimer);\n      pendingTimer = undefined;\n    }\n  }\n}',
    repl: '  } finally {\n    stopped = true;\n  }\n}',
    pkg: 'cli',
    tests: ['tests/unit/dialog-cli.spec.ts'],
  },
];

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const results = [];
for (const m of POINTS) {
  if (only.length && !only.some((o) => m.id.startsWith(o))) continue;
  const abs = path.join(repoRoot, m.file);
  const orig = await fs.readFile(abs);
  const origSha = sha(orig);
  const text = orig.toString('utf-8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const find = m.find.replace(/\n/g, eol);
  const repl = m.repl.replace(/\n/g, eol);
  const count = text.split(find).length - 1;
  if (count !== 1) {
    results.push({ id: m.id, desc: m.desc, error: `find matched ${count} times (expected 1) -- anchor drifted` });
    console.log(m.id, 'SKIP find count', count);
    continue;
  }
  try {
    for (let k = 0; k < 20; k++) {
      try {
        await fs.writeFile(abs, text.replace(find, repl));
        break;
      } catch (e) {
        if (k === 19) throw e;
        await new Promise((r) => setTimeout(r, 500 * (k + 1)));
      }
    }
    const t0 = Date.now();
    const r = spawnSync(VITEST, ['run', ...m.tests], { cwd: path.join(repoRoot, 'packages', m.pkg), encoding: 'utf-8', shell: true, timeout: 300000 });
    const outText = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
    const tl = (outText.match(/Tests\s+.*\(\d+\)/g) || []).pop() ?? '';
    const failedNames = [...outText.matchAll(/(?:FAIL|×)\s+(.{0,160})/g)].map((x) => x[1].trim()).slice(0, 6);
    const testsFailedWithoutFix = r.status !== 0;
    results.push({
      id: m.id,
      desc: m.desc,
      file: m.file,
      eol: eol === '\r\n' ? 'CRLF' : 'LF',
      verdict: testsFailedWithoutFix ? 'CONFIRMED (tests fail without the fix)' : 'NOT CONFIRMED (tests still pass without the fix)',
      tests: tl,
      failed: failedNames,
      ms: Date.now() - t0,
    });
    console.log(`${testsFailedWithoutFix ? 'CONFIRMED' : 'NOT-CONFIRMED'}  ${m.id} :: ${tl} :: ${failedNames.slice(0, 2).join(' | ')}`);
  } finally {
    for (let k = 0; k < 20; k++) {
      try {
        await fs.writeFile(abs, orig);
        break;
      } catch (e) {
        console.error('restore retry', k, e.code);
        await new Promise((r) => setTimeout(r, 500 * (k + 1)));
      }
    }
    const after = sha(await fs.readFile(abs));
    if (results.length && results[results.length - 1].id === m.id) results[results.length - 1].restoredShaOk = after === origSha;
    if (after !== origSha) {
      console.error('RESTORE FAILED for', m.file);
      process.exit(2);
    }
  }
}
await fs.writeFile(path.join(here, 'revert-confirm-results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
console.log('\nAll restores sha-verified OK.');

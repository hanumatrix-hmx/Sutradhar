// FR2-04 audit-1: revert-and-confirm / mutation runner (Auditor-written).
// Each mutation: back up the source file, apply an exact string replacement (asserting it matched
// exactly once), run the named vitest spec, record pass/fail counts, restore the file byte-for-byte
// and verify the sha256 matches the original. Source files are UNCOMMITTED Executor work, so git
// checkout is never used for restoration.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..', '..', '..', '..');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const M = [
  { id: 'M1-B6-dispose-once', pkg: 'cli', file: 'packages/cli/src/dialog-broker.ts', spec: 'tests/unit/dialog-broker.spec.ts',
    from: '  } finally {\n    await broker.dispose();\n  }\n}', to: '  } finally {\n    // mutated: no dispose\n  }\n}' },
  { id: 'M1b-B6-dispose-twice', pkg: 'cli', file: 'packages/cli/src/dialog-broker.ts', spec: 'tests/unit/dialog-broker.spec.ts',
    from: '  } finally {\n    await broker.dispose();\n  }\n}', to: '  } finally {\n    await broker.dispose();\n    await broker.dispose();\n  }\n}' },
  { id: 'M2-DC2-report-not-persisted', pkg: 'cli', file: 'packages/cli/src/dialog-cli.ts', spec: 'tests/unit/dialog-cli.spec.ts',
    from: "  if (dialogFlag === 'report') {\n    return { policy: { mode: 'report' }, persist: 'set' };\n  }", to: "  if (dialogFlag === 'report') {\n    return { policy: { mode: 'report' }, persist: 'keep' };\n  }" },
  { id: 'M3-GAP006-fn-inside-selfheal-try', pkg: 'cli', file: 'packages/cli/src/session-flow.ts', spec: 'tests/unit/session-flow.spec.ts',
    from: '  try {\n    sessionId = await deps.reattach(state);\n  } catch (err) {\n    sessionId = await deps.selfHeal(state, err);\n  }\n\n  await deps.afterAttach(sessionId, false);\n  return deps.fn(sessionId);',
    to: '  try {\n    sessionId = await deps.reattach(state);\n    await deps.afterAttach(sessionId, false);\n    return await deps.fn(sessionId);\n  } catch (err) {\n    sessionId = await deps.selfHeal(state, err);\n  }\n\n  await deps.afterAttach(sessionId, false);\n  return deps.fn(sessionId);' },
  { id: 'M4-warden-no-exit-on-disconnect', pkg: 'browser', file: 'packages/browser/src/session/dialog-warden.ts', spec: 'tests/unit/dialog-warden.spec.ts',
    from: "void this.stop('browser-disconnected');", to: '/* mutated */' },
  { id: 'M4b-warden-no-exit-on-state-change', pkg: 'browser', file: 'packages/browser/src/session/dialog-warden.ts', spec: 'tests/unit/dialog-warden.spec.ts',
    from: "if (!current) void this.stop('state-changed');", to: 'void current;' },
  { id: 'M5-auto-mode-timer-changed(T1 MCP guard)', pkg: 'browser', file: 'packages/browser/src/session/browser-tab.ts', spec: 'tests/unit/browser-tab-observability.spec.ts',
    from: "      if (policy.mode === 'report' && !isBeforeUnload) {", to: "      if ((policy.mode === 'report' || policy.mode === 'auto') && !isBeforeUnload) {" },
  // Auditor's own mutations on code with no obvious dedicated test:
  { id: 'A1-token-check-accepts-missing-header', pkg: 'browser', file: 'packages/browser/src/session/dialog-warden.ts', spec: 'tests/unit/dialog-warden.spec.ts',
    from: 'if (auth !== `Bearer ${this.token}`) {', to: 'if (auth !== undefined && auth !== `Bearer ${this.token}`) {' },
  { id: 'A2-token-check-prefix-only', pkg: 'browser', file: 'packages/browser/src/session/dialog-warden.ts', spec: 'tests/unit/dialog-warden.spec.ts',
    from: 'if (auth !== `Bearer ${this.token}`) {', to: "if (!auth?.startsWith('Bearer ')) {" },
  { id: 'A3-DirectCdpBroker-unknown-no-longer-blocks', pkg: 'cli', file: 'packages/cli/src/dialog-broker.ts', spec: 'tests/unit',
    from: "          busy.push(info.targetId);\n          dialogs.push({\n            targetId: info.targetId,\n            dialogType: 'unknown',\n            message: '',\n            url: info.url,\n            openedAt: new Date().toISOString(),\n          });",
    to: '          busy.push(info.targetId);' },
  { id: 'A4-warden-binds-all-interfaces', pkg: 'browser', file: 'packages/browser/src/session/dialog-warden.ts', spec: 'tests/unit/dialog-warden.spec.ts',
    from: "this.server!.listen(0, '127.0.0.1', () => resolve());", to: "this.server!.listen(0, '0.0.0.0', () => resolve());" },
  { id: 'A5-gate-unknown-status-falls-to-clear-vs-block', pkg: 'cli', file: 'packages/cli/src/dialog-broker.ts', spec: 'tests/unit',
    from: "if (listed.status === 'unknown') return { status: 'clear' };", to: "if (listed.status === 'unknown') throw new DialogBlockedError(verb, [], 'blocked');" },
  { id: 'A6-warden-closed-event-ignored', pkg: 'browser', file: 'packages/browser/src/session/dialog-warden.ts', spec: 'tests/unit/dialog-warden.spec.ts',
    from: "    session.on('Page.javascriptDialogClosed', () => {\n      this.dialogs.delete(targetId);", to: "    session.on('Page.javascriptDialogClosed', () => {\n      void 0;" },
  { id: 'A7-stopWarden-in-close-removed(no unit guard expected)', pkg: 'cli', file: 'packages/cli/src/cli.ts', spec: 'tests/unit',
    from: "  await stopWarden(STATE_DIR).catch(() => {});\n  if (state.profileName && !closeBlocked) {", to: "  if (state.profileName && !closeBlocked) {" },
];

const only = process.argv.slice(2);
const out = [];
for (const m of M) {
  if (only.length && !only.some((o) => m.id.startsWith(o))) continue;
  const abs = path.join(root, m.file);
  const orig = await fs.readFile(abs);
  const origSha = sha(orig);
  const text = orig.toString('utf-8');
  const count = text.split(m.from).length - 1;
  if (count !== 1) { out.push({ id: m.id, error: `pattern matched ${count} times` }); console.log(m.id, 'PATTERN', count); continue; }
  await fs.writeFile(abs, text.replace(m.from, m.to));
  let res;
  try {
    res = spawnSync(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', m.spec], { cwd: path.join(root, 'packages', m.pkg), encoding: 'utf-8', maxBuffer: 64 << 20, timeout: 300000 });
  } finally {
    await fs.writeFile(abs, orig);
  }
  const restored = sha(await fs.readFile(abs)) === origSha;
  const clean = (res.stdout + res.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  const tests = /Tests\s+(.*)/.exec(clean)?.[1]?.trim();
  const failedNames = [...clean.matchAll(/(?:FAIL|×)\s+(.*)/g)].map((x) => x[1].trim()).slice(0, 12);
  const caught = res.status !== 0;
  out.push({ id: m.id, file: m.file, spec: m.spec, exit: res.status, caught, tests, failedNames, restored });
  console.log(`${m.id}: ${caught ? 'CAUGHT' : 'NOT CAUGHT'} (${tests}) restored=${restored}`);
}
await fs.writeFile(path.join(here, `mutations-results${only.length ? '-' + only.join('+') : ''}.json`), JSON.stringify(out, null, 2));

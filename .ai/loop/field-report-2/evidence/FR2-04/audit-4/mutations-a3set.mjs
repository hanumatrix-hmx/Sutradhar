// FR2-04 audit-2: test-integrity mutations. Each mutation edits ONE product source file (EOL-aware:
// the find/replace strings are written with \n and converted to the file's own EOL), runs the
// named vitest file(s) for that package, then restores the original bytes and verifies sha256.
// A mutation "KILLED" = at least one test failed. "SURVIVED" = all tests still passed.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { repoRoot, here } from './lib.mjs';

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const VITEST = path.join(repoRoot, 'node_modules/.bin/vitest.CMD');
const W = 'packages/browser/src/session/dialog-warden.ts';
const B = 'packages/cli/src/dialog-broker.ts';
const C = 'packages/cli/src/warden-control.ts';
const S = 'packages/browser/src/session/browser-session.ts';

const M = [
  { id: 'M1-WD7-bind-0.0.0.0', file: W, find: "this.server!.listen(0, '127.0.0.1', () => resolve());", repl: "this.server!.listen(0, '0.0.0.0', () => resolve());", pkg: 'browser', tests: ['tests/unit/dialog-warden.spec.ts'], expect: 'WD7' },
  { id: 'M2-WD3-missing-token-accepted', file: W, find: 'if (auth !== `Bearer ${this.token}`) {', repl: 'if (auth !== undefined && auth !== `Bearer ${this.token}`) {', pkg: 'browser', tests: ['tests/unit/dialog-warden.spec.ts'], expect: 'WD3' },
  { id: 'M3-direct-unknown-reported-busy-only', file: B, find: "          busy.push(info.targetId);\n          dialogs.push({", repl: "          busy.push(info.targetId);\n          if (Math.random() > 2) dialogs.push({", pkg: 'cli', tests: ['tests/unit/direct-cdp-broker.spec.ts'], expect: 'GAP-225 unknown blocks' },
  { id: 'M4-WC5-no-spawn-lock', file: C, find: "    try {\n      const handle = await open(lockPath, 'wx');", repl: "    if (Date.now() > 0) return true;\n    try {\n      const handle = await open(lockPath, 'wx');", pkg: 'cli', tests: ['tests/unit/warden-control.spec.ts'], expect: 'WC5' },
  { id: 'M5-WC6-no-stale-recovery', file: C, find: '      if (!stale) return false;', repl: '      if (!stale || true) return false;', pkg: 'cli', tests: ['tests/unit/warden-control.spec.ts'], expect: 'WC6' },
  { id: 'M5b-WC6-age-only-staleness(ignore dead pid)', file: C, find: '!existing || !isPidAlive(existing.pid) ||', repl: '!existing ||', pkg: 'cli', tests: ['tests/unit/warden-control.spec.ts'], expect: 'WC6' },
  { id: 'M6a-SD1-createTab-no-policy', file: S, find: "const tab = new BrowserTab(tabId, url, 'New Tab', isFirstTab, puppeteerPage, this.id, this.eventBus, this.dialogPolicy);", repl: "const tab = new BrowserTab(tabId, url, 'New Tab', isFirstTab, puppeteerPage, this.id, this.eventBus);", pkg: 'browser', tests: ['tests/unit/session.spec.ts'], expect: 'S-D1/S-D2' },
  { id: 'M6b-SD1-popup-no-policy', file: S, find: "const tab = new BrowserTab(tabId, page.url() || 'about:blank', 'New Tab', false, page, this.id, this.eventBus, this.dialogPolicy);", repl: "const tab = new BrowserTab(tabId, page.url() || 'about:blank', 'New Tab', false, page, this.id, this.eventBus);", pkg: 'browser', tests: ['tests/unit/session.spec.ts'], expect: 'S-D1' },
  { id: 'M6c-SD1-adopt-no-policy', file: S, find: "      this.eventBus,\n      this.dialogPolicy,\n    );", repl: "      this.eventBus,\n    );", pkg: 'browser', tests: ['tests/unit/session.spec.ts'], expect: 'S-D1' },
  { id: 'M7-SD2-setDialogPolicy-no-propagation', file: S, find: '    for (const tab of this.tabsMap.values()) {\n      tab.setDialogPolicy(policy);\n    }', repl: '    for (const tab of [] as BrowserTab[]) {\n      tab.setDialogPolicy(policy);\n    }', pkg: 'browser', tests: ['tests/unit/session.spec.ts'], expect: 'S-D2' },
  { id: 'M8-GAP221-gate-no-default-fallback', file: B, find: '(policy.promptText ?? dialog.defaultValue)', repl: '(policy.promptText)', pkg: 'cli', tests: ['tests/unit/dialog-broker.spec.ts'], expect: 'GAP-221' },
  { id: 'M9-GAP223-warden-ignores-dialogId(409)', file: W, find: 'if (dialogId !== undefined && dialog.id !== dialogId) {', repl: 'if (false && dialogId !== undefined && dialog.id !== dialogId) {', pkg: 'browser', tests: ['tests/unit/dialog-warden.spec.ts'], expect: 'GAP-223 409 path' },
  { id: 'M10-GAP223-policy-identity-check-removed', file: W, find: '    if (!stillPending || stillPending.handled || stillPending !== expected) return;', repl: '    if (!stillPending || stillPending.handled) return;', pkg: 'browser', tests: ['tests/unit/dialog-warden.spec.ts'], expect: 'GAP-223 late-handle identity' },
  { id: 'M10b-GAP223-both-identity-checks-removed', file: W, find: "    if (!dialog || dialog.handled || dialog !== expected) return;\n", repl: "    if (!dialog || dialog.handled) return;\n", pkg: 'browser', tests: ['tests/unit/dialog-warden.spec.ts'], expect: 'GAP-223 late-handle identity (1st check)' },
  { id: 'M11-GAP220-never-probe', file: W, find: '      if (this.pageEnableAckedAt.has(info.targetId)) continue;', repl: '      if (this.pageEnableAckedAt.has(info.targetId) || true) continue;', pkg: 'browser', tests: ['tests/unit/dialog-warden.spec.ts'], expect: 'WD9' },
  { id: 'M12-GAP220-probe-everything', file: W, find: '      if (this.pageEnableAckedAt.has(info.targetId)) continue;', repl: '', pkg: 'browser', tests: ['tests/unit/dialog-warden.spec.ts'], expect: 'WD11' },
  { id: 'M13-GAP220-bootstrap-skips-blank', file: W, find: "      if (target.type() === 'page') await this.track(target);\n    }\n\n    await this.listen();", repl: "      if (target.type() === 'page' && target.url() !== 'about:blank') await this.track(target);\n    }\n\n    await this.listen();", pkg: 'browser', tests: ['tests/unit/dialog-warden.spec.ts'], expect: 'WD12' },
  { id: 'M14-GAP222-no-lazy-connect', file: B, find: '    if (!this.browser) {\n      const browser = await connectForDialogs(this.wsEndpoint, GATE_CONNECT_TIMEOUT_MS);', repl: "    if (!this.browser) throw new Error('DirectCdpBroker.handle called before list()');\n    if (!this.browser) {\n      const browser = await connectForDialogs(this.wsEndpoint, GATE_CONNECT_TIMEOUT_MS);", pkg: 'cli', tests: ['tests/unit/direct-cdp-broker.spec.ts'], expect: 'GAP-222' },
  { id: 'M15-gate-dispose-skipped', file: B, find: '  } finally {\n    await broker.dispose();\n  }', repl: '  } finally {\n  }', pkg: 'cli', tests: ['tests/unit/dialog-broker.spec.ts'], expect: 'B6' },
  { id: 'M16-warden-never-releases-own-attach', file: W, find: "        session.send('Runtime.runIfWaitingForDebugger').catch(() => {});\n      }", repl: "      }", pkg: 'browser', tests: ['tests/unit/dialog-warden.spec.ts'], expect: 'never leave a target paused' },
  { id: 'M17-liveness-probe-budget-10s', file: W, find: 'export const LIVENESS_PROBE_MS = 400;', repl: 'export const LIVENESS_PROBE_MS = 10000;', pkg: 'browser', tests: ['tests/unit/dialog-warden.spec.ts'], expect: 'probe bound' },
  // ---- audit-3 additions: fix-2 code (whole-package vitest run, see WHOLE below) ----
  { id: 'M18-probe-signal-back-to-Runtime.evaluate', file: 'packages/browser/src/session/dialog-cdp.ts', find: "await session.send('Performance.getMetrics', undefined, { timeout: ms });", repl: "await session.send('Runtime.evaluate', { expression: '1', returnByValue: true }, { timeout: ms });", pkg: 'browser', tests: [], expect: 'GAP-228 signal' },
  { id: 'M19-regate-single-round', file: B, find: 'const GATE_REGATE_MAX_ROUNDS = 5;', repl: 'const GATE_REGATE_MAX_ROUNDS = 1;', pkg: 'cli', tests: [], expect: 'GAP-229 chain loop' },
  { id: 'M20-no-final-fail-closed', file: B, find: "if (finalListed.status !== 'unknown' && finalListed.dialogs.length > 0) {", repl: 'if (false) {', pkg: 'cli', tests: [], expect: 'GAP-229 fail closed' },
  { id: 'M20b-regate-loop-returns-after-first-handle', file: B, find: "      if (Date.now() - startedAt > GATE_REGATE_BUDGET_MS) break;", repl: "      return { status: 'handled', records };", pkg: 'cli', tests: [], expect: 'GAP-229 re-list' },
  { id: 'M21-recover-without-reprobe', file: 'packages/browser/src/session/dialog-warden.ts', find: "    if (state === 'responsive') return false; // it cleared on its own", repl: "    if (false) return false; // it cleared on its own", pkg: 'browser', tests: [], expect: 'GAP-230 never close a healthy tab' },
  { id: 'M21b-no-recovery-at-all', file: 'packages/browser/src/session/dialog-warden.ts', find: "          const recovered = await this.tryRecoverUnknownTarget(targetId);", repl: "          const recovered = false as boolean;", pkg: 'browser', tests: [], expect: 'GAP-230 recovery' },
  { id: 'M22-lock-no-readback', file: C, find: 'return after.pid === payload.pid && after.startedAt === payload.startedAt;', repl: 'return true;', pkg: 'cli', tests: [], expect: 'GAP-231 read-back' },
  { id: 'M23-rival-check-disabled', file: C, find: 'return !!health && health.wsEndpoint === wsEndpoint;', repl: 'return false;', pkg: 'cli', tests: [], expect: 'GAP-231 singleton' },
  { id: 'M24-direct-no-recovery', file: B, find: "      if (state === 'responsive') throw err;\n      await closeTargetAtBrowserLevel(this.browser, targetId);", repl: "      throw err;\n      await closeTargetAtBrowserLevel(this.browser, targetId);", pkg: 'cli', tests: [], expect: 'GAP-230 direct recovery' },
  { id: 'M24b-direct-recovery-no-reprobe', file: B, find: "      if (state === 'responsive') throw err;\n      await closeTargetAtBrowserLevel(this.browser, targetId);", repl: "      void state;\n      await closeTargetAtBrowserLevel(this.browser, targetId);", pkg: 'cli', tests: [], expect: 'GAP-230 never close healthy (direct)' },
  { id: 'M25-tabs-gated-again', file: 'packages/cli/src/dialog-cli.ts', find: "'close', 'tabs', '__dialog-warden'", repl: "'close', '__dialog-warden'", pkg: 'cli', tests: [], expect: 'GAP-230 tabs ungated' },
  { id: 'M26-closedTarget-not-surfaced', file: B, find: '    if (body?.closedTarget) return { closedTarget: true, message: body.message };', repl: '    void body;', pkg: 'cli', tests: [], expect: 'GAP-230 honest message' },
];

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const results = [];
for (const m of M) {
  if (only.length && !only.some((o) => m.id.startsWith(o))) continue;
  const abs = path.join(repoRoot, m.file);
  const orig = await fs.readFile(abs);
  const origSha = sha(orig);
  const text = orig.toString('utf-8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const find = m.find.replace(/\n/g, eol), repl = m.repl.replace(/\n/g, eol);
  const count = text.split(find).length - 1;
  if (count !== 1) { results.push({ id: m.id, error: `find matched ${count} times` }); console.log(m.id, 'SKIP find count', count); continue; }
  let r;
  try {
    for (let k = 0; k < 20; k++) { try { await fs.writeFile(abs, text.replace(find, repl)); break; } catch (e) { if (k === 19) throw e; await new Promise((r) => setTimeout(r, 500 * (k + 1))); } }
    const t0 = Date.now();
    r = spawnSync(VITEST, ['run', ...(process.env.WHOLE ? [] : m.tests)], { cwd: path.join(repoRoot, 'packages', m.pkg), encoding: 'utf-8', shell: true, timeout: 300000 });
    const outText = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
    const tl = (outText.match(/Tests\s+.*\(\d+\)/g) || []).pop() ?? '';
    const failedNames = [...outText.matchAll(/(?:FAIL|×)\s+(.{0,160})/g)].map((x) => x[1].trim()).slice(0, 6);
    const killed = r.status !== 0;
    results.push({ id: m.id, file: m.file, eol: eol === '\r\n' ? 'CRLF' : 'LF', expect: m.expect, verdict: killed ? 'KILLED' : 'SURVIVED', tests: tl, failed: failedNames, ms: Date.now() - t0 });
    console.log(`${killed ? 'KILLED  ' : 'SURVIVED'} ${m.id} :: ${tl} :: ${failedNames.slice(0, 2).join(' | ')}`);
  } finally {
    for (let k = 0; k < 20; k++) { try { await fs.writeFile(abs, orig); break; } catch (e) { console.error("restore retry", k, e.code); await new Promise((r) => setTimeout(r, 500 * (k + 1))); } }
    const after = sha(await fs.readFile(abs));
    results[results.length - 1].restoredShaOk = after === origSha;
    if (after !== origSha) { console.error('RESTORE FAILED for', m.file); process.exit(2); }
  }
}
const tag = only.length ? only.join('+') : 'all';
await fs.writeFile(path.join(here, `mutations-a3set-${tag}.json`), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));

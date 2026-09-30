// FR2-08 REVERT-AND-CONFIRM (unit): applies each mutant of MY OWN code to one source file, runs the unit suites that
// should pin that behaviour, records whether they FAIL (caught), restores the file byte-identically (sha256 checked before,
// after every restore, and at the end). Usage: node mutate-unit.mjs <repoRoot> <outJson> [--only=U1,U2]
// Touches only the mutated file, and always restores it. Hard timeout per mutant run: 240 s.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const repo = process.argv[2];
const out = process.argv[3];
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const vitest = path.join(repo, 'node_modules', 'vitest', 'vitest.mjs');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const CW = 'packages/browser/src/actions/condition-wait.ts';
const PS = 'packages/browser/src/actions/page-settle.ts';
const RT = 'packages/capability-runtime/src/runtime.ts';
const TL = 'packages/mcp-server/src/tools.ts';
const PG = 'packages/sutradhar/src/page.ts';
const PA = 'packages/cli/src/parse-args.ts';
const CWS = { pkg: 'packages/browser', specs: ['tests/unit/condition-wait.spec.ts'] };
const PSS = { pkg: 'packages/browser', specs: ['tests/unit/page-settle.spec.ts', 'tests/unit/browser-action-engine.spec.ts'] };

/** `from` must occur EXACTLY once in `file`. */
const MUTANTS = [
  { id: 'U1', why: 'wait_for treats "unavailable" as met (only "unmet" blocks success)', file: CW, ...CWS,
    from: "CONDITION_KEYS.every((k) => condition[k] === undefined || st.results[k] === 'met')", to: "CONDITION_KEYS.every((k) => condition[k] === undefined || st.results[k] !== 'unmet')" },
  { id: 'U2', why: 'textGone reads "unavailable" as gone', file: CW, ...CWS,
    from: "          st.results[k] = 'unavailable';\n          st.details[k] = r.detail;\n          continue;", to: "          st.results[k] = k === 'textGone' ? 'met' : 'unavailable';\n          st.details[k] = r.detail;\n          continue;" },
  { id: 'U3', why: 'the condition is checked ONCE only (poll never re-evaluates)', file: CW, ...CWS,
    from: 'if (left <= 0) return finish(false);', to: 'return finish(false);' },
  { id: 'U4', why: 'timeout not honoured (the deadline is 60 s later than asked)', file: CW, ...CWS,
    from: 'const deadline = start + opts.timeoutMs;', to: 'const deadline = start + opts.timeoutMs + 60000;' },
  { id: 'U4b', why: 'timeout not honoured, bounded variant (the deadline is 1.5 s later than asked: "0 = check once" becomes several polls)', file: CW, ...CWS,
    from: 'const deadline = start + opts.timeoutMs;', to: 'const deadline = start + opts.timeoutMs + 1500;' },
  { id: 'U5', why: 'a pending native dialog is ignored (page probes run into it)', file: CW, ...CWS,
    from: '        if (dialog) {\n          const t = now();', to: '        if ((false as boolean) && dialog) {\n          const t = now();' },
  { id: 'U6', why: 'multiple conditions are ORed instead of ANDed', file: CW, ...CWS,
    from: "CONDITION_KEYS.every((k) => condition[k] === undefined || st.results[k] === 'met')", to: "CONDITION_KEYS.some((k) => condition[k] !== undefined && st.results[k] === 'met')" },
  { id: 'U7', why: 'a js throw is treated as transient (never fatal)', file: CW, ...CWS,
    from: '          if (isTransientContextError(e)) {', to: '          if (true as boolean) {' },
  { id: 'U8', why: 'presentAtStart comes from the LAST definitive pass, not the first', file: CW, ...CWS,
    from: 'presentAtStart ??= found; // the first DEFINITIVE pass', to: 'presentAtStart = found;' },
  { id: 'U9', why: 'a closed tab is not detected', file: CW, ...CWS,
    from: '    if (closed) {\n      return finish(false, {\n        kind: \'page-closed\',', to: '    if ((false as boolean) && closed) {\n      return finish(false, {\n        kind: \'page-closed\',' },
  { id: 'U10', why: 'wait_for text probe bypasses the shared frame-aware probe: no per-frame unavailable (any throw = not found)', file: CW, ...CWS,
    from: "        if (r.result === 'unavailable') {", to: "        if (r.result === 'unavailable' && false) {" },
  { id: 'U11', why: 'NO Node-side settle hard bound (the T5 defect restored)', file: PS, ...PSS,
    from: 'await Promise.race([Promise.all([domQuiet, networkIdle]), hardBound]);', to: 'await Promise.all([domQuiet, networkIdle]);' },
  { id: 'U12', why: 'the settle hard-bound timer is never cleared', file: PS, ...PSS,
    from: '    if (hardTimer) clearTimeout(hardTimer);', to: '' },
  { id: 'U13', why: 'settle skipped for the newly covered engine-routed tools (settleParam always empty)', file: RT, pkg: 'packages/capability-runtime', specs: ['tests/unit/runtime.spec.ts'],
    from: 'return settle ? { settle } : {};', to: 'return {};' },
  { id: 'U14', why: 'settlePage is a no-op (runtime-level methods never settle)', file: RT, pkg: 'packages/capability-runtime', specs: ['tests/unit/runtime.spec.ts'],
    from: 'if (settle && this.hasRealPage(tab)) await waitForPageSettle(tab.page!, settle);', to: '' },
  { id: 'U15', why: 'a vacuous textGone is reported verified (the typo trap hidden)', file: RT, pkg: 'packages/capability-runtime', specs: ['tests/unit/runtime.spec.ts'],
    from: '    if (presentAtStart === false) {\n      vacuous = true;', to: '    if ((false as boolean) && presentAtStart === false) {\n      vacuous = true;' },
  { id: 'U16', why: 'fillForm settles per field instead of once (the per-field type gets settle)', file: RT, pkg: 'packages/capability-runtime', specs: ['tests/unit/runtime.spec.ts'],
    from: 'results[target] = await this.type(sessionId, target, value, tabId).catch(', to: 'results[target] = await this.type(sessionId, target, value, tabId, settle).catch(' },
  { id: 'U17', why: 'the wait_for error hint no longer matches (falls through to the generic "page may still be loading")', file: TL, pkg: 'packages/mcp-server', specs: ['tests/unit/tools.spec.ts'],
    from: "    'wait_for timed out',\n    'The condition never became true.", to: "    'wait_for tim3d out',\n    'The condition never became true." },
  { id: 'U18', why: 'handle_dialog drops settle', file: TL, pkg: 'packages/mcp-server', specs: ['tests/unit/tools.spec.ts'],
    from: 'runtime.handleDialog(sessionId, action, promptText, tabId, ...trimTrailingUndefined([settle]))', to: 'runtime.handleDialog(sessionId, action, promptText, tabId)' },
  { id: 'U19', why: 'wait_for tool drops timeoutMs', file: TL, pkg: 'packages/mcp-server', specs: ['tests/unit/tools.spec.ts'],
    from: 'Object.entries({ text, textGone, url, js, timeoutMs })', to: 'Object.entries({ text, textGone, url, js })' },
  { id: 'U20', why: 'a newly wired tool (hover) drops settle from the runtime call', file: TL, pkg: 'packages/mcp-server', specs: ['tests/unit/tools.spec.ts'],
    from: 'runtime.hover(sessionId, target, tabId, offset, ...expectSettleArgs(expect, settle))', to: 'runtime.hover(sessionId, target, tabId, offset, ...(expect ? [expect] : []))' },
  { id: 'U21', why: 'SDK waitFor swallows a failed wait (no throw)', file: PG, pkg: 'packages/sutradhar', specs: ['tests/unit/api.spec.ts'],
    from: '    if (!r.success) throw new ActionFailedError(r);\n    return r;\n  }\n\n  /**\n   * Click `selector` (the element that triggers a download)', to: '    return r;\n  }\n\n  /**\n   * Click `selector` (the element that triggers a download)' },
  { id: 'U22', why: 'CLI waitfor timeout cap raised past the watchdog', file: PA, pkg: 'packages/cli', specs: ['tests/unit/parse-args.spec.ts'],
    from: 'export const WAITFOR_CLI_MAX_TIMEOUT_MS = 280000;', to: 'export const WAITFOR_CLI_MAX_TIMEOUT_MS = 999999;' },
  { id: 'U23', why: 'CLI --text-gone value is not consumed as a value (leaks into cleanArgs)', file: PA, pkg: 'packages/cli', specs: ['tests/unit/parse-args.spec.ts'],
    from: '    (waitTextGoneIndex !== -1 && waitTextGoneValue !== undefined && i === waitTextGoneIndex + 1) ||\n', to: '' },
];

const results = [];
const originals = new Map();
try {
  for (const m of MUTANTS) {
    if (only.length && !only.includes(m.id)) continue;
    const target = path.join(repo, m.file);
    if (!originals.has(target)) originals.set(target, fs.readFileSync(target));
    const original = originals.get(target);
    const shaBefore = sha(original);
    const src = original.toString('utf8').replace(/\r\n/g, '\n'); // patterns are written with LF; the restore writes the ORIGINAL bytes
    const count = src.split(m.from).length - 1;
    if (count !== 1) {
      results.push({ id: m.id, why: m.why, error: `pattern occurs ${count} times (need exactly 1)` });
      console.log(m.id, 'PATTERN ERROR', count);
      continue;
    }
    fs.writeFileSync(target, src.replace(m.from, () => m.to));
    const t0 = performance.now();
    const r = spawnSync(process.execPath, [vitest, 'run', '--globals', ...m.specs], { cwd: path.join(repo, m.pkg), encoding: 'utf8', timeout: 240000, maxBuffer: 64 * 1024 * 1024 });
    const strip = ((r.stdout ?? '') + (r.stderr ?? '')).replace(/\x1b\[[0-9;]*m/g, '');
    const failedTests = [...strip.matchAll(/FAIL\s+tests\/unit\/[^\n]*/g)].map((x) => x[0].slice(0, 240));
    const summary = (strip.match(/Tests\s+[^\n]*/) ?? [''])[0];
    fs.writeFileSync(target, original); // restore the ORIGINAL bytes immediately
    const row = { id: m.id, why: m.why, file: m.file, unitCaught: r.status !== 0, exit: r.status, timedOut: r.error?.code === 'ETIMEDOUT', summary, firstFailures: [...new Set(failedTests)].slice(0, 4), failedCount: failedTests.length, restoredIdentical: sha(fs.readFileSync(target)) === shaBefore, ms: Math.round(performance.now() - t0) };
    results.push(row);
    console.log(m.id, row.unitCaught ? 'CAUGHT' : 'NOT CAUGHT', summary.trim(), 'restored:', row.restoredIdentical);
  }
} finally {
  for (const [t, b] of originals) fs.writeFileSync(t, b);
}
const shas = {};
for (const [t, b] of originals) shas[path.relative(repo, t)] = { before: sha(b), after: sha(fs.readFileSync(t)) };
fs.writeFileSync(out, JSON.stringify({ allIdentical: Object.values(shas).every((x) => x.before === x.after), shas, results }, null, 2));
console.log('caught', results.filter((x) => x.unitCaught).length, 'of', results.length, '; all files identical:', Object.values(shas).every((x) => x.before === x.after));

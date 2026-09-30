// FR2-11 mutation driver. Applies ONE mutant at a time to the executor's own source, runs the unit spec(s) that should
// catch it and (for the live ones) rebuilds the package and runs the live-verify script subset, then restores the file
// BYTE-IDENTICALLY (sha256 before/after) and rebuilds again. A mutant is CAUGHT when the unit run exits non-zero and/or the
// live run exits non-zero (whichever the table asks for). Results -> <evidence>/mutants.json.
//
// Run: node tools/scenario-suite/mutate-fr2-11.mjs [--only=M01,M05] [--unit-only]
// Only ever edits files listed in the table below, never anything under tests/ or tools/.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FIX1_MUTANTS } from './mutate-fr2-11-fix1-table.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const EVIDENCE_DIR =
  process.env.SUTRADHAR_FR2_11_EVIDENCE_DIR ?? path.join(repoRoot, '.ai', 'loop', 'field-report-2', 'evidence', 'FR2-11', 'run-1');
const args = process.argv.slice(2);
const ONLY = (args.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const UNIT_ONLY = args.includes('--unit-only');
const vitest = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'vitest.CMD' : 'vitest');
const tsc = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.CMD' : 'tsc');

const B = 'packages/browser';
const R = 'packages/capability-runtime';
const M = 'packages/mcp-server';
const C = 'packages/cli';

// unit: [pkg, [spec files]]   live: { pkg (to rebuild), surface, only }
const MUTANTS = [
  { id: 'M01', what: 'navigate is not recorded', file: `${R}/src/runtime.ts`, find: '    const startedAt = performance.now();', replace: "    if (meta.actionType === 'navigate') return run();\n    const startedAt = performance.now();", unit: [R, ['tests/unit/action-history.spec.ts']], live: { pkg: R, surface: 'mcp', only: 'L1' } },
  { id: 'M02', what: 'eval is not recorded', file: `${R}/src/runtime.ts`, find: '    const startedAt = performance.now();', replace: "    if (meta.actionType === 'eval') return run();\n    const startedAt = performance.now();", unit: [R, ['tests/unit/action-history.spec.ts']] },
  { id: 'M03', what: 'verification dropped from engine entries', file: `${B}/src/actions/browser-action-engine.ts`, find: '      ...(r.verification ? { verification: scrubVerification(params, r.verification) } : {}),\n', replace: '      ...(false ? { verification: scrubVerification(params, r.verification!) } : {}),\n', unit: [B, ['tests/unit/browser-action-engine.spec.ts']], live: { pkg: B, surface: 'mcp', only: 'L1' } },
  { id: 'M03b', what: 'verification dropped from runtime-level entries (navigate/back/...)', file: `${R}/src/runtime.ts`, find: '          ...(extra.verification ? { verification: extra.verification } : {}),\n', replace: '', unit: [R, ['tests/unit/action-history.spec.ts']], live: { pkg: R, surface: 'mcp', only: 'L1' } },
  { id: 'M04a', what: 'per-tab eviction count never incremented (eviction silent again)', file: `${B}/src/session/browser-tab.ts`, find: "this.actionHistoryEvicted++; // counted, never reset for this tab's lifetime", replace: '/* mutant: not counted */', unit: [B, ['tests/unit/session-action-history.spec.ts']], live: { pkg: B, surface: 'mcp', only: 'L3' } },
  { id: 'M04b', what: 'session eviction count off by one (+2 per eviction)', file: `${B}/src/session/browser-session.ts`, find: 'this.sessionActionEvicted++;', replace: 'this.sessionActionEvicted += 2;', unit: [B, ['tests/unit/session-action-history.spec.ts']], live: { pkg: B, surface: 'mcp', only: 'L3' } },
  { id: 'M05', what: 'URL query string leaked into history', file: `${B}/src/session/action-history.ts`, find: '      return u.origin + cutAtDelimiter(u.pathname);', replace: '      return u.origin + cutAtDelimiter(u.pathname) + u.search;', unit: [B, ['tests/unit/action-history.spec.ts']], live: { pkg: B, surface: 'mcp', only: 'L1' } },
  { id: 'M06', what: 'typed value not scrubbed from failure errors / verification (a password reaches the history)', file: `${B}/src/session/action-history.ts`, find: 'export function scrubActionError(params: ActionParams, error: string): string {', replace: 'export function scrubActionError(params: ActionParams, error: string): string {\n  if (error.length >= 0) return error;', unit: [B, ['tests/unit/action-history.spec.ts', 'tests/unit/browser-action-engine.spec.ts']], live: { pkg: B, surface: 'mcp', only: 'L1,L1b' } },
  { id: 'M06b', what: 'engine records the typed value as the target of a type action', file: `${B}/src/session/action-history.ts`, find: "    case 'click_by_text':\n      return params.text;", replace: "    case 'type':\n      return params.value;\n    case 'click_by_text':\n      return params.text;", unit: [B, ['tests/unit/action-history.spec.ts', 'tests/unit/browser-action-engine.spec.ts']] },
  { id: 'M07', what: 'CLI type args recorded raw (typed text on disk)', file: `${C}/src/history-file.ts`, find: "      return args.length === 0 ? [] : [fin(args[0]!), ...(args.length > 1 ? [lenTag(args.slice(1).join(' '))] : [])];\n    case 'setclipboard':", replace: "      return args.map(fin);\n    case 'setclipboard':", unit: [C, ['tests/unit/history-file.spec.ts']], live: { pkg: C, surface: 'cli', only: 'L5' } },
  { id: 'M08', what: 'concurrent appends can interleave (line written in 512-byte slices)', file: `${C}/src/history-file.ts`, find: 'const { bytesWritten } = await fh.write(buf, written, buf.length - written);', replace: 'const { bytesWritten } = await fh.write(buf, written, Math.min(512, buf.length - written));', unit: [C, ['tests/unit/history-file.spec.ts']], live: { pkg: C, surface: 'cli', only: 'L7b' } },
  { id: 'M09', what: 'a torn/partial history line crashes the reader', file: `${C}/src/history-file.ts`, find: '    } catch {\n      skipped++;\n      continue;\n    }', replace: '    } catch (e) {\n      throw e;\n    }', unit: [C, ['tests/unit/history-file.spec.ts']], live: { pkg: C, surface: 'cli', only: 'L5,N7' } },
  { id: 'M10', what: 'history.jsonl deleted when session state is cleared', file: `${C}/src/state.ts`, find: 'await rm(STATE_FILE, { force: true });', replace: 'await rm(STATE_FILE, { force: true });\n  await rm(HISTORY_FILE_PATH, { force: true });', unit: [C, ['tests/unit/history-file.spec.ts']], live: { pkg: C, surface: 'cli', only: 'L5,L6' } },
  { id: 'M11', what: 'torn-line repair removed (next append glued onto the fragment)', file: `${C}/src/history-file.ts`, find: "if (bytesRead === 1 && last[0] !== 0x0a) prefix = '\\n';", replace: 'void bytesRead;', unit: [C, ['tests/unit/history-file.spec.ts']], live: { pkg: C, surface: 'cli', only: 'L5,N7' } },
  { id: 'M12', what: 'CLI records exit code 0 for every command', file: `${C}/src/cli.ts`, find: 'await recordCliCommand(finalExitCode ?? Number(process.exitCode ?? 0), commandErrorMessage);', replace: 'await recordCliCommand(0, commandErrorMessage);', unit: null, live: { pkg: C, surface: 'cli', only: 'L5' } },
  { id: 'M13', what: 'adopted-page tabs are not wired into the session ring', file: `${B}/src/session/browser-session.ts`, find: '    this.wireActionHistory(tab);\n    this.tabsMap.set(tabId, tab);\n    if (makeActive || isFirstTab) {', replace: '    this.tabsMap.set(tabId, tab);\n    if (makeActive || isFirstTab) {', unit: [B, ['tests/unit/session-action-history.spec.ts']], live: { pkg: B, surface: 'cli', only: 'L5' } },
  { id: 'M14', what: 'MCP ignores the scope argument', file: `${M}/src/tools.ts`, find: 'const report = runtime.getActionHistoryReport(sessionId, { scope, tabId });', replace: 'const report = runtime.getActionHistoryReport(sessionId, { scope: scope && undefined, tabId });', unit: [M, ['tests/unit/tools.spec.ts']], live: { pkg: M, surface: 'mcp', only: 'L1,L2' } },
  { id: 'M15', what: 'eviction of the CLI file never rotates', file: `${C}/src/history-file.ts`, find: 'if (st.isFile() && st.size >= rotateBytes) {', replace: 'if (st.isFile() && st.size >= rotateBytes * 1e9) {', unit: [C, ['tests/unit/history-file.spec.ts']], live: { pkg: C, surface: 'cli', only: 'L8' } },
  { id: 'M16', what: 'verification.reason not URL-redacted', file: `${B}/src/session/action-history.ts`, find: "  if (typeof v.reason === 'string') out.reason = redactedString(v.reason, HISTORY_TEXT_CAP);", replace: '  /* mutant */', unit: [B, ['tests/unit/action-history.spec.ts']] },
  { id: 'M17', what: 'duplicate-guard rejection not recorded', file: `${B}/src/actions/browser-action-engine.ts`, find: '      this.recordHistory(tab, params, duplicateError);\n', replace: '', unit: [B, ['tests/unit/browser-action-engine.spec.ts']] },
  { id: 'M18', what: 'session seq not increasing', file: `${B}/src/session/browser-session.ts`, find: 'seq: ++this.sessionActionSeq', replace: 'seq: this.sessionActionSeq', unit: [B, ['tests/unit/session-action-history.spec.ts']] },
  { id: 'M20', what: 'the watchdog hard-exit does not record the hung command', file: `${C}/src/cli.ts`, find: '      recordCliCommand(1, `did not finish within ${Math.round(deadlineFor(verb, cleanArgs, process.env) / 1000)}s and was stopped by the watchdog`),\n', replace: '      Promise.resolve(),\n', unit: null, live: { pkg: C, surface: 'cli', only: 'L5,W1' } },
  { id: 'M19', what: 'history verb not offered a (current) marker: current session id ignored', file: `${C}/src/history-file.ts`, find: "sessionId !== null && sessionId === opts.currentSessionId ? ' (current)' : ''", replace: "''", unit: [C, ['tests/unit/history-file.spec.ts']], live: { pkg: C, surface: 'cli', only: 'L5' } },
];

MUTANTS.push(...FIX1_MUTANTS); // fix-1 (audit-1 REOPEN): mutants of the new redaction, ids MF*

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const run = (cmd, argv, opts = {}) => spawnSync(cmd, argv, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' && cmd.endsWith('.CMD'), ...opts });

function build(pkg) {
  const r = run(tsc, [], { cwd: path.join(repoRoot, pkg), timeout: 300000 });
  return { ok: r.status === 0, out: (r.stdout + r.stderr).slice(-400) };
}

const results = [];
for (const m of MUTANTS) {
  if (ONLY.length && !ONLY.includes(m.id)) continue;
  const file = path.join(repoRoot, m.file);
  const original = fs.readFileSync(file);
  const before = sha(original);
  const text = original.toString('utf-8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const conv = (s) => s.replace(/\r?\n/g, eol);
  const find = conv(m.find);
  const first = text.indexOf(find);
  const entry = { id: m.id, what: m.what, file: m.file, shaBefore: before };
  if (first < 0 || text.indexOf(find, first + 1) >= 0) {
    entry.error = `find string ${first < 0 ? 'not found' : 'ambiguous'}`;
    results.push(entry);
    console.log(`[${m.id}] ERROR ${entry.error}`);
    continue;
  }
  try {
    fs.writeFileSync(file, Buffer.from(text.slice(0, first) + conv(m.replace) + text.slice(first + find.length), 'utf-8'));
    // ── unit ──
    if (m.unit) {
      const [pkg, files] = m.unit;
      const r = run(vitest, ['run', '--globals', ...files], { cwd: path.join(repoRoot, pkg), timeout: 600000 });
      const out = (r.stdout ?? '') + (r.stderr ?? '');
      entry.unit = {
        caught: r.status !== 0,
        exit: r.status,
        failingTests: [...out.matchAll(/(?:FAIL|×|✗)\s+(.+)/g)].map((x) => x[1].replace(/\u001b\[[0-9;]*m/g, '').slice(0, 200)).slice(0, 4),
        summary: (out.replace(/\u001b\[[0-9;]*m/g, '').match(/Tests\s+.*$/m) ?? [''])[0].trim(),
      };
    }
    // ── live ──
    if (m.live && !UNIT_ONLY) {
      const b = build(m.live.pkg);
      if (!b.ok) {
        entry.live = { caught: false, buildFailed: true, out: b.out };
      } else {
        const r = run(process.execPath, [path.join(here, 'verify-fr2-11-history.mjs'), `--surface=${m.live.surface}`, `--only=${m.live.only}`], {
          cwd: repoRoot, timeout: 900000, env: { ...process.env, SUTRADHAR_FR2_11_EVIDENCE_DIR: path.join(EVIDENCE_DIR, 'mutant-live', m.id) },
        });
        const out = (r.stdout ?? '') + (r.stderr ?? '');
        entry.live = {
          caught: r.status !== 0,
          exit: r.status,
          surface: m.live.surface,
          only: m.live.only,
          failedCases: [...out.matchAll(/\[(?:mcp|cli)\] FAIL (\S+) \(\d+ checks\) -- (.{0,300})/g)].map((x) => `${x[1]}: ${x[2]}`).slice(0, 4),
          summaryLine: (out.match(/\[fr2-11\] \d+\/\d+ cases.*$/m) ?? [''])[0].slice(0, 200),
        };
      }
    }
  } finally {
    fs.writeFileSync(file, original);
    const after = sha(fs.readFileSync(file));
    entry.shaAfter = after;
    entry.restoredIdentical = after === before;
    if (m.live && !UNIT_ONLY) entry.rebuiltAfterRestore = build(m.live.pkg).ok;
  }
  entry.caught = (entry.unit?.caught ?? true) && (entry.live ? entry.live.caught : true) && !!(entry.unit || entry.live);
  results.push(entry);
  console.log(`[${m.id}] ${entry.caught ? 'CAUGHT' : 'NOT CAUGHT'} unit=${entry.unit ? entry.unit.caught : '-'} live=${entry.live ? entry.live.caught : '-'} restored=${entry.restoredIdentical}  ${m.what}`);
}
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const out = ONLY.length ? `mutants-${ONLY.join('_')}.json` : 'mutants.json';
fs.writeFileSync(path.join(EVIDENCE_DIR, out), JSON.stringify({ ranAt: new Date().toISOString(), total: results.length, caught: results.filter((r) => r.caught).length, allRestoredIdentical: results.every((r) => r.restoredIdentical), results }, null, 2));
console.log(`\n[mutants] ${results.filter((r) => r.caught).length}/${results.length} caught; all restored byte-identically: ${results.every((r) => r.restoredIdentical)}`);
process.exitCode = results.every((r) => r.caught && r.restoredIdentical) ? 0 : 1;

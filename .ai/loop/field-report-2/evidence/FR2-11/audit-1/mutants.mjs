// AUDIT-1 mutation driver: each mutant = one exact single-occurrence source edit, the owning package suite is run,
// then the file is restored from an in-memory copy and its sha256 re-verified byte-identical.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { spawnSync } from 'node:child_process';
import { here } from './lib.mjs';
const repo = path.resolve(here, '../../../../../..');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const B = 'packages/browser/src/session/';
const MUTANTS = [
  { id: 'A1', pkg: 'packages/browser', file: B + 'browser-tab.ts', find: 'if (this.actionHistory.length > MAX_ACTION_HISTORY) {', repl: 'if (this.actionHistory.length >= MAX_ACTION_HISTORY) {', why: 'tab cap off-by-one (keeps 199)' },
  { id: 'A2', pkg: 'packages/browser', file: B + 'browser-session.ts', find: 'seq: ++this.sessionActionSeq', repl: 'seq: this.sessionActionSeq++', why: 'session seq starts at 0' },
  { id: 'A3', pkg: 'packages/browser', file: B + 'browser-session.ts', find: 'this.sessionActionHistory.shift();\n        this.sessionActionEvicted++;', repl: 'this.sessionActionHistory.shift();', why: 'session eviction never counted' },
  { id: 'A4', pkg: 'packages/browser', file: B + 'action-history.ts', find: "      return u.origin + u.pathname;", repl: "      return u.origin + u.pathname + u.hash;", why: 'fragment kept in stored URLs (#access_token=)' },
  { id: 'A5', pkg: 'packages/browser', file: B + 'action-history.ts', find: "if ((params.actionType === 'type' || params.actionType === 'type_by_label') && landed >= 0) {", repl: "if (params.actionType === 'type' && landed >= 0) {", why: 'type_by_label did-not-land message keeps field content' },
  { id: 'A6', pkg: 'packages/browser', file: B + 'action-history.ts', find: "if (typeof value === 'string' && value.length >= 3) {", repl: "if (typeof value === 'string' && value.length >= 12) {", why: 'typed value scrub skipped for values < 12 chars' },
  { id: 'A7', pkg: 'packages/browser', file: B + 'action-history.ts', find: "        if ('observed' in c) cOut.observed = scalar(c.observed);", repl: '', why: 'evidence observed not URL-redacted' },
  { id: 'A8', pkg: 'packages/capability-runtime', file: 'packages/capability-runtime/src/runtime.ts', find: "record({ success: ar?.success ?? true, error: ar?.error, verification: ar?.verification });", repl: "record({ success: true, error: ar?.error, verification: ar?.verification });", why: 'runtime-level success:false literal recorded as success' },
  { id: 'A9', pkg: 'packages/capability-runtime', file: 'packages/capability-runtime/src/runtime.ts', find: "        entries: [...(session.getSessionActionHistory?.() ?? [])],", repl: "        entries: (session.getSessionActionHistory?.() ?? []) as SessionActionHistoryEntry[],", why: 'session report returns the live ring, not a copy' },
  { id: 'A10', pkg: 'packages/mcp-server', file: 'packages/mcp-server/src/tools.ts', find: "report.evicted === 1 ? 'y was' : 'ies were'", repl: "report.evicted > 1 ? 'y was' : 'ies were'", why: 'note singular/plural inverted' },
  { id: 'A11', pkg: 'packages/cli', file: 'packages/cli/src/history-file.ts', find: "        if (bytesRead === 1 && last[0] !== 0x0a) prefix = '" + String.fromCharCode(92) + "n';", repl: '', why: 'torn-line repair removed (next line glued to fragment)' },
  { id: 'A12', pkg: 'packages/cli', file: 'packages/cli/src/history-file.ts', find: "    case 'type':\n    case 'select':\n      return args.length === 0", repl: "    case 'type':\n      return args.length === 0", why: 'select value stored raw in args' },
  { id: 'A13', pkg: 'packages/cli', file: 'packages/cli/src/history-file.ts', find: "    if (raw.trim() === '') continue;", repl: "    if (raw.trim() === '') { skipped++; continue; }", why: 'blank lines counted as unreadable' },
  { id: 'A14', pkg: 'packages/cli', file: 'packages/cli/src/history-file.ts', find: "  const usable = secrets.filter((s) => s.length >= 3);", repl: '  const usable = [];', why: 'defense-in-depth secret scrub disabled' },
];
const only = process.argv[2]?.split(',');
const results = [];
for (const m of MUTANTS.filter((x) => !only || only.includes(x.id))) {
  const f = path.join(repo, m.file);
  const orig = fs.readFileSync(f); const before = sha(f);
  const text = orig.toString('utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const find = m.find.replace(/\n/g, eol), repl = m.repl.replace(/\n/g, eol);
  const count = text.split(find).length - 1;
  if (count !== 1) { results.push({ ...m, status: 'NOT-APPLIED', count }); console.log(m.id, 'NOT APPLIED count=' + count); continue; }
  fs.writeFileSync(f, text.replace(find, repl));
  let r;
  try {
    r = spawnSync(process.execPath, [path.join(repo, 'node_modules/vitest/vitest.mjs'), 'run'], { cwd: path.join(repo, m.pkg), encoding: 'utf8', timeout: 900000 });
  } finally {
    fs.writeFileSync(f, orig);
  }
  const after = sha(f);
  const clean = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  const failing = [...new Set((clean.match(/(?:FAIL|×)\s+[^\n]{0,160}/g) ?? []).map((s) => s.trim()))].slice(0, 6);
  const summary = (clean.match(/Tests\s+[^\n]+/g) ?? []).at(-1);
  const row = { id: m.id, file: m.file, why: m.why, exit: r.status, killed: r.status !== 0, summary, failing, restored: before === after, sha256: before };
  results.push(row);
  console.log(m.id, row.killed ? 'KILLED' : 'SURVIVED', summary, 'restored=' + row.restored);
}
fs.writeFileSync(path.join(here, 'mutants' + (only ? '-' + only.join('_') : '') + '.json'), JSON.stringify(results, null, 1));

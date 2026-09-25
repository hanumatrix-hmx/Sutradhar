// FR2-06 audit-1: revert-and-confirm by source mutation. Each mutation is applied to ONE source
// file, the relevant vitest file is run, and the original bytes are restored (sha256-verified)
// in a finally block. Run: node .ai/loop/field-report-2/evidence/FR2-06/audit-1/mutate.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..', '..', '..', '..');
const vitest = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vitest.cmd' : 'vitest');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const M = [
  { id: 'M1-chain-regex-drops-P-selector-exclusion', pkg: 'browser', file: 'packages/browser/src/actions/selector-dialect.ts', find: 'const CHAIN_RE = /(?<!>)>>(?!>)/;', repl: 'const CHAIN_RE = />>/;', test: 'tests/unit/selector-dialect.spec.ts' },
  { id: 'M2-no-string-literal-stripping', pkg: 'browser', file: 'packages/browser/src/actions/selector-dialect.ts', find: `if (ch === '"' || ch === "'") {`, repl: 'if (false) {', test: 'tests/unit/selector-dialect.spec.ts' },
  { id: 'M3-probe-treats-any-exception-as-invalid', pkg: 'browser', file: 'packages/browser/src/actions/selector-dialect.ts', find: `(e as { name?: string }).name === 'SyntaxError'`, repl: `(e as { name?: string }).name !== '__never__'`, test: 'tests/unit/selector-dialect.spec.ts' },
  { id: 'M4-toPuppeteerQuery-always-pierce', pkg: 'browser', file: 'packages/browser/src/actions/selector-dialect.ts', find: 'return PUPPETEER_SELECTOR_PREFIX_RE.test(t) ? t : `pierce/${selector}`;', repl: 'return `pierce/${selector}`;', test: 'tests/unit' },
  { id: 'M5-engine-reason-text-garbage (predict SURVIVES: reason text for xpath=/aria=/pierce= unpinned)', pkg: 'browser', file: 'packages/browser/src/actions/selector-dialect.ts', find: 'return `"${norm}=" is not supported; use the slash form "${norm}/".`;', repl: "return 'GARBAGE';", test: 'tests/unit/selector-dialect.spec.ts' },
  { id: 'M6-engine-D8-no-retry-break-removed', pkg: 'browser', file: 'packages/browser/src/actions/browser-action-engine.ts', find: 'if (/is not a valid selector|is not a valid XPath expression/.test(lastError.message)) {', repl: 'if (false) {', test: 'tests/unit/browser-action-engine.spec.ts' },
  { id: 'M7-engine-probe-never-rejects', pkg: 'browser', file: 'packages/browser/src/actions/browser-action-engine.ts', find: 'if (parserMessage === null) continue; // valid OR inconclusive -> today\'s path', repl: 'continue;', test: 'tests/unit/browser-action-engine.spec.ts' },
  { id: 'M8-engine-probe-ignores-pending-dialog', pkg: 'browser', file: 'packages/browser/src/actions/browser-action-engine.ts', find: 'if (tab.getPendingDialog?.()) return undefined;', repl: 'void 0;', test: 'tests/unit/browser-action-engine.spec.ts' },
  { id: 'M9-normalizeTarget-no-detection', pkg: 'capability-runtime', file: 'packages/capability-runtime/src/types.ts', find: '  assertSupportedSelectorDialect(target);', repl: '  void 0;', test: 'tests/unit' },
  { id: 'M10-extract-throws-on-first-bad-field', pkg: 'capability-runtime', file: 'packages/capability-runtime/src/extract/extract-data.ts', find: 'invalidDialect.push({ name, selector: spec.selector, message: e.reason });', repl: 'throw invalidExtractSelectorsError([{ name, selector: spec.selector, message: e.reason }]);', test: 'tests/unit' },
  { id: 'M11-extract-swallows-non-InvalidSelectorError (predict SURVIVES: P10 tests a different throw)', pkg: 'capability-runtime', file: 'packages/capability-runtime/src/extract/extract-data.ts', find: "        continue;\n      }\n      throw e;", repl: "        continue;\n      }\n      continue;", test: 'tests/unit' },
  { id: 'M12-uploadViaTrigger-normalize-after-fs-check', pkg: 'capability-runtime', file: 'packages/capability-runtime/src/runtime.ts', find: 'const selector = normalizeTarget(triggerTarget);', repl: 'const selector = await this.assertUploadPathAllowed(filePath).then(() => normalizeTarget(triggerTarget));', test: 'tests/unit/runtime.spec.ts' },
  { id: 'M13-uploadViaTrigger-no-parser-wrap', pkg: 'capability-runtime', file: 'packages/capability-runtime/src/runtime.ts', find: 'throw new Error(invalidSelectorSyntaxError(selector, msg).message);', repl: 'throw e;', test: 'tests/unit/runtime.spec.ts' },
  { id: 'M14-resolveFrame-no-InvalidSelectorError-wrap', pkg: 'capability-runtime', file: 'packages/capability-runtime/src/runtime.ts', find: 'if (e instanceof InvalidSelectorError) {\n          // FR2-06: normalizeTarget rejected', repl: 'if (false) {\n          // FR2-06: normalizeTarget rejected', test: 'tests/unit/runtime.spec.ts' },
  { id: 'M15-cli-validateFrameChain-noop', pkg: 'cli', file: 'packages/cli/src/selector-args.ts', find: '  if (chain === undefined) return null;', repl: '  return null;', test: 'tests/unit/selector-args.spec.ts' },
  { id: 'M16-cli-cmdClick-prevalidation-removed (predict SURVIVES: cli.ts wiring has no unit test)', pkg: 'cli', file: 'packages/cli/src/cli.ts', find: '  const selectorErr = validateSelectorArgs([ref]);\n  if (selectorErr) printErrorAndExit(selectorErr);\n  await withSession(async (runtime, sessionId) => {\n    const result = await runtime.click(', repl: '  await withSession(async (runtime, sessionId) => {\n    const result = await runtime.click(', test: 'tests/unit' },
  { id: 'M17-mcp-targetDesc-reverted', pkg: 'mcp-server', file: 'packages/mcp-server/src/tools.ts', find: `"Puppeteer's pierce/, xpath/, aria/ and text/ prefixes are also accepted. Playwright syntax (text=, " +`, repl: `'' +`, test: 'tests/unit/tools.spec.ts' },
];

const results = [];
for (const m of M) {
  const abs = path.join(root, m.file);
  const orig = fs.readFileSync(abs);
  const origSha = sha(orig);
  const text = orig.toString('utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const find = m.find.replace(/\n/g, eol);
  const repl = m.repl.replace(/\n/g, eol);
  const count = text.split(find).length - 1;
  if (count !== 1) {
    results.push({ id: m.id, error: `find string occurs ${count} times` });
    console.log(`SKIP ${m.id}: find occurs ${count}x`);
    continue;
  }
  let out;
  try {
    fs.writeFileSync(abs, text.replace(find, repl));
    const r = spawnSync(vitest, ['run', '--globals', m.test], { cwd: path.join(root, 'packages', m.pkg), encoding: 'utf8', shell: true, timeout: 300000 });
    out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  } finally {
    fs.writeFileSync(abs, orig);
  }
  const restored = sha(fs.readFileSync(abs)) === origSha;
  const testsLine = (out.match(/Tests\s+[^\n]+/) || [''])[0].trim();
  const failed = /(\d+) failed/.test(testsLine);
  const failingNames = [...out.matchAll(/^\s*(?:×|FAIL|✗)\s+(.+)$/gm)].map((x) => x[1].trim()).slice(0, 8);
  results.push({ id: m.id, file: m.file, testsLine, killed: failed, restored, failingNames });
  console.log(`${failed ? 'KILLED ' : 'SURVIVED'} ${m.id} :: ${testsLine} :: restored=${restored}`);
  fs.writeFileSync(path.join(here, 'mutation-logs', `${m.id.split(' ')[0]}.log`), out);
}
fs.writeFileSync(path.join(here, 'mutation-results.json'), JSON.stringify(results, null, 2));

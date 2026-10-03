// AUDIT-1 own mutants. Each: exact-once text replacement in a product src file -> rebuild the affected
// packages' dist (tsc via turbo, concurrency 1) -> run unit tests (vitest) for affected packages and the
// auditor's own function-level probes -> RESTORE byte-identically (sha256 checked) -> next.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../../../..');
const SCR = process.argv[2];
const ONLY = process.argv[3] ? process.argv[3].split(',') : null;
const OUT = path.join(HERE, '..', 'mutants.jsonl'); if (!ONLY) fs.writeFileSync(OUT, '');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const CP = 'packages/capability-runtime/src/config-precedence.ts', PC = 'packages/capability-runtime/src/project-config.ts';
const M = [
  { id: 'A1', desc: 'MCP only: config allowedDomains outranks env (one pair reversed on one surface)', file: 'packages/mcp-server/src/server.ts', from: 'resolveAllowedDomains({ option: options.allowedDomains, env: process.env, config: cfg })', to: 'resolveAllowedDomains({ option: options.allowedDomains ?? cfg?.values.allowedDomains, env: process.env, config: cfg })', pkgs: ['mcp-server'] },
  { id: 'A2', desc: 'CLI only: sticky state dialog outranks an accept/dismiss flag', file: 'packages/cli/src/dialog-cli.ts', from: "if (dialogFlag === 'accept' || dialogFlag === 'dismiss') {", to: "if ((dialogFlag === 'accept' || dialogFlag === 'dismiss') && !state?.dialogPolicy) {", pkgs: ['cli'] },
  { id: 'A3', desc: '.git exclusion computed on the literal (non-canonical) path: junction-to-.git bypass', file: PC, from: 'const rel = c.slice(base.length)', to: 'const rel = d.abs.slice(baseDir.length)', pkgs: ['capability-runtime'] },
  { id: 'A4', desc: '.git exclusion dropped entirely', file: PC, from: "if (rel.some((s) => foldAscii(s) === '.git')) {", to: "if (false && rel.some((s) => foldAscii(s) === '.git')) {", pkgs: ['capability-runtime'] },
  { id: 'A5', desc: 'a discovered file is treated like an explicit (trusted) one', file: PC, from: "    origin = 'discovered';", to: "    origin = 'env';", pkgs: ['capability-runtime'] },
  { id: 'A6', desc: 'an explicit falsy value (0) falls through instead of winning', file: CP, from: '    if (value === undefined) continue;', to: '    if (!value) continue;', pkgs: ['capability-runtime'] },
  { id: 'A7', desc: 'CLI fail-open: --allowlist-domains "" / " , " means unrestricted again', file: 'packages/cli/src/parse-args.ts', from: 'allowlistDomainsFlagIndex !== -1 && !allowlistDomainsFlag?.length', to: 'allowlistDomainsFlagIndex !== -1 && allowlistDomainsRaw === undefined', pkgs: ['cli'] },
  { id: 'A8', desc: 'home boundary compared literally (no canonicalisation/case fold)', file: PC, from: 'if (sameFold(here, home)) return', to: 'if (dir === homedir) return', pkgs: ['capability-runtime'] },
  { id: 'A9', desc: 'MCP: server default viewport outranks the browser.launch call argument', file: 'packages/mcp-server/src/tools.ts', from: 'const vp = viewport ?? options.defaultViewport;', to: 'const vp = options.defaultViewport ?? viewport;', pkgs: ['mcp-server'] },
  { id: 'A10', desc: 'duplicate keys only detected at the top level', file: PC, from: 'if (top && top.obj && top.expectKey) {', to: 'if (top && top.obj && top.expectKey && stack.length === 1) {', pkgs: ['capability-runtime'] },
  { id: 'A11', desc: 'SDK: a config dialog "report" is not mapped to auto (would hang page.evaluate)', file: CP, from: "if (r.source === 'config' && i.surface === 'sdk' && r.value?.mode === 'report') {", to: "if (false && r.source === 'config' && i.surface === 'sdk' && r.value?.mode === 'report') {", pkgs: ['capability-runtime'] },
  { id: 'A12', desc: 'nested unknown keys (dialog.*) silently dropped without a warning', file: PC, from: "warnUnknown('dialog.', k, DIALOG_KEYS);", to: 'void k;', pkgs: ['capability-runtime'] },
  { id: 'A5b', desc: 'a discovered file is treated like an explicit (trusted) one (type-valid spelling)', file: PC, from: "    origin = 'discovered';", to: "    origin = ['env', 'discovered'][0] as ConfigOrigin;", pkgs: ['capability-runtime'] },
  { id: 'A8b', desc: 'home boundary needs a LITERAL match of the cwd walk to the home string (no canonical/case-fold equality)', file: PC, from: 'if (sameFold(here, home)) return', to: 'if (sameFold(here, home) && dir === homedir) return', pkgs: ['capability-runtime'] },
];
const DEP = { 'capability-runtime': ['capability-runtime', 'cli', 'mcp-server', 'sutradhar'], cli: ['cli'], 'mcp-server': ['mcp-server'] };
function sh(cmd, args, cwd, ms = 900000) { const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: ms, shell: false, windowsHide: true }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; }
const TURBO = path.join(WT, 'node_modules/.bin/turbo.CMD'); const VITEST = path.join(WT, 'node_modules/.bin/vitest.CMD');
function build(pkgs) { const f = []; for (const p of pkgs) f.push('--filter=@sutradhar/' + p); return spawnSync('cmd.exe', ['/c', TURBO, 'run', 'build', '--concurrency=1', ...f], { cwd: WT, encoding: 'utf8', timeout: 900000, windowsHide: true }); }
for (const m of M) {
  if (ONLY && !ONLY.includes(m.id)) continue;
  const file = path.join(WT, m.file); const before = sha(file); const orig = fs.readFileSync(file);
  const text = orig.toString('utf8'); const n = text.split(m.from).length - 1;
  const row = { id: m.id, desc: m.desc, file: m.file, applied: n === 1 };
  if (n !== 1) { row.error = 'pattern count ' + n; fs.appendFileSync(OUT, JSON.stringify(row) + '\n'); continue; }
  try {
    fs.writeFileSync(file, text.replace(m.from, m.to));
    const b = build(m.pkgs); row.buildCode = b.status;
    row.unit = {};
    for (const p of DEP[m.pkgs[0]]) {
      const r = spawnSync('cmd.exe', ['/c', VITEST, 'run'], { cwd: path.join(WT, 'packages', p), encoding: 'utf8', timeout: 900000, windowsHide: true });
      const o = (r.stdout || '') + (r.stderr || ''); const fm = o.match(/Tests\s+.*?(\d+) failed/); row.unit[p] = r.status === 0 ? 'pass' : 'FAIL(' + (fm ? fm[1] : '?') + ')';
    }
    const pf = spawnSync(process.execPath, [path.join(HERE, 'precedence-fn.mjs'), path.join(SCR, 'mut-' + m.id + '-pf')], { cwd: WT, encoding: 'utf8', timeout: 600000 });
    const pfs = (pf.stdout.match(/"fail": (\d+)/) || [])[1]; row.ownPrecedenceFails = Number(pfs ?? -1) - 3; try { const pj = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'precedence-fn.json'), 'utf8')); row.ownPrecedenceFailIds = pj.summary.failures.map((x) => x.id).filter((id) => !/NULL/.test(id)); } catch (e) { row.ownPrecedenceFailIds = 'unreadable'; } const bj = spawnSync(process.execPath, ['-e', 'x']);
    const lp = spawnSync(process.execPath, [path.join(HERE, 'loader-probes.mjs'), path.join(SCR, 'mut-' + m.id + '-lp')], { cwd: WT, encoding: 'utf8', timeout: 600000 });
    row.loaderOut = lp.stdout.length;
    fs.copyFileSync(path.join(HERE, '..', 'loader-probes.json'), path.join(SCR, 'mut-' + m.id + '-loader.json'));
  } finally {
    fs.writeFileSync(file, orig);
    row.restored = sha(file) === before; row.sha = before; row.rebuildAfterRestore = build(m.pkgs).status;
  }
  fs.appendFileSync(OUT, JSON.stringify(row) + '\n'); console.log(JSON.stringify(row));
}
const b = build(['capability-runtime', 'cli', 'mcp-server']); console.log('final rebuild', b.status);

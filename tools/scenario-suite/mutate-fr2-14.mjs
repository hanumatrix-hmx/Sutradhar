// Mutation check for FR2-14 (my own code). Each mutant edits ONE behaviour of the shipped source,
// confirms the mutated source still compiles (tsc), then must be CAUGHT by the unit suite and/or the
// live harness. Sources are restored from the original bytes after every mutant and the sha256 is
// compared before and after. Live mutants rebuild the affected dist (tsc) and run a subset of
// verify-fr2-14-config.mjs; run a forced rebuild afterwards.
//
//   node tools/scenario-suite/mutate-fr2-14.mjs [--only=U1,L3] [--no-live]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const EVIDENCE_DIR = process.env.SUTRADHAR_FR2_14_MUTATION_DIR ?? path.join(repoRoot, '.ai', 'loop', 'field-report-2', 'evidence', 'FR2-14', 'run-1');
const argv = process.argv.slice(2);
const ONLY = (argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const NO_LIVE = argv.includes('--no-live');
const bin = (n) => path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? `${n}.cmd` : n);
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

const CR = 'packages/capability-runtime';
const PC = `${CR}/src/project-config.ts`;
const CP = `${CR}/src/config-precedence.ts`;
const CLI_SETTINGS = 'packages/cli/src/project-config-cli.ts';
const CLI_MAIN = 'packages/cli/src/cli.ts';

const mutants = [
  // ── unit-caught (each also run through the live harness where a live case exists, see `live`) ──
  { id: 'U1', desc: 'precedence reversed: config layer outranks env', file: CP,
    edits: [[`      ['env', i.env ? parseDomainsEnv(i.env[ALLOWED_DOMAINS_ENV]) : undefined],
      ['config', i.config?.values.allowedDomains],`, `      ['config', i.config?.values.allowedDomains],
      ['env', i.env ? parseDomainsEnv(i.env[ALLOWED_DOMAINS_ENV]) : undefined],`]],
    unit: { pkg: CR, files: ['tests/unit/config-precedence.spec.ts'] }, tsc: CR,
    live: { build: [CR, 'packages/cli'], only: 'L4,L5,L5m' } },
  { id: 'U2', desc: 'env var ignored for allowedDomains', file: CP,
    edits: [[`['env', i.env ? parseDomainsEnv(i.env[ALLOWED_DOMAINS_ENV]) : undefined],`, `['env', undefined],`]],
    unit: { pkg: CR, files: ['tests/unit/config-precedence.spec.ts'] }, tsc: CR },
  { id: 'U3', desc: 'CLI flag ignored', file: CLI_SETTINGS,
    edits: [[`resolveAllowedDomains({ flag: i.flags.allowlistDomains, env: i.env, config: i.config })`, `resolveAllowedDomains({ flag: undefined, env: i.env, config: i.config })`]],
    unit: { pkg: 'packages/cli', files: ['tests/unit/project-config-cli.spec.ts'] }, tsc: 'packages/cli' },
  { id: 'U4', desc: 'unknown key becomes an error', file: PC,
    edits: [[`if (!PROJECT_CONFIG_KNOWN_KEYS.includes(k)) warnUnknown('', k, PROJECT_CONFIG_KNOWN_KEYS);`, `if (!PROJECT_CONFIG_KNOWN_KEYS.includes(k)) throw bad(file, \`unknown key "\${k}"\`);`]],
    unit: { pkg: CR, files: ['tests/unit/project-config.spec.ts'] }, tsc: CR },
  { id: 'U5', desc: 'search does not walk upward (stops after the cwd)', file: PC,
    edits: [[`    dir = p.dirname(dir);
  }
}`, `    return { searched, stoppedAt: 'filesystem-root' };
  }
}`]],
    unit: { pkg: CR, files: ['tests/unit/project-config.spec.ts'] }, tsc: CR,
    live: { build: [CR, 'packages/cli'], only: 'L1,L2' } },
  { id: 'U6', desc: 'nearest file does not win (the farthest does)', file: PC,
    edits: [
      [`  const searched: string[] = [];
  for (;;) {
    if (p.dirname(dir) === dir) return { searched, stoppedAt: 'filesystem-root' };`, `  const searched: string[] = [];
  let farthest: string | undefined;
  for (;;) {
    if (p.dirname(dir) === dir) return farthest ? { path: farthest, searched, stoppedAt: 'found' } : { searched, stoppedAt: 'filesystem-root' };`],
      [`      if (st.isFile()) return { path: cand, searched, stoppedAt: 'found' };
      throw new ProjectConfigError(cand, \`\${cand} exists but is not a regular file. \${NO_ESCAPE_HINT}\`);`, `      if (!st.isFile()) throw new ProjectConfigError(cand, \`\${cand} exists but is not a regular file. \${NO_ESCAPE_HINT}\`);
      farthest = cand;
      if (await exists(fs, p.join(dir, '.git'))) return { path: farthest, searched, stoppedAt: 'found' };`],
    ],
    unit: { pkg: CR, files: ['tests/unit/project-config.spec.ts'] }, tsc: CR,
    live: { build: [CR, 'packages/cli'], only: 'L21' } },
  { id: 'U7', desc: 'MCP drops the config layer for allowedDomains', file: 'packages/mcp-server/src/server.ts',
    edits: [[`resolveAllowedDomains({ option: options.allowedDomains, env: process.env, config: cfg })`, `resolveAllowedDomains({ option: options.allowedDomains, env: process.env })`]],
    unit: { pkg: 'packages/mcp-server', files: ['tests/unit/server-config.spec.ts'] }, tsc: 'packages/mcp-server',
    live: { build: ['packages/mcp-server'], only: 'M-L22', surface: 'mcp' } },
  { id: 'U8', desc: 'fail-open allowedDomains: an empty array is accepted', file: PC,
    edits: [[`  if (v.length === 0) throw bad(file, \`\${key} must list at least one \${key === 'allowedDomains' ? 'domain' : 'directory'}; remove the key for no restriction\`);`, `  // (mutant) empty array accepted`]],
    unit: { pkg: CR, files: ['tests/unit/project-config.spec.ts'] }, tsc: CR,
    live: { build: [CR, 'packages/cli'], only: 'N1' } },
  { id: 'U9', desc: 'download root not canonicalised (lexical containment only)', file: PC,
    edits: [[`if ((await findContainingRoot(d.abs, [baseDir])) === undefined) {`, `if (!isPathWithinRoot(path.resolve(d.abs), path.resolve(baseDir)) || (void findContainingRoot, false)) {`]],
    unit: { pkg: CR, files: ['tests/unit/project-config.spec.ts'] }, tsc: CR },
  { id: 'U10', desc: 'a discovered (parent-directory) file may widen download roots: containment skipped', file: PC,
    edits: [[`  if (origin === 'discovered') {
    let base: string;`, `  if (origin === 'discovered' && false) {
    let base: string;`]],
    unit: { pkg: CR, files: ['tests/unit/project-config.spec.ts'] }, tsc: CR,
    live: { build: [CR, 'packages/cli'], only: 'N4,H1,H3,N6,H4' } },
  { id: 'U11', desc: '.git boundary ignored', file: PC,
    edits: [[`if (await exists(fs, p.join(dir, '.git'))) return`, `if (false && (await exists(fs, p.join(dir, '.git')))) return`]],
    unit: { pkg: CR, files: ['tests/unit/project-config.spec.ts'] }, tsc: CR,
    live: { build: [CR, 'packages/cli'], only: 'L16' } },
  { id: 'U12', desc: 'home boundary ignored', file: PC,
    edits: [[`      inHome = isPathWithinRoot(await canonicalizePath(dir), home, platform);`, `      inHome = (await canonicalizePath(dir), false);`]],
    unit: { pkg: CR, files: ['tests/unit/project-config.spec.ts'] }, tsc: CR,
    live: { build: [CR, 'packages/cli'], only: 'L18' } },
  { id: 'U13', desc: 'duplicate keys allowed (last silently wins)', file: PC,
    edits: [[`  if (dup !== undefined) {`, `  if (false && dup !== undefined) {`]],
    unit: { pkg: CR, files: ['tests/unit/project-config.spec.ts'] }, tsc: CR,
    live: { build: [CR, 'packages/cli'], only: 'H8' } },
  { id: 'U14', desc: 'JSON parse error echoes the file text (secret leak)', file: PC,
    edits: [[`  return m.replace(/\\s+/g, ' ').trim();
}`, `  return msg;
}`]],
    unit: { pkg: CR, files: ['tests/unit/project-config.spec.ts'] }, tsc: CR,
    live: { build: [CR, 'packages/cli'], only: 'H14' } },
  { id: 'U15', desc: 'POSIX ownership/mode check disabled', file: PC,
    edits: [[`if (origin === 'discovered' && platform !== 'win32') {`, `if (false && origin === 'discovered' && platform !== 'win32') {`]],
    unit: { pkg: CR, files: ['tests/unit/project-config.spec.ts'] }, tsc: CR },
  { id: 'U16', desc: 'invalid SUTRADHAR_IDLE_TIMEOUT_MS silently ignored (reaper disabled/default)', file: CP,
    edits: [[`const envValue = i.env ? parseIdleTimeoutMs(IDLE_TIMEOUT_ENV, i.env[IDLE_TIMEOUT_ENV]) : undefined;`, `const envValue = i.env ? (() => { try { return parseIdleTimeoutMs(IDLE_TIMEOUT_ENV, i.env![IDLE_TIMEOUT_ENV]); } catch { return undefined; } })() : undefined;`]],
    unit: { pkg: CR, files: ['tests/unit/config-precedence.spec.ts'] }, tsc: CR },
  { id: 'U17', desc: 'trust notice for a discovered file removed', file: CLI_SETTINGS,
    edits: [[`  if (!cfg || cfg.origin !== 'discovered') return undefined;`, `  if (!cfg || cfg.origin !== 'discovered' || cfg.origin === 'discovered') return undefined;`]],
    unit: { pkg: 'packages/cli', files: ['tests/unit/project-config-cli.spec.ts'] }, tsc: 'packages/cli',
    live: { build: ['packages/cli'], only: 'L9,H2' } },
  { id: 'U18', desc: 'SDK drops the config viewport', file: 'packages/sutradhar/src/index.ts',
    edits: [[`const viewport = resolveViewport({ option: options.viewport, config: cfg }).value;`, `const viewport = resolveViewport({ option: options.viewport, config: undefined }).value;`]],
    unit: { pkg: 'packages/sutradhar', files: ['tests/unit/launch-config.spec.ts'] }, tsc: 'packages/sutradhar' },
  { id: 'U19', desc: 'SDK reads SUTRADHAR_ALLOWED_DOMAINS from the environment', file: 'packages/sutradhar/src/index.ts',
    edits: [[`resolveAllowedDomains({ option: options.allowedDomains, config: cfg })`, `resolveAllowedDomains({ option: options.allowedDomains, env: process.env, config: cfg })`]],
    unit: { pkg: 'packages/sutradhar', files: ['tests/unit/launch-config.spec.ts'] }, tsc: 'packages/sutradhar' },
  { id: 'U20', desc: 'SUTRADHAR_CONFIG=none ignored by the MCP startup', file: 'packages/mcp-server/src/startup-config.ts',
    edits: [[`env.kind === 'disabled'
      ?`, `false
      ?`]],
    unit: { pkg: 'packages/mcp-server', files: ['tests/unit/config-banner.spec.ts'] }, tsc: 'packages/mcp-server' },
  { id: 'U21', desc: 'empty --allowlist-domains means unrestricted again (no error)', file: 'packages/cli/src/parse-args.ts',
    edits: [[`const allowlistDomainsGivenButEmpty = allowlistDomainsFlagIndex !== -1 && !allowlistDomainsFlag?.length;`, `const allowlistDomainsGivenButEmpty = false;`]],
    unit: { pkg: 'packages/cli', files: ['tests/unit/project-config-cli.spec.ts'] }, tsc: 'packages/cli',
    live: { build: ['packages/cli'], only: 'H15' } },
  { id: 'U22', desc: 'a config relative path resolves against the cwd, not the config file', file: `${CR}/src/fs-roots.ts`,
    edits: [[`  return path.resolve(baseDir, e);`, `  return path.resolve(baseDir ? e : e);`]],
    unit: { pkg: CR, files: ['tests/unit/config-precedence.spec.ts', 'tests/unit/project-config.spec.ts'] }, tsc: CR,
    live: { build: [CR, 'packages/cli'], only: 'L9' } },
  // ── live-only (the code is in cli.ts, which runs main() on import and has no unit seam) ──
  { id: 'L-persist', desc: 'CLI persists the CONFIG viewport into state.json', file: CLI_MAIN,
    edits: [[`    viewport: viewportFlag,
    dialogPolicy,
  });`, `    viewport: spawnViewport,
    dialogPolicy,
  });`]],
    tsc: 'packages/cli', live: { build: ['packages/cli'], only: 'L8' } },
  { id: 'L-none', desc: 'CLI ignores SUTRADHAR_CONFIG=none', file: CLI_MAIN,
    edits: [[`    if (env.kind === 'disabled') return undefined;
    const d = await loadProjectConfig({
      cwd: process.cwd(),
      discover: env.kind === 'unset',`, `    const d = await loadProjectConfig({
      cwd: process.cwd(),
      discover: env.kind === 'unset' || env.kind === 'disabled',`]],
    tsc: 'packages/cli', live: { build: ['packages/cli'], only: 'L19' } },
  { id: 'L-state-first', desc: 'CLI viewport: config outranks the sticky state viewport', file: CLI_MAIN,
    edits: [[`const effectiveViewport = resolveViewport({ flag: viewportFlag, state: state.viewport, config: activeConfig }).value;`, `const effectiveViewport = resolveViewport({ flag: viewportFlag, state: activeConfig?.values.viewport ? undefined : state.viewport, config: activeConfig }).value;`]],
    tsc: 'packages/cli', live: { build: ['packages/cli'], only: 'L7' } },
  // ── fix-1 mutants (audit-1 findings F1/F2/F3/F4/F8/F9); ids are distinct from U1-U22 / L-* above ──
  // (X8 in the first cut, `here === home`, is an EQUIVALENT mutant: both sides come from native realpath, which normalises case, so
  //  it was replaced by the A8b-style literal-string mutant; the literal-stop mutant X10 was equivalent too because the canonical
  //  check always fires on the same directory, so the redundant literal check was deleted from the code instead.)
  { id: 'X1', desc: 'F1: the download refusal is raised whatever layer wins (env/option no longer override a refused file)', file: `${CR}/src/fs-roots.ts`,
    edits: [[`  // Downloads.
`, `  // Downloads.
  if (input.config?.downloadRefusal !== undefined) throw new Error(input.config.downloadRefusal);
`]],
    unit: { pkg: CR, files: ['tests/unit/override-matrix.spec.ts'] }, tsc: CR,
    live: { build: [CR, 'packages/cli'], only: 'F1-env-f1-out,F1-env-f1-git,H4b' } },
  { id: 'X2', desc: 'F1 fail-open: a refused discovered download root is never refused', file: `${CR}/src/fs-roots.ts`,
    edits: [[`        err.name = 'ProjectConfigError';
        throw err;`, `        err.name = 'ProjectConfigError';
        void err;`]],
    unit: { pkg: CR, files: ['tests/unit/override-matrix.spec.ts'] }, tsc: CR,
    live: { build: [CR, 'packages/cli'], only: 'F1-none-f1-out,H1,N4' } },
  { id: 'X3', desc: 'F1: fsRootsConfigLayer forgets the refusal (every surface fails open)', file: CP,
    edits: [[`, ...(cfg.downloadRefusal !== undefined ? { downloadRefusal: cfg.downloadRefusal } : {}) };`, ` };`]],
    unit: { pkg: CR, files: ['tests/unit/override-matrix.spec.ts'] }, tsc: CR,
    live: { build: [CR, 'packages/cli'], only: 'F1-none-f1-out,N4' } },
  { id: 'X4', desc: 'F1: the CLI ignores the explicit `download <ref> <dir>` grant over a refused file (resolver level)', file: CLI_SETTINGS,
    edits: [[`i.config && i.extraDownloadRoots?.length && i.config.downloadRefusal !== undefined`, `i.config && (i.extraDownloadRoots?.length ?? 0) < 0 && i.config.downloadRefusal !== undefined`]],
    unit: { pkg: 'packages/cli', files: ['tests/unit/project-config-cli.spec.ts'] }, tsc: 'packages/cli',
    live: { build: [CR, 'packages/cli'], only: 'F1-arg' } },
  { id: 'X5', desc: 'F1: withSession no longer passes the explicit download dir to the resolver (wiring; live-only)', file: CLI_MAIN,
    edits: [[`      extraDownloadRoots: opts?.extraDownloadRoots,
`, ``]],
    tsc: 'packages/cli', live: { build: [CR, 'packages/cli'], only: 'F1-arg' } },
  { id: 'X6', desc: 'F2: null counts as a set value again (fails open)', file: CP,
    edits: [[`if (value === undefined || value === null) continue;`, `if (value === undefined) continue;`]],
    unit: { pkg: CR, files: ['tests/unit/config-precedence.spec.ts', 'tests/unit/override-matrix.spec.ts'] }, tsc: CR },
  { id: 'X7', desc: 'F2: SDK configFile null is treated as a path', file: 'packages/sutradhar/src/index.ts',
    edits: [[`const configFile = options.configFile ?? undefined;`, `const configFile = options.configFile;`]],
    unit: { pkg: 'packages/sutradhar', files: ['tests/unit/launch-config.spec.ts'] }, tsc: 'packages/sutradhar' },
  { id: 'X8', desc: 'F3 (A8b-style): the home boundary needs a LITERAL match of the walked dir to the home string', file: PC,
    edits: [[`if (sameFold(here, home)) return { searched, stoppedAt: 'home', stopDir: dir };`, `if (sameFold(here, home) && dir === homedir) return { searched, stoppedAt: 'home', stopDir: dir };`]],
    unit: { pkg: CR, files: ['tests/unit/project-config.spec.ts'] }, tsc: CR },
  { id: 'X9', desc: 'F3 (A8-style): canonical home equality replaced by a literal compare (a home reached through a link is not the boundary)', file: PC,
    edits: [[`if (sameFold(here, home)) return { searched, stoppedAt: 'home', stopDir: dir };`, `if (sameFold(dir, homedir) || here === 'never') return { searched, stoppedAt: 'home', stopDir: dir };`]],
    unit: { pkg: CR, files: ['tests/unit/project-config.spec.ts'] }, tsc: CR },
  { id: 'X11', desc: 'F3: the literal cwd no longer counts as "inside home" (a junction cwd inside home walks past it)', file: PC,
    edits: [[` || isPathWithinRoot(dir, literalHome, platform);`, `;`]],
    unit: { pkg: CR, files: ['tests/unit/project-config.spec.ts'] }, tsc: CR,
    live: { build: [CR, 'packages/cli'], only: 'F3-home-junction' } },
  { id: 'X12', desc: 'F4: the echo cap is removed (a 20 KB key prints 20 KB)', file: PC,
    edits: [[`  return t.length > max ? \`\${t.slice(0, max)}...\` : t;`, `  return t.length > 1e12 ? \`\${t.slice(0, max)}...\` : t;`]],
    unit: { pkg: CR, files: ['tests/unit/project-config.spec.ts'] }, tsc: CR,
    live: { build: [CR, 'packages/cli'], only: 'F4-longkey' } },
  { id: 'X13', desc: 'F8: the file viewport upper bound is removed', file: PC,
    edits: [[` || n < 1 || n > VIEWPORT_MAX) {`, ` || n < 1) {`]],
    unit: { pkg: CR, files: ['tests/unit/project-config.spec.ts'] }, tsc: CR,
    live: { build: [CR, 'packages/cli'], only: 'F8-file' } },
  { id: 'X14', desc: 'F8: the --viewport flag upper bound is removed', file: 'packages/cli/src/parse-args.ts',
    edits: [[`    viewportParsed.width <= VIEWPORT_MAX &&
    viewportParsed.height <= VIEWPORT_MAX
`, `    viewportParsed.width <= VIEWPORT_MAX * 1e9 &&
    viewportParsed.height <= VIEWPORT_MAX * 1e9
`]],
    unit: { pkg: 'packages/cli', files: ['tests/unit/project-config-cli.spec.ts'] }, tsc: 'packages/cli',
    live: { build: [CR, 'packages/cli'], only: 'F8-flag' } },
  { id: 'X15', desc: 'F9: the SDK no longer announces a discovered dialog accept', file: 'packages/sutradhar/src/index.ts',
    edits: [[`dialog.source === 'config' && dialog.value?.mode === 'accept') {`, `dialog.source === 'config' && dialog.value?.mode === 'dismiss') {`]],
    unit: { pkg: 'packages/sutradhar', files: ['tests/unit/launch-config.spec.ts'] }, tsc: 'packages/sutradhar' },
  { id: 'X16', desc: 'F1 on MCP: the server hands the resolver no config refusal', file: 'packages/mcp-server/src/server.ts',
    edits: [[`      config: fsRootsConfigLayer(cfg),`, `      config: fsRootsConfigLayer(cfg && { ...cfg, ...({ downloadRefusal: undefined } as object) }),`]],
    unit: { pkg: 'packages/mcp-server', files: ['tests/unit/server-config.spec.ts'] }, tsc: 'packages/mcp-server',
    live: { build: [CR, 'packages/mcp-server'], only: 'M-F1-none-mf1-out', surface: 'mcp' } },
  { id: 'X17', desc: 'F1 on the SDK: the SDK hands the resolver no config refusal', file: 'packages/sutradhar/src/index.ts',
    edits: [[`    config: fsRootsConfigLayer(cfg),`, `    config: fsRootsConfigLayer(cfg && { ...cfg, ...({ downloadRefusal: undefined } as object) }),`]],
    unit: { pkg: 'packages/sutradhar', files: ['tests/unit/launch-config.spec.ts'] }, tsc: 'packages/sutradhar' },
  { id: 'X18', desc: 'F2 (audit A6, re-spelled for the null-aware code): an explicit falsy value (0, "", false) falls through instead of winning', file: CP,
    edits: [[`if (value === undefined || value === null) continue;`, `if (!value) continue;`]],
    unit: { pkg: CR, files: ['tests/unit/config-precedence.spec.ts', 'tests/unit/override-matrix.spec.ts'] }, tsc: CR },
];

// ───────────────────────────── runner ─────────────────────────────
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
function sh(cmd, args, opts = {}) {
  // .cmd shims need a shell on Windows; node.exe (a path that may contain spaces) must NOT go through one.
  const useShell = process.platform === 'win32' && /.cmd$/i.test(cmd);
  const r = spawnSync(cmd, args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, shell: useShell, ...opts });
  return { code: r.status, out: strip((r.stdout ?? '') + (r.stderr ?? '') + (r.error ? String(r.error) : '')) };
}
function applyEdits(orig, edits) {
  const crlf = orig.includes('\r\n');
  let s = crlf ? orig.replace(/\r\n/g, '\n') : orig;
  for (const [f, r] of edits) {
    const n = s.split(f).length - 1;
    if (n !== 1) throw new Error(`pattern occurs ${n}x (need exactly 1): ${f.slice(0, 70)}`);
    s = s.replace(f, () => r);
  }
  return crlf ? s.replace(/\n/g, '\r\n') : s;
}

const report = [];
async function main() {
  for (const m of mutants) {
    if (ONLY.length && !ONLY.includes(m.id)) continue;
    const abs = path.join(repoRoot, m.file);
    const origBuf = fs.readFileSync(abs);
    const shaBefore = sha(origBuf);
    const row = { id: m.id, desc: m.desc, file: m.file, unit: 'n/a', live: 'n/a', caught: false, valid: true };
    try {
      fs.writeFileSync(abs, applyEdits(origBuf.toString('utf8'), m.edits));
      const tsc = sh(bin('tsc'), ['--noEmit', '-p', path.join(repoRoot, m.tsc)]);
      if (tsc.code !== 0) {
        row.valid = false;
        row.unit = `INVALID MUTANT (does not compile): ${tsc.out.split('\n').slice(0, 2).join(' ')}`;
      } else {
        if (m.unit) {
          const v = sh(bin('vitest'), ['run', ...m.unit.files], { cwd: path.join(repoRoot, m.unit.pkg) });
          const failed = /Tests\s+(\d+) failed/.exec(v.out);
          row.unit = failed ? `CAUGHT (${failed[1]} test(s) failed)` : /Tests\s+\d+ passed/.test(v.out) ? 'SURVIVED' : `NO-RESULT (exit ${v.code})`;
          if (failed) row.unit += ' e.g. ' + (/FAIL\s+(.+)/.exec(v.out)?.[1] ?? '').slice(0, 110);
        }
        if (m.live && !NO_LIVE) {
          for (const pkg of m.live.build) {
            const b = sh(bin('tsc'), ['-p', path.join(repoRoot, pkg)]);
            if (b.code !== 0) row.live = `BUILD FAILED ${pkg}: ${b.out.slice(0, 160)}`;
          }
          if (!String(row.live).startsWith('BUILD FAILED')) {
            const evDir = path.join(process.env.TEMP ?? '.', `fr214-mut-${m.id}`);
            fs.rmSync(evDir, { recursive: true, force: true });
            const live = sh(process.execPath, [path.join(here, 'verify-fr2-14-config.mjs'), `--surface=${m.live.surface ?? 'cli'}`, `--only=${m.live.only}`], {
              env: { ...process.env, SUTRADHAR_FR2_14_EVIDENCE_DIR: evDir },
            });
            let summary;
            try { summary = JSON.parse(fs.readFileSync(path.join(evDir, 'live-summary.json'), 'utf-8')); } catch { /* no summary */ }
            if (!summary) {
              row.live = `LIVE RUN ERROR (no summary; exit ${live.code}): ${live.out.slice(-200)}`;
            } else if (summary.total - summary.bySurface.harness.pass - summary.bySurface.harness.fail < 1) {
              row.live = 'LIVE RUN ERROR (the selected cases never ran)';
            } else {
              const failedIds = summary.failed.filter((f) => f.surface !== 'harness').map((f) => `${f.surface}/${f.id}`);
              row.live = failedIds.length ? `CAUGHT (live failed: ${failedIds.join(', ')})` : `SURVIVED (${summary.total - 3} selected live case(s) passed)`;
            }
          }
        }
      }
    } finally {
      fs.writeFileSync(abs, origBuf);
      const after = sha(fs.readFileSync(abs));
      row.restoredByteIdentical = after === shaBefore;
      if (m.live && !NO_LIVE) for (const pkg of m.live.build) sh(bin('tsc'), ['-p', path.join(repoRoot, pkg)]);
      row.sha256 = shaBefore.slice(0, 16);
    }
    row.caught = row.valid && (/^CAUGHT/.test(row.unit) || /^CAUGHT/.test(row.live));
    report.push(row);
    console.log(`${row.caught ? 'CAUGHT ' : 'NOT-CAUGHT'} ${row.id} ${row.desc}\n    unit: ${row.unit}\n    live: ${row.live}\n    restored byte-identical: ${row.restoredByteIdentical}`);
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'mutation.json'), JSON.stringify(report, null, 2));
  }
  // rebuild every dist the mutants touched so the tree is back to the committed behaviour
  if (!NO_LIVE) for (const pkg of ['packages/capability-runtime', 'packages/cli', 'packages/mcp-server']) sh(bin('tsc'), ['-p', path.join(repoRoot, pkg)]);
  const bad = report.filter((r) => !r.caught || !r.restoredByteIdentical);
  console.log(`\n${report.length - bad.length}/${report.length} mutants caught and restored byte-identically`);
  process.exitCode = bad.length ? 1 : 0;
}
await main();

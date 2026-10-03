// FR2-14 fix-2 mutants. Each: exact-once text replacement in ONE product file. `pkg` is the package whose dist must be rebuilt
// (tsc) so the dependent packages' tests see the mutant. `expect` names the test group that must catch it (documentation only).
// The audit-2 mutants B1, B10, B11 (and B12/B14) are re-spelled against the CURRENT source (the find strings moved with the refactor).
const CR = 'capability-runtime';
const PC = 'packages/capability-runtime/src/project-config.ts';
const FS = 'packages/capability-runtime/src/fs-roots.ts';
const EC = 'packages/capability-runtime/src/echo.ts';
const LS = 'packages/capability-runtime/src/layer-set.ts';
const CP = 'packages/capability-runtime/src/config-precedence.ts';

export const MUTANTS = {
  // ── N1: the choke point removed in each message path / the cap / the replacement ──
  C1: { desc: 'choke point removed in the toAbs catch (the audit-2 `~user` path)', file: PC, pkg: CR,
    find: '${label} "${echo(entry)}": ~user', replace: '${label} "${entry}": ~user' },
  C2: { desc: 'choke point removed in resolveConfigPath (fs-roots)', file: FS, pkg: CR,
    find: '`"${echo(entry)}": ~user is not supported', replace: "`\"${echo('') + entry}\": ~user is not supported" },
  C3: { desc: 'choke point removed in the unknown-key warning', file: PC, pkg: CR,
    find: '"${prefix}${echo(key)}" ignored', replace: '"${prefix}${key}" ignored' },
  C4: { desc: 'domain suggestion: no length limit, no choke point', file: PC, pkg: CR,
    find: "const hint = sug !== undefined && sug.length <= ECHO_MAX ? `write \"${echo(sug)}\"; ` : '';", replace: "const hint = sug !== undefined ? `write \"${sug}\"; ` : '';" },
  C5: { desc: 'choke point removed in the "cannot be checked" refusal', file: PC, pkg: CR,
    find: 'cannot be checked (${echo((e as Error).message)})', replace: 'cannot be checked (${(e as Error).message})' },
  C6: { desc: 'choke point removed in the "outside this config\'s directory" refusal (resolved path)', file: PC, pkg: CR,
    find: 'resolves to "${echoPath(c)}", outside this', replace: 'resolves to "${c}", outside this' },
  C7: { desc: 'choke point removed in the duplicate-key error', file: PC, pkg: CR,
    find: 'duplicate key ${echoValue(dup)}', replace: 'duplicate key ${dup}' },
  C8: { desc: 'choke point removed around the redacted JSON engine message', file: PC, pkg: CR,
    find: 'is not valid JSON (${echoPath(sanitizeJsonError((e as Error).message))}', replace: 'is not valid JSON (${sanitizeJsonError((e as Error).message)}' },
  C9: { desc: 'the cap removed from echo()', file: EC, pkg: CR,
    find: 'const head = s.length > max ? s.slice(0, max) : s;', replace: 'const head = s;' },
  C10: { desc: 'control/NUL/bidi replacement removed from echo()', file: EC, pkg: CR,
    find: "return `${head.replace(UNSAFE, '?')}", replace: "return `${head.replace(UNSAFE, (m) => m)}" },
  C11: { desc: 'path cap widened 200 -> 2000', file: EC, pkg: CR,
    find: 'export const ECHO_PATH_MAX = 200;', replace: 'export const ECHO_PATH_MAX = 2000;' },
  // ── N2: the home boundary ──
  H1: { desc: 'the canonical walk reverted (a link above home pointing in climbs its logical parents)', file: PC, pkg: CR,
    find: '      if (canonIn && !logicalIn) dir = canonCwd;', replace: '' },
  H2: { desc: 'the reverse-link guard removed (a directory whose real location is above home is searched)', file: PC, pkg: CR,
    find: '      if (isPathWithinRoot(home, here, platform) && !sameFold(here, home)) {', replace: '      if (false) {' },
  H3: { desc: 'audit-2 B14 / pre-fix F3: inHome from the canonical cwd only', file: PC, pkg: CR,
    find: '      inHome = canonIn || logicalIn;', replace: '      inHome = canonIn;' },
  // ── N3: each definition of "set" reverted ──
  S1: { desc: 'audit-2 B1: a blank / `;;` DOWNLOAD env counts as set (refusal skipped, FILE roots used)', file: FS, pkg: CR,
    find: "    if (isLayerSet(envResult.roots)) {\n      allowedDownloadRoots = envResult.roots;\n      downloadSource = 'env';",
    replace: "    if (isLayerSet(envResult.roots) || (input.env !== undefined && input.env[DOWNLOAD_ROOTS_ENV] !== undefined && !!input.config?.allowedDownloadRoots?.length)) {\n      allowedDownloadRoots = envResult.roots ?? input.config!.allowedDownloadRoots!.map((r) => path.resolve(input.config!.baseDir, r));\n      downloadSource = 'env';" },
  S2: { desc: 'audit-2 B10: an UPLOAD-roots env var skips the DOWNLOAD refusal (other-surface env counts)', file: FS, pkg: CR,
    find: '      if (input.config.downloadRefusal !== undefined) {', replace: '      if (input.config.downloadRefusal !== undefined && input.env?.[UPLOAD_ROOTS_ENV] === undefined) {' },
  S3: { desc: 'audit-2 B12: a blank env becomes the default roots', file: FS, pkg: CR,
    find: '  if (entries.length === 0) return { roots: undefined, warnings };', replace: '  if (entries.length === 0) return { roots: raw.length > 0 ? [defaultDownloadRoot()] : undefined, warnings };' },
  S4: { desc: 'a blank / `;;` UPLOAD env counts as set (upload allowlist silently becomes unrestricted)', file: FS, pkg: CR,
    find: '    if (isLayerSet(envResult.roots)) {\n      allowedUploadRoots = envResult.roots;', replace: '    if (isLayerSet(envResult.roots) || input.env?.[UPLOAD_ROOTS_ENV] !== undefined) {\n      allowedUploadRoots = envResult.roots;' },
  S5: { desc: 'isLayerSet: an empty list counts as set', file: LS, pkg: CR,
    find: '  if (Array.isArray(v) && v.length === 0) return false;', replace: '' },
  S6: { desc: 'isLayerSet: null counts as set', file: LS, pkg: CR,
    find: '  if (v === undefined || v === null) return false;', replace: '  if (v === undefined) return false;' },
  S7: { desc: 'firstDefined bypasses the shared definition (null and [] win)', file: CP, pkg: CR,
    find: '    if (!isLayerSet(value)) continue;', replace: '    if (!isLayerSet(value) && value === undefined) continue;' },
  S8: { desc: 'audit-2 B11 (wiring): cli.ts does not hand the `download <ref> <dir>` argument to the resolver', file: 'packages/cli/src/cli.ts', pkg: 'cli',
    find: '      extraDownloadRoots: opts?.extraDownloadRoots,\n', replace: '' },
  S9: { desc: 'CLI: an empty `download` dir list counts as a set layer (clears the refusal)', file: 'packages/cli/src/project-config-cli.ts', pkg: 'cli',
    find: 'isLayerSet(i.extraDownloadRoots)', replace: '(isLayerSet(i.extraDownloadRoots) || i.extraDownloadRoots !== undefined)' },
  // ── N4 / N8 ──
  Z1: { desc: 'the zod bound removed from the MCP browser.launch viewport', file: 'packages/mcp-server/src/tools.ts', pkg: 'mcp-server',
    find: 'z.number().int().positive().max(VIEWPORT_MAX), height: z.number().int().positive().max(VIEWPORT_MAX)', replace: 'z.number().int().positive().max(VIEWPORT_MAX * 1000), height: z.number().int().positive().max(VIEWPORT_MAX * 1000)' },
  N8: { desc: 'the override-of-a-refused-root note removed', file: FS, pkg: CR,
    find: "(downloadSource === 'option' || downloadSource === 'env')) {", replace: "(downloadSource === 'option' || downloadSource === 'env') && input.config.downloadRefusal.length < 0) {" },

  // ── auditor mutants re-spelled against the current source (their original find text moved with the fix-2 refactor) ──
  A6r: { desc: 'audit-1 A6 (re-spelled): an explicit falsy value (0) falls through instead of winning', file: CP, pkg: CR,
    find: '    if (!isLayerSet(value)) continue;', replace: '    if (!isLayerSet(value) || !value) continue;' },
  A8r: { desc: 'audit-1 A8 (re-spelled): home boundary compared literally (no canonicalisation/case fold)', file: PC, pkg: CR,
    find: '&& sameFold(here, home)) return {', replace: '&& dir === homedir) return {' },
  A8br: { desc: 'audit-1 A8b (re-spelled): home boundary needs a LITERAL match of the walk to the home string as well', file: PC, pkg: CR,
    find: '&& sameFold(here, home)) return {', replace: '&& sameFold(here, home) && dir === homedir) return {' },
  B6r: { desc: 'audit-2 B6 (re-spelled): CLI download <dir> is NOT treated as a higher layer', file: 'packages/cli/src/project-config-cli.ts', pkg: 'cli',
    find: 'isLayerSet(i.extraDownloadRoots)', replace: '(isLayerSet(i.extraDownloadRoots) && i.extraDownloadRoots!.length === -1)' },
  B13r: { desc: 'audit-2 B13 (re-spelled): home boundary by exact string equality of the canonical paths (equivalent on win32: canonicalizePath normalises case)', file: PC, pkg: CR,
    find: '&& sameFold(here, home)) return {', replace: '&& sameFold(here, home) && here === home) return {' },
};

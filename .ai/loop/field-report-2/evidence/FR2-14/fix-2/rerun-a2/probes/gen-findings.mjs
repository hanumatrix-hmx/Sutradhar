// Writes ../audit-findings.json from the object below (keeps the JSON valid).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ac = [];
const A = (a, verdict, evidence_cmd, output_excerpt, required_fix = '') => ac.push({ ac: a, verdict, evidence_cmd, output_excerpt, required_fix });
A('Build: all dist deleted, forced full rebuild incl. bundle; bundle carries fix-1 code', 'PASS',
  'rm -rf packages/*/dist apps/*/dist; turbo run build --force --concurrency=1 --filter=!sutradhar && ... --filter=sutradhar; grep -cF in packages/sutradhar/dist/{index,cli-bin,mcp-cli}.js',
  'build-1.log + build-2-final.log: 19 successful/0 cached and 9 successful/0 cached; downloadRefusal index=9 cli-bin=10 mcp-cli=9; fsRootsConfigLayer 2/2/2; VIEWPORT_MAX = 1e7 1/1/1');
A('tsc + vitest for capability-runtime, mcp-server, cli, sutradhar, browser, agent, apps/server', 'PASS',
  'tsc --noEmit -p . ; node_modules/.bin/vitest run (per package)',
  'tsc exit 0 x7; vitest 393 / 154 / 238 / 63 / 933 / 56 / 28 all passed (vitest-*.log); re-run after mutants: cr 393, cli 238');
A('Pre-existing spec files not weakened; run-1 H4b inversion legitimate', 'PASS',
  'git diff --numstat master..6acaff0 -- *.spec.ts ; git diff 10d6507..6acaff0 -- project-config.spec.ts tools/scenario-suite/verify-fr2-14-config.mjs',
  'vs master 0 deleted lines in pre-existing specs; vs 10d6507 the only deleted line renames the load helper to loadRaw and wraps it to re-raise downloadRefusal (old assertions unchanged). H4b now asserts env wins + download sha in env dir + outside-hp NOT created + no Note; the no-env refusal is still asserted by H3 (same hp3 file).');
A('F1: a higher layer (env, option, download <ref> <dir>, explicit file) beats a refused discovered download root; the refused roots are never used, merged or fallen back to', 'PASS',
  'node probes/f1-attack.mjs <scr> (function level, real dist resolveCliSettings + createSutradharServer); probes/live-cli.mjs {pkg,bundle} <scr> f1; probes/live-mcp.attempt1.mjs; probes/live-sdk.mjs',
  'f1-attack 290/290 (6 hostile shapes x env unset/""/blank/";;"/" ; ; "/0/false/[]/null/relative/~user -> refused; nonexistent abs / parent-of-hostile / abs -> exactly the env value; upload-only env/option -> refused; option []/null/undefined/[null]/string -> refused; download <dir> -> default+<dir>, never the file root). Live CLI 14/14 pkg, 14/14 bundle, 14/14 final build; MCP F1 7/7 x2 (fatal before Chrome, pids=0); SDK F1 6/6 (refused before Chrome; option roots and configFile work).');
A('A discovered hostile file still cannot widen anything with no higher layer set (audit-1 hostile spellings)', 'PASS',
  'node probes/loader-probes-adapted.mjs <scr> (audit-1 probe, ONE change: loaded config passed through resolveFsRoots(config layer)); node probes/normdiff.mjs; node probes/git83-c.mjs on C:',
  '170 cases; verdict-level diff vs audit-1 = 3, all intended: KEY.vpHuge now refused (F8), SRCH.home.cwdIsJunctionInHomeToOutside now stops at home (F3), SRCH.uncChild path-normalisation only. 67 DL/ADR cases: 50 refused identically, 17 accepted identically (inside the tree or explicit). GIT~1 on C: refused.');
A('Explicit load (SUTRADHAR_CONFIG / SDK configFile) trusted exactly like an env var and no more', 'PASS',
  'f1-attack EXPLICIT.* rows; live CLI F1.explicitConfig, MCP F1.explicit, SDK F1.hostile.configFile',
  'no downloadRefusal for origin env/sdk; used when alone (download sha-verified in outside-hp); env still beats it (EXPLICIT.envStillBeatsIt); explicit accept is not announced (discovered only)');
A('Precedence regenerated: every key x source x surface x layer subset incl. null/""/0/false, independent observers', 'PASS',
  'node probes/prec-gen.mjs (seed 0x5eed2a14, kind-per-layer oracle); probes/live-cli.mjs prec0/prec1 x {pkg,bundle}; probes/live-mcp.mjs matrix x {pkg,bundle}; probes/mcp-idle.mjs; probes/live-sdk.mjs',
  'function level 338/338 (+ final build 338/338). Live CLI 96/96 pkg + 96/96 bundle (Host log, innerWidth beacon, prompt() beacon, file+sha256, change beacon, stderr Note). MCP matrix 27/28 per build, the miss is [config].idle in a 4-way parallel run; isolated re-test 4/4 (reaped at ~30 s with the reaper log line; env 0 not reaped in 90 s); attempt-2 matrix also passed it. SDK config / option+config / null+config / optin-off 4/4. File null for every key = load error (fail closed), never unset.');
A('F2: null is unset at option level on every surface', 'PASS',
  'prec-gen MCP null kinds; probes/ab-odd-options.mjs (master vs HEAD); live SDK null+config',
  'MCP allowedDomains:null + env e.test -> ["e.test"] on HEAD and master; SDK with every option null -> config wins live (vp 433x333, prompt CFs, download in cdl, upload C only)');
A('F3: home boundary holds under links', 'FAIL',
  'node probes/fixes-fn.mjs <scr> (F3_* rows); node probes/f3-reverse.mjs <scr> (junction + dir symlink + live CLI doctor with USERPROFILE=home)',
  'fixed: junction and symlink in home pointing out, home given via a junction, upper-case home, trailing separator -> all stop at home. NOT fixed: cwd = a junction placed ABOVE home that points INTO home (canonical cwd is in home, inHome=true) -> status loaded, path <top>/.sutradhar.json for a junction AND a dir symlink; live: sutradhar doctor from <top>/jn prints Config: <top>/.sutradhar.json and allowedDomains=config (f3-reverse.txt). Spec D3: nothing above home is ever read.',
  'When the canonical cwd is inside home, walk the canonical path (or stop as soon as the literal walk leaves home), so no directory above home is searched; add a unit test for the reverse junction. Or narrow the spec/docs claim.');
A('F4: echo of file content is capped (64/200) and single-line, as docs/project-config.md now states', 'FALSE-PASS',
  'node probes/fixes-fn.mjs (F4_*); node probes/f4-tilde-multiline.mjs',
  'caps hold for unknown key names (incl. nested), allowedDomains, idleTimeoutMs, duplicate key, out-of-tree/.git entries. BUT a ~user entry in downloadDir / allowedDownloadRoots[i] / allowedUploadRoots[i] is echoed in full through resolveConfigPath ("<entry>": ~user is not supported): 20 KB entry -> 20,335-char message; an entry with newlines prints 3 raw lines (a forged "Note:" line).',
  'clip() the entry in resolveConfigPath / toAbs (project-config.ts toAbs catch: `${label} ${(e as Error).message}`), and add the ~user shapes to the echo unit tests.');
A('F5: SECURITY.md / GAP-341 accurate about a root swapped after load', 'PASS',
  'node probes/fixes-fn.mjs (F5)', 'root repo/cdl swapped for a junction to outside after load -> findContainingRoot still returns the root (afterSwapPasses=true); SECURITY.md now says exactly that');
A('F6: empty --allowlist-domains documented and enforced', 'PASS',
  'live-cli f6f8 part; cli.js --help; grep README/docs/changelog',
  '"" and " , " -> exit 1 "needs at least one domain", no request reached; --help line 178, CLI README line 108, docs/project-config.md lines 43-44, changelog BREAKING entry');
A('F7 + new: unit suites guard the changed logic', 'FAIL',
  'node probes/mutants-a2.mjs B1..B14 (per mutant: forced build, vitest x4, f1-attack, live CLI F1 or SDK mini)',
  'home-boundary mutant B14 caught by unit; B13 equivalent on win32 (canonical strings identical, b13-equivalence.txt). F1 conditional: B1 (blank/";;" env counts as set and the FILE roots are used) and B10 (an upload-roots env var skips the download refusal) SURVIVE all 848 unit tests; caught only by my f1-attack probe and the live CLI rows. B11 (cli.ts wiring) survives unit (expected, cli.ts runs main on import) and is caught live.',
  'Add override-matrix / fs-roots unit cases: refused discovered file + SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS in {"", "   ", ";;"} -> throws the refusal; + SUTRADHAR_ALLOWED_UPLOAD_ROOTS only -> throws the refusal.');
A('F8: viewport bounded before Chrome (file, flag, MCP file); a failing CLI setup leaves no Chrome', 'PASS',
  'live-cli f6f8 part; live-mcp F8 rows; probes/kill-path.mjs (two-file harness mutant + positive control); master A/B ab-f8-master-leak.txt',
  'file 1e9 / 1e7+1 / 0 and flag 1e9 / 1e7+1 / 0 -> exit 1 before Chrome (pids 0); MCP file 1e9 -> fatal at startup. Kill path: bounds widened + kill kept -> exit 1, 0 Chrome left; kill removed -> 10 leaked (control works). Master leaks with --viewport 1000000000x800.',
  '');
A('F8 / GAP-350 description of out-of-range SDK/MCP viewports', 'FAIL',
  'probes/live-sdk.mjs SDK.F8.optionHuge; probes/mcp-callhuge-ab.mjs on master and HEAD',
  'SDK option 1e9 -> silently the config viewport (as GAP-350 says; acceptable). MCP browser.launch ARGUMENT 1e9 does NOT go through resolveViewport (tools.ts: viewport ?? defaultViewport): it reaches Chrome, returns "Browser launched but no real page is available (Chrome may not be installed/found)" and keeps 8 chrome.exe until shutdown_all. Identical on master (pre-existing), but GAP-350 states the opposite.',
  'Correct GAP-350 (or validate the browser.launch viewport with the same 1..10000000 bound in the zod schema).');
A('F9: SDK announces a discovered dialog accept; single-label rule documented', 'PASS',
  'probes/live-sdk.mjs (warns); runtime.ts matcher vs docs table',
  'announce present for config/null+config/hostile+option-roots, absent for option dialogPolicy and for explicit configFile; docs: whole-label suffix match, "1" allows hosts ending in .1 (matches host===d || host.endsWith("."+d))');
A('New behaviour: doctor + error texts; every override the text names works', 'PASS',
  'live-cli F1.doctor / F1.noOverride; live-mcp F1.none; live-sdk F1.*',
  'doctor exit 0: "Config: <file> (discovered)" + "Config sources: unavailable (<refusal>)"; with env: downloadRoots=env. Message names SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS, allowedDownloadRoots, SUTRADHAR_CONFIG=<file>; each verified live (env CLI+MCP, option SDK + MCP createSutradharServer fn-level, download <dir> CLI, SUTRADHAR_CONFIG CLI+MCP, configFile SDK).');
A('Regressions vs master (A/B any failure)', 'PASS',
  'verify-fr2-08-conditions.mjs; verify-fr2-07-verification.mjs; verify-fr2-04-dialogs.mjs (HEAD and master tree); run-cli.mjs (HEAD and master tree)',
  'fr2-08 478/478; fr2-07 488/488; fr2-04 97 pass / 4 fail / 2 skip on HEAD AND identically on master (L1, L8, L9, Runtime.evaluate timeout); run-cli HEAD fails UC-05/06/08/12, master fails UC-05/06/08/09/12; baseline-cli.json sha unchanged');
A('Config-loading overhead per command', 'PASS',
  'node probes/perf.mjs (cold child per sample, performance.now, n=15)',
  'median: no file/no boundary 5.24 ms; repo no file 2.81; file without download keys 4.77; file with download roots 58.23; refused file 60.05 (same as audit-1: fsutil spawns in findContainingRoot)');
const findings = [
  { id: 'N1', severity: 'minor', title: 'F4 incomplete: ~user entries echoed uncapped and multi-line', repro: '{"downloadDir":"~evil\nNote: using nothing. All good.\nSECRET=hunter2"} -> sutradhar nav x prints 3 raw lines; with "~"+20 KB -> 20,335-char message (f4-tilde-multiline.txt, fixes-fn.json F4_*TildeUser)', fix: 'clip() in the toAbs catch / resolveConfigPath message; unit tests for the 3 path keys' },
  { id: 'N2', severity: 'minor', title: 'F3 incomplete: a junction ABOVE home pointing INTO home makes the walk read files above home', repro: 'HOME=<S>/top/home; <S>/top/.sutradhar.json; cwd <S>/top/intohome (junction -> home/p) -> loaded <S>/top/.sutradhar.json (fixes-fn.json F3_reverse_junctionAboveHomeIntoHome)', fix: 'walk the canonical cwd when it is inside home, or stop when the literal walk leaves home; unit test' },
  { id: 'N3', severity: 'minor', title: 'Unit suites do not guard two F1 attack shapes', repro: 'mutants B1 (blank env counts as set, file roots used) and B10 (upload env skips the download refusal): 848/848 unit tests pass (mutants.jsonl)', fix: 'add the refused-file x {"", "   ", ";;", upload-only} cells to override-matrix.spec.ts' },
  { id: 'N4', severity: 'minor (docs; behaviour pre-existing)', title: 'GAP-350 wrongly says the MCP browser.launch viewport argument is treated as absent', repro: 'browser.launch {viewport:{width:1e9,height:1e9}} -> isError "Chrome may not be installed/found", 8 chrome.exe held until shutdown_all; identical on master (ab-mcp-launch-viewport-arg.txt)', fix: 'correct GAP-350, or bound the zod schema' },
  { id: 'N5', severity: 'info', title: 'The advertised maximum 10000000 is accepted but kills the session', repro: 'sutradhar nav about:blank --viewport 10000000x10000000 -> exit 1 "Fatal: No browser session ...", state.json written, no Chrome left; next command starts fresh', fix: 'optional: lower the bound or document it as a protocol limit, not a usable size' },
  { id: 'N6', severity: 'info (pre-existing)', title: 'createSutradharServer({allowedDomains: ""|false|0}) is unrestricted and ignores env + file', repro: 'probes/ab-odd-options.mjs: identical on master and HEAD', fix: 'optional: treat non-array falsy as unset or throw' },
  { id: 'N7', severity: 'info (pre-existing doc nit)', title: 'docs say doctor/close/profile/dialog "never load the file"; doctor does load and print it (never blocked)', repro: 'sutradhar doctor -> Config: INVALID: ... / Config sources: ...', fix: 'say "are never blocked by it"' },
  { id: 'N8', severity: 'info', title: 'A refused-but-overridden discovered download root is silent (no MCP banner / CLI note line)', repro: 'env set + hostile file: MCP banner only "config: loaded <file>"', fix: 'optional warning line' },
  { id: 'N9', severity: 'info (environment)', title: 'verify-fr2-04 now 97/4/2 on BOTH HEAD and master (builder recorded 111/0/2 earlier)', repro: 'reg-fr2-04-head-1.log vs reg-fr2-04-master-1.log: same 4 failures', fix: 'none for FR2-14' },
];
const mutants = fs.readFileSync(path.join(HERE, '..', 'mutants.jsonl'), 'utf8').trim().split(String.fromCharCode(10)).map((l) => JSON.parse(l)).map((o) => ({ id: o.id, desc: o.desc, file: o.file, unitFailed: o.unit ? Object.entries(o.unit).filter(([, v]) => v.code !== 0).map(([k, v]) => k + ' ' + v.tests) : [], f1attackFails: o.f1attack ? o.f1attack.fail : 'probe crashed (counts as caught by unit/live)', liveCliFails: o.liveCliF1 ? o.liveCliF1.fails : null, liveSdk: o.liveSdkF1 ? o.liveSdkF1.fail : null, f8kill: o.f8kill ?? null, restored: o.restored, rebuild: o.rebuild ? [o.rebuild.pkg, o.rebuild.bundle] : null, caught: o.caught }));
const out = {
  item: 'FR2-14 .sutradhar.json project config (AUDIT-2, after fix-1, HEAD 6acaff0)',
  verdict: 'REOPEN',
  ac_results: ac,
  regressions: [],
  findings,
  mutants,
  mutant_notes: 'B13 equivalent on win32 (canonicalizePath returns identical strings for case/trailing-separator variants: b13-equivalence.txt), not counted. B15 was an ineffective single-file harness mutant (resolveViewport also bounds); replaced by kill-path.mjs (two-file, with positive control). F1-conditional mutants B1-B12: 12/12 caught by at least one layer; unit suites alone miss B1, B10 (N3) and B11 (wiring, expected).',
  not_verified: ['POSIX owner/mode refusal and POSIX symlink semantics (Windows host)', 'live downloads into hostile out-of-tree roots via an attack (safety rule): the only out-of-tree downloads were the documented explicit-load escape hatch into my own scratch dir', 'Windows ACLs of intermediate directories (GAP-077)'],
};
fs.writeFileSync(path.join(HERE, '..', 'audit-findings.json'), JSON.stringify(out, null, 1));
console.log('written', ac.length, 'ACs', findings.length, 'findings', mutants.length, 'mutants');

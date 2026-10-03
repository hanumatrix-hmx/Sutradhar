# FR2-14 AUDIT-3 verdict (after fix-2): ACCEPT, with two minor follow-ups

Auditor: independent. Worktree `project-understanding-696041`, branch `claude/fr2-14-project-config`, HEAD `7a44cb5`
(confirmed with `git rev-parse --show-toplevel`, `git branch --show-current` and `git rev-parse HEAD`).

- Product code was edited only by my mutants. Each was restored byte-identically (`mutant-files-sha-after-check.txt`: 5/5 OK).
- After the mutants, all dist was deleted and rebuilt with force (`build-2-after-mutants.log`: 19 + 9 tasks, 0 cached).
- Nothing was committed or pushed.
- Probes are in `probes/` and outputs are in this directory.
- I formed this verdict before reading `fix-2/` and the fix-2 section of `run-1/false-pass-analysis.md`.

## Why ACCEPT

Neither hard-fail condition occurs:
- **No widening.** No path lets a discovered file widen an access decision (domains, download or upload roots, dialog, idle, viewport).
- **Precedence holds.** The decided order flag > env > file > default holds on CLI, MCP and SDK.

The audit-2 items are fixed:
- **N1:** `~user` echoes are capped and single-line.
- **N2:** a link above home pointing in no longer loads a file above home.
- **N3:** B1, B10 and B11 are now caught by unit tests.
- **N4:** the MCP viewport is bounded by the schema.

Both done-when items pass, fresh and live.

The new findings change no access decision:
- one documentation claim is false (A3-1);
- one unit-test gap (A3-2);
- infos.

**If the echo cap counts as a "protection", A3-1 makes this BLOCKED.** It is an undocumented path for discovered-file text to reach output beyond the documented bound. I rule that it does not count, for two reasons:
- SECURITY.md's trust model does not list the echo cap.
- The refusal it decorates has already refused.

The user can override that ruling.

## Findings

| # | Severity | One-line repro | Required fix |
|---|---|---|---|
| A3-1 | minor (docs claim false) | A discovered file contains `{"allowedUploadRoots":["./up<LF>Note: upload permitted, all good<U+202E>" + 20000 chars]}`. Then `sutradhar upload #f C:\Windows\win.ini` prints a **20,306-char** refusal. The injected text starts its own line, and raw U+202E is printed. The same happens on other surfaces: MCP `upload_file` returns 46 KB with RLO, the MCP `download_file` refusal echoes `downloadDir` raw, and SDK `uploadFile` throws a 20 KB multi-line error. The nav-block message echoes an 18 KB `allowedDomains` entry (safe chars, uncapped). Evidence: `echo-live-{cli,mcp,sdk}.json`. This contradicts docs/project-config.md: "Every message built from file text ... goes through one function (echo.ts) ... so a new message cannot echo more". | Echo the root and domain lists through `echo`/`echoPath` with a list cap. The sites are `browser-action-engine.ts:283,317` and `runtime.ts:2130,2903`. Or refuse control, bidi and line-separator characters in file path entries at load time. At minimum, narrow the doc sentence to loader messages. |
| A3-2 | minor (test gap) | Mutant M4 compares the above-home skip with the literal home instead of the canonical one. It passes **all** unit tests: cr, cli, mcp and sdk each have 0 failures. Only my topology probe catches it. The case is `HOME=c97\hl` (a junction to `a\b\h`) with cwd `hl\w\k\l1`, where `l1` is a junction to `a\b`. Under the mutant, `a\b\.sutradhar.json`, which is above home, is loaded. The real code loads `a\b\h\w\k`. Evidence: `mutants-a3-M4-rerun.json`. | Add a home-boundary.spec.ts case: HOME is a link, combined with an in-home link that points above the real home. |
| A3-3 | low / info | The cwd is `\\localhost\E$\...\H\P\Q`, a UNC alias of a directory inside home, and homedir is `E:\...\H`. The file in the parent of home is loaded, because realpath keeps the UNC spelling (`probes/unc.mjs`). In substance this is GAP-355 clause 2 ("inside home neither as written nor really"). Exploiting it needs write access above home, which is admin-only on default Windows. | Narrow the absolute doc sentence "never read when you are inside home" to cover path aliases. |
| A3-4 | info | CLI `download <ref> <dir>` over a refused discovered root prints no N8 note. With env also set, it suppresses the note that env alone would print. This is 12 of the 735 precedence cells. Values and sources are correct. | Optional: print the note, or say the note covers env and option only. |
| A3-5 | info | The source-level guard only sees template interpolations. M5 (`+ ' (' + key + ')'`) passes all 4 guard tests. The generated corpus catches it (4 tests fail). | None. The corpus is the backstop, but it covers loader messages only (A3-1). |
| A3-6 | info | `SUTRADHAR_IDLE_TIMEOUT_MS="   "` is an error, but the docs say a blank env means "not set". This is stricter, so it fails closed. CLI dialog and `resolveViewport` use their own equivalent checks, not `isLayerSet`. | Wording. |
| A3-7 | info | `USERPROFILE=""` gives `Fatal: uv_os_homedir returned ENOENT`, exit 1, and no browser starts. It fails closed. | None. |

## Home boundary (new walk): own generator and oracle (`probes/topo-a3.mjs`, seed 0xa3d17e55)

**Model.** I used my own structure:

| Path | Role |
|---|---|
| `a/b/h` | home |
| `a/b` and `a` | above home |
| `a/b/s/t` | sibling of home |
| `o/p/q` | outside |

Each case gets 1 to 4 links, which are junctions or directory symlinks. A link target can be another link, which makes chains, including junction to junction. The home spelling also varies: real, a junction link, a symlink-to-junction chain, UPPER case, and a trailing separator.

**Oracle.** The oracle resolves links in an in-memory model, never through the filesystem. It is compared with the real `findProjectConfigPath` running on real links.

**Results:**
- **1200/1200 checks pass** over 400 cases.
- **S1 = 0:** a file above home was never loaded while the cwd was in home.
- **S3 = 0:** a found file was never off both the literal-real chain and the canonical chain.
- **Live doctor: 24/24 agree** (real CLI, USERPROFILE set per case).
- Coverage:
  - 410 in-home / 790 not in home checks;
  - 190 canonical-only cwds (the N2 shape) and 31 logical-only cwds (the F3 shape);
  - 487 cwds via a link;
  - 661 junctions and 562 directory symlinks.
- A first run had 45 mismatches. The cause was MY oracle, which did not model the home link. I fixed the oracle and re-ran; that first run is not counted.

**Hand-written attacks (`probes/attack-home.mjs`): 31/31 pass, function-level plus 4 live doctor runs.** They cover:
- F3: a junction or symlink in home pointing out;
- N2: a junction or symlink above home pointing in;
- chains: junction to junction, and symlink to junction to junction;
- a link in home pointing above home;
- HOME as a link, with a trailing separator, in upper case, and with forward slashes;
- an empty homedir and HOME on another drive (C:), which give the documented plain walk;
- a junction from E: into the real C: home;
- the 8.3 home spelling `C:/Users/VARADM~1` in both directions;
- `.sutradhar.json` as a file symlink into an untrusted tree: `baseDir` is the link directory and an escaping `downloadDir` is refused;
- a symlink to a file above home, read as project content;
- a dangling config symlink, which is an error;
- cwd `E:/` (filesystem root, never read);
- a device-path cwd;
- a UNC cwd with a UNC home.

## GAP-355 ruling: safe

Consider every check where the cwd was in home and the result differed from what a `cd` to the REAL cwd would load. There are 13. In each, the loaded file was **inside home**: it came from the logical in-home ancestors of the cwd (the F3 semantics).

Every other in-home find is the same file a direct `cd` to the real directory would load. A link-reached directory is only ever searched at the real location of a directory on the literal path of the user. That file has download roots confined to its own tree.

So a hostile repo reached through a link can only supply the config that the target directory would supply anyway. It can never supply a config above home or one off the path. The finds that are outside home and differ from a direct walk (27) all occur only when the cwd is not in home. The docs already describe that plain walk.

## Echo corpus

**Loader messages (`probes/echo-corpus.mjs`).** I ran 324 hostile documents and checked 337 messages. Inputs:
- payloads: multi-line, 20 KB, `~user`, ESC/BEL/DEL/C1, NUL, bidi (RLO/LRI/PDI/RLM/ALM/BOM), lone high and low surrogates, a cut surrogate pair, LS/PS, and secret-looking values;
- positions: every key, unknown keys at the top level and nested, `dialog.*` and `viewport.*`, wrong types, duplicate keys (top, nested and escaped), and 5 JSON-error forms.

Result: **0** bad messages. The longest is 773 chars (64 + 200 for refusals). promptText and unknown-key values are never echoed.

**Downstream: see A3-1.** CLI, MCP stdout/stderr and SDK output were all checked. Stack traces never appear: the CLI prints `Error:`/`Fatal:` plus the message only.

## Precedence and F1 (`probes/prec-a3.mjs`, seed 0x5a3f0c14, exhaustive per surface x key x layer kinds)

| Surface | Cells | Method |
|---|---|---|
| CLI | 222 | real `parseArgs` + `resolveCliSettings` |
| MCP | 444 | real `createSutradharServer` with `process.env`; viewport through the real zod schema via an in-memory MCP client |
| SDK | 69 | real `launch()` with `SutradharRuntime.prototype.launch` intercepted; SUTRADHAR_* env set to prove the SDK ignores it |

Layer kinds were: absent, null, an empty list, an empty string, blank, `;;`, spaced `;;`, `,,`, `0`, `false`, a relative path, a valid value, a refused discovered root, a refused `.git` root and an explicit outside root.

Results:
- **723/735** cells pass. All 12 others are A3-4 (note flag only).
- **0** value or source mismatches.
- A refused root was never used as a fallback (`refusedRootUsed` was never set).

**Live (`probes/live-prec.mjs`, independent observers): 34/34.** The observers were `innerWidth`, `prompt()` return, navigation block, the stderr Warning, doctor sources and chrome.exe PIDs. What was checked:
- CLI package and bundle, each:
  - parent config discovered;
  - env > config and flag > env for domains;
  - flag > config for viewport;
  - `--dialog dismiss` > config accept;
  - F1: refused with no higher layer means exit 1 before Chrome;
  - env override with the N8 Warning;
  - `;;` stays refused;
- MCP: fatal before Chrome; env override with the startup warning; banner names the parent file;
- SDK: throws before Chrome; option override with the `console.warn` note;
- 0 Chrome left.

## Fail-closed, hostile roots, viewport

- **Fail-closed: 170/170** (`probes/failclosed.mjs`). Every shape below is a load error:
  - every key as null, an empty string, 0, false, an empty list, an empty object, true, a number, a string, `[null]`, `[1]`, a list holding an empty string, or a nested array;
  - 16 bad domains;
  - bad dialog and viewport values, including 1e400;
  - duplicate keys, comments and a trailing comma;
  - empty, top-level non-object;
  - UTF-16 LE/BE with or without BOM, invalid UTF-8, and 65537 bytes or BOM + 65537;
  - deep nesting in idle;
  - a file that changes during the read (grows, turns malformed, vanishes, becomes a directory, or gives EACCES).
- Accepted: BOM, exactly 65536 bytes, `-0`, `idleTimeoutMs: 0`.
- `__proto__` and `constructor` smuggling: warn only. No pollution, and no `allowedDomains` taken.
- Live `nav` refuses before Chrome, and `doctor` prints INVALID and exits 0.
- **Hostile roots:** I re-ran the audit-1 loader probe. My adapter adds one line: the loaded config goes through `resolveFsRoots` (`probes/loader-probes-adapted.mjs`). Over 170 cases, 169 have the same verdict as the audit-1 baseline; the one change is vpHuge, which is intended. DL/ADR: 50 refused and 17 accepted (inside the tree or explicit).
- **Explicit load:** used when alone and beaten by env/option, with no refusal (prec cells `explicitOutside`).
- **Viewport (`probes/vp-live.mjs`, package and bundle):**
  - MCP `browser.launch` with 0, -1, null (NaN), 100.5, 1e9, 10000001 or a string returns -32602 with 0 new Chrome. The positive control (800x600) spawns 8 Chrome, so the observer works.
  - CLI `--viewport` 0x5, 5x0, 10000001x5, -5x5, 1.5x5 or abcxdef: exit 1.
  - `10000000x10000000`: exit 1 "No browser session ...", and 0 Chrome remain even without `close`. This matches the docs (N5/GAP-353).
- **Docs:** checked docs/project-config.md, `--help`, the CLI README, SECURITY.md, AGENT_SETUP.md and the changelog fragment.
  - The empty `--allowlist-domains` break is documented in `--help`, the CLI README, docs/project-config.md and the changelog.
  - The doctor wording (N7) matches.
  - Exceptions: A3-1 and the A3-3 sentence.

## Mutants (own, `probes/mutants-a3.mjs`)

Each mutant was run as follows:
1. one exact replacement;
2. tsc of the touched packages;
3. vitest for cr, cli, mcp and sdk;
4. my probes;
5. restore, checked by sha;
6. rebuild.

| id | mutant | unit fails (cr/cli/mcp/sdk) | own probes | caught |
|---|---|---|---|---|
| M1 | home walk: N2 revert (no canonical walk) | 11/0/0/0 | topo 12, attack 1 | yes |
| M2 | home walk: never skip a dir above home | 12/0/0/0 | topo 3 (S1=3), attack 4 | yes |
| M3 | topology: canonical-only cwd not in home | 20/0/0/0 | topo 19 (S1=18), attack 9 | yes |
| M4 | topology: above-home test vs the LITERAL home | **0/0/0/0** | topo 1 (S1=1) | yes, **only by my probe (A3-2)** |
| M5 | echo bypass by concatenation in the unknown-key warning | 8/0/0/0 (corpus only; source guard blind, A3-5) | echo 36 | yes |
| M6 | echo.ts stops replacing bidi | 4/0/0/0 | echo 14 | yes |
| M7 | raw error text in "cannot be checked" | 4/0/0/0 | - | yes |
| M8 | isLayerSet bypassed at the option site (empty list counts) | 2/0/0/0 | prec 52 | yes |
| M9 | isLayerSet: an empty list counts as set | 6/2/1/0 | prec 73 | yes |
| M10 | a discovered file is trusted (no refusal) | 21/6/4/6 | prec 78, hostile roots 63 accepted, attack 1 | yes |
| M11 | CLI `download <dir>` strips non-refused file roots | 0/4/0/0 | prec 22 | yes |
| M12 | N8 note removed | 1/0/0/1 | prec 38 | yes |
| M13 | stricter rule (skip everything outside home, the GAP-355 alternative) | 2/0/0/0 | topo 4 | yes |

Result: 13/13 caught by at least one layer. M2 and M12 were type-invalid on the first try; they were re-spelled and not counted until they compiled.

## Master comparison (fdae749 tree at E:/AI-Cache/tmp/fr211-master)

I checked the tree against `git ls-tree -r fdae749`:
- 5098 tracked files;
- 5094 are identical (274 byte-identical, 4820 after CRLF normalisation);
- 4 differ: 3 unit-test files and `results/uc06-modal-after-clicktext.png`. No product source differs.

The master `results/*` shas were unchanged by my runs. All suite output went to my scratch through the evidence and output env overrides (logs copied to `regression/`).

| Suite | HEAD | Master | Attribution |
|---|---|---|---|
| verify-fr2-08 | 478/478 | - | no regression |
| verify-fr2-07 | 488/488 (hygiene: 0 lingering Chrome) | - | no regression |
| verify-fr2-04 | 110/1/2, 111/0/2, 110/1/2 (only `L13.headed.click-exit0`: click timed out at 15 s with an alert pending) | 111/0/2 twice | flake |
| run-cli | UC-04/05/06/08/12 fail | UC-04/05/06/08/09/12 fail | external sites; HEAD failures are a subset of master's |

**Why the L13 failure is a flake:** in isolated interleaved A/B (`probes/l13-ab.mjs`, 8 rounds, headed nav, click, alert), HEAD was 8/8 exit 0 and master 8/8 exit 0, with 6.33 to 6.40 s per click on both. The failure only shows in the full suite. It is the known GAP-338 / GAP-321 headed-click stall family. FR2-14 adds no config here: there is no `.sutradhar.json` and the walk stops at the worktree `.git`.

**Overhead per command** (cold child, `performance.now`, n=15, medians):

| Case | ms |
|---|---|
| No file | 2.5 to 3.5 |
| File without download keys | 4.9 |
| File with download roots | 54.6 (fsutil case-sensitivity spawn) |
| Refused file | 52.2 |

These match audit-2. A `close` round trip is unaffected (234 to 240 ms, because `close` never loads the file).

## False-pass analysis (per AC)

| AC | How the check could pass while broken | Ruled out by |
|---|---|---|
| Home boundary | The oracle copies the walk; links silently not created; only one repro. | The oracle resolves an in-memory link table, not the fs. It counts 661 junctions and 562 directory symlinks actually created (materialize errors would be logged as skips: 0). Its first run caught MY oracle bug (45 mismatches), so it is not vacuous. Mutants M1, M2, M3, M4 and M13 each make it fail. Oracle-free properties: S1 and S3. |
| Precedence / F1 | Testing resolvers instead of the composed surfaces; a stale dist; values that coincide. | It uses the real `createSutradharServer`, the real `launch()` with only `runtime.launch` intercepted, the real `parseArgs`, and the real zod schema through an in-memory client. Each layer has a distinct value (401/402/403/404/405 widths, `flag.test`/`env.test`/`cfgXXX.test`, distinct roots). A forced rebuild came first. M8, M9, M10, M11 and M12 move the counts. Live observers are `innerWidth`, the `prompt()` return value, the navigation block and Chrome PIDs. |
| Echo | The corpus misses a message path; the length oracle shares the code under test. | My oracle counts a filler char (U+01A9) absent from static text, and has its own unsafe-char regex. M5 and M6 make it fail. It is also what found A3-1: it was extended to runtime refusals, live on all 3 surfaces. |
| Fail-closed | An "error" outcome from a crash, not a refusal. | Only `ProjectConfigError` counts as a refusal; any other error class is a failure. Injected-fs cases cover changes during the read. Live `nav` exits 1 with 0 Chrome. |
| Viewport / no leak | The Chrome observer never sees Chrome. | The positive control (an 800x600 launch) shows 8 new chrome.exe from my TEMP. The max-viewport case was re-checked without `close`: 0 left. |
| Regressions | Load flake counted as a regression, or as no regression. | Every failure was A/B'd. L13 was isolated and interleaved 8 vs 8. run-cli was compared case by case with master. |
| Restore | "Restored" claimed from memory. | `sha256sum -c` gives 5/5 OK after all mutants and after the M5 guard check. Then all dist was deleted and rebuilt with force. `git status` shows only `audit-3/`. |

## Not verified

- POSIX owner/mode and symlink semantics (Windows host).
- Attack-style live downloads into hostile roots (safety rule). All download checks were refusals before any click, or function-level.
- subst drives and mapped network drives. I did not create them because that changes session state on a shared machine. The UNC loopback alias was tested at function level.
- Windows ACLs (GAP-077).
- The renderable maximum viewport (machine-dependent; GAP-353).

## Process

- **Scratch:** `E:/AI-Cache/tmp/fr214a3`, created by me (it did not exist at start). TEMP and TMP pointed there for every run, so all `sutradhar-cli-*` profiles landed inside it.
- **Deletions:**
  - I unlinked its 474 junctions and symlinks first without following them (one pointed at the real home), then removed the directory.
  - I also removed `C:/Users/Varad M/.sutradhar-cli/4f9f68dedb86a9f5`. It was empty, and it is the sha256 prefix of my scratch cwd `E:/AI-Cache/tmp/fr214a3/le`.
  - The helper script `E:/AI-Cache/tmp/fr214a3-unlink.cjs` was mine and was removed.
- **Untouched:** `E:/AI-Cache/tmp/sutradhar-cli-1790798002107`.
- **Processes:** I killed none. Every Chrome I started was closed by its own CLI `close`, MCP `shutdown_all` or SDK `close`. The final check found 0 chrome.exe with my scratch in the command line. The background runner shells I started (PIDs 1201, 1785, 1491) exited on their own.
- **Disk (E:):** 14 GB free before; 12 GB lowest during the run; 14 GB after cleanup.

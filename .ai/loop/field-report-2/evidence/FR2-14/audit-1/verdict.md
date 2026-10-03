# FR2-14 AUDIT-1 verdict: REOPEN

Auditor: independent (did not write the code). Worktree `project-understanding-696041`, branch
`claude/fr2-14-project-config`, HEAD `a1ff2ca` (confirmed with `git rev-parse --show-toplevel`,
`git branch --show-current`, `git rev-parse --short HEAD`). Product code was not edited, apart from the 14
mutants, each restored byte-identically (`mutant-files-sha-before.txt`, `sha256sum -c`: all OK). Nothing was
committed. Every probe and log is in this directory, and the scratch data is in the session scratchpad.

## Why REOPEN (in one paragraph)

The core of FR2-14 holds. My own generator and oracle (not the builder's) found the precedence correct for
every key, every layer subset and every surface, observed live through independent observers: the server's Host log,
the page's own beacons, the filesystem plus sha256, and chrome.exe process lists. Fail-closed held for 25 malformed
or hostile shapes on all 5 surfaces (125/125 refused before Chrome). The Done-when (a live CLI run from a child
directory picks up the parent's file) passes on the package CLI and the bundle CLI. Two defects break the decided
precedence rule on a path users are told to take, though, and several docs claims are false:

- **F1 (major).** For a discovered file whose download dir is outside its tree, the error message says "To allow
  it anyway, set SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS". Setting that env var does NOT help. The command still exits 1,
  and MCP still dies at startup. This contradicts the spec's 7.1 ("SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS (env > config)
  always beats it"), the CLI README ("SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS ... beat the file's roots") and the decided
  rule env > config.
- **F2 (minor, security-relevant regression).** `firstDefined` treats `null` as a value. So
  `createSutradharServer({allowedDomains: null})` now ignores `SUTRADHAR_ALLOWED_DOMAINS` and the config, and runs
  UNRESTRICTED. Master applied the env var (`null ?? env`). A/B: `ab` lines in `precedence-fn.out` and the
  inline check in the findings.
- **F3-F7 (minor).** These are the home-boundary bypass through a junction, docs claims that are false, and an
  untested home-boundary equality. See the findings.

## Per-AC results (formed BEFORE reading run-1/deviations.md and false-pass-analysis.md)

| AC | Verdict | Evidence (command -> excerpt) |
|---|---|---|
| Build: forced, bundle carries the new code | PASS | All 20 dist dirs deleted; `turbo run build --force --concurrency=1` -> `19 successful ... 0 cached` and `9 successful ... 0 cached` (`build-1.log`, rebuilt again after the mutants in `build-2-after-mutants.log`). Grep of `packages/sutradhar/dist/{index,cli-bin,mcp-cli}.js` finds `outside this config's directory`, `SUTRADHAR_CONFIG`, `config: loaded` (mcp-cli) and `allowlist-domains needs at least one domain` (cli-bin). |
| tsc + vitest, 7 packages | PASS | tsc exit 0 x7 (`tsc-*.log`). vitest: capability-runtime 356, mcp-server 147, cli 228, sutradhar 55, browser 933, agent 56, apps/server 28, all pass (`vitest-*.log`). |
| No weakened pre-existing tests | PASS | `git diff --numstat master..HEAD -- '*.spec.ts'` shows 0 deleted lines in each modified pre-existing spec (fs-roots +18, help-text +17, tools +35). |
| Precedence flag > env > config > default, unit-tested | PASS for ordinary values; **FAIL on two paths (F1, F2)** | My own generator and oracle (`probes/precedence-fn.mjs`): 95/95 over every key x every subset of layers for the CLI composition (`resolveCliSettings`) and the MCP composition (the real `createSutradharServer` runtime object inspected; the viewport goes through the REGISTERED `browser.launch` handler). Odd values: env `""`, `" , "`, `"0"`, option `0`, option `[]`, option `-5` all behave as documented; **option `null` -> unrestricted (F2)**. F1 is the env layer failing to beat an out-of-tree discovered `downloadDir`. |
| Live: every key x layer subset x surface, independent observers | PASS | CLI package 96/96 (`live-cli-pkg.jsonl` 90 plus the 6 trust-notice rows re-verified in `live-cli-pkg.flagrerun.jsonl`, 48/48; run 1's 6 notice "fails" were my matcher catching FR2-04's "Note: dialog policy" line). CLI bundle 96/96. MCP package 32/32, MCP bundle 32/32. SDK (bundle `index.js`) 33/33. All 16 subsets of {flag, env, state, config} on the CLI, all 4 of {env, config} on MCP, all 4 of {option, config} on the SDK, plus opt-in-off, explicit, both and env-ignored. |
| Done-when: live CLI picks the config up from a PARENT directory | PASS | cwd `<S>/proj/a/b` with the file only in `<S>/proj`. The download lands in `<S>/proj/cdl` (sha256 matches the served bytes), never in `cwd/cdl`. The page reports `405x305`, and the server never sees a request to a host outside the allowlist (`live-cli-*.jsonl` `[config]` rows). Same for the bundle. |
| Search (nearest wins, no merge; boundaries; odd starts) | PASS with **F3** | `loader-probes.json`: nearest wins with no merge (`SRCH.nearestWinsNoMerge`: only `allowedDomains`, no viewport from the farther file); `.git` FILE boundary; drive root `E:` gives `filesystem-root` with 0 searched; UNC share root likewise; UNC and `\?\` child starts work; a `.sutradhar.json` that is a directory, a broken symlink or a broken junction is an error; cwd inside `.git` errors. **F3:** a cwd that is a junction inside HOME walks ABOVE home (unit-level `SRCH.home.cwdIsJunctionInHomeToOutside`, live `F3-home-junction-evidence.txt`). |
| Trust / hostile config | PASS with F1/F4 | 80 hostile download-root spellings (`DL.*`, `ADR.*`): `../`, absolute, forward-slash absolute, `~`, `~/x`, UNC, `\?\`, `\.\`, `/x`, `\x`, `.git/hooks`, `.GIT`, `.git.`, `.git ` (trailing space), `.git::$INDEX_ALLOCATION` (realpath resolves it to `.git`: refused), `GIT~1` on an 8.3-enabled C: (refused), a junction out, a junction to `.git`, `dl/../../x`: all refused. `%USERPROFILE%`, `$HOME` and `E:x` stay literal, inside the tree. Explicit loads are trusted (CT6 equivalent). Upload/domain keys only narrow. Live: 5 surfaces refuse `escapeDl`, `gitHooks`, `gitHooks` with a backslash, and absolute `C:/Windows/Temp`. |
| Fail-closed before Chrome | PASS | `live-failclosed.jsonl`: 25 shapes x 5 surfaces = 125/125 refused with no chrome.exe for that case's TEMP, no `sutradhar-cli-*` dir and no state.json. Shapes: empty, URL, `*` domains, bad JSON, `null`/`[]` top level, wrong types, negative/huge idle, nested arrays, duplicate keys, comments, invalid JSON with a secret (not echoed), viewport 0, bad dialog, `null` downloadDir, UTF-16, >64 KiB, a directory, a broken link, an empty file. Function level adds BOM (ok), BOM + 64 KiB (ok), whitespace >64 KiB, `__proto__`/`constructor` (warning only, prototype intact), 20k-deep arrays, 7k-deep objects (no crash), latin-1 (invalid UTF-8). |
| Cleanup verbs never blocked; GAP-342 | PASS (by design) | `doctor` exit 0 with `Config: INVALID: ...`; `close`, `profile list` exit 0; `dialog` exits 1 only for "No active session". With `--allowlist-domains` and an invalid file: exit 1 (D7, documented). `SUTRADHAR_CONFIG=none` reports disabled. |
| Surfaces (banner, doctor, notice, SDK opt-in) | PASS | MCP banner rows 8/8 (both builds), including the accept warning exactly when a discovered file sets accept. The CLI `Note:` appears on every command where a discovered file supplies the download dir or `accept`, and never otherwise (32/32 notice rows). SDK: `optin-off` reads nothing; `env-ignored` (`SUTRADHAR_CONFIG=none` plus env domains/roots) is ignored by the SDK; `both` and option `report` throw TypeErrors. |
| Docs match the behaviour | **FAIL (F1, F4, F5, F6)** | See the findings. |

## Findings

| # | Severity | Finding | One-line repro | Required fix |
|---|---|---|---|---|
| F1 | **major** | Env does not beat a discovered file's out-of-tree download dir. The message says "To allow it anyway, set SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS", but with that env var set the CLI still exits 1 and MCP dies at startup. Same on all 4 binaries (`F1-escape-hatch-evidence.txt`, `live-failclosed.jsonl` `escapeHatch.*`). This contradicts spec 7.1, the CLI README and the decided flag > env > file > default rule. | `r/.git`, `r/.sutradhar.json`=`{"downloadDir":"../out"}`; `cd r/sub; SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS=<abs dir> sutradhar nav about:blank` -> `exit 1 ... outside this config's directory ... To allow it anyway, set SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS` | Make the containment refusal apply only when the file's download layer is the effective one, i.e. when no env/option download roots are set. Keep D7 for malformed values. Or, if the team prefers GAP-342 semantics, drop the env advice from the message, the CLI README, SECURITY.md and spec 7.1. Either way, add a live CLI+MCP test for "env set + out-of-tree discovered downloadDir". |
| F2 | minor (security-relevant regression vs master) | `firstDefined` treats `null` as a value. `createSutradharServer({allowedDomains:null})` with `SUTRADHAR_ALLOWED_DOMAINS=e.test` is UNRESTRICTED on HEAD but `["e.test"]` on master `fdae749` (`ab-null-allowedDomains.txt`). The SDK `launch({allowedDomains:null, discoverConfig:true})` and `dialogPolicy:null` likewise drop the config layer. Typed callers cannot pass `null`, but JS and JSON-fed callers can. | `SUTRADHAR_ALLOWED_DOMAINS=e.test node -e "createSutradharServer({allowedDomains:null}) -> runtime.allowedDomains"` -> `undefined` | Treat `null` as absent in `firstDefined` (`value == null`), and add precedence tests for `null` on every key. |
| F3 | minor | Home boundary bypass. If the cwd is a junction/symlink INSIDE HOME that points outside it, `inHome` is computed from the canonical cwd (false), so the literal walk passes HOME and reads `.sutradhar.json` ABOVE home. Spec D3 and the docs say "nothing above home is ever read". Exploitation needs write access above home (`C:\Users` is admin-only here; `/home` is root-owned, and root-owned files pass the POSIX check), so the impact is low. | `HOME=<S>/top/home`, `<S>/top/.sutradhar.json`, cwd `<S>/top/home/link` (junction -> elsewhere): `sutradhar doctor` -> `Config: <S>\top\.sutradhar.json (discovered)` (`F3-home-junction-evidence.txt`) | Treat the walk as in-home when EITHER the literal or the canonical cwd is under home; stop at home by literal OR canonical equality; add a unit test. |
| F4 | minor (docs vs behaviour) | "Error messages never repeat values from your file (only key names)" (docs/project-config.md; changelog fragment "Messages never repeat values from the file") is false. These are echoed: `allowedDomains[i]` values and `idleTimeoutMs` strings (up to 64 chars, e.g. `sk_live_SUPERSECRET_...`), and `downloadDir`/root entries plus their resolved path (unbounded). Unknown key NAMES are echoed unbounded (a 20,000-char key gives a 20,220-char warning on every CLI command). Invalid JSON is correctly redacted. | `{"allowedDomains":["sk_live_SUPERSECRET_0123456789abcdef"]}` -> `allowedDomains[0] "sk_live_SUPERSECRET_0123456789abcdef" is not a bare domain` (`loader-probes.json` `KEY.secretVal`, `KEY.unknownLong`) | Either redact the values (show the key, type and length) and cap key-name echo (for example at 64 chars), or correct the docs and changelog to say what is echoed. |
| F5 | minor (docs) | SECURITY.md (and GAP-341) cite "the runtime re-checks every download itself" as mitigation for a link swapped in after load. A function-level check shows `findContainingRoot` canonicalises the ROOT too, so a root dir replaced by a junction to outside still passes the runtime check. | `probes` inline (TOCTOU block): root `repo/cdl` passes, then is swapped for a junction to `outside` -> `afterSwap_runtimeRecheckAllows:true` | Correct SECURITY.md/GAP-341 (the runtime check does not cover root swaps), or re-check root containment against the config dir at download time. |
| F6 | minor (docs, behaviour change) | An empty `--allowlist-domains` is now an error (a breaking change for scripts that pass an empty variable). Only the changelog says so: `--help` and the CLI README are silent, and docs/project-config.md says "An empty array counts as 'not set' at the flag/option/env layers", which contradicts the CLI flag. | `sutradhar nav x --allowlist-domains ""` -> `Error: --allowlist-domains needs at least one domain` | Align `--help`, the CLI README and project-config.md. |
| F7 | minor (test gap) | Mutants A8 and A8b (the home-boundary equality made literal or case-sensitive) SURVIVE every unit suite: capability-runtime 356, cli, mcp-server and sutradhar all pass. Only my probe `SRCH.home.caseVariantHome` catches them. | `probes/mutants.mjs <scr> A8b` -> `unit: all pass`; loader diff `SRCH.home.caseVariantHome` | Add a discovery unit test with a case-variant / trailing-separator `homedir`, and with a junction cwd (F3). |
| F8 | minor | The file viewport has no upper bound. `{"viewport":{"width":1e9,"height":1e9}}` validates. Every CLI command then spawns Chrome, fails `Emulation.setDeviceMetricsOverride` (CDP max 10,000,000), exits 1 and LEAKS that Chrome: it is not in state, so `close` reports "No active session". The flag `--viewport 1000000000x1000000000` leaks identically on master, so the leak is old, but a repo-controlled file makes it persistent and silent. | `{"viewport":{"width":1000000000,"height":1000000000}}`; `sutradhar nav about:blank` -> `Fatal: Protocol error ... not greater than 10000000`, chrome.exe left running (`F9-viewport-huge.txt`, `pids-killed.txt`) | Cap width/height at 10,000,000 in the schema and the hand validator; ideally also kill the spawned Chrome when post-spawn setup fails. |
| F9 | info | `allowedDomains` accepts single labels (`"1"`, `"com"`). With the runtime suffix match, `"1"` allows every host ending in `.1`. This only narrows and is the pre-existing C12 matcher. The SDK does not announce a discovered `dialog.mode "accept"` (D12c names only the CLI and MCP; the SDK is opt-in). | `{"allowedDomains":["1"]}` loads OK | Optional: reject numeric-only labels that are not full IPv4 addresses. |

## Rulings on GAP-339 to GAP-342

- **GAP-339 (a discovered file may set `dialog accept` and `idleTimeoutMs: 0`): acceptable as documented behaviour.** The spec
  decided it (D12c), and the announcement is real and continuous. Every CLI command where a discovered `accept` is in effect prints
  `Note: using ... dialog.mode "accept" from project config <file>` (32/32 notice rows over all 16 layer subsets x 2 builds). MCP
  prints the accept warning at startup (8/8 banner rows). A `--dialog` flag, including a sticky `--dialog report`, beats it
  (live `[flag*]`/`[state*]` rows). `SUTRADHAR_IDLE_TIMEOUT_MS` beats `idleTimeoutMs: 0` (live MCP `[env+config].idle`: not reaped
  with env `0`; `[config].idle` reaped). Neither widens the filesystem or navigation sandbox, so this is not a done-when or security
  violation. Residual: the SDK does not announce a discovered `accept` (F9), which is acceptable because discovery is opt-in there.
- **GAP-340 (the between-command warden ignores a config dialog policy): acceptable.** The effect is narrower (a dialog stays open
  until the next command's gate applies the policy) and it is documented.
- **GAP-341 (point-in-time containment): acceptable as a gap, but its stated mitigation is wrong (F5).** Every CLI command reloads and
  re-checks, so the window is one command. An MCP server keeps it for its lifetime. Exploiting it needs local write access to the
  tree at runtime.
- **GAP-342 (an invalid file blocks a command whose flag would override that key): acceptable for genuinely malformed values.** It
  fails closed (a skipped bad `allowedDomains` could widen access), `SUTRADHAR_CONFIG=none` works, and `doctor`, `close` and
  `profile` are never blocked (live `verbs.*`). **Not acceptable as written for the containment refusal (F1):** there the message
  itself promises that the env var overrides the file, and it does not.

## My mutants (14, all new; none duplicates the builder's U1-U22 / L-*)

Runner `probes/mutants.mjs`. For each mutant it does an exact-once replacement, then a turbo build of the affected packages, then
vitest for every dependent package, then my own `precedence-fn.mjs` and `loader-probes.mjs`. After that it restores the file
(sha256 checked) and rebuilds. Logs: `mutants-run1..5.log`, `mutants-loader-diffs.json`.

| id | mutant | unit tests | my probes | caught |
|---|---|---|---|---|
| A1 | MCP only: config allowedDomains outranks env (one layer pair reversed on one surface) | mcp-server FAIL(1) | `MCP.allowedDomains[env+config]` | yes |
| A2 | CLI only: sticky state dialog outranks an accept/dismiss flag | cli FAIL(4) | `CLI.dialog[flag+state]`, `[flag+state+config]` | yes |
| A3 | `.git` exclusion computed on the literal path (canonicalisation skipped) | capability-runtime FAIL(1) | `DL.gitAds`, `DL.gitAds2`, `DL.junctionToGit` (+2) | yes |
| A4 | `.git` exclusion dropped entirely | capability-runtime FAIL(3) | 16 loader cases | yes |
| A5 / A5b | a discovered file trusted like an explicit one (A5b is the type-valid spelling) | capability-runtime FAIL(12), sutradhar FAIL(1) | 96 loader cases | yes |
| A6 | an explicit falsy value (0) falls through instead of winning | capability-runtime FAIL(2), mcp-server FAIL(2) | `MCP.odd.option0`, `MCP.odd.env0` | yes |
| A7 | CLI fail-open: `--allowlist-domains ""` / `" , "` means unrestricted again | cli FAIL(1) | (live-only shape; unit catches) | yes |
| A8 / A8b | home boundary compared literally (no canonical / case-fold equality) | **all pass (SURVIVED)** | `SRCH.home.caseVariantHome` | only by my probe (F7) |
| A9 | MCP: server default viewport outranks the `browser.launch` argument | mcp-server FAIL(1) | `MCP.viewport[call+*]` x3 | yes |
| A10 | duplicate keys detected only at the top level | capability-runtime FAIL(1) | `KEY.dupNested` | yes |
| A11 | SDK: config `report` not mapped to `auto` | capability-runtime FAIL(1), sutradhar FAIL(1) | - | yes |
| A12 | nested unknown keys (`dialog.*`) dropped without a warning | capability-runtime FAIL(1) | `KEY.dlgExtra` | yes |

All 14 are caught by unit tests or my probes. The unit suites alone miss 2 of the 14 (A8, A8b). Every touched file passed
`sha256sum -c mutant-files-sha-before.txt`, and `git status --short` shows only `audit-1/` untracked. After the mutants I did a forced
full rebuild (`build-2-after-mutants.log`: 0 cached) and re-ran my probes: the loader diff against the pre-mutant baseline is `[]`.

## Precedence matrix result (my generator and oracle; values distinct per layer)

| Surface | Layers x keys | Function level | Live (independent observer) |
|---|---|---|---|
| CLI (package `dist/cli.js`) | {flag, env, state, config} subsets x allowedDomains, viewport, dialog, download roots, upload roots, trust notice | `resolveCliSettings`: 32 subset rows + 9 odd rows, 41/41 | 16 subsets x 6 checks = 96/96 (server Host log; page `innerWidth` beacon; page `prompt()` result; file on disk + sha256; page `change` beacon; stderr `Note:`) |
| CLI (bundle `cli-bin.js`) | same | n/a (the bundle runs `main()` on import) | 96/96 |
| MCP (package `dist/cli.js`) | {env, config} subsets x domains, download, upload, dialog, idle, viewport; call-arg > config | `createSutradharServer` with the real runtime: option/env/config subsets 36/36, viewport through the registered handler 8/8, odd 10/13 (**3 null rows fail = F2**) | 4 subsets x 8 checks = 32/32 (idle observed through the chrome.exe process list with no tool calls) |
| MCP (bundle `mcp-cli.js`) | same | n/a | 32/32 |
| SDK (bundle `index.js`) | {option, config} subsets x all keys; opt-in; explicit; both; env-ignored; report-option | n/a | 33/33 (default dialog A/B identical to master: `ab-sdk-auto-dialog.txt`) |

Odd-value semantics, all confirmed:
- An explicit `0` wins: option `0` / env `"0"` disables the reaper over config `6000`.
- Env `""` and `" , "` fall through. The CLI flag `""` is an error (F6). Option `[]` falls through (D13c).
- `null` wins and fails OPEN (F2).
- A repeated flag takes the first occurrence (pre-existing `indexOf` parsing; `--viewport 401x301 --viewport 999x999` gives 401x301).
- A lower-case env name is honoured on Windows (OS env is case-insensitive).
- `viewport` and `dialog` are whole-value: `--dialog accept` does not inherit the config's `promptText`.
- Config-relative paths resolve against the file's directory, not the cwd (live `cwdRel` probe never exists).

Harness corrections made during the audit, each re-run before counting:
1. A synchronous spawn blocked my in-process observer server, so the first CLI attempt timed out. I switched to an async spawn.
2. My trust-notice matcher took FR2-04's `Note: dialog policy ...` line. I fixed the matcher, and 48/48 passed on re-run.
3. MCP `upload_file` reports a refusal as `success:false` inside a non-error result (pre-existing convention). I now judge by `success`.
4. MCP/SDK uploads within 1000 ms trip the pre-existing double-dispatch guard. I spaced them 1.3 s apart.
5. With `idleTimeoutMs: 4000` the reaper (correctly) closed the session during my own 4.5 s waits. I used 15000 ms in the matrix.
6. With the SDK default `auto`, a pending prompt makes the next `#dl` lookup fail. This is identical on master, so default/explicit modes skip the click.

## Master comparison (HEAD a1ff2ca vs master fdae749 at `E:\AI-Cache\tmp\fr211-master`)

Before using the master tree I checked it: 488 tracked ts/mjs/json files compared after CR normalisation, 485 identical. The 3 that
differ are test files. Its bundle has 0 occurrences of `SUTRADHAR_CONFIG`.

| Suite | HEAD | Master / A-B | Attribution |
|---|---|---|---|
| verify-fr2-08-conditions (full) | **478/478** (`reg-fr2-08-head-1.log`) | C-L5 only, each tree's own script, interleaved x3: HEAD 11/11, 11/11, 11/11 (43.06-43.32 s); master 11/11 x3 (43.00-43.44 s) (`gap345-cl5-ab.txt`) | No regression |
| verify-fr2-07-verification | **488/488** (bundle:H2 did not flake) | - | No regression |
| verify-fr2-04 dialogs | **111 pass, 0 fail, 2 skip** (L13 passed) | - | No regression |
| CLI scenario suite | UC-05, 06, 08, 09, 12 fail | Master full run: UC-05, 06, 09, 12 fail. Interleaved UC-08/09 x3: HEAD UC-08 0/3 vs master 1/3; UC-09 0/3 vs 1/3. Direct `nav https://the-internet.herokuapp.com/download --headed` x4: HEAD 1/4, master 0/4, HEAD+`SUTRADHAR_CONFIG=none` 0/4 (`ab-nav-download-page.txt`) | External site flakiness, identical on master; not FR2-14 |

Tracked `tools/scenario-suite/results/baseline-cli.json` was redirected (`SCENARIO_OUTPUT_PATH`) and is unchanged (`sha256sum -c`
OK). The fr2-07/08/04 evidence dirs were redirected to scratch, so no tracked evidence was overwritten.

## GAP-345 attribution

Config discovery costs, per cold process (`perf-config.json`, n=15, monotonic `performance.now()` inside the child):
- 6.2 ms median with no config and no boundary, up to the drive root;
- 3.35 ms in a repo with no file;
- 5.63 ms with a file without download keys;
- **58 ms** with download roots in the file. That is two `fsutil` spawns from `isRootCaseSensitive` inside `findContainingRoot`, paid
  on every CLI command in such a project.

The FR2-08 CLI cases run with `cwd = repoRoot` (`.git` file boundary, no file), so they pay about 3 ms. That is four orders of
magnitude below the 15 s / 30 s timeouts. C-L5 passed 33/33 on HEAD here, with wall time identical to master. **Verdict: not
attributable to FR2-14.** It is consistent with the GAP-316/321/338 shared-machine family.

## Builder evidence: read AFTER forming the verdicts above, under-reporting flagged

- `deviations.md` item 4 says values are echoed "only for key-scoped scalars (never promptText, never unknown keys)". In fact free
  text in `allowedDomains[i]` and `downloadDir` entries is echoed, and unknown key NAMES are echoed unbounded (F4). The docs go
  further ("never repeat values"), and that is false.
- `false-pass-analysis.md` AC8 (secrets) covered only unknown-key values and `promptText`, never a secret inside a known key's
  value. AC12 (docs) did not catch F1, F4, F5 or F6.
- GAP-341's mitigation text ("the runtime re-checks every download itself") is not true for a swapped root (F5).
- GAP-342 does not mention that the containment message advertises an env override that does not work (F1).
- Not reported anywhere: F2 (the `null` regression), F3 (home-boundary bypass through a junction), F7 (the unit suite misses the
  home-equality mutants), F8 (repo-controlled viewport leaks Chrome).
- The builder's own 25/25 mutants are credible, but its home-boundary mutant U12 ("ignored") is coarser than A8b, which survives
  every unit test.

## False-pass analysis (mine)

| Check | How it could pass while broken | How it was ruled out |
|---|---|---|
| Precedence matrix | The oracle copies the resolver; or equal values per layer | My oracle is written from the spec table, and every layer carries a distinct value (`f.test`/`e.test`/`c.test`, 401/402/403/404/405 px). Mutants A1, A2, A6 and A9 each turn exactly the expected rows red. |
| Live layer winner | Reading the tool's own report | Observers are the server Host log (blocked navigations never reach it), the page's own beacons, files on disk with sha256 against the served bytes, and chrome.exe process lists. |
| Done-when | The file sat in the cwd itself | The file exists only in `<S>/proj`, the cwd is `<S>/proj/a/b`, and the `cwdRel` probe proves nothing resolved against the cwd. |
| Bundle surface | Stale bundle | All dist dirs were deleted, then a forced build with 0 cached tasks, the strings grepped in all 3 bundles, and live runs against `cli-bin.js`/`mcp-cli.js`/`index.js`. |
| Fail-closed | Refused, but Chrome already started | Per-case TEMP marker, then chrome.exe count, `sutradhar-cli-*` dirs and state.json checks after each refusal. |
| Idle reaping | A harness call keeps the session alive or kills it | No tool calls during the window. The first version of the harness was itself reaped by the 4 s config; I fixed that and re-ran. |
| Mutant catch | Mutant breaks the build, or the dist is stale | Rebuild per mutant, rebuild after restore, sha256 restore check. A5 and A8 also got type-valid twins (A5b, A8b). |
| Regressions | Ran against the master dist after an A/B | The master A/B used the separate `fr211-master` tree; the worktree dist was rebuilt with force after the mutants and never switched. |

## Not verified

- POSIX ownership/mode refusal (D12d). This host is Windows.
- POSIX symlink behaviour, macOS case-insensitive `.git`, and HFS+ ignorable-codepoint `.git` spellings.
- Windows ACLs of intermediate directories (GAP-077).
- Live Chrome downloads into hostile paths. These were not attempted (safety rule); function-level only.
- Per-mutant live runs. Mutants were judged by unit tests plus my function-level probes on the rebuilt dist.
- A UNC cwd for a live CLI process (function level only: `SRCH.uncChild`, `SRCH.uncShareRoot`).

## Process and cleanup

- No product source was left modified (`git status --short`: only `audit-1/` untracked). No commit, push or publish.
- The final forced full rebuild of dist is in `build-2-after-mutants.log`.
- PIDs I killed, all Chrome trees whose command line held MY scratch path: 46180, 49952, 90668, 91268 (`pids-killed.txt`).
- Nothing was killed by image name.
- `E:\AI-Cache\tmp\sutradhar-cli-*` is unchanged before and after (only `sutradhar-cli-1790798002107`, never touched), because
  every run of mine set TEMP into my own scratch dirs.
- I deleted these scratch dirs by exact name: `lp2 pf1 live1..live10 dbg1 dbgup esc1 envcase toctou perf1 mut mut2..mut6 lp-final
  pf-final reg abdlg homejn vphuge vpflag-head vpflag-master`. They hold every `sutradhar-cli-*` profile my runs created. Other
  files in the shared scratchpad belong to earlier sessions and were left alone.
- Repo deletion audit: product code deletes only its own state/warden files, its own profile dirs (`ProfileManager`) and the bundle
  `dist`. The FR2-14 harness removes only its own mkdtemp root and its own evidence dirs. Nothing globs `sutradhar-cli-*` for
  deletion.
- Disk on E: was 9.8G free at the start and 20G free at the end; another session freed space in the meantime.

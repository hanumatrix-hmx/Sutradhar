# S6 evidence - I-051 no-session reads fail with a hint (commit `I-051: CLI read verbs fail with a hint when no session is active`)

Run 2026-10-04 on `release/0.6.2` (parent ca794a9). Change: `withSessionFlow` (`packages/cli/src/session-flow.ts`) gains `mayLaunch` and `noSession`; the **first statement inside `if (!state) {`** is
`if (!deps.mayLaunch) throw deps.noSession();`, so nothing is spawned, attached, persisted or run. `isLaunchCapable(verb, args)` (pure): only `nav <url>`, `newtab <url>`, `audit <url>`,
`compare <a> <b>` (non-empty args) launch. `NoSessionError` (`name === 'NoSessionError'`); `main().catch` matches it by name and prints exactly
`Error: no active browser session — "<verb>" needs an open page and does not start one. Start a session with: sutradhar nav <url>` (em dash U+2014), exit 1, stdout empty.
Help: `nav` entry names the four launching forms; `grant` entry and usage line say it needs an active session (run nav first). With state present the flow is untouched.

## AC table

| AC | result | evidence |
|---|---|---|
| S6-1 dependents inventory | PASS | `autolaunch-dependents.md` (+ `dep-grep1.txt`, `dep-grep-docs.txt`, scripts `seq.mjs`/`seq2.mjs`): no tracked non-frozen driver or doc example runs a non-launch verb first on a fresh state; frozen WebBench files recorded as historical (`drive.mjs:157` `eval AUTO`), not edited; `verify-fr2-14-config.mjs:330` region read (all sub-cases start with `nav`); `.github/workflows/scenario-suite.yml:78` runs `run-cli.mjs`, every flow starts `closeSession(); nav` |
| S6-2 unit | PASS | `session-flow.spec.ts` N1 (no state + `mayLaunch:false` rejects with `NoSessionError`; `spawnFresh`/`afterAttach`/`gate`/`reattach`/`selfHeal`/`fn` call counts 0), N2 (`mayLaunch:true` keeps the W5 order), N3/N4 (state present + `mayLaunch:false`: unchanged reattach path and unchanged self-heal), N5 (exact message with the em dash); `isLaunchCapable` table (3 tests: launching forms; the same verbs without their url; every other verb incl. back/forward/reload with and without args); `help-text.spec.ts` (2 tests). Before the change: 7 of the 10 new tests FAIL (`new-tests-before-change.log`; N2/N3/N4 describe unchanged behaviour and pass both before and after by design); after: 29/29 in the two files (`new-tests-after-change.log`) |
| S6-3 every non-launch verb live | PASS | `live-nosession-head.json` / `.stderr.log`, 34 checks (34 PASS, 0 FAIL), `LIVE-NOSESSION OK`. 16 sub-cases (`text`, `snap`, `axsnap`, `click 1`, `type 1 x`, `press 1 Enter`, `screenshot`, `eval 1`, `tabs`, `waitfor 1000 --text x`, `scroll`, `grant <origin> clipboard-read`, `getclipboard`, `newtab`, `audit`, `snap --json`), each with its OWN fresh state dir (asserted absent before): exit 1, the only non-`[iso-guard]` stderr line is byte-for-byte the hint line for that verb, no `Fatal:`, stdout empty, no `state.json`/`warden.json` in the state dir; afterwards no `sutradhar-cli-*` under ISO and the CIM attribution query for the ISO basename returned 0 Chrome. Smoke: `nav`, `close`, `text` -> exit 1 with the hint and nothing launched. State present: `text` right after `nav` still works (exit 0, 300 chars). |
| S6-4 launch-capable verbs launch | PASS | `nav <url>` (exit 0, state.json appears, `userDataDir` 199 chars, dirname == ISO), `newtab <url>` (exit 0; `tabs` lists the page URL), `audit <url>` (exit 0), `compare <a> <b>` (exit 0, diff written), each followed by `close` (state.json gone) |
| S6-5 NEG061 auto-launches | PASS | `live-nosession-neg061.json` (published 0.6.1, cli-bin sha256 `9858726a...`): `text` from no state exits 0 and a `state.json` appears (a blank browser was launched); `snap` likewise (`URL: chrome://new-tab-page/`); both closed. The harness can therefore see an auto-launch. |
| S6-6 counts / typecheck / mode | PASS | cli 396 -> 406 + 2 skipped (+10; `test-cli.log`), other packages untouched; spec typecheck 7 errors == baseline in the same 3 files (`spec-tsc.txt`; the 4 `session-flow.spec.ts` errors are the pre-existing `Promise<number>` ones, line numbers shifted by the new header); `tsc --noEmit` cli exit 0, eslint `cli.ts` + `session-flow.ts` exit 0; `git ls-files -s packages/cli/src/cli.ts` = 100644 before and after |

Build: forced, 9/9 executed, 0 cached (`build.log`, `build-times.txt` rc=0); `cli-bin.js` bd779d37 -> 3c5527e6 (changed; `index.js` and `mcp-cli.js` unchanged, as expected: the CLI sources are not in those bundles); `grep -c NoSessionError dist/cli-bin.js` = 4. Harness prints `cliSha256` = the freshly built file.
Isolation: `[iso-guard]` in every log, no `ISOLATION GUARD`, path-log check exit 0 (head 40 / NEG061 20 `[cleanup]` lines, none outside ISO), real-TEMP `sutradhar-cli-*` 4 before / 4 after (none vanished), no Chrome with the ISO basename left after any run, no mutant file left in `dist`, real `cli-bin.js` sha256 unchanged by the mutant runs, ISO dirs (`S6t`, `N6t`, `S6-tmp`) deleted with the guarded form.

## Mutants
Unit (`mutants-unit.txt`, `mut-spec.json`, runner `../tools/mutrun.mjs`; copy-restore, exactly 1 replacement, sha256 restored equal): 13 mutants, 13 killed, 0 survivors.
| mutant | killed by |
|---|---|
| M-051a-unit guard never fires (`mayLaunch` ignored) | N1 |
| M-051b guard placed after `spawnFresh` | N1 (call counts) |
| M-051c guard placed after `afterAttach` | N1 (call counts) |
| M-051d `newtab` without a url launch-capable; M-051d2 `audit` without a url; M-051d3 `compare` with one url; M-051d4 empty-string url counts; M-051d5 `snap` launch-capable; M-051d6 `nav` never launch-capable | `isLaunchCapable` table tests |
| M-051f message loses the verb; M-051g hyphen instead of em dash; M-051h wrong `name` | N5 / N1 |
| M-051i guard also fires when state is present | W2-W5 + N3/N4 (6 failures) |
| M-051j `grant` help line loses the "needs an active session" statement | `help-text.spec.ts` |
Live, same-build bundle mutants (`mutants-live.txt`; sibling `dist/cli-bin.mutant.js`, exactly 1 replacement, deleted afterwards; launched sessions closed with the real build):
- **M-051e** (`main().catch` does not special-case `NoSessionError`): harness FAILS 17 checks; stderr is `Fatal: no active browser session ...` (the exact-line assertion kills it).
- **M-051a-live** (`mayLaunch: true` in the CLI wiring): harness FAILS 21 checks; the read verbs exit 0 and launch a browser (state.json appears).

## False-pass analysis
- S6-3 failure "for another reason": the exact hint text per verb is asserted byte-for-byte (em dash included), with no `Fatal:` and empty stdout; the M-051e mutant (right exit code, wrong prefix) fails it.
- S6-3 "nothing launched" could be vacuous if Chrome was started elsewhere: the check reads the sub-case's own state dir (fresh, asserted absent beforehand) for `state.json`/`warden.json`, counts `sutradhar-cli-*` under ISO, and runs the CIM attribution query for the ISO basename (a profile dir lives under ISO, so its Chrome command line contains it); M-051a-live launches browsers and fails exactly these checks.
- Harness blind to auto-launch: NEG061 (published 0.6.1) from no state exits 0 and writes `state.json`, so the same observations do detect a launch.
- Stale build: forced 9/9 uncached build, `cli-bin.js` hash changed, `grep -c NoSessionError` = 4, and the printed `cliSha256` equals the file on disk.
- S6-4 could pass because a previous session existed: each sub-case has its own fresh state dir, asserted absent; `nav` is followed by `close` and `state.json` is verified gone.
- State-present path unchanged: N3/N4 (reattach and self-heal with `mayLaunch:false`), M-051i, and live `nav` then `text` (exit 0) in the same state dir.
- Wiring in `cli.ts` (`isLaunchCapable(verb, cleanArgs)`) is not unit-reachable (cli.ts runs `main()` at import); it is covered by the live harness and by M-051a-live.

## Deviations
1. `SessionFlowDeps` fields are REQUIRED (plan 2.4: `mayLaunch: boolean`, `noSession: () => Error`), so the five pre-existing deps literals in `session-flow.spec.ts` gained one spread line each (`...MAY_LAUNCH` for W1, `...STATE_PRESENT` with `mayLaunch:false` for W2-W5); no assertion of W1-W5 changed.
2. `isLaunchCapable` takes `cleanArgs` (flags removed); the `nav` entry in the help text was extended to state the rule. `grant`'s usage line (`printErrorAndExit` text) also names the requirement.
3. The two helper scripts `evidence/tools/vt.sh` and `iso.sh` committed in S5 were tracked as 100644; this commit marks them 100755 (`git update-index --chmod=+x`), per the shell-script mode rule.
4. `rg` is not on PATH; the bundled ripgrep binary (read-only) was used for the inventory.

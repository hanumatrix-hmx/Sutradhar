# S5 evidence - I-049 `#N` / `[#N]` accepted as node ids (commit `I-049: accept #N and [#N] snapshot ids wherever a target is accepted`)

Run 2026-10-04 on `release/0.6.2` (parent 4d94646). Change: `normalizeTarget` (`packages/capability-runtime/src/types.ts`) maps, after trim,
`^#(\d+)$` and `^\[#(\d+)\]$` to `[data-sd-node-id="<digits>"]` (digits verbatim). `selector-dialect.ts` untouched. One help sentence
(`packages/cli/src/cli.ts`) and one description sentence (`browser.snapshot` in `packages/mcp-server/src/tools.ts`) say the forms are accepted.

## AC table

| AC | result | evidence |
|---|---|---|
| S5-1 unit | PASS | `runtime.spec.ts` (+2 tests): `#5`, `[#5]`, ` #5 `, ` [#5] `, `5` -> `[data-sd-node-id="5"]`; `#05` -> `"05"`; `#5]`/`[#5` still `InvalidSelectorError` with the node-id hint; `#a5`, `#\\35`, `div#x` unchanged; `#5 > span` unchanged and never mapped. `selector-args.spec.ts`: `validateSelectorArgs(['#5'])`, `(['[#5]'])` null, `['#5]']` non-null; `validateFrameChain('#7::#8')`, `('[#7]::[#8]')` null. Before the change: 1 + 2 tests FAIL (`new-tests-before-change.log`); after: 162/162 and 6/6 (`new-tests-after-change.log`). One existing assertion changed: `runtime.spec.ts` "FR2-06 R1 ... InvalidSelectorError" list had `'#12'` as a must-throw input; it is now a valid node id by design (2.3), so it was removed from that list and its replacement is the new I-049 test (the `selector-dialect.spec.ts` `#12`/`[#12]` tests still pass: that module is unchanged and is simply not reached for these forms). |
| S5-2 live CLI / MCP / SDK / `--frame` | PASS | `live-nodeid-head.json` / `.stderr.log`, 30 PASS, 0 FAIL, `LIVE-NODEID OK`. CLI: `click "#1"` exit 0 and `window.__goClicks` 1, `click "[#1]"` -> 2, bare `1` -> 3 (control), `type "#2" hello` -> value `hello`, `type "[#2]" world` -> `world`, `eval document.title --frame "#3"` and `"[#3]"` -> `Frame Title` (== the bare-number result; top title is `Nodeid page`), `click "#4"` (button inside the iframe) -> frame counter 1; counters read through a separate `eval` call. MCP: `browser.click {target:"#1"}` -> counter 1, `"[#1]"` -> 2, `browser.eval frameSelector:"#3"` -> `Frame Title`. SDK: `page.click("#1")` -> 1, `"[#1]"` -> 2, `page.evaluate(expr, "#3")` -> `Frame Title`. Negative on all three surfaces: `#1]` rejected (CLI exit 1, MCP `isError`, SDK rejection) with the node-id hint and the counter unchanged; CLI `[#1` also rejected. The ids come from the real `snap` listing, including the iframe's own id: an `<iframe>` is not an interactive element, so the harness gives it `tabindex=0` through `eval` and the snapshot then lists it as `[#3] iframe role=clickable` (no manual stamping of `data-sd-node-id`). |
| S5-3 NEG061 rejects | PASS | `live-nodeid-neg061.json` (published 0.6.1; cli-bin sha256 `9858726a...`): `click "#1"` exit 1 `Error: Invalid selector "#1" - this looks like a snapshot node id ...`, `"[#1]"` exit 1, `eval --frame "#3"` exit 1; MCP `isError` with the hint; SDK rejects; counter stays 0; control: the bare number works on NEG061 (counter 1), so the counter is live. |
| S5-4 counts / typecheck | PASS | capability-runtime 555 -> 557 (+2), cli 395 -> 396 + 2 skipped (+1), mcp-server 167, browser 951, sutradhar 70 (unchanged) - `test-*.log`; spec typecheck: 7 errors == baseline, same 7 files (`spec-tsc.txt`), no error in new test code; `tsc --noEmit` capability-runtime and mcp-server exit 0 (`typecheck-*.txt`); eslint on the 3 changed src files exit 0 (`lint.txt`); `git ls-files -s packages/cli/src/cli.ts` = 100644 before and after. |

Build: forced, 9/9 executed, 0 cached (`build.log`, `build-times.txt` rc=0); `dist-before.sha256` -> `dist-after.sha256` differ for all three bundles (cli-bin 1fb886d1 -> bd779d37, index e47a4f9d -> 0ca9bab4, mcp-cli b70ea572 -> 6fb55653); `grep -c bracketed` 5 / 3 / 10 in cli-bin / index / mcp-cli; no `*.mutant.js` in dist. Harness prints the sha256 of the files it runs: `cliSha256` bd779d37... equals `dist-after.sha256`.
Isolation: `[iso-guard]` lines present, no `ISOLATION GUARD`, path-log check exit 0 on both runs (10 `[cleanup]` lines, 0 outside ISO), `userDataDir` 199 chars with dirname == ISO, real-TEMP `sutradhar-cli-*` 4 before / 4 after, none vanished, no Chrome with the ISO basename afterwards, ISO dirs `S5t`/`N5t`/`S5-tmp` deleted with the guarded form.

## Mutants (`mutants-unit.txt`, `mut-spec.json`, runner `../tools/mutrun.mjs`; copy-restore of `types.ts`, CRLF aware, exactly 1 replacement, restored sha256 equal)
| mutant | outcome | killing test |
|---|---|---|
| M-049a unanchored regexes | KILLED | `half-bracketed forms keep the node-id-syntax hint` (runtime.spec) + `"#5" and "[#5]" are accepted node ids` (selector-args.spec) |
| M-049b `#N` only | KILLED | `"#N" and "[#N]" map` + `"[#5]" accepted` + `validateFrameChain` |
| M-049b2 `[#N]` only | KILLED | same |
| M-049c `Number()` normalisation (`#05` -> 5) | KILLED | `"#N" and "[#N]" map ...` (`#05` -> `"05"`) |
| M-049d untrimmed match | KILLED | `" #5 "` row |
Survivors 0. (The live harness is the end-to-end check; the mutants are unit-level, as the plan lists them.)

## False-pass analysis
- S5-1: a unit test on `normalizeTarget` alone could pass while a surface never calls it. Ruled out by S5-2: the same forms are exercised through the real CLI, MCP stdio server and SDK against Chrome, with an independent counter read through a separate call (`window.__goClicks`), not the action's own success report.
- S5-2: success could come from a stale bundle. `cliSha256`/`bundleSha256`/`mcpSha256` printed by the harness equal the freshly built files, the forced build executed 9/9 with 0 cached and the hashes changed, and NEG061 (a different bundle) rejects the very same inputs. A click could "succeed" on the wrong element: the counter belongs to the intended `#go` button (and the frame counter to the in-frame button), and the control with the bare number moves the same counter. `--frame` could pass vacuously if both frames were the top document: the titles differ (`Frame Title` vs `Nodeid page`) and equal the bare-number result. Duplicate-click guard (runtime rejects the same target within 1000 ms) would hide a failure as an error; the harness sleeps 1.2 s between same-target MCP/SDK clicks, and the CLI calls are separate processes.
- S5-3: NEG061 could fail for an unrelated reason: the stderr/`isError` text carries the node-id hint (the exact rejection of `#N`), and the bare-number control on the same NEG061 session succeeds and moves the counter.
- Negative cases (`#1]`, `[#1`) are expected to FAIL and do (exit 1 / isError / rejection, counter unchanged); mutant M-049a, which wrongly accepts them, is killed.
- Not covered live: a frame chain with several `#N` hops (`#7::#8`); that is covered by the `validateFrameChain` unit test and the single live hop (every hop goes through the same `normalizeTarget`).

## Deviations
1. The `'#12'` element of the existing must-throw list in `runtime.spec.ts` was removed (consequence of 2.3; see S5-1).
2. Evidence tooling shared with S6/S7 is stored under `../tools/` (`mutrun.mjs`, `rep.mjs`, `vt.sh`, `iso.sh`).

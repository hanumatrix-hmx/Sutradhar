# FR2-17 run-1: claims verified against code

Worktree: `E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041`,
branch `claude/field-report-2-loop`, HEAD `a19b3c0` (confirmed with `git rev-parse --show-toplevel` and
`git branch --show-current` first). `packages/{browser,capability-runtime,mcp-server,cli}/dist` were
rebuilt from HEAD (`build.txt`, all exit 0) before any probe, so probes run against current source.
Raw outputs live next to this file (`probe-*.out`, `cli-help.txt`, `proofs-misc.out`,
`verify-misc.out`). "Gap" ids are rows in `.ai/loop/field-report-2/gaps.md`; a gap is only cited as a
limitation when the code/decision log shows it is still open, never from the changelog fragment alone.

Legend for the proof column: `P-TOOLS` = `node probe-tools.mjs <root>` (real `registerTools` against a
recording mock server), `P-SEL` = `probe-selectors.mjs`, `P-FS` = `probe-fsroots.mjs`, `P-SDK` =
`probe-sdk-selector.mjs`, `HELP` = `node packages/cli/dist/cli.js` (no args) saved in `cli-help.txt`,
`MISC` = `proofs-misc.out`.

| # | File | Claim | Proof command | Output excerpt |
|---|---|---|---|---|
| 1 | docs/22-changelog.md, packages/mcp-server/README.md, AGENT_SETUP.md, README.md | 72 MCP tools = 71 `browser.*` + `agent.runGoal` (README said 69) | P-TOOLS: `node probe-tools.mjs "$(pwd)"` | `{"total":72,"browser":71,"agent":1}` |
| 2 | docs/22-changelog.md | Branch adds exactly one tool, `browser.audit`; master had 71 total (70 + agent) | `git show master:packages/mcp-server/src/tools.ts \| grep -c "server.registerTool("` vs branch; diff of name lists | `71` / `72`; `> 'browser.audit'` is the only added line |
| 3 | docs/22-changelog.md, mcp README, AGENT_SETUP.md | `sessionId` optional on 70 tools, none requires it | P-TOOLS | `tools with a sessionId field: 70` / `tools where sessionId is REQUIRED: []` |
| 4 | mcp README | An omitted id produces a `sessionId omitted: used "<id>", ...` note | `grep -n "sessionId omitted" packages/mcp-server/src/session-resolution.ts` | line 158: `` `sessionId omitted: used "${r.sessionId}", the only live browser session.` `` |
| 5 | mcp README, changelog | `launch`/`attach`/`agent.runGoal` keep "id to create" meaning | P-TOOLS description of `browser.launch` | "The sessionId parameter HERE is different: it is the id to create ... Omitting it always launches a new session." |
| 6 | AGENT_SETUP.md | `get_viewport` exists and was missing from the tool table | P-TOOLS names list; loop `grep` of each name in AGENT_SETUP.md | names include `browser.get_viewport`; only `get_viewport` was reported missing before the edit |
| 7 | README.md | Engine has 18 action types, not 19 (also 18 on master) | MISC `ActionType count` | `18` (branch) / `18` (master) |
| 8 | cli README, changelog | `SUTRADHAR_CLI_DEADLINE_MS`, default 300000 ms; `wait` extends to max(base, 3*t+30s) | MISC `grep SUTRADHAR_CLI_DEADLINE_MS` | `DEFAULT_CLI_DEADLINE_MS = 300_000`; `return Math.max(base, 3 * t + 30_000)` |
| 9 | cli README | `tabs` works when a tab is blocked/crashed, lists browser target ids | HELP | line 75: `tabs  List open tabs ... Still works when a tab is blocked by a dialog or has crashed` |
| 10 | cli README, changelog | `closetab` works on a blocked/crashed tab | HELP | line 79: `closetab <tabId> Close a specific tab (also works on a blocked or crashed tab)` |
| 11 | cli README, changelog, AGENT_SETUP | Exit code 3 = blocked/interrupted by an open dialog | HELP | line 163: `Exit codes: 0 ok, 1 failure, 3 blocked by or interrupted by an open dialog.` |
| 12 | cli README | `--viewport <WxH>` flag exists and persists (was missing from README flag table) | HELP | lines 123-125 |
| 13 | cli README | `--state visible\|attached\|hidden` flag for `wait`, default visible | HELP | line 136 `--state <S>  "wait" only: visible (default), attached ..., or hidden` |
| 14 | cli README | `--dialog accept\|dismiss\|report`, `--dialog-text` exist and persist | HELP | lines 154-161 |
| 15 | cli README | `audit [url] [outDir] [--json]`, `--baseline`, outDir created if missing | HELP + `grep -n "mkdir -p outDir" packages/capability-runtime/src/audit/audit-report.ts` | help line 84-96; `await mkdir(abs, { recursive: true })` |
| 16 | cli README, changelog | `--baseline` with no URL is a usage error | `grep -n "baselineFlagGivenButInvalid" packages/cli/src/parse-args.ts` | field defined at line 29, comment "the caller rejects it with a clear" usage error |
| 17 | cli README | Selector sentence (CSS, id, `pierce/ xpath/ aria/ text/`; Playwright syntax rejected) | HELP line 23-25 + P-SEL | `"text=Sign in" => REJECTED InvalidSelectorError`; `"xpath=//a" => REJECTED`; `"pierce/.x" => accepted`, `"xpath//a"`, `"aria/Submit"`, `"text/Sign in"`, `"#ok"`, `"12"` accepted (negative controls) |
| 18 | changelog, sdk README | SDK `click('text=...')` throws `InvalidSelectorError` | P-SDK | `click(text=...) threw: InvalidSelectorError` vs control `click(#ok) ... threw: BrowserNotAvailableError` |
| 19 | AGENT_SETUP, mcp README | CLI/`--help` selector rule covers legacy `xpath=`/`aria=`/`pierce=`/`text=` forms | P-SEL | `"xpath=//a" => REJECTED ... "xpath=" is not supported; use the slash form "xpath/"` |
| 20 | cli README, SECURITY.md, mcp README, changelog | Default download root is `<OS temp>/sutradhar-downloads` | P-FS | `defaultDownloadRoot() = E:\AI-Cache\tmp\sutradhar-downloads \| os.tmpdir() = E:\AI-Cache\tmp` |
| 21 | mcp README, cli README, SECURITY.md | Env var REPLACES the default; upload unset = unrestricted; set = restricted | P-FS | `unset env => download ["...\\sutradhar-downloads"] upload undefined`; `env set => download ["E:\\AI-Cache\\tmp"] upload ["C:\\Users\\Varad M"]` |
| 22 | mcp README, cli README, changelog | A relative root entry fails loudly, naming the variable | P-FS | `relative entry => throws: SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: entry "relative/dir" must be an absolute path (entries are separated by ";")` |
| 23 | SECURITY.md, cli/mcp/sdk READMEs, changelog | Overlapping `download_file` refused immediately; lock is a file in the process temp dir keyed by sha256 of the endpoint | MISC `grep download-lock.ts` | `path.join(os.tmpdir(), 'sutradhar-download-locks')`; `createHash('sha256').update(wsEndpoint)`; `class DownloadInProgressError`; `STALE_LOCK_MS = 5 * 60 * 1000` |
| 24 | SECURITY.md, packages/browser/README.md | Page-initiated downloads outside `download_file` are not covered by the roots (may land in Chrome's default location) | decisions.md 2026-09-29 Decision 1 + `browser-action-engine.ts` finally block sets `{behavior:'deny'}` on a never-detached session; CLI process exits and detaches (GAP-301 root cause 1) | Stated as "not governed by the roots and can land in Chrome's default download location", per the lead's brief and GAP-301; not re-run live in this item |
| 25 | SECURITY.md | Dialog warden listens on 127.0.0.1 (random port) with a random 32-byte bearer token; token/port stored in `warden.json` beside `state.json` | MISC `grep dialog-warden.ts`, `grep warden.json warden-control.ts` | `listen(0, '127.0.0.1'`; `crypto.randomBytes(32)`; `Bearer ${this.token}`; `warden.json` sidecar |
| 26 | SECURITY.md | Warden is not started by MCP server or SDK | `grep -rli warden packages/mcp-server/src packages/sutradhar/src packages/capability-runtime/src` | only `runtime.ts` (a comment at line 1999, no start code) |
| 27 | mcp README | Env vars `SUTRADHAR_ALLOWED_DOMAINS` (comma list), `SUTRADHAR_RESTRICT_NAVIGATION_TO_LOCAL=1`, `SUTRADHAR_IDLE_TIMEOUT_MS` (default 30 min) | `sed -n 18,60p packages/mcp-server/src/server.ts`; MISC `idle default` | `DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000`; `=== '1'`; `.split(',')` |
| 28 | mcp README | `@sutradhar/mcp-server` is not published separately | `grep -n '"private"' packages/mcp-server/package.json` | `"private": true` |
| 29 | mcp README, AGENT_SETUP | MCP keeps `auto` dialog policy (unhandled dialog auto-dismissed after 30 s) | P-TOOLS `browser.get_pending_dialog` description; `grep -n "auto-dismissed after 30s" packages/mcp-server/src/tools.ts` | line 1618 `it is auto-dismissed after 30s if never handled.`; `grep dialogPolicy packages/mcp-server/src packages/sutradhar/src` -> no hits (never set) |
| 30 | changelog, cli README | CLI default dialog policy is `report` | `grep -n "mode: 'report'" packages/cli/src/cli.ts packages/cli/src/dialog-cli.ts` | `dialog-cli.ts:43: return { policy: { mode: 'report' }, persist: 'keep' }` |
| 31 | changelog | `wait_for_selector` default is `visible`; `state` param on MCP | P-TOOLS `browser.wait_for_selector` params `sessionId,target,timeoutMs,tabId,state`; `grep "params.state ?? 'visible'"` | `const state: WaitForSelectorState = params.state ?? 'visible';` |
| 32 | changelog | CLI success line `<ref> is <state> (state=<state>)` | `sed -n 863p packages/cli/src/cli.ts` | `` `${ref} is ${state === 'hidden' ? 'hidden or absent' : state} (state=${state})` `` |
| 33 | mcp README, sdk README, cli README, AGENT_SETUP | Failed visible-wait ~3x timeoutMs (engine retries twice); `timeoutMs<=0` does not retry | `sed -n 365,382p packages/browser/src/actions/browser-action-engine.ts` | `params.maxRetries ?? (... timeoutMs <= 0 ? 0 : 2)` |
| 34 | mcp README, sdk README | CLI and SDK omit `otherVisibleMatches`/`matchedAtStart` (GAP-136) while MCP returns them | `grep -n otherVisibleMatches packages/cli/src/cli.ts packages/sutradhar/src/page.ts` / `... packages/mcp-server/src/tools.ts` | no hits in CLI/SDK; hit at `tools.ts:760` |
| 35 | mcp README, AGENT_SETUP, changelog | `browser.audit` params `url, baselineUrl, includeImages, tabId`; JSON first, images after; findings never error | P-TOOLS `browser.audit` | `params: sessionId,url,baselineUrl,includeImages,tabId`; description "Returns the JSON report first, then the screenshot PNG, then (with baselineUrl) a diff PNG; includeImages:false omits the images. Findings never make this call fail" |
| 36 | mcp README, changelog | Five heuristic a11y checks | P-TOOLS `browser.audit` description | `(img-alt, input-label, missing-title, missing-lang, button-name; not a WCAG audit)` |
| 37 | changelog, all READMEs | Only HTTP status >= 400 responses count as broken requests | MISC `n.status >= 400` | `runtime.ts:1816 .filter((n) => n.phase === 'response' && n.status !== undefined && n.status >= 400)` (no `loadingFailed`/`requestfailed` handling found by grep) |
| 38 | changelog, READMEs | Audit settle is a fixed 1500 ms with url (GAP-038) | MISC | `runtime.ts:1752 options.settleMs ?? 1500` |
| 39 | changelog, mcp README | Ring buffers 200 console / 50 page-error / 200 network per tab | MISC | `MAX_CONSOLE_LOGS = 200; MAX_PAGE_ERRORS = 50; MAX_NETWORK_LOG = 200` |
| 40 | changelog, READMEs | Bfcache-restored page reports `coversWholeDocument:false` | MISC bfcache flag | `!input.wasBfcacheRestore && input.observingSince !== null && ...` |
| 41 | changelog, READMEs | Audit JSON Schema is in the repo, not shipped in the npm package | MISC schema grep; `grep '"exports"' packages/capability-runtime/package.json`; `packages/sutradhar/package.json` `files` | no `schemas` reference in either package.json or `scripts/build-bundle.mjs`; `files: [dist, README.md, LICENSE, AGENT_SETUP.md]` |
| 42 | changelog | An already-open dialog makes audit fail fast | `sed -n 1760,1770p packages/capability-runtime/src/runtime.ts` | `a ${pending.dialogType} dialog is open ... so it can't be audited` |
| 43 | changelog, READMEs | Dialog during load/capture can make audit slow/misleading (GAP-270), `snap --json` multi-doc (GAP-277) | gaps.md rows 267 and 274 | both status `TODO`, quoted in the row; not re-run live here |
| 44 | changelog, READMEs | GAP-288 first-navigation-on-a-new-tab drops own status; GAP-291 bfcache wrong 500 | gaps.md rows 285, 288 (status `TODO`) and ledger FR2-12 BLOCKED | ledger: "audit-6 (FINAL) FAILED: GAP-288 (major ...)" |
| 45 | changelog | Grouped gap statuses: GAP-132/133/134/135 FIXED, 1,920 engine + 320 MCP trials, 0 false successes | gaps.md rows 129-132; decisions.md line 1966 entry | rows say `FIXED`; decision text "1,920 engine trials + 320 MCP trials, 0 false successes" |
| 46 | changelog, READMEs | GAP-001 open (retries), GAP-136 open, GAP-137 process | gaps.md rows 5, 133, 134 | `TODO` |
| 47 | changelog, cli README, AGENT_SETUP | Crash note advice to `nav` is wrong for `chrome://crash` (GAP-309); use `tabs` then `closetab` | `sed -n 73,79p packages/cli/src/dialog-broker.ts`; gaps.md row 306 | note still says `reload it with "sutradhar nav <url>"` (code unchanged, so the docs warn against it) |
| 48 | changelog, cli README, AGENT_SETUP | Background-tab crash also hangs other gated commands (GAP-310) | gaps.md row 307 | "a BACKGROUND tab crashed the same way also makes nav/snap on the healthy active tab hang (5/5 current, 2/2 master)" |
| 49 | changelog, cli README, AGENT_SETUP | `closetab` needs id as printed; lowercase rejected by Chrome (GAP-311) | MISC `TARGET_ID_RE`; gaps.md row 308 | `/^[0-9A-F]{32}$/i` accepts lowercase but passes it unchanged -> Chrome rejects (exit 1, 5/5 per audit) |
| 50 | changelog, cli README, AGENT_SETUP | GAP-257 popups after opener closes; busy-from-birth residual | gaps.md rows 254, 235-244; decisions.md lines 2560-2615 | GAP-257 `TODO`; "the residual (busy-from-birth, wider than originally disclosed ...)" |
| 51 | changelog | GAP-256 fix: crash events recorded, tabs/closetab browser-level | decisions.md 2026-09-29 audit-1 PASSED entry; `git log` `8d43b8f`, `6d349b7` | audit-1 PASS, 6/6 active + 6/6 background recoverable |
| 52 | changelog | GAP-307 fix (foreign-guid race) | decisions.md 2026-09-29 GAP-307 entry; `git log -1 a19b3c0` | "0/20 and 0/5" flaky failures after fix; commit `a19b3c0` |
| 53 | changelog | GAP-006 self-heal no longer wraps the command; GAP-017 gate before attach | `grep -n "deps.gate\|deps.reattach\|deps.fn\|deps.selfHeal" packages/cli/src/session-flow.ts` | lines 56 gate, 59 reattach, 61 selfHeal, 65 `fn()` "OUTSIDE the try above" |
| 54 | changelog, browser README | Dead stealth exports removed; launch flag unchanged | `git diff --stat master..HEAD -- packages/browser/src/stealth` ; `grep -c` in index | `5 files changed, 134 deletions(-)` (4 stealth files + 1 line of index.ts); see `proofs-misc2.out` |
| 55 | changelog, mcp/sutradhar READMEs | FR2-16 CI enforcement did not land | MISC | `grep -rn "stealth-claim-check\|fr2-16" .github package.json turbo.json scripts` returns nothing; scripts exist only under `tools/scenario-suite/fr2-16/` |
| 56 | changelog, AGENT_SETUP, README | FR2-03/07/08/11/13/14/15 are not on the branch | MISC first block | grep for `sutradhar.json`, `waitForPageSettle`, `case 'run':`, `garbageCollect`, `gcSessions` finds only a comment at `runtime.ts:1748` saying `waitForPageSettle` "hasn't" landed |
| 57 | sdk README | `page.download`, `page.uploadFile`, `page.audit`, `page.waitForSelector`, `evaluate(expr, frameSelector?)`, `getStorageState/setStorageState`, `setViewport/getViewport`, `Browser.pages()` is async, `getWsEndpoint()`, `launch({viewport, allowedDownloadRoots, allowedUploadRoots})` | `grep -n "public async \|public get" packages/sutradhar/src/page.ts packages/sutradhar/src/browser.ts` | all signatures present; `pages(): Promise<Page[]>` (README had `Page[]`) |
| 58 | sdk README | SDK does not read `SUTRADHAR_ALLOWED_*` | `grep -rn SUTRADHAR_ALLOWED packages/sutradhar/src` | only doc-comment mentions in `browser.ts:55-56` (see `proofs-misc2.out`); `launch()` calls `resolveFsRoots({options})` with no `env`, and `fs-roots.ts` documents "Omit entirely to skip the env layer (the SDK does this deliberately)` |
| 59 | browser README | Module layout entries (`actions/`, `dom/`, `session/dialog-*`, `page/`, `skills/`, `verifier/`) | `ls packages/browser/src packages/browser/src/*/` | files `download-lock.ts`, `path-containment.ts`, `selector-dialect.ts`, `frame-labels.ts`, `dialog-cdp.ts`, `dialog-warden.ts` exist |
| 60 | docs/ARCHITECTURE.md | Uploads are unrestricted by default (doc said downloads/uploads both constrained) | `sed -n 40,46p` of `path-containment`/engine: `allowedUploadRoots?: readonly string[]` "Unset (the default) means unrestricted"; P-FS `upload undefined` | `upload undefined` |
| 61 | README.md | No cloud-browser execution; no Anthropic/OpenAI adapters; memory not consulted; workflow is scaffolding | `ls packages/llm/src/gateway packages/llm/src/local`; `grep -il anthropic packages/llm/src` (none); `grep -rn -i cloud packages/browser/src` (only Cloudflare mentions) | gateway has `openai-compatible-adapter.ts`, `openrouter-adapter.ts`, `fallback-provider.ts`; Ollama in `local/` |
| 62 | docs/08, docs/16 banners | `@sutradhar/policy`/`tools` packages absent; no child-process/secret-redaction implementation; no 500 MB per-tab limit; runtime idle reaper unset by default | `ls packages`; `grep -rli redact packages/*/src` (only frontend); `grep -rn "500MB\|maxMemory" packages/*/src` (none); `sed -n 122,129p packages/capability-runtime/src/runtime.ts` | packages list has no `policy`/`tools`; "Unset by default" |
| 63 | AGENT_SETUP.md | Mirrored copy `packages/sutradhar/AGENT_SETUP.md` is a build artifact (`scripts/build-bundle.mjs` `copyFileSync`), git-ignored | `cp AGENT_SETUP.md packages/sutradhar/AGENT_SETUP.md && cmp ...`; `git check-ignore -v` | `mirror identical`; `.gitignore:53:packages/sutradhar/AGENT_SETUP.md` (not in `git status`) |

## False-pass check: claims that could be stale because a changelog fragment was copied

1. **Tool count "66 tools" (FR2-10 fragment) vs reality.** The fragment says "66 tools at FR2-10
   time"; the old mcp README said 69; AGENT_SETUP said 71. Copying any of them would be wrong for one
   count or another. Ruled out by P-TOOLS, which registers the real tools: 72 total, 71 `browser.*`,
   70 carry a `sessionId` field, 0 require it (claims 1, 3).
2. **"An open native dialog now fails the audit immediately" (FR2-12 fragment).** Copying it would
   overclaim: gaps.md GAP-270 (still `TODO`) says a dialog opening during page load/capture makes MCP/SDK
   audit hang ~30 s with a misleading message. Code check (claim 42) shows fail-fast only applies to a
   dialog already open after navigation+settle. The docs therefore say "already open" fails fast and list
   the GAP-270 residual (claims 42, 43).
3. **"MCP and the SDK are unaffected: default still `auto`" (FR2-04 fragment).** Verified independently:
   `grep dialogPolicy packages/mcp-server/src packages/sutradhar/src` finds nothing, and the MCP tool
   description says a dialog is auto-dismissed after 30 s (claim 29). Also confirmed the CLI default is
   `report` (claim 30).
4. **`SUTRADHAR_ALLOWED_*` "first entry becomes the destination; relative entry fails startup" (FR2-05
   fragment).** Ran the real `resolveFsRoots` (claims 20-22): unset gives the `sutradhar-downloads` subfolder
   and `undefined` upload roots; a relative entry throws naming the variable (negative control passed as
   expected).
5. **"`download_file` reset to `default`" (FR2-05 fragment item 5).** That fragment text is superseded:
   fix-1 changed it to `deny` and fix-2 moved to a never-detached session. The fragment's item 5 was NOT
   copied; the docs describe the current behaviour (claim 24) and the overlap protection as best-effort.
6. **FR2-01 fragment says the default is visible and "GAP-001 ... proposed fix maxRetries:0".** The
   proposed fix was never applied (only `timeoutMs <= 0` sets 0); verified by reading the engine
   (claim 33), so the docs keep the "about 3 x timeoutMs" caveat.
7. **FR2-12 fragment "Known limits" (GAP-new-A..G) are not in gaps.md under those ids.** Each one was
   re-derived from code instead of copied: only status >= 400 (claim 37), schema not shipped (41),
   ring buffers (39), fixed 1500 ms (38), legacy CLS (schema description text: "legacy total, not
   session-windowed"), and `audit <outDir>` (CLI help line 84-88 requires `""` as url).
8. **FR2-16 changelog fragment lists fixes to PROJECT_DEEP_DIVE.md etc.; the CI check "did not land".**
   Verified nothing in `.github`, `package.json`, `turbo.json` or `scripts` references it (claim 55), so the
   changelog calls FR2-16 PARTIAL and says the checker is not wired in.

## Other verification run

- `node tools/scenario-suite/fr2-16/doc-static.spec.mjs` after my edits (`fr2-16-doc-static-after.out`):
  all AGENT_SETUP.md/README boundary checks PASS; exactly one FAIL, a "detection" hit in a code comment
  in `packages/cli/src/cli.ts` (FR2-04 warden comment, "detection-only via a state hint"). That file is
  unchanged by this item (`git diff --quiet HEAD -- packages/cli/src/cli.ts` is clean), so the failure is
  pre-existing and is a false positive of the best-effort checker (it is about dialog detection).
- No claim above was verified with a live browser in this item; live-only limitations (GAP-257,
  GAP-288, GAP-309..311, lock behaviour) are documented from the audited gaps.md / decisions.md
  evidence and are worded as reported, not re-measured.

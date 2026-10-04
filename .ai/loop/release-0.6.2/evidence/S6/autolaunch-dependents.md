# S6 step 1: dependents of the 0.6.1 auto-launch (a non-launch verb as the first command against a fresh state)

Commands (raw output: `dep-grep1.txt` 654 lines, `dep-grep-docs.txt` 35 lines; `rg` is not on PATH, the ripgrep binary bundled with ZCode was used, read-only):
1. `rg -n "runCli\(|cli\(|spawnSync\(|drive\.mjs" tools .ai/loop/webbench-2026-10-04 packages/*/tests .claude/skills` -> `dep-grep1.txt`.
2. The docs grep from the plan with every non-launch verb (incl. back/forward/reload) over `README.md docs packages/*/README.md AGENT_SETUP.md packages/sutradhar/AGENT_SETUP.md .claude/skills .ai/loop/webbench-2026-10-04/driver-brief.md` -> `dep-grep-docs.txt`.
3. `.github/workflows/*.yml`: `ci.yml` runs only package build/lint/test steps (no CLI verb); `scenario-suite.yml:78` runs `node tools/scenario-suite/run-cli.mjs`.
4. Two mechanical scans over every driver script that invokes the CLI (`$R/S6/seq.mjs`, `$R/S6/seq2.mjs`, copies in this directory): (a) a non-launch verb array that is the first CLI call in the file or follows a `close`; (b) a non-launch verb array with no `nav`/`newtab`/`audit`/`compare` array in the previous 25 lines.

## Results

| dependent | first CLI call on a fresh state | verdict |
|---|---|---|
| `tools/scenario-suite/run-cli.mjs` (CI: `scenario-suite.yml:78`) | every flow is `closeSession(); runCli(['nav', ...])` (UC-01..UC-14); scan (a): the only hit is the `typeWithReadback` helper (line 129), called mid-flow after a `nav`; scan (b) hits (lines 332-386) are all mid-UC-05 inside the session opened by `nav` at :303 | compatible, no change |
| `tools/scenario-suite/verify-fr2-01-wait-states.mjs` (CLI surface) | `nav` (:710); the `wait` calls at 849-874 are in the same session (nav at :816, closed at :882) | compatible |
| `verify-fr2-04-dialogs.mjs` (177 calls) | `snap`/`tabs` at 308/817/1167/1299 are mid-case, in the session the case opened with `nav` and a dialog (read in context) | compatible |
| `verify-fr2-05-download-roots.mjs`, `verify-fr2-12-audit.mjs`, `verify-fr2-14-config.mjs`, `false-pass-checks-fr2-14.mjs` | scans (a) and (b): 0 hits | compatible. `verify-fr2-14-config.mjs:330`-region read: every sub-case starts with `nav` (the L5m loop, L7 ...) |
| `verify-fr2-06-selectors.mjs:358,364` | `click text=Submit`, `eval 1 --frame iframe#f::role=x` run with no session ON PURPOSE to assert the pre-validation error (exit 1, no Chrome). Validation precedes `withSession`, so the observable result is unchanged (the 0.6.1 contract was "fails before any Chrome contact") | compatible |
| `verify-fr2-07-verification.mjs` (1189-1275), `verify-fr2-08-conditions.mjs` (894-966) | mid-suite calls in the shared session opened by the suite's own `nav` | compatible |
| `verify-fr2-16-boundary.mjs`, `verify-fr2-10-optional-session.mjs`, `verify-fr2-02-extract-live.mjs`, `probe-fr2-14-launch-leak.mjs`, `mutate-fr2-14.mjs`, `tools/reliability/prob043-mcp-soak.mjs` | no CLI verb arrays of the affected kind (MCP/SDK drivers, help invocation with no args, PowerShell helpers) | not affected |
| `tools/engine-comparison/*` | drive Playwright/Puppeteer/pinchtab harnesses; no Sutradhar CLI verbs | not affected |
| `packages/*/tests` | `selector-args`, `session-flow`, `help-text`, `parse-args` unit specs only; `session-flow.spec.ts` deps literals gained the two new required fields (assertions unchanged, see README) | updated in this commit |
| `.ai/loop/webbench-2026-10-04/drive.mjs:157` | the WebBench driver runs `eval AUTO` after a command; with no session it now exits 1 with the hint instead of starting a blank browser (that was a defect, not intended behaviour). `.ai/loop/webbench-2026-10-04/**` is frozen historical evidence | recorded as historical, NOT edited |
| `.ai/loop/webbench-2026-10-04/tests/selftest/*` | fake transcripts, no real CLI calls | not affected |
| `.claude/skills` | grep for CLI verbs: no hits | not affected |
| docs examples (`dep-grep-docs.txt`) | every runnable example block starts with `nav` (`packages/sutradhar/README.md:57`, `packages/cli/README.md:38`, `AGENT_SETUP.md:257`); the `waitfor` examples in `AGENT_SETUP.md:163-167` are follow-up lines of a session context; `tabs`/`closetab` mentions are recovery advice for an existing session | no change in this commit; S10 documents the rule (launch-capable list, `grant` needs a session) |
| help text | `nav <url>` entry states which commands start a session; `grant` entry and the `grant` usage line say "needs an active session; run nav first" | updated in this commit |

Not found: any non-launch verb used as the first command against a fresh state in a tracked, non-frozen driver. The WebBench driver brief (`driver-brief.md`) is frozen; the docs grep found no verb examples in it.

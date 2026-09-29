# Field Report 2 loop: 0.5.0 (unreleased)

Merges `claude/field-report-2-loop` into `master`. Version bumped to **0.5.0**; **not published**.

Every item went through build → independent audit (a separate agent that didn't write the code) → fix, with a cap on cycles. Items that couldn't pass within the cap are marked BLOCKED with a written diagnosis rather than forced through. Full history: `.ai/loop/field-report-2/` (`ledger.md`, `decisions.md`, `gaps.md`, per-item evidence).

## What's in this PR

| Item | Status | What it does |
|---|---|---|
| FR2-02 extract_data reads live values | DONE | Extraction reads current input values and visibility, not stale attributes |
| FR2-06 Selector dialect coach | DONE | Clear errors and suggestions for unsupported selector syntax |
| FR2-09 Snapshot frame/shadow labels | DONE | Snapshots label content inside iframes and shadow DOM |
| FR2-10 MCP optional sessionId | DONE | MCP tools no longer require `sessionId` |
| FR2-05 Download/upload roots | PARTIAL, ships | Downloads/uploads confined to configured roots; 3 escape tricks found and fixed |
| FR2-04 CLI dialog handling | BLOCKED, ships with a scoped fix | CLI no longer silently acts on the wrong tab when a dialog is open |
| GAP-256-fix | DONE | A crashed tab no longer locks the CLI session (fixes a regression FR2-04 introduced) |
| FR2-12 Machine-readable audit | BLOCKED, ships | `sutradhar audit --json`, `browser.audit`, `Page.audit()` with a JSON schema |
| FR2-01 wait_for_selector states | BLOCKED, ships | `visible` / `hidden` / `attached` / `detached` wait states |
| FR2-16 Stealth boundary honesty | PARTIAL | Dead stealth code removed, honest docs; CI enforcement did not land |
| GAP-307 | DONE | Fixed flaky download tests and a real download-attribution race |
| FR2-17 Docs sweep | DONE | Docs match the branch; limitations stated |

**Not in this PR** (not started, or code never committed): FR2-03 session/profile GC, FR2-07, FR2-08, FR2-11, FR2-13, FR2-14, FR2-15.

"BLOCKED, ships" means the code is on the branch and passed its core checks, but the item's final audit still found a narrow defect. Each is listed below. The reviewer should decide whether to accept them or drop specific items.

## Known limitations

**CLI dialog handling (FR2-04 + GAP-256-fix)**
- After a tab crashes via `chrome://crash`, other commands hang until the crashed tab is closed with `tabs`, then `closetab <id>` (applies to active and background tabs; same as master).
- Two popups sharing a renderer can be misattributed after their opener closes (GAP-257).
- A tab busy from the instant it's created can look like a dialog.

**Downloads (FR2-05)**
- Run one process driving downloads per browser. A second overlapping `download_file` on the same browser is refused with a clear error. Cross-process protection is best-effort: the lock location depends on the process temp dir and the endpoint spelling.
- Downloads a page starts on its own, outside `download_file`, go to Chrome's default location.
- Four questions about overlapping downloads (stale-lock takeover race, lock location across processes, one client disconnecting, cancelled click still completing) could not be tested live in the development environment and are unverified.

**Audit report (FR2-12)**
- Auditing the current page of a brand-new tab right after its first navigation can miss the page's own HTTP error status (GAP-288).
- Slow requests can be missed (fixed settle time; needs FR2-08).
- A back-forward-cached page reports `coversWholeDocument: false`.

The complete list is in `docs/22-changelog.md` and each package README.

## Security fixes (FR2-05)

Found by independent audit and confirmed end-to-end in a real browser before fixing:
1. A folder link whose name ends in a dot or space escaped the allowed root (Windows strips the dot; the check didn't).
2. Look-alike Unicode letters (e.g. the Kelvin sign) matched a different real folder.
3. Case-sensitive folders: `root` and `ROOT` were treated as the same folder.

All three are fixed and re-tested. Master still has the original literal-path fallback bug these build on, so this branch is strictly safer.

## Verification (fresh, at `ed42cd9`)

- Typecheck: 34/34 tasks
- Forced build: 20/20 tasks
- Tests: browser 568, capability-runtime 228, mcp-server 101, cli 180, sutradhar 25 (**1102, all passing**; the download tests, previously flaky 9/20, now pass 20/20 and 5/5 full runs)
- FR2-04 live dialog suite: 111 pass / 0 fail / 2 skip

## Notes for the reviewer

- Root `README.md` says "Proprietary & Confidential", but the published package is FSL-1.1-ALv2. Not changed; needs your decision.
- `sutradhar --help` cites internal IDs (GAP-001, PROB-018). Cosmetic; not changed.
- `tools/scenario-suite/fr2-16/doc-static.spec.mjs` (not wired into CI) flags the word "detection" in a code comment in `packages/cli/src/cli.ts`. It's a false positive in that checker.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

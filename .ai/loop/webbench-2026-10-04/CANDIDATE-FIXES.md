# Sutradhar candidate fixes surfaced during the run (orchestrator notes; final classification is the verifier's)

1. **CLI rejects the id form its own snapshot prints.** `snap` lists elements as `[#5] button "..."`, but `click "#5"`
   (and type/press with `#N`) exits 1: `Invalid selector "#5" — this looks like a snapshot node id; pass just the number`.
   Hit by B1 (1172 seq 19), B2 (1946 seq 7/9), B3 (781). `#<digits>` is not valid CSS (an id selector cannot start with
   an unescaped digit), so accepting `#N` as the node id is unambiguous. Cost per occurrence: one wasted call; no task lost.
   Also a protocol defect: driver-brief.md's verb table shows `click "#12"`.
2. (pending verifier) B1/2388: click that opens a new tab -> `--expect-url-changed` exit 4 (checks the original tab).
3. (pending verifier) B1/2388: "Past 24 hours" click reported a 15 s timeout although the filter applied (possible false failure).
4. NOT a Sutradhar bug: B3/1940 `waitfor --js` "Unexpected token" = Git Bash MSYS path conversion of a leading-"/" argument
   (see DEVIATIONS.md #4); `return` refusal is documented expression-only behaviour.
5. (pending verifier replay) B4/2561 Kayak: clicks/types failed with detached-frame errors on a1; "Dismiss" refused as
   occluded; typeahead selection not taken. Could be Sutradhar (frame handling after navigation/iframe swap) or site.
6. (observation) B4/1789: star ratings rendered as graphics with no text/attribute equivalent - evidence-rule, not a
   Sutradhar defect unless a read verb returned wrong data.
7. (pending verifier replay) B5/982 lawinsider: `text` returned only 3 of 10 search-result cards; `read body` returned all
   10. Either a truncation/visibility bug in `text`, or `text` = rendered-visible-text in the 800x600 CLI viewport
   (surface caveat). Must be decided with a replay (scroll position, viewport, text vs read body diff).
8. (cosmetic, confirmed by driver) `back` prints "undefined" to stdout while navigating correctly (exit 0).
9. RE-TESTS: PROB-044 (`clicktext` across <mark>-split text, 597) and the type-append bug (41, 192) both PASS live on 0.6.1.
10. **CONFIRMED in source: silent page-text truncation.** `capability-runtime/src/runtime.ts:2959` returns
    `document.body.innerText.slice(0, 4000)` (PDF path 2986 also 4000) with no truncation marker and no way to page
    through the rest; CLI `text` (cli.ts:838) prints it as-is; MCP `browser.snapshot` slices pageText again to 2000
    (mcp-server/src/tools.ts:524). An agent cannot tell content is missing. Seen: B5/982 (`text` showed 3 of 10 result
    cards; `read body` got all 10); verifier phase 1 believes it contributed to 1371, 2582, 2687.
    Fix direction: mark truncation explicitly ("[truncated: N of M chars]"), and let callers request more (offset/limit
    or a max) on text/snapshot in CLI, MCP and SDK. Severity: MAJOR for an AI-browsing tool (silent data loss).

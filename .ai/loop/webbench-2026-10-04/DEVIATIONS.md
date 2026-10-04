# Run deviations from the frozen protocol (orchestrator log)

1. Briefs are delivered by file path + sha256 (driver reads runs/<slot>/brief.md and verifies the hash) instead of pasted
   inline; content is identical and auditable. fill-briefs.mjs substitutes only below the header's '---'.
2. Drivers cannot write summary.md (the harness refuses subagent report files); the orchestrator saves each summary from
   the driver's final reply, labelled as such.
3. Rolling start instead of fixed waves: a new slot starts when one finishes; the binding limit (<=3 concurrent Chrome
   sessions) is unchanged.
4. Environment correction at ~10:35Z: Git Bash (MSYS) path conversion rewrote a --js argument starting with "/" into a
   Windows path (B3/1940 seq 7: "!C:/Program Files/Git/Just a moment|Verif/i..." -> "Unexpected token ':'"). Root cause is
   the driver's shell, NOT Sutradhar (seq 11 'return' refusal is documented expression-only behaviour). All running drivers
   (B1, B4, B5) were told to prefix drive.mjs calls with MSYS_NO_PATHCONV=1; B6 gets it at launch. B3/1940's class is
   unaffected (a regex-free equivalent waited the full 30 s and the Cloudflare page persisted).
5. `runs/<slot>/raw.sha256` was NOT snapshotted at driver progress notifications as protocol 3.3(c) / 6.4 intended; it was
   generated once, after all work finished (2026-10-04, end of report step), with `sha256sum *.jsonl` per slot (B1-B6, K, V1).
   It therefore proves only that the committed lists match the raw logs as they were at the end, not that no log changed
   between writing and then. The hash chains inside each log (checker C1, all 36 passed) are the in-run integrity evidence.
6. Canary K1 (R31 = 1414) could not be built as specified: the honest K run of 1414 was EXTERNAL-BLOCK (HTTP 402) with no
   titles to replace. Per protocol 4.4 the orchestrator substituted a K2-style canary on the next-ranked primary COMPLETED
   record (2336). Canaries were B2/2554 (K3), B4/1925 (K2), B4/2336 (K1 substitute). All three classified non-COMPLETED in
   phase 1; control 1310 stayed COMPLETED.
7. Rule slips by drivers, none score-changing: several drivers chained 2 drive.mjs calls in one shell command (sequential,
   never concurrent; see ADJUDICATION.md T4 re-derivation); B4/2561 ran an a2 that the single-retry rule did not authorise
   (a1 had not ended in a transient error or suspected block), and a2 cannot raise the result; brief example `click "#12"`
   is rejected by the CLI (candidate fix 1), which cost drivers one call each.
8. The verifier's phase-2 independent channel was the Claude_Browser tool (read-only, non-headless) for 7 of 12 replays; the
   other 5 are "same-tool replay" (counted as confirmation, reported separately).
9. Orchestrator ruled on 10 disputed or flagged cases in verify/adjudication.md; verify/adjudication-brief.md is the
   evidence brief an independent Opus agent prepared (it recommended, the orchestrator ruled).

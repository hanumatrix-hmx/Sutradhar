# Release 0.6.2 STATE

- Last completed step: S1 (baseline, fixtures, spikes, plan commit).
- Next step: S2 (I-048 runtime `readTextWindow`), then S3a, S3b, S3c.
- Verify command for the last step: `cat .ai/loop/release-0.6.2/evidence/S1/test-totals.txt`; `cat .ai/loop/release-0.6.2/evidence/S1/spikes.md`.
- Background processes: none. Escalation counts: none.
- Spike results binding on later steps: SP-1 -> S7 uses dialog-history detection (reload/goBack under dismiss time out after 30 s);
  SP-2 -> S3a(g) runs the PDF check headless. Tool counts: tools_list=73, EXPECTED_BROWSER_TOOLS=72.

- S2 done (I-048 runtime). Next: S3a (CLI text flags/marker/errors). Verify: tail -1 of evidence/S2/mutants.txt (survivors=0); capability-runtime 553 tests.

- S3a STOPPED (uncommitted working tree): S3a-7 (g) PDF fails - bundled CLI cannot extract PDF text (@napi-rs/canvas / DOMMatrix); see evidence/S3a/README.md. Next: orchestrator decision, then re-run the harness and commit S3a, then S3b, S3c.

- Addendum A.1 follow-ups for later steps: S10b gap (bundled PDF extraction, PROB-052, both fix options); S10 changelog "Known limitations": PDF text unavailable in bundled builds, `text` on a PDF now exits 1 with the PROB-052 message (was empty line + exit 0).

- S3a done after Addendum A (committed). Next: S3b.

- S3b done (committed). Next: S3c (SDK page.text()).

- S3c done (committed). Next: S4 (I-047), not started by this builder.

- S4 done (I-047 frame-detach containment, committed). Next: S5 (I-049 `#N` refs). Verify: evidence/S4/README.md AC table; mutants-unit.txt (survivors=0); live-detach-neg.err (NEG061 10/10, 30/30, 5/5 failures) vs live-detach-head.err (all clean). Background processes: none. Notes for S10/S10b in evidence/S4/README.md (goto-after-click hang on churn page, kayak /stays ERR_ABORTED, runtime.ts upload site).

- S5 done (I-049 `#N`/`[#N]`, committed). Next: S6 (I-051 no-session reads). Verify: evidence/S5/README.md AC table; mutants-unit.txt (survivors=0); live-nodeid-head.json allPass. Background processes: none.

- S6 done (I-051 no-session reads, committed). Next: S7 (I-NAV back/forward/reload). Verify: evidence/S6/README.md AC table; mutants-unit.txt (survivors=0) and mutants-live.txt (both live mutants fail the harness); live-nosession-head.json allPass. Background processes: none.

- S7 done (I-NAV back/forward/reload, committed after fixture fix 6c952b8). Next: S8 independent audit (not started). Verify: evidence/S7/README.md; live-history-head.json allPass; mutants-unit.txt survivors=0. Background processes: none.

- S0b/S9 done (A-1 test 5393010; version bump 0.6.2). Next: S10 changelog+docs, S10b gaps, S11 gate, S11b WebBench.

- S10 done (changelog + docs, commit follows S9). Next: S10b gaps, S11 gate, S11b WebBench.

- S10b done (GAP-399..413). Next: S11 gate (re-key S4 inventory first, A-2), S11b.

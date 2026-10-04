# S10 notes (S10-2 justifications and deviations)

- `packages/browser/README.md:58` says `See docs/22-changelog.md ("0.6.0" and "0.5.0 (2026-09-29)")`. That is a pointer, not an "as of 0.6.0"
  claim, and 0.6.1 changes nothing in `@sutradhar/browser`; left as is. It does not match the S10-2 pattern.
- `AGENT_SETUP.md` was grepped for CLI temp-dir text (`temp`, `sutradhar-cli-`): the only temp mentions are the download sandbox root
  (`<OS temp>/sutradhar-downloads`) and the download lock; nothing describes CLI profile dirs, so no line was added (plan: "add a line if it describes CLI temp dirs").
- `packages/cli/README.md:288-289` ("`sutradhar close` kills that Chrome process tree") left unchanged per plan: still true in 0.6.1.
- The README `0.6.0 adds ...` paragraph is kept unchanged (plan S10, review-5 #9c).
- "as of 0.6.1" in SECURITY.md, the cli, mcp-server and sutradhar READMEs: each list was re-read; 0.6.1 changes no download, dialog, audit or
  wait behaviour, so every listed limitation is still accurate. The sweep/close timing wording is S7's suggested wording
  (`S7/README.md`, "Measured timings").
- The changelog template deviates from the plan's text in these places (orchestrator instructions for this run): the
  exit-code sentence names the failed-state-clear path; the Changed list adds the F-S8-5 fail-fast start; the "forgets the PID" bullet no longer says an
  interrupted cleanup "can never" leave a stale ID (a failed state clear still does, as in 0.6.0, and is documented as such); S3b was kept,
  so the bracketed dev-only sentence is included unconditionally.
- `check-s10.mjs` first run had a script bug (S1 ids carry the `GHSA-` prefix, the changelog slice did not): FAIL on S10-3, fixed in the checker only; the fixed checker is the one recorded in `check-s10.out.txt`.

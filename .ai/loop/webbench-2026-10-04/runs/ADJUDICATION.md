# Orchestrator adjudications (protocol 4.3 step 2)

- B6/41 (re-test): checker C2d failed on review_count (excerpt "4.9 \n449 Reviews", 15 chars < 20). The same log record
  (seq 27, verb `text`, page-reading, untainted) contains a passing citation >= 20 chars:
  "Black Brown Belts Without Buckle Cowskin\n  4.9  \n449 Reviews". Rule 4.3-2 -> stays COMPLETED (re-test set; not in headline).

## Transcript cross-check (protocol 4.3 step 5)
- T1 in all six slots: "hashing in a command" = the driver running `sha256sum brief.md`, which the orchestrator's launch
  prompt told every driver to do (verify the frozen brief). Benign; no log file was hashed.
- T4 in B1/B2/B3 ("N cli records but only M drive.mjs calls"): transcript-check counts shell commands, but those drivers
  chained several drive.mjs calls per command. Re-derived per task with runs/t4-adjudicate.mjs (counts every
  `drive.mjs <slot> <id> <attempt>` occurrence in the driver's own transcript vs every non-auto-href log record):
  35/36 tasks match exactly; B5/1434 differs by one only because the driver invoked close via `node "$D" B5 1434 a1 close`
  (variable path) - the call is present in the transcript. Result: every log record corresponds to a real driver call;
  no fabricated records. Chaining is a rule slip (one call per command), reported, not score-changing.

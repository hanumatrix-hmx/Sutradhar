# S10b follow-up gaps

`add-gaps.cjs` appended 15 rows GAP-399..GAP-413 to `.ai/loop/field-report-2/gaps.md` (CRLF preserved; `git diff --stat`: 15
insertions, 0 deletions). Highest existing id before: GAP-398 (0.6.1); no `GAP-399`/`GAP-4xx` on any local or remote branch
under `.ai` (checked with `git grep` per ref). Mapping: 399 self-heal, 400 agent-loop cap, 401 apps/server cap, 402 buildGraph
catch-all, 403 eval `undefined`, 404 Kayak ERR_ABORTED, 405 WebBench 2388 unconfirmed, 406 SDK consumer types, 407 PROB-052 fix
options, 408 S8 A-3 navigation hang, 409 S8 A-4 cross-origin child-frame raw errors, 410 A-2 inventory re-key, 411 A-5, 412 A-7, 413 A-9/A-10.

False-pass analysis: ids could collide with a row added on another branch -> `git grep -E "GAP-(39[9]|4[0-9][0-9])"` over every
ref under `.ai` printed no hit before the append; ids in the file are unique (`grep -o "^| GAP-[0-9]*" | sort | uniq -d` empty).

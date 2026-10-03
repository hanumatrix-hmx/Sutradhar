# S4 evidence index
- `audit.md`: verdict (REOPEN), per-item and per-runtime table, findings, plan defects, false-pass analysis (section 6).
- `module.sha256`, `branch.diff`, `node-bins.txt`: module provenance.
- `win/`: Windows probe logs plus `.pathcheck` per log (v25/v18/v20/v22; `browser-*` = live Chrome/Edge; `*-FIXCONTROL` = scratch-patched control; `*-MUTANT-M2` = mutant).
- `wsl/`: WSL Node 20 logs plus `.pathcheck`. `wsl-guard.txt` and `wsl-guard-literal.txt`: A9.
- `spec/`: branch spec under vitest (isolated) and `mutants.txt`.
- `port-map.md`: C5-live(d).
- `probes/` plus `probes.sha256`: every probe source (S8 re-runs these).
- `snapshots/`: real-TEMP before/after; `x1-pathchecks.txt`; `iso-cleanup.txt`.

# S6e - index (probes added in S6e; per-fix evidence is in `../S6e-1` .. `../S6e-5`)

## Orchestrator decision (second sanctioned exception to A.5 rule 3)
The two unmodified S4 `wsl/wsl-a7.mjs` checks `A7 ps unresolvable -> null` and `A7 ps unresolvable -> close keeps` set `PATH=''` to make the POSIX scanner
unresolvable. They are APPROVED as a second sanctioned exception, with the same rationale as `win-a7` -> `win-a7b`: since S6a/S6d the scanner is an absolute
binary (`/bin/ps`, macOS) or `/proc` (Linux), so PATH is irrelevant. In exchange this directory adds the probe below, which proves the protected property.
Observed (HEAD module): every other `wsl-a7` check PASSes (`4 PASS 2 FAIL`, the two sanctioned ones), and on Windows every `win-a7` check except the two sanctioned PATH ones PASSes.

## `probes/wsl-a7b.mjs` (additive; the S4 probes are untouched)
- sha256 (for S8): `089482f3cb121f9e15e029a9ea6c8eccf961c18f97f5eef4cf7bbb6248d0ac91` (`probes/wsl-a7b.sha256`).
- Runs on WSL Node 20.20.2 with the HEAD-compiled module (esbuild bundle), under the literal WSL guard (the first 4 lines are byte-copied from `wsl-a7.mjs`), via
  `evidence/S6d/run-wsl-s6x.sh` (self-contained `wsl.exe` call, `mktemp`, guarded `rm`, `MSYS_NO_PATHCONV=1` path check).
- Four "scanner unavailable" variants, each through the module's own seams: `/proc` unlistable (ENOENT); every `/proc/<pid>/cmdline` unreadable (EACCES);
  scanner binary missing (absolute path that does not exist); real `/proc` reader with a 1 ms timeout. For each: the scan is `null`, close keeps the dir with
  `scan-unavailable`, and the sweep keeps it with `scan-unavailable`.
- Negative controls so the probe can FAIL: scanner available + dir not in use -> REMOVED (close and sweep); scanner available + dir in use by a stand-in -> `in-use`
  (kept); after the stand-in is killed by its own handle, the same dir is removed.
- Result (HEAD module `d24edfa8...`): `18 PASS 0 FAIL` (`../S6e-2/wsl/wsl-a7b-head.log`).
  Against a scratch-only mutant module where a failed scan is treated as `[]` (`../S6e-2/MUTANT-scanfail-as-empty-scratch-only.diff`, module `75dc608f...`): `10 PASS 8 FAIL`
  (`../S6e-2/wsl/wsl-a7b-mutant.log`): all 8 close/sweep "keeps" checks fail (`{"removed":true}`), so the probe detects a fail-open scan.

# FR2-14 run-1: regression results (all on a forced build of this branch, HEAD d96443d + harness commit)

| Script | Result | Notes |
|---|---|---|
| `verify-fr2-08-conditions.mjs` full, run A | 473/478 | `cli:C-L5:{clicktext,clickrole,hover,drag,download}` = 15 s/30 s action timeouts (`regression-verify-fr2-08-conditions.log`) |
| same, run B (after nothing changed) | **478/478** (mcp 327, cli 23, sdk 10, bundle 118) | `regression/fr2-08-full-run2.log` |
| `--surface=cli` only, twice | 23/23, 23/23 | `regression/ab-branch-fr2-08-cli-{1,2}.log` |
| `--surface=cli --only=C-L5` | 11/11 | `regression/ab-branch-fr2-08-CL5-1.log` |
| `verify-fr2-07-verification.mjs` | **487/488**, fail = `bundle:H2` (the known master flake); no GAP-325 tolerance and no H2 `relaxedFound` fallback line in the log | `regress-verify-fr2-07-verification.log`; it also left one `sutradhar-cli-*` dir in the OS temp (GAP-315), removed |
| `verify-fr2-04-dialogs.mjs` | 110 passed, 1 failed, 2 skipped (113); the failure is `L13.headed.click-exit0` (headed click stall, GAP-316/321/338 family; identical numbers to FR2-08's own run) | `regress-verify-fr2-04-dialogs.log` |
| CLI scenario suite `run-cli.mjs` (full) | UC-01/02/03/04/07/10/11/13/14 pass; UC-05, UC-06, UC-08, UC-09, UC-12 fail | `regression/run-cli-branch-full.json`; tracked `results/baseline-cli.json` restored after each run |

## A/B of every failure before counting it

* **fr2-08 run A `C-L5` timeouts:** not reproduced by 4 later runs on the same build (run B 478/478, CLI-only 23/23 x2, `C-L5` 11/11). Recorded as
  an unattributed flake (GAP-345, the GAP-338 family: 15 s action timeouts under load on a shared machine). No A/B on master was possible for
  a failure that does not reproduce.
* **UC-06 (`entry_ad nav`):** `Fatal: Navigation timeout of 30000 ms exceeded` on the branch AND identically on master `fdae749` (detached
  checkout, forced rebuild, then forced rebuild back): `regression/ab-master-uc06-nav.txt`, `regression/run-cli-UC06-master.log`. The site
  answers HTTP 200 from curl; the page does not reach `load` here. Pre-existing, not FR2-14.
* **UC-09:** failed in the full run, passed in isolation on the branch (`regression/run-cli-UC06-UC09-branch.log`: UC-09 success=true, 10 s).
* **UC-05, UC-08, UC-12:** the task lists these (with UC-04) as known to fail or flake on master; not individually A/B'd here. UC-04 passed in this run.

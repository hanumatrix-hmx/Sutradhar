# Plan review 6: release 0.6.1 plan (revision 6), confirmation pass

Reviewer: independent plan reviewer, round 6 (Claude Opus 5.5), 2026-10-04. I only read the repo; the one file I wrote
is this one.

Location check: `git rev-parse --show-toplevel` printed `$WT`, and `git branch --show-current` printed `release/0.6.1`.

Sources read:
- `plan.md` rev 6 (all 1717 lines) and `plan-review-5.md`;
- branch `fix/gap-315-temp-profile-cleanup` `cli.ts` `cmdClose` (lines 1496-1592);
- master `cli.ts` `chromePid`/`clearState` sites;
- `tools/scenario-suite/verify-fr2-04-dialogs.mjs` N11b (lines 844-860);
- `packages/sutradhar/src/{index.ts,page.ts}` (the S11-8b API);
- `docs/22-changelog.md` (placeholder grep).

## 1. Review-5 findings: resolved in text?

| # | resolved | resolving text (plan line) |
|---|---|---|
| 1 | yes, but see finding A | 835-838: "**The trailing `clearState()` is removed from the chromePid branch** ... stays **only** in the attached-session (no `chromePid`) branch". O7 at 857, M-O5 at 868. |
| 2 | yes | 813-816: "`now()`. It is **pinned to the monotonic clock**: the default and the `cli.ts` wiring are both `now: () => performance.now()`". O8 at 858 ("(14 000, 15 001]"), M-O4 at 867, and the S6c grep at 946 (`now: *(\(\) *=> *)?Date\.now` ... "must be 1"). |
| 3 | partly; see finding B | 1273-1288 "**S11 BLOCKED variant** ... `killChromeTree(` ... must be **5** ... system-binary grep ... **1** ... `git diff origin/master -- packages/cli/src` must be **empty**". 6.3 at 1473: "Which S11 variant ran (normal or BLOCKED) is recorded". |
| 4 | yes | 1374-1378: "the kill function is unchanged **against the S5 merge commit** ... except for `taskkillExe()` ... The async/await form, the cap and `windowsHide` ... are **not** a finding". |
| 5 | yes, with finding D | 894-897: "`await deps.removeProfile(dir, killed ? pid : undefined, {tmpRoot, isAlive: deps.isAlive})` ... **When a kill was issued (P2 and F8), the PID is passed**". The `isAlive` seam is at 704-706. G3 (922) has "**injected `isAlive: () => false`**". G3b is at 923, M-G6 at 938, and S10b item 6 at 1194-1195. |
| 6 | yes | 741-753: "Logging happens only in the I/O paths ... It **never** logs in the pure predicates `isAutoTempProfileDir`, `commandLinesReference` or `decideRemoval`". T6b at 772, M-f at 785. |
| 7 | yes, except the S8-BLOCKED path (finding B) | 149-155: "Every step's own commit adds `$EV/<STEP>` by name ... S5's evidence ... `GAP-315 merge evidence` ... Anything still untracked there is an S11 FAIL". S5 step 5 is at 639-640. |
| 8a | yes | 384-385: literal `cd apps/server ... test-apps-server.log` and `cd packages/frontend ... test-frontend.log`. |
| 8b | yes | 1223-1269: full blocks for item 6 (`--pack-destination "$SP/S11-tmp-pack"`, consumer `npm audit --json`) and item 7 (`npm pack sutradhar@0.6.0 --dry-run --json` plus a diff script). 8a/8b/8c are spec'd. The S11-8b API exists: `launch` (index.ts:48), `ActionFailedError` (index.ts:122), and `Page.waitFor({text,timeout})`, which throws `ActionFailedError` (page.ts:347-359). |
| 8c | yes | 585-590: "`const TP = await import(pathToFileURL(process.env.TP_MODULE).href)`", plus a WSL example with `TP_MODULE="$PWD/temp-profile.mjs"`. |
| 8d | yes | 592-596: "with **that probe's WSL `PROBE_ROOT` as the root argument** ... Require `cleanup-lines > 0`". |
| 8e | yes | 1058-1067: `git worktree add "$SP/S7-tmp-s5wt" <S5 merge sha>` ... `git worktree remove --force` ... "only if R1 shows a non-close failure". |
| 8f | yes | 434 and 534: `turbo run lint --force --continue --concurrency=1`. |
| 8g | yes | 1218: `turbo run typecheck --force --concurrency=1`. |
| 8h | yes | 687: "**`packages/cli/src/spawn-chrome.ts`**: `killChromeTree` switches to `taskkillExe()`". |
| 8i | yes, with one stale line (finding E) | 345: set B "O1-O8, G1-G6 (incl. G3b)". Also 871, 1093, 1371 and 1462. |
| 9a | yes, with finding C | 515: "**exactly one fast-uri version, ≥ 3.1.8**". Placeholders at 1155-1160. |
| 9b | yes | 1151-1152 is the session-start bullet; 739 defines `phase sweep ms=`. |
| 9c | yes | 1174-1176 is the heading decision; the S10-2 grep at 1183 includes `Status (0\.6\.0)`. |
| 9d | yes | 1236-1238: "**New-advisory rule** ... **stop** ... re-plan, starting from S3a ... Never ship around it". |
| 9e | yes | 1479-1485: publish from the S11-gated commit, or from a merge checkout after re-running items 2, 3, 6 and 7. |
| 10 | yes | 156-159 is the per-AC false-pass README. 160-165 cap waits at ≤ 1200 s and record the deviation for 2400/1800 s single foreground commands, which the orchestrator accepted. |

The three stated deviations are sound:
- An injected `isAlive` is the only deterministic option, because no PID is guaranteed dead on Linux.
- Logging only in I/O paths keeps the branch spec byte-identical to what S4 audited.
- The build-timeout deviation is accepted by the orchestrator.

## 2. Findings

There is no BLOCKER and no MAJOR.

### A. MINOR (important): the O7 source guard contradicts the correct `cmdClose` shape, and "the attached-session branch" can be read as `else if (!closeBlocked)`, which drops `clearState` for one path

**Evidence.** The merged `cmdClose` (branch `cli.ts` 1572-1592) has this shape:

```ts
if (state.chromePid) { await killChromeTree(...); await cleanupSessionTempProfile(state, true); }
else if (!closeBlocked) { /* attach + shutdown */ }
await clearState();
console.log('Session closed.');
```

The trailing clear is shared by **three** paths: chromePid, attached and not blocked, and attached and blocked. There
is no plain attached-session branch.

**Two problems.**
1. **Guard contradiction.** The O7 guard (857) asserts that "no `clearState(` appears after `await stopSpawnedChrome(`
   up to `Session closed.`". Any correct placement keeps a `clearState(` for the no-chromePid paths textually between
   the two, for example `else { if (!closeBlocked) {...} await clearState(); }`. So a literal guard fails on correct
   code. The only way to satisfy it is to put the no-chromePid branch first.
2. **Untested regression.** The likeliest reading of "stays only in the attached-session branch" is to move it into
   `else if (!closeBlocked) {}`. That loses the clear for **no chromePid + dialog open**: `close` prints
   `Session closed.`, but `state.json` survives.
   - N11b (verify-fr2-04 844-855) is exactly this case, but it checks only `code === 0 && ms < 10000`, not
     `state.json`.
   - O5 tests `stopSpawnedChrome`, which is not on this path.

   So no check in the plan catches it. The impact is narrow: master writes `chromePid` only at cli.ts:315
   (`spawnFreshSession`), so only legacy state files reach this path. That is why this is MINOR and not MAJOR.

**Fix.** In S6b, state the target shape literally:

```ts
if (state.chromePid) { await stopSpawnedChrome(state, deps); }
else { if (!closeBlocked) { /* unchanged attach+shutdown */ } await clearState(); }
console.log('Session closed.');
```

Restate the O7 guard as two checks:
- the text from `await stopSpawnedChrome(` to the closing `}` of the `if (state.chromePid)` block contains no
  `clearState(`;
- the `cmdClose` body contains exactly one `clearState(`, and it sits **outside** the `if (!closeBlocked)` block.

Also add one assertion to S7 R1, or a small live L case: after N11b's `close`, `$caseDir/state.json` is absent.

### B. MINOR: the BLOCKED variant covers only the S8 path; S4-BLOCKED, and the S8-BLOCKED evidence, still fail S11

**Evidence.**
- Gating rule 1 (349-350) says: "S4 ... BLOCKED: skip S5-S8. 0.6.1 ships without GAP-315/349". But the variant (1273)
  is "used only when S8 ended BLOCKED and the S8 revert procedure ran".
- On the S4-BLOCKED path, the normal item 3 (`killChromeTree(` = 1; system-binary grep 0) cannot pass on master's code
  (5 / 1). This is the same false-fail class as review-5 #3.
- Separately, the S8 revert procedure (1100-1106) never says which commit takes `$EV/S8`. The ACCEPT branch commits it
  (1097-1098), and the revert commits use `--no-edit`. So on the BLOCKED path S11-1 finds untracked evidence and fails
  (155).

**Effect.** False FAIL, not false PASS. The release stops when rule 1 or rule 4 says it should proceed.

**Fix.**
- Change the variant's trigger to "whenever GAP-315 did not ship (S4 BLOCKED, or S8 BLOCKED and reverted)".
- Add revert step 7: commit `$EV/S8` as `GAP-315: post-merge audit BLOCKED, evidence`.

### C. MINOR: S10-5's placeholder grep cannot see the lowercase `<p50>` placeholder

**Evidence.** The changelog template (1149) contains `(measured: <p50> in total)`. S10-5 (1160) is
`grep -n "<[A-Z_0-9]*>" docs/22-changelog.md`, which does not match lowercase. Broadening the regex is not an option:
the existing changelog has legitimate `<defs>`, `<ref>`, `<state>` and similar tokens (lines 97-167).

**Effect.** An unfilled `<p50>` passes S10-5, and S10-4 depends on a reviewer noticing it.

**Fix.** Rename the placeholder to `<CLOSE_P50>` in both 1149 and 1158.

Also clarify `<SWEEP_P50>` (1158-1159): "`scan ms=` plus `phase` lines" double-counts, because `phase sweep ms=`
already includes the scan. Use the p50 of `phase sweep ms=` alone.

### D. MINOR: the G-test `removeProfile` wrapper can silently drop the injected `isAlive`

**Evidence.** At 913-916, the wrapper delegates "to the real `removeSessionTempProfile` with
`{tmpRoot, scan: async () => []}`". If the builder builds a fresh opts object as written, the `isAlive` that
`discardSpawnedProfile` passes (894) is lost.

**Effect.**
- G3 falls back to `isPidAlive(4242)`. That is exactly the Linux-CI nondeterminism review-5 #5 removed, and it stays
  invisible on Windows.
- G3b would fail visibly, but G3 would not.

**Fix.** The wrapper forwards the received opts as `{...opts, tmpRoot, scan: async () => []}`. G3 also asserts that
`opts.isAlive` is the injected fake.

### E. NIT: stale counts and cross-references from the rev-6 edits

- 6.3 (1463) says "GAP-349: G1-G6 + 6 mutants". S6c now has G3b and **7** mutants (958-961).
- S1 (441) says "today that is 1-4", and 1.1 (172) says "plan + reviews 1-4". Reviews 1-6 now exist. The `ls`
  instruction is correct; the parentheticals are stale.
- S6c (911): "Remove the now-unused `killChromeTree` import from `cli.ts` if tsc flags it." It stays in use through
  `kill: killChromeTree`, which O6 requires, so tsc will not flag it. This is harmless, but the sentence should say
  "keep it".

## 3. Contradiction, ordering and new-MAJOR sweep

- **Step order is unchanged and valid.** The only new commit, `GAP-315 merge evidence`, sits after S5 and before S6a,
  and it touches no `src`. S11-9 still commits the evidence before `check-release-ready`.
- **Counts are consistent.**
  - S6a: 6 mutants, M-a..M-f.
  - S6b: 5, M-O1..M-O5.
  - S6c: 7.
  - Kill-site counts: S6b-3 = 3, S6c-3 = 1, S11-3 = 1; the BLOCKED variant = 5, matching review-5's `git grep`.
  - Blocking set, S8 and section 5 all name O1-O8 and G3b.
- **Safety.**
  - No new step touches real-TEMP `sutradhar-cli-*` dirs. S11-6 and S11-7 run npm only, with `--ignore-scripts`, in
    `$SP/S11-tmp-*`.
  - R1's comparison worktree is step-created under `$SP` and is removed by `git worktree remove` only.
  - No new kill path was added. The `isAlive` seam is read-only (`process.kill(pid, 0)`), and G3b uses fakes.
  - P2 passing the PID adds a read-only wait, not a kill.
- **No false-verification route found** beyond A (state survives N11b unchecked) and C (placeholder).

## 4. Builder executability spot-checks

1. **S5** (619-661): executable as written. Merge `--no-commit`, resolve by keeping both sides, `git add` by name,
   commit, then the separate evidence commit. The spec-typecheck configs go in `$SP/S6/`, which the Write tool creates.
   S5-1 (11 files) and S5-5 (7 errors, 0 TS6059, a planted TS2322) are mechanical.
2. **S6b** (798-880): executable apart from finding A. The O7 guard, as worded, fails on the correct implementation,
   and the builder has to guess the scope.
3. **S11-7 / S11-8b** (1239-1257):
   - In `node -e '...' a b`, `process.argv[1]` is `a`, so the diff script indexes correctly.
   - The `npm pack --json` output shape is `[0].files[].path`.
   - The SDK names used in 8b exist with the stated semantics: `waitFor` throws `ActionFailedError` on timeout
     (page.ts:358).

   Executable.

## Verdict: APPROVE

There are no BLOCKER or MAJOR findings, and all 10 review-5 findings are resolved in the text. Two are only partial:
- #1: the guard and branch wording contradict each other (finding A);
- #3: the S4-BLOCKED path is not covered (finding B).

Recommended before the steps that use them:
- fold A into S6b before it starts;
- fold B into S11 and S8 before any BLOCKED outcome;
- fold C into S10;
- fold D into S6c.

E is cosmetic.

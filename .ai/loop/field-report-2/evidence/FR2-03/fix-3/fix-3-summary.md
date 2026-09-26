# FR2-03 fix-3 summary (2026-09-25)

Fix cycle 3 of 4. Structural fixes for GAP-188 and GAP-189 per decisions.md's "FR2-03 audit-3"
entry. No narrow patches — both changes widen the underlying principle so the whole failure
class is closed, not just the literal reported scenario.

## GAP-188 — unify read-failure and parse-failure into one "unreadable" outcome

`packages/cli/src/sessions.ts`, `scanStateFiles`. Previously `stat`/`readFile` throwing hit a
`catch { continue }` that silently DROPPED the session, falling through to the old dead-owner
default elsewhere. Only a successful read that then failed to *parse* got the protected
`unreadable` status. Now there is exactly one code path: `stat` failing for any reason other
than ENOENT (file genuinely doesn't exist — skipped, not an error), `readFile` failing, or
`parseCliState` failing, all set the same `ioFailed`/`!parsed` condition and produce the same
`unreadable`, protected `ScannedSession` record. A real ENOENT on `stat` (ordinary: most
directories under `stateRoot` don't have a `state.json` at all) is still skipped silently — that
case was never the bug.

Live-verified against audit-3's exact repro (`state.json` held open with `FileShare.None` on an
ordinary, live, default-state-root session): `f3-gap188-locked-state-real.mjs` → `doctor --gc`
real run produces 0 actions, Chrome stays alive, profile dir intact, state file intact.

Own extra bypass attempts:
- `f3-mybypass1-eisdir.mjs`: `state.json` is itself a directory (stat succeeds, `readFile`
  throws `EISDIR` — a different OS error code than the lock repro's `EBUSY`). Result: `unreadable`,
  0 actions — confirms the unification isn't keyed to one specific errno.
- `f3-mybypass2-midwrite-race.json`: real concurrent writer (76k tight writes/30s) racing a real
  CLI session + `doctor --gc --dry-run` in a loop — 4-8 real race hits per 26-30 dry runs, 0 runs
  ever planned to kill the live Chrome or delete its profile.

## GAP-189 — the marker mechanism can only ADD protection, never authorize deletion

`packages/cli/src/sessions.ts` (`scanStateFiles`/`buildSessionsSnapshot` now tag every scanned
session `viaMarker: boolean` — true only when a state-file path's SOLE discovery route was
`discoverMarkerStateFiles` reading some OTHER process's command line, as opposed to the trusted
`stateRoot` directory scan or this process's own `extraStateFiles`/`SUTRADHAR_CLI_STATE_DIR`).
`packages/cli/src/gc.ts` (`collectGcSnapshot` now passes `discoveredStateFiles` as
`markerStateFiles`, kept structurally separate from trusted `extraStateFiles`; `planGc`'s pass-1
session loop gates its ONLY action-producing branch — the `stale` fallthrough that pushes
`clearState`/`deleteDir` actions and seeds `pendingStaleDirDeletes` — behind `if (s.viaMarker) {
protect and continue; }`, placed BEFORE the two action-pushing lines).

This is a structural change, not a new heuristic: a `viaMarker` entry's content (attacker-shaped
or not) can never reach the two lines that produce a `clearState`/`deleteDir` action, because
control flow `continue`s out of the loop iteration first. It can only ever add to
`referencedPids`/`referencedDirs`/`kept` — the same protection every other non-actionable status
already gets. GAP-175's legitimate use case (a live `SUTRADHAR_CLI_STATE_DIR` session, itself
only discoverable via its own marker once its owning CLI has exited) is unaffected: it still
classifies `live` and is protected exactly as before, since only the `stale` branch's behavior
changed.

Live-verified against audit-3's exact repro (`gap184-bypass.mjs`, both cases A and B — a plain
`node` process forging `--user-data-dir`/`--sutradhar-state` substrings, targeting a foreign
`state.json` with an attacker-chosen `profileDir` pointing at an unrelated, grace-protected young
dir): `f3-gap189-bypass.mjs` → 0 real actions, target file/parent dir/young dir/carrier dir all
still exist after a real `doctor --gc` run. Re-ran twice for determinism; identical result both
times (`f3-gap189-final-confirm.json`).

Own extra bypass attempt: unit tests in `packages/cli/tests/unit/gc.spec.ts` ("GAP-189
(FR2-03 fix-3, structural)") construct a `viaMarker: true` stale session with a FULLY
attacker-shaped payload (parseable sessionId/endpoint, profileDir aimed at a victim dir) directly
against `planGc` (bypassing the CLI/OS/process-enumeration layer entirely, attacking the pure
decision function itself) — 0 actions. A control test with the IDENTICAL payload but
`viaMarker: false` confirms the gate is keyed on `viaMarker`, not accidentally suppressing every
stale action.

Residual, accepted, non-destructive surface (documented honestly, not hidden): a `viaMarker`
entry can still be used to ADD spurious protection (e.g. forge a marker pointing at some
unrelated orphan dir to keep GC from ever reclaiming it). This is a griefing/denial-of-cleanup
vector, not a deletion-authorization vector — by construction it can only ever prevent an action,
never cause one, so it's outside GAP-189's scope (which was specifically about deletion
authorization) and consistent with the project's existing "when in doubt, protect" philosophy
(GAP-185/191 accept the same kind of trade-off). Also accepted: a genuinely stale
marker-sourced session (e.g. real `SUTRADHAR_CLI_STATE_DIR` session whose Chrome exited without a
clean `close`) no longer self-cleans via this path; it stays protected forever. Both are
documented in `gc.ts`'s inline comment at the `viaMarker` check.

## Regression re-verification (all live, all PASS)

- GAP-175 (`f3-gap175-regression.mjs`): live SUTRADHAR_CLI_STATE_DIR session still protected via
  marker discovery from a separate GC invocation with no env var set. PASS.
- GAP-176 (`f3-gap176-regression.mjs`): a real orphan CLI browser + its profile dir (with a
  child process still referencing the same `--user-data-dir` at snapshot time) still correctly
  killed and reclaimed in the same run. PASS — confirms the fix-3 changes didn't over-protect.
- GAP-183: no code in the PPID-chain walk (gc.ts pass 3, lines ~330-393) was touched by fix-3 at
  all. Re-ran the full Done-when scenario (below) and the full unit suite (both include GAP-183
  coverage) rather than the expensive standalone PID-reuse hunt (`f3-gap183-ppid-hunt.mjs`, which
  spawns thousands of processes hunting for real PID reuse) — that hunt was started but timed out
  under this session's tool time budget without a hit; logged honestly rather than claimed. No
  code-level reason to expect a regression since the region is byte-for-byte unchanged.
- Done-when live-proof scenario (`f3-donewhen.mjs`, an adapted copy of audit-3's own
  `a3-donewhen.mjs`, 25 independent cases): 25/25 PASS, 0 leftover processes under the scratch
  root. Ran twice (`f3-donewhen-run2-stdout.txt`) for determinism.

## Revert-and-confirm (both structural changes)

Each structural change was manually reverted in place, the full CLI vitest suite re-run to
confirm the NEW regression test for that exact gap fails (and nothing else does), then restored
and re-verified byte-identical via sha256:

- `f3-revert-mutation1-gap189.txt`: reverting the `viaMarker` gate in `gc.ts` → the new GAP-189
  "zero actions" test fails with a real `clearState` action instead of `undefined`. 1 failed |
  163 passed.
- `f3-revert-mutation2-gap188.txt`: reverting the unified read/parse-failure handling in
  `sessions.ts` → the new GAP-188 EISDIR test fails (`scanned` is `[]` instead of length 1,
  silently dropped). 1 failed | 163 passed.
- `f3-pre-mutation-sha.txt` / `f3-post-mutation-restore-sha.txt`: sha256 of both files before any
  mutation and after both mutations were reverted — byte-identical (same two hashes, order
  differs only because the two `sha256sum` invocations listed the files in a different order).

## Full verification (real numbers)

- Typecheck (`f3-typecheck.txt`): `packages/browser`, `packages/cli`, `packages/mcp-server` —
  all clean, 0 errors.
- vitest, every touched package, real run:
  - `@sutradhar/cli`: 164 passed (156 pre-existing + 8 new: 3 in `gc.spec.ts`, 5 in
    `sessions.spec.ts`) — `f3-vitest-cli.txt`.
  - `@sutradhar/browser`: 302 passed (unchanged) — `f3-vitest-browser.txt`.
  - `@sutradhar/mcp-server`: 84 passed (unchanged) — `f3-vitest-mcp-server.txt`.
- Real build (`f3-build.txt`): `turbo run build --filter=@sutradhar/browser
  --filter=@sutradhar/cli --filter=@sutradhar/mcp-server --force` — 14/14 tasks successful.

## GAP-190 / GAP-191 (time permitting)

- GAP-190 (weak test coverage for GAP-183's own logic): NOT attempted this cycle — all available
  time went to making the two mandatory structural fixes land cleanly (including their own new,
  real regression coverage) and re-verifying every prior gap live. Left explicitly for a future
  cycle rather than rushed.
- GAP-191 (permanently-corrupted state blocks cleanup forever): NOT implemented, deliberately
  deferred — it interacts directly with GAP-188's now-unified `unreadable` path (the auditor's
  suggested rule, "unparsable AND last-modified >120s ago is safe to reclaim," would need to
  reach into the exact code this cycle just restructured), and this cycle's mandate was explicit
  about not destabilizing the two structural fixes. Safer to let audit-4 exercise the
  restructured GAP-188/189 code in isolation first.
- GAP-192: untouched, per instructions (pre-existing, out of scope for this item).

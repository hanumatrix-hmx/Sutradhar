# fix-4 revert-and-confirm

Each mutation was applied directly to `packages/cli/src/gc.ts` via the Edit tool, `vitest run
tests/unit/gc.spec.ts` was run, the failure was captured below verbatim, then the exact original
edit was restored (byte-identical -- confirmed by the full 172/172 suite passing again
immediately after each restore).

## M1: revert GAP-193's Puppeteer-dir fix (restore `!dir.ownerFile && !dirsWithKilledBrowser.has(norm)` gate and the `dirsWithKilledBrowser.has(norm) || ownerDead === true` delete condition)

Result: 2 failed / 38 (gc.spec.ts)
- `G9: ... Puppeteer dir deleted` -> got `reason: 'orphan-browser'` instead of the fixed `'owner-dead'`
- `GAP-193: an UNOWNED (no .sutradhar-owner.json) Puppeteer dir is never deleted ...` ->
  `expected { type: 'deleteDir', ...(3) } to be undefined` -- the mutation let the forged carrier
  delete the unowned dir again.

## M2: revert GAP-193's grace-period reordering (move the `dirsWithKilledBrowser` check back before `withinGrace`)

Result: 1 failed / 38 (gc.spec.ts)
- `GAP-193: a YOUNG dir (mtime=now) stays grace-protected ...` ->
  `expected { type: 'deleteDir', ...(3) } to be undefined` -- the young victim dir was deleted
  again, bypassing grace.

## M3: revert GAP-194's legacyProbes consultation (remove the `else if (legacyProbes?.[...] === true)` branch entirely, falling straight to kill)

Result: 1 failed / 38 (gc.spec.ts)
- `GAP-194: a legacy unmarked CLI dir past grace is PROTECTED (unknown-liveness) ...` ->
  `expected { type: 'kill', pid: 703, ...(4) } to be undefined` -- the reachable legacy Chrome was
  killed again despite its DevToolsActivePort answering.

All three mutations were caught by tests added in this round (none by a pre-existing test alone),
and all three were restored to the exact fixed form afterward -- confirmed by the full suite
(172/172) passing again immediately after each restore, and by the final `git diff` against this
round's own start containing only the intended fix, not a leftover mutation.

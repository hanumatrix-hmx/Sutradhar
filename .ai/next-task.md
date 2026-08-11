---
State Category: Operational / Session
Next Task ID: TASK-UX-OVERHAUL-P6
Upcoming Epic: Frontend UX Overhaul (Neumorphic Soft UI + multi-day execution history)
Upcoming Work Package: Phase 6 Onboarding & settings honesty (docs/UX_OVERHAUL_PROMPT.md §7)
Upcoming Checkpoint: first-run state + health chip + honest settings + shortcuts help; typecheck/test green
---

# Queued Next Task

## Task Description

Phase 5 (Multi-day history) is DONE 2026-08-09 and verified live. Delivered
(for context — do not redo):

- Canonical `RunRecordDto` in `@pinchtab/contracts` (`dto/run-dto.ts`);
  server is the single source of truth.
- `RunRepository` (`apps/server/src/application/run-repository.ts`): one
  JSON per run at `runs/<runId>.json` on `LocalFileStorage`; write at
  START, update at END (failed/cancelled included); indefinite retention —
  the 10-min eviction only bounds the in-memory SSE frame buffer; records
  survive restarts (verified live).
- Runs API: `GET /api/v1/runs?sessionId=&status=&from=&to=` (live runs
  merged over storage, newest first), `GET /api/v1/runs/:runId` full
  record (memory → file), `DELETE /api/v1/runs/:runId` (404/409/200),
  `GET /api/v1/storage/files/:key`; gateway gained `ApiRouter.parseQuery`.
- Frontend: localStorage = cache only; boot reconciliation settles stale
  `running` runs from server records; History page (`/#/history`,
  day-grouped, search + status chips) + run detail (`/#/history/:runId`,
  trace/answer/export/open-session/re-run/delete-behind-confirm-modal);
  session page "Past runs" strip from the server list.
- Honest attribution: `provider` = `FallbackLlmProvider.activeProviderId`;
  `model` left undefined rather than fabricated.

Do not regress: no fabricated state; hover changes elevation, never
visibility; DELETE is never silent (confirm modal); one backend session
per UI session.

Next: execute **Phase 6 — Onboarding & settings honesty** from
[docs/UX_OVERHAUL_PROMPT.md](../docs/UX_OVERHAUL_PROMPT.md) §7 (target
lifecycle §6 items 1–2; E1–E3 in §3; backend ask §8.1). Steps:

1. First-run state + persistent backend-health chip:
   - First launch (no sessions ever): calm onboarding surface per §6.1 —
     backend health check; offline = calm full-screen Soft-UI state with
     Retry; online = detected provider chip + one obvious goal intake.
   - Persistent health chip (global, e.g. rail or topbar): backend
     reachable + provider name from `GET /api/v1/agents/status`; offline
     state honest, with Retry. Never fake "connected".
2. Settings honesty (E2): Settings shows backend-reported provider/model
   (requires a small backend extension — `/api/v1/agents/status` currently
   returns only `agentId/name/state`; add detected provider id from
   `FallbackLlmProvider.activeProviderId` and version; model only if the
   provider can truthfully report one). Non-functional controls removed or
   clearly labeled; keep working prefs (theme, approvals/auto-start).
3. Shortcuts help popover + ⌘K discoverability (§7.3): existing shortcuts
   documented in a soft popover (trigger in rail/topbar + ⌘K itself);
   only list shortcuts that actually exist — never fabricated.
4. Optional carry-in (PROB-006, found in Phase 5 live verification):
   screenshot-poll head-of-line blocking — abort in-flight
   `/browser/screenshot` requests on unmount/route change (AbortController),
   serialize to max 1 concurrent, back off on repeated 503. Small,
   frontend-only; improves the History-navigation UX.

## Prerequisites

- Backend on :8081 — running the Phase-5 dist (storage-backed runs + SSE
  live). Frontend dev server: :3001 (3000 in use).
- `pnpm typecheck` and `pnpm test` green before and after the phase.
- Server e2e TEST 2 (live github.com + local LLM) can time out under
  concurrent benchmark load; re-run `tests/integration/e2e.spec.ts` alone
  before treating it as a real failure.
- Seed data in `.pinchtab-storage/runs/` (the `sess_p5_smoke` run) — leave
  in place; useful for History regression checks during Phase 6.

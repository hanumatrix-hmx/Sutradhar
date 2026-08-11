# Sutradhar Frontend UI/UX Overhaul — Master Prompt

> **Purpose**: This is the standing instruction set for the Sutradhar frontend
> rework. The backend (real ReAct agent loop, real browser sessions, real
> LLM providers) works; the frontend experience around it is currently
> unusable and visually dated. This document is the single source of truth
> for what to fix, why, in what order, and what "done" means.
> Read it fully before touching any file.
>
> **Design language**: Neumorphism / "Soft UI" (modern soft-skeuomorphism).
> Reference study: `C:\Users\Varad M\AppData\Roaming\Qoder\SharedClientCache\cache\images\db625ad5\i1k1x2dx-1cf03efb.png`
> ("Soft UI Shadow Study"). Shadow recipes below are taken from that image.

---

## 1. Mission

Turn Sutradhar into a tool a user can actually operate — create a goal, watch
the agent work live, intervene, get the answer, and **come back days later
and still find every execution** — wrapped in a modern, futuristic Soft-UI
shell: floating soft panels, inset/raised surfaces, smooth spring motion.

### 1.1 The Servant Model — things come to the user

The user never "goes to" the tool; the tool brings everything to the user.
The user orders a meal; a chef cooks it; a servant serves it — the user
just eats. Concretely: answers, errors, approvals, status changes, history
and actions are *delivered* to where the user already is. The user never
navigates, hunts, or remembers to check anything. **Every design decision
is tested against this doctrine before shipping.**

**Priority order: UX (lifecycle) > UX (feedback/honesty) > Design system
(Soft UI + motion) > History persistence > UI polish > anything else.**
Capabilities, SDK/CLI usage, VS Code integration, embedding into other
software are **out of scope** — but keep `runtime/api/client.ts` clean so
they can be added later.

## 2. Ground Truth (verified 2026-08-09)

- Frontend: `packages/frontend` — React 18 + Vite, custom in-memory router
  (`src/app/router.tsx`), hand-rolled UI kit `src/components/ui`, styles in
  `src/styles/*.css` (`pt-` BEM + heavy inline styles).
- Backend: `apps/server` — REST under `/api/v1/*` (`sessions`, `browser/*`,
  `agents/goals`, `agents/status`, `storage/files`). Default port **8081**;
  Vite dev server proxies `/api` (`vite.config.ts`).
- `POST /api/v1/agents/goals` is **synchronous** — no streaming, no WS feed
  to the frontend (PROB-003). `executeGoal(goal)` takes only the goal
  string: not bound to the frontend session nor the backend browser
  session; the agent drives its own internal browser.
- Backend auto-detects the LLM provider from server env; frontend Settings
  provider selection never reaches the backend.
- Persistence today: sessions live only in browser `localStorage`.
  Backend has `LocalFileStorage` (`@sutradhar/storage`) exposed via
  `POST/GET /api/v1/storage/files` (list only — **no GET-by-key yet**).
- Build: `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm dev`.
  Hexagonal rules in `.ai/architecture-rules.md` apply.

## 3. Verified Problem Inventory

### A. Lifecycle broken end-to-end (highest priority)

- **A1 — No visible execution, no cancel.** "Run Agent" blocks on
  `executeGoal()`; UI looks frozen on long goals. No abort, no timer, no
  step stream.
- **A2 — Hidden auto-run via magic string.** `SessionPage` auto-triggers
  the agent when a timeline entry contains `"[Backend] Real browser
  session"`. Invisible, uncontrollable.
- **A3 — Results are ephemeral.** Answer/steps live in component state;
  navigate/reload → gone. **Nothing survives days; barely survives minutes.**
- **A4 — Transport errors become a login modal.** Backend launch failure
  sets `status: 'paused'`; `AuthPromptModal` opens on `paused` → a network
  error presents as "enter email/password". The credential form must be
  removed entirely; resume = "I handled it / Retry".
- **A5 — Session/agent/browser not linked.** No run id, no way to re-run,
  continue, or know which run produced which answer.
- **A6 — No real terminal states.** `completed` only via manually ticking
  fabricated tasks; real agent outcomes never transition the session.

### B. Dishonest / fabricated state

- **B1** Fake initial progress (10%/40%). **B2** Fabricated timeline
  entries at creation. **B3** Boilerplate auto-tasks driving the progress
  bar. **B4** URL regex-guessing with silent `google.com`/GitHub fallback.
- Rule: **show only backend-sourced or user-sourced state.**

### C. Viewport & interaction

- **C1** 1.5 s screenshot polling; click mapping hardcoded to 1280×800;
  typing via a separate "⌨️ Type into Viewport" bar; Enter simulated.
- **C2** Contradictory iframe fallback (third-party `allorigins.win` proxy
  for google/github) shows a *different page* than the backend browser.
- **C3** Silent `catch {}` on every interaction — user acts, nothing
  happens, no feedback.
- **C4** Polling dead-end message with no recovery button.

### D. Persistence, routing, reconciliation

- **D1** In-memory router: refresh loses route; no deep links; no
  back/forward.
- **D2** localStorage sessions never reconciled with backend; stale
  "active" sessions after server restart.
- **D3** Delete is local-only; `client.ts deleteSession` matches no route.
- **D4 — No execution history at all.** There is no store, view, or API
  for past runs. After days (or a refresh), executions are unrecoverable.

### E. Onboarding, settings honesty, global status

- **E1** No first-run experience. **E2** Settings that lie (provider/model
  saved locally, ignored by backend; "E2E Verification" only pings status).
  **E3** No global backend-health indicator.

### F. Information architecture & visual (pre-redesign)

- **F1** Home is a stats dashboard for zero-session users. **F2** New
  session demands Title+Goal, jargon labels, no URL field. **F3** Rail
  ignores its own `onOpenNewSessionModal` prop; dots cap at 6. **F4** Emoji
  as functional icons; hype copy. **F5** BEM CSS vs inline-style
  split-brain; light-theme fallbacks inside dark surfaces. **F6** Error
  boundary "Reset & Reload" wipes settings, mislabeled. **F7** Answer
  buried under a button in the dock.

### G. Visual era is wrong (user directive)

- **G1** Flat 2018 dashboard aesthetic; hard 1px borders; no depth system;
  no motion language; feels "1998". User wants modern/futuristic: floating
  widgets, soft depth, rich transitions.
- **G2** No design-token-driven shadows/elevation; elevation is ad-hoc
  `boxShadow` strings and `zIndex` numbers.
- **G3 — Fetch-style UX.** The user must navigate to everything (separate
  pages for history/settings/downloads), remember to press Run, remember
  to check status, and hunt errors in a hidden console. Nothing is ever
  delivered; the user does all the work. Violates the Servant Model (§1.1).

## 4. Design Language — Neumorphic Soft UI

The entire shell (layout, components, states, motion) is rebuilt in this
language. Not a skin over the old layout — structure changes too.

### 4.1 Core principles

1. **One neutral canvas per theme.** Light: `#E5E5E5`. Dark: `#23272E`
   (same recipe, dimmed values). Surfaces are *the same color as the
   canvas*; depth comes only from shadow pairs.
2. **Every element is physical.** States map to physics:
   - `raised` (buttons, cards, rail, dock): dual drop shadows.
   - `inset/pressed` (inputs, wells, active toggles, pressed buttons):
     dual inner shadows.
   - `nested` (viewport stage, trays): outer element inset, inner element
     raised (the "Combination" square in the study).
   - `flat` (disabled, quiet text rows): minimal or no shadow.
3. **Light comes from top-left.** Light shadow always negative offset,
   dark shadow positive offset. Never a single black drop shadow.
4. **No hard borders.** `border: none` on soft surfaces; separation via
   shadow and spacing. (1px hairlines allowed only inside data-dense
   tables if ever needed — prefer spacing.)
5. **Rounded geometry.** Radius scale: 12 / 16 / 20 / 28; pills for
   floating bars and chips.
6. **Color is semantic, not structural.** One brand accent (soft indigo
   `#5B6CFF` family) + semantic success/warn/danger used only on dots,
   chips, progress, focus rings — never as large fills.

### 4.2 Shadow tokens (from the reference study)

Light theme (canvas `#E5E5E5`):

```
--pt-soft-canvas:        #E5E5E5;
--pt-soft-is-light:      rgba(255,255,255,0.64);  /* inner,  blur 18, -12 -12 */
--pt-soft-is-dark:       rgba(13,39,80,0.20);     /* inner,  blur 18, +12 +12 */
--pt-soft-ds-light:      rgba(255,255,255,0.70);  /* drop,   blur 19, -10 -10 */
--pt-soft-ds-dark:       rgba(44,42,51,0.36);     /* drop,   blur 20, +10 +10 */

--pt-shadow-raised:  -10px -10px 19px var(--pt-soft-ds-light),
                      10px 10px 20px var(--pt-soft-ds-dark);
--pt-shadow-raised-sm: -5px -5px 10px var(--pt-soft-ds-light),
                        5px  5px 10px var(--pt-soft-ds-dark);
--pt-shadow-inset:   inset -12px -12px 18px var(--pt-soft-is-light),
                      inset  12px  12px 18px var(--pt-soft-is-dark);
--pt-shadow-inset-sm: inset -6px -6px 10px var(--pt-soft-is-light),
                       inset  6px  6px 10px var(--pt-soft-is-dark);
```

Dark theme (canvas `#23272E`): same geometry, values
`ds-light rgba(255,255,255,0.05)`, `ds-dark rgba(0,0,0,0.55)`,
`is-light rgba(255,255,255,0.04)`, `is-dark rgba(0,0,0,0.60)`.

Elevation levels: `raised-sm` (chips, small buttons) → `raised`
(cards, dock, rail) → `raised-lg` (modals, palette: blur 30/34, offset
±14). Pressed/active = corresponding `inset`.

### 4.3 Structure & floating widgets

- **Floating rail**: detached pill column, 12px off the left edge,
  vertically centered, `raised` surface, soft circular buttons; active
  button is `inset`. Session dots become soft avatar chips.
- **Browser stage**: `nested` tray — outer inset well, inner raised
  viewport card. Omnibar is a **floating pill** overlaid at the top of the
  stage (address input is an inset well inside the raised pill).
- **AI dock**: floating rounded panel with 12px margins, `raised-lg`,
  drag handle to resize, spring height animation; collapses to a soft bar.
- **Agent status orb**: floating circular widget bottom-right over the
  stage — idle (flat), thinking (soft pulse ring), running (animated
  conic ring), paused (amber), done (success dot). Click opens the dock.
- **Command palette / modals / toasts**: floating soft cards, inset
  inputs, raised buttons; toasts are soft pills top-center.
- **Home**: action-first hero — big inset goal well ("What should the
  agent do?"), raised Run button, recent sessions as raised cards,
  history link. Stats demoted to a quiet row.
- **History view** (§5.3): day-grouped soft cards; run detail is a
  floating panel with the full step trace.
- Density toggle later if wanted; default is comfortable.

### 4.4 Motion system

- Easing: `--pt-ease-soft: cubic-bezier(0.22, 1, 0.36, 1)` (soft out);
  spring-like enter `cubic-bezier(0.34, 1.56, 0.64, 1)` for floating
  widgets only.
- Durations: micro 140–180ms (shadow morphs, hover), panel 260–340ms
  (dock, overlays), page 380–450ms (route cross-fade + 8px rise).
- **Shadow morphing is the interaction language**: hover = raise one
  level; `:active` = inset; toggle-on = inset; focus = soft accent ring
  (`0 0 0 3px color-mix(accent 25%)` + raised-sm).
- Floating widgets enter with `translateY(10px) scale(.98) → settle` +
  shadow bloom; exit reversed.
- Live feedback: skeleton shimmer (soft, not gray bars — inset wells with
  moving highlight), pulsing orb while running, step rows slide-in.
- Viewport refresh cross-fades frames (opacity 120ms) instead of hard swap.
- `prefers-reduced-motion`: collapse all to opacity-only 120ms.
- No animation on data the user is reading (no layout thrash on lists).

### 4.5 Typography & iconography

- System stack or one variable font; weights 400/550/650; letter-spacing
  relaxed on small caps labels.
- Single inline-SVG icon module `components/ui/icons.tsx`; stroke 1.5,
  round caps; **zero emoji in controls**; icons sit in soft circular wells
  when actionable.

### 4.6 Servant surfaces (push, not fetch)

- **Universal goal intake**: the home hero well, ⌘K palette, and the orb
  all accept a goal. Type it and everything else happens — session
  created, browser launched, run started.
- **Visible auto-start**: the run begins the moment the backend is ready
  (default), with a prominent `Running — Stop` state; a settings toggle
  switches to manual start. This replaces both the old hidden auto-run
  magic and the dead "now press Run" friction.
- **Answer delivery**: on completion a floating answer card slides in
  over the workspace with Copy / Export / Re-run / Continue actions. The
  dock timeline is the archive, not the delivery mechanism.
- **Error & approval delivery**: inline soft cards at the point of cause
  plus a global queue badged on the orb. Every card carries its actions
  (Retry / Approve / Deny / Edit). The user never opens a log to find out
  something went wrong.
- **Overlays, not destinations**: History, Settings, Downloads open as
  floating drawers/sheets above the current context. Full pages exist
  only as deep-link targets.
- **Contextual actions**: hover/selection reveals inline actions on
  session cards, run rows, notes, steps; right-click soft context menus;
  ⌘K lists *actions* first, navigation second.
- **Auto-derived metadata, visibly correctable**: title from goal, start
  URL as an editable chip, suggested follow-ups after a run — always
  shown, always editable in place, never silent.
- **Navigation-free switching**: ⌘Tab-style floating session switcher;
  rail chips; the orb tooltip always shows the latest answer snippet, so
  the last result is one glance away from anywhere.

## 5. Execution History — Accessible After Many Days

### 5.1 Run record (single schema, server is source of truth)

```
RunRecord { runId, sessionId?, goal, startUrl?, status:
  running|completed|failed|cancelled, startedAt, endedAt?, durationMs?,
  provider, model, steps: [{n, reasoning, actionName, observation,
  success, errorMessage?, at}], answer?, summary?, exportedAt? }
```

### 5.2 Backend asks (additive)

- `POST /api/v1/runs`, `GET /api/v1/runs?sessionId=&status=&from=&to=`,
  `GET /api/v1/runs/:id`, `DELETE /api/v1/runs/:id` — backed by
  `LocalFileStorage` (one JSON file per run under a `runs/` prefix).
- `GET /api/v1/storage/files/:key` (currently missing).
- `agents/goals` accepts optional `sessionId` and returns `runId`;
  SSE `GET /api/v1/runs/:runId/events`; `POST /api/v1/runs/:runId/cancel`.
- Retention: **indefinite**; no auto-purge. Frontend never deletes
  silently (confirm dialog).

### 5.3 Frontend behavior

- Every run (including failures/cancels) is written server-side at start
  and updated at end; localStorage is cache only.
- **History page** (rail entry + `/history`): grouped Today / Yesterday /
  date headers, search + status filter, each card shows goal, status dot,
  duration, model, relative date ("3 days ago").
- **Run detail**: full step trace, answer panel, export (copy/markdown),
  "Open session" if the session still exists, "Re-run goal" button.
- Session page lists its past runs; opening an old session never errors —
  detached sessions show a soft "Relaunch" state.
- Deep links: `/#/history`, `/#/history/:runId`, `/#/session/:id` all
  refresh-safe.

## 6. Target Lifecycle (the experience we build)

1. **First launch** → backend health check; offline = calm full-screen
   Soft-UI state with Retry. Online = detected provider/model chip;
   action-first home.
2. **Create** → goal is the only required field (inset well); title and
   URL auto-derived as editable chips; honest `preparing` while backend
   browser launches; failure = error card with Retry delivered on the
   spot (never a login modal).
3. **Run** → starts automatically when ready (visible auto-start); orb
   pulses; live step feed; viewport updates; elapsed timer; **Stop**
   always available.
4. **Intervene** → manual drive with immediate feedback; approvals come
   to the user as approve/deny soft cards wherever they are.
5. **Finish** → real `completed|failed|cancelled`; answer in a
   first-class panel; persisted server-side instantly.
6. **Days later** → History shows the run; detail renders full trace and
   answer; re-run or export in one click.

## 7. Execution Plan (ordered phases)

Run `pnpm typecheck` + `pnpm test` after each phase; update
`.ai/known-problems.md` as items close.

### Phase 0 — Stop the bleeding (correctness, old skin acceptable) — DONE 2026-08-09

1. Decouple `AuthPromptModal` from `paused`; real `error`/`detached`
   states; remove credential form.
2. Replace hidden auto-run with the Servant Model default: visible,
   controllable auto-start (run begins when backend ready; prominent
   Stop; settings toggle for manual start).
3. Persist run results into the session model (local first).
4. Surface all viewport errors; reconnect/relaunch buttons.
5. Router ↔ `history` sync (deep links, refresh, back/forward).
6. Real backend delete + boot reconciliation; mark detached sessions.
7. Delete fabricated data (B1–B4).

### Phase 1 — Soft UI design system & layout rebuild — DONE 2026-08-09

Delivered via token remap: `styles/soft.css` loads last and remaps the
existing `--pt-*` namespace (shadows, radii, easing, both themes, light
default), so the whole UI kit inherits the soft language; targeted overrides
for flat-era behaviors; `components/ui/icons.tsx` single icon module; agent
status orb + floating answer delivery card in SessionPage; action-first
Home hero with direct goal intake.

1. New tokens file (`styles/soft.css` replacing theme/tokens): §4.2
   shadows, radii, easing, both themes; delete old ad-hoc shadows.
2. Rebuild UI kit components (Button, Card, Input, Modal, Toast, Tabs,
   Badge, Progress, Spinner→soft pulse) in the physical state language.
3. Rebuild layout per §4.3: floating rail, nested browser stage, floating
   omnibar + dock, status orb, palette/modals/toasts.
4. Motion pass per §4.4 on every interactive element.
5. Icons module; purge emoji; typography pass.
6. Home + Sessions + Settings restyled action-first.
7. Servant surfaces per §4.6: universal goal intake, floating drawers
   replacing page hops, contextual inline actions, ⌘Tab switcher.

### Phase 2 — Execution UX — DONE 2026-08-09

Delivered: `agents/goals` accepts optional `sessionId` and returns server-
assigned `runId` (linked into the persisted RunRecord as `serverRunId`);
real status machine `preparing → ready → running → completed|failed|
cancelled → archived` derived from facts (`deriveSessionPhase`) and shown in
the topbar badge + orb states; honest wall-clock run timer (client-measured,
backend `durationMs` preferred when present); first-class **Result** dock tab
(answer, duration, steps, server run id, Copy/Export/Re-run); floating answer
and error cards at the point of cause. Live per-step streaming deferred to
Phase 4 (SSE) — until then the UI says so honestly instead of faking progress.

1. Run linkage (`runId`, `sessionId` through the goal endpoint).
2. Execution surface: timer, live steps, Stop (client abort now, server
   cancel when available), orb states.
3. Real status machine: `preparing → ready → running →
   completed|failed|cancelled → archived`.
4. First-class answer/result panel; export actions live there.
5. Push delivery: floating answer card on completion; error/approval
   cards at point of cause; global action queue on the orb.

### Phase 2.5 — Soft UI visibility & consistency hardening — DONE 2026-08-09

User report: “many things are not visible unless I hover”. Root causes found
and fixed before Phase 3:

1. **Blank-icon bug (root cause)**: `makeIcon` in `components/ui/icons.tsx`
   cloned stroke props onto top-level children only; `React.Children.map`
   does not descend into fragments, so every multi-path icon (Layers, Search,
   Download, Settings, Copy, Refresh, Globe, Lock, …) rendered with
   `stroke: none` = invisible. Fix: stroke/strokeWidth/linecap/linejoin now
   live on the `<svg>` and inherit into all descendants.
2. **WCAG cheat-sheet values applied** (1.4.3 text ≥ 4.5:1, 1.4.11 non-text
   ≥ 3:1, measured against the real canvas luminance):
   - Light ink ladder on `#E5E5E5`: primary `#232833` (12.6:1), secondary
     `#4f5765` (5.5:1), tertiary `#5f6673` (4.6:1 — was `#939aa8` at 2.25:1).
   - Dark ink ladder on `#23272E`: secondary `#aeb5c2`, tertiary `#8f96a3`
     (5:1 — was `#5d6572` at 2.55:1).
   - Semantic inks are now text-safe AND white-fill-safe: success `#0d6f3b`,
     warning `#b26205`, danger `#b92f2f` (each ≥ 4.5:1 on canvas and ≥ 6:1
     under white text). `--pt-brand-primary` `#4553d4` (4.9:1 on canvas,
     6.1:1 under white) is the button/brand fill; `--pt-soft-accent`
     `#5B6CFF` is graphics-only (rings, spinner, dots).
   - Status/idle dots raised to ≥ 3:1 (`--pt-ai-idle` 0.28→0.50 light,
     0.22→0.40 dark). Structural alphas (rail divider, separators, timeline
     track) raised 0.16–0.20 → 0.28–0.32.
   - Doctrine now written into soft.css: hierarchy comes from size + weight,
     never from fading ink below 4.5:1; hover changes elevation, never
     visibility.
3. **Consistency**: Settings verification banners converted from hard 1px
   borders + off-palette Tailwind tints to the soft dialect (semantic dim
   backgrounds + inset wells).

Verified live: rail glyphs compute `stroke: rgb(79,87,101)` and are visible
at rest; typecheck 28/28; frontend tests 29/29.

### Phase 3 — Viewport honesty — DONE 2026-08-09

1. Backend browser is the only source; remove iframe/allorigins.
2. Real coordinate mapping from screenshot dimensions; optimistic click
   highlight; error toasts.
3. Adaptive polling (fast while running, slow idle, pause when hidden);
   frame cross-fade.

Delivered 2026-08-09:

- `EmbeddedBrowser` rewritten: iframe/allorigins branch deleted; viewport is
  a double-buffered stack of real backend PNGs (prev frame base + keyed top
  frame with 180 ms cross-fade). Clicks map through `img.naturalWidth/Height`
  with `object-fit: contain` letterbox math → true backend coordinates,
  optimistic ripple at the click point, danger toasts when input is not
  delivered. Adaptive polling: 900 ms while loading/agent-active, 3000 ms
  idle, paused on `document.hidden`, instant refresh on visibility return.
  After 5 consecutive screenshot failures polling stops with a warning toast
  + soft Reconnect pill (generous threshold: startup provisioning races
  404/503 legitimately).
- **One backend session per UI session** (the real stale-frame root cause):
  previously the viewport, the session store and the agent loop each spawned
  their own backend browser session, so the frame never followed the agent.
  Now the UI session id is passed to `POST /api/v1/sessions` and to
  `agents/goals`; `BrowserSessionManager.createSession` is idempotent for
  caller-supplied ids (incl. in-flight coalescing); the agent loop reuses the
  caller's live session and only closes sessions it created; the frontend
  `BrowserSession` no longer auto-launches a competing session; screenshot /
  eval requests omit the frontend-guessed tabId so the backend's own active
  tab is the source of truth.
- Tab strip + omnibar now sync from `GET /api/v1/sessions/:id`
  (`BrowserSession.syncFromServer`) on every poll — agent-side navigation
  shows up honestly instead of the fabricated local mirror.

Verified live: agent goal navigates the shared session; frame, address bar
and tab title all show example.com after the run; single sessionId across
sessions/goals/screenshot requests; no `/browser/launch` call; click ripple
works. Typecheck 28/28; frontend 29/29, agent 30/30, browser 21/21, server
28/28 green.

### Phase 4 — Live progress & cancel (backend SSE) — DONE 2026-08-09

Delivered:

- **Async runs API**: `POST /api/v1/runs` returns a server-assigned `runId`
  immediately; `GET /api/v1/runs/:runId` exposes state/result; the runId is
  the loop's goalId, so run, events and result share one identifier.
- **SSE stream** `GET /api/v1/runs/:runId/events`: `started` / `step` /
  `result` frames produced only by the real loop (`onStep` sink → replayable
  frame buffer → replay-on-connect + live fan-out, heartbeat, terminal frame
  closes the stream). Gateway gained honest streaming support
  (`NodeHttpResponse.stream/writeChunk/endStream`); buffered JSON routes
  untouched.
- **Live steps are also real domain events**: the loop publishes
  `agent:step:executed` per step into the EventBus (persisted history).
- **End-to-end Stop**: `POST /api/v1/runs/:runId/cancel` aborts the loop's
  `AbortSignal`. Cancellation is honored at step boundaries AND mid-turn
  (in-flight LLM call / action abort); contracts gained an honest
  `'cancelled'` terminal status; cancelled runs preserve exactly the steps
  executed before Stop.
- **Frontend**: SessionPage now streams steps into the dock and timeline as
  they happen (`appendTimeline`), the Stop button hits the cancel endpoint
  (no more client-only abort), cancelled is a first-class terminal state with
  no error card, EventSource reconnects lose nothing (server replays).
- Optional WS feed for browser events: intentionally not built — poll-driven
  viewport sync already shows honest state; add only if polling proves costly.

Verified live (Browser agent): steps render one-by-one while the badge still
says Running; Stop settles into "Cancelled · N steps" with no error surface;
network shows only runs/start + SSE + cancel (zero `/agents/goals`, zero
`/browser/launch`); timeline gains real "Agent: …" entries. Typecheck 28/28;
frontend 29/29, agent 30/30, browser 21/21, server 28/28 green.

### Phase 5 — Multi-day history — DONE 2026-08-09

1. Backend runs endpoints (§5.2) on `LocalFileStorage`.
2. Write-through run records from the frontend run lifecycle.
3. History page + run detail + re-run/export (§5.3).
4. Session page "Past runs" strip.

Delivered:

- **Canonical run record**: `RunRecordDto` in `@sutradhar/contracts`
  (`dto/run-dto.ts`) — single schema, server is source of truth
  (runId, sessionId?, goal, status, startedAt/endedAt/durationMs,
  provider?, model?, steps, answer?, summary?, error?, result?).
- **Storage-backed runs**: `RunRepository` (`apps/server/src/application/
  run-repository.ts`) — one JSON per run at `runs/<runId>.json` on
  `LocalFileStorage`. `RunManager` writes at START (crash leaves an honest
  `'running'` record) and updates at END incl. failed/cancelled; retention
  is INDEFINITE — the 10-minute eviction now only bounds the in-memory SSE
  frame buffer, persisted records survive restarts. Honest attribution:
  `provider` = `FallbackLlmProvider.activeProviderId` (the chain link that
  actually served the run); `model` left undefined rather than fabricated.
- **Runs API**: `GET /api/v1/runs?sessionId=&status=&from=&to=` (newest
  first, live runs merged over storage), `GET /api/v1/runs/:runId` returns
  the full record (memory → file fallback), `DELETE /api/v1/runs/:runId`
  (404 missing / 409 still running / 200 `{runId, deleted:true}`),
  `GET /api/v1/storage/files/:key` for raw record access. Gateway gained
  query-string parsing (`ApiRouter.parseQuery`).
- **Frontend**: localStorage is cache only; boot reconciliation settles
  locally-`running` runs from server records (unknown → honest `failed`,
  "Run interrupted — the server has no record of it."). History page
  (`/#/history`, rail clock entry): day-grouped soft cards (Today /
  Yesterday / date) with status dot, duration, provider, relative time;
  search over goal+answer; status chips. Run detail (`/#/history/:runId`,
  refresh-safe): full step trace, answer panel with Copy, Export
  (markdown), Open session (only when the session exists locally),
  Re-run goal, Delete behind a confirm modal (never silent). Session page
  "Past runs" strip fed by `listRuns({sessionId})`, rows deep-link into
  History.

Verified live (Browser agent): rail → History shows the persisted seed run
under Today; detail renders 2-step trace + answer "Example Domain"; deep
link survives fresh navigation; a new UI run writes through and appears in
both the Past-runs strip and History; delete confirms via modal and removes
the record server-side. Typecheck 28/28; build 16/16; full `pnpm test`
green (the known e2e TEST 2 concurrent-load flake re-ran 5/5 alone).

### Phase 6 — Onboarding & settings honesty

1. First-run state + persistent backend-health chip.
2. Settings shows backend-reported provider/model; non-functional
   controls removed or labeled; keep working prefs (theme, approvals).
3. Shortcuts help popover; ⌘K discoverability.

## 8. Minimal Backend Asks (consolidated)

1. `/agents/status` → detected provider + model + version.
2. `agents/goals` accepts `sessionId`, returns `runId`.
3. `GET /api/v1/runs/:runId/events` (SSE) + `POST .../cancel`.
4. Runs CRUD + `GET /api/v1/storage/files/:key`.
5. Real `DELETE /api/v1/sessions/:id`.

If an ask is unavailable: ship the frontend behavior with a clearly
marked degraded path. **Never fake it.**

## 9. Non-Goals

- New capabilities (workflows/memory UI, DAG view) — later.
- VS Code / SDK / embedding — later.
- Mobile layouts (don't break ≥1024px). Multi-user/app auth.

## 10. Definition of Done

- First-time user: understands within 5s, runs a goal, watches progress,
  stops it, reads the persisted answer — no docs.
- **Zero-navigation primary flows**: goal → run → answer happens on one
  screen; secondary surfaces are overlays; nothing requires the user to
  remember to check it (Servant Model, §1.1).
- **Days later, every execution is one click away** with full trace.
- No fabricated state; every shown value has a real source.
- Refresh/back/deep links work; server restart leaves truthful UI.
- Every action gives feedback <200ms; every failure visible + actionable.
- Soft-UI language applied end-to-end: both themes, all states, motion
  spec honored, `prefers-reduced-motion` respected.
- `pnpm typecheck` + `pnpm test` green; `.ai/known-problems.md` updated;
  no §3 finding open without an entry there.

## 11. Style Rules for Implementers

- File-header JSDoc blocks; `pt-` BEM classes; structural CSS in classes,
  inline only for dynamic values.
- No new runtime deps without justification; no third-party proxies.
- Comments explain *why*; keep honesty-first comments.
- Update `.ai/current-task.md` / `.ai/session-handoff.md` at session end.

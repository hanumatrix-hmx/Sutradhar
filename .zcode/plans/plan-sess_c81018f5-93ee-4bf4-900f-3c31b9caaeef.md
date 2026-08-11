# Wire frontend to real backend (zero mocks) + cleanup

## Directive recall
- **#3 (CRITICAL)**: Frontend must talk to the real backend. Nothing mock. Real browser, real agent, real LLM. Fail loud, never fabricate.
- **#4**: Cleanup accordingly.

## Root problems found
1. **`HttpBrowserTransport.send()` swallows ALL errors** — any fetch failure or non-2xx returns `{ok:false}` silently. Callers can't tell success from failure. This is the core enabler of the mock behavior.
2. **`ServerBrowserAdapter` falls back to fake SVG/PNG** when backend is offline — a hidden mock.
3. **Backend routes have mock fallbacks**: `screenshot` returns a hardcoded 1x1 PNG if no page; `goback/forward/cookies/downloads` return canned data without real work; routes ignore `tabId` and always use `getTabs()[0]`.
4. **No `MockBrowserAdapter` removal yet** — it must go (or be test-only), per "no mocks."
5. **No `.env` loading** — OpenRouter key / API base must work out of the box.
6. **No Vite dev proxy** — frontend (3000) → backend (8081) needs proxying or it's CORS-only and base URL is wrong (defaults to 3000).
7. **Frontend has agent UI (SessionPage AI Timeline, goal input) that's purely cosmetic** — never calls `/api/v1/agents/goals`.

## Plan (in dependency order)

### A. Make the transport honest + `.env` support
1. **Rewrite `HttpBrowserTransport.send()`** to `throw` on network error or non-2xx (with the body text in the message). Remove all the silent-fallback `console.log` instrumentation. Default base URL → `http://localhost:8081` (the real server port). Keep `VITE_API_BASE_URL` override.
2. **Add `.env` loading to the server**: read `.env` at repo root on boot (small parser, no dep) so `OPENROUTER_API_KEY`, `PINCHTAB_MODEL`, etc. just work. Create a `.env.example` (no secrets).

### B. Remove mock fallbacks (backend honesty)
3. **Backend `browser-routes.ts`**:
   - `screenshot`: if no page/tab, return HTTP 503 with a clear error instead of a fake PNG.
   - Honor `tabId` (look up the specific tab, not `getTabs()[0]`) across navigate/screenshot/eval/etc.
   - `goback`/`goforward`: implement via `page.goBack()`/`goForward()` (Puppeteer supports these); 503 if no page.
   - `cookies`: use `page.cookies()`; `downloads`: honest "not yet tracked" empty list (real, not canned) or 503. I'll implement cookies for real; downloads return a truthful empty array with a note it's not yet wired (no mock data).
4. Add a `GET /api/v1/browser/snapshot/:sessionId/:tabId` route returning the real DOM semantic graph + visible text, so the frontend can show what the agent sees (reuses `DOMSemanticEngine` + `formatGraphForLlm`). This is the "agent vision" surface.

### C. Real frontend adapter + remove mocks
5. **Rewrite `ServerBrowserAdapter`**: every method calls the backend and propagates errors (no SVG/PNG/text fallbacks). Remove the `screenshotData.includes(...)` hack. `subscribeEvents` stays but emits only real backend events (no synthetic ones).
6. **Delete `MockBrowserAdapter`** from production code path. Keep the file but mark it test-only (`__tests__`/mock export) OR delete outright — per "no mocks" I'll **delete it** and fix the 2 unit tests that used it to use a real test-only stub (clearly named, in the test file, not shipped).
7. **`BrowserRuntime`/`BrowserSession`/stores**: ensure they construct `ServerBrowserAdapter` (not mock) and that connection errors surface to the UI (toast/error state), not swallowed.

### D. Real agent UI wiring
8. **`SessionPage` + goal input**: wire the goal form to `POST /api/v1/agents/goals` via a small typed client (`packages/frontend/src/runtime/api/agentClient.ts`). Show the returned status/answer.
9. **`AITimeline`**: render the real step trace from the agent result (each step's action + observation + success). No fabricated sample data — empty state when nothing has run.
10. **Remove `sampleSessions.ts`** mock data from the sessions list; the list fetches real sessions from `GET /api/v1/sessions`.

### E. Dev ergonomics
11. **Vite dev proxy**: add `server.proxy['/api'] → http://localhost:8081` so dev mode (Vite 3000) hits the backend transparently (no CORS friction, correct base URL).
12. **One-command dev**: document `pnpm --filter @pinchtab/server dev` + `pnpm --filter @pinchtab/frontend dev` (or add a root `concurrently` script).

### F. Cleanup (#4)
13. **Fix frontend pre-existing type errors** (the 14 errors from earlier: `TextArea` re-export, `BadgeVariant 'info'`, `ProgressProps`, unused imports, `import.meta.env` typing) so the frontend typechecks clean too.
14. **Trim theater**: archive/remove the empty/aspirational packages listed in README (`knowledge`, `prompt`, `registry`, `plugin`, `orchestrator`, `queue`, `runtime`, `tools`, `ui`, `sdk` if empty) — move to `_archive/` or delete. Align README package list with what really exists.
15. **Update `.ai/` docs** to reflect the real frontend↔backend wiring and removed mocks.

### G. Verify (no mocks in the chain)
16. Build frontend + backend; typecheck both clean.
17. Run unit tests (gate the frontend adapter test on a live backend, like the server tests).
18. **Live proof**: start backend + frontend, open the UI, submit a real goal, watch the real agent drive real Chrome and show the real trace in the AI Timeline. Capture a screenshot of the UI showing real data.

## What I will NOT do (scope discipline)
- Not building new agent capabilities (memory/RAG) in this pass — that's #2, decided separately after.
- Not redesigning the frontend UI/UX — only making it real (wired, no mocks). Visual polish is later.
- Not touching the agent loop itself (already real and verified).

## Risk
- The frontend's `IBrowserAdapter` contract is broad (15+ methods). Some backend routes don't fully implement every method yet (downloads, cookies). I'll implement what's needed for the core loop (launch/navigate/screenshot/eval/snapshot) for real, and make the rest honest (real or a clear "not supported" 503) — never a canned mock.
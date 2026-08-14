---
name: dashboard-verify
description: Build and run the real Sutradhar dashboard (apps/server + packages/frontend) locally, then drive it through Sutradhar's own browser.* MCP tools to live-verify a specific fix or behavior, then tear down cleanly. Use whenever a fix touches packages/frontend or apps/server and needs more than a typecheck/unit-test pass — this project's standing verification bar (CLAUDE.md) requires actually driving the running app, not just compiling it.
user-invocable: true
---

# /dashboard-verify — actually run the dashboard and drive it, don't just typecheck it

This repo's standing rule (`CLAUDE.md`): "typechecking is necessary, not sufficient... verify
by actually driving the fix through Sutradhar's own tools against a real target." For a
frontend/backend fix, that means the real dashboard has to actually be running while you poke
it — a passing `tsc --noEmit` proves the code is well-typed, not that the button does the
right thing when clicked.

Arguments passed: `$ARGUMENTS` — what to verify (e.g. "PROB-007 fix: empty Goal shows an
inline error"). If empty, ask what specifically needs verifying before starting servers for no
reason.

## 1. Build what you're about to run

```bash
cd apps/server && npx tsc
```

`pnpm` is not reliably available in this environment — use `npx tsc` directly per package
rather than assuming a root `pnpm build` will work. The frontend doesn't need a separate build
step for dev mode (Vite serves from source).

## 2. Start the backend

```bash
cd apps/server
node dist/runtime/bootstrap.js > <scratchpad>/server.log 2>&1 &
sleep 3
tail -30 <scratchpad>/server.log
```

Look for `[ServerApp] Sutradhar REST API Gateway running at http://127.0.0.1:8081` in the log
before proceeding — if it's not there, read the rest of the log for the real startup error
rather than assuming the port is just slow.

## 3. Start the frontend

Port 3000 has been occupied by an unrelated project on this dev machine before (a different
Next.js app). Don't assume it's free — check first, and fall back to an explicit port:

```bash
cd packages/frontend
npx vite --port 3055 --strictPort > <scratchpad>/frontend.log 2>&1 &
sleep 4
cat <scratchpad>/frontend.log   # confirm "ready in" and the real Local URL before proceeding
```

If 3055 is also taken, pick another and pass `--strictPort` again — `--strictPort` fails fast
on a conflict instead of silently picking a random port you'd then have to discover.

## 4. Drive it via Sutradhar's own MCP tools

`browser.launch` against the real frontend URL, then exercise the exact scenario named in
`$ARGUMENTS` — `browser.snapshot`/`browser.click`/`browser.type` etc., the same way an actual
user would. Confirm the specific behavior (an inline error appears, a session gets created and
navigated to, a toast fires) via a fresh `browser.snapshot` after each action, not just by
trusting the click's own `success: true` — that only confirms the click landed, not that the
app responded the way you expect.

Also re-verify the adjacent happy path, not just the bug scenario — a fix that solves the
reported case but breaks the normal one is not actually done (see PROB-007's fix: confirmed
both the empty-Goal error message AND that a real goal still creates and navigates to a
session).

## 5. Tear down

```bash
for port in 8081 3055; do
  pid=$(netstat -ano | grep ":$port" | grep LISTENING | awk '{print $5}' | head -1)
  [ -n "$pid" ] && taskkill //F //PID "$pid"
done
```

Don't leave these running past the verification — they'll silently occupy the ports for the
rest of the session and confuse the next person (or the next `/dashboard-verify` run) who
tries to start them.

## 6. Report what you actually saw

State the exact before/after observed through the MCP tools (a quoted snapshot line showing
the inline error text, a URL that changed to `/session/<id>`, etc.) — not "verified the fix
works." A future reader (including you, next session) should be able to tell from the report
alone what was actually checked, not just that a checkmark was made.

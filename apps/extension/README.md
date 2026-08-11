# PinchTab Browser Extension

Drive your **real, logged-in browser** with an AI agent. This extension connects Chrome to
the PinchTab runtime, so the agent can operate on sites behind your SSO/2FA — the use case
headless Chrome cannot reach.

> **Status: MVP.** The engine's attach mode is built and verified. The extension UI is built.
> You (the user) need to test it in your real browser — that part can't be automated.

## How it works

```
┌──────────────┐      goal       ┌─────────────────┐    CDP attach    ┌─────────────────┐
│  Extension   │ ──────────────▶ │ PinchTab server │ ───────────────▶ │  Your Chrome    │
│  (this popup)│ ◀────────────── │  (port 8081)    │ ◀─────────────── │ (--remote-debug │
└──────────────┘     result      └─────────────────┘   snapshots/      │  ging-port=9222)│
                                       ▲  actions       clicks          └─────────────────┘
                                       │                                                 │
                                       └───────── LLM (Ollama/OpenRouter) ◀──────────────┘
```

The agent lives on the PinchTab server (which needs an LLM — see below). It **attaches** to
your Chrome over the DevTools Protocol and drives it. Your browser's cookies and login state
are the source of truth.

## Setup

### 1. Run the PinchTab server

From the monorepo root:

```bash
# Build everything (if not already built)
pnpm build

# Start the server (port 8081)
node apps/server/dist/runtime/bootstrap.js
```

For the agent to reason, it needs an LLM. The free path — install Ollama, then:

```bash
ollama serve          # in one terminal
ollama pull qwen3.5:9b   # once, to fetch the model
```

(Do NOT set `OPENROUTER_API_KEY`, or the server will prefer OpenRouter over local Ollama.)

### 2. Launch Chrome with remote debugging

The PinchTab server attaches to Chrome over CDP. You must launch Chrome with a debugging
port so it's reachable. **Fully quit Chrome first** (all windows), then relaunch with:

**Windows (PowerShell):**
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

**macOS:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

**Linux:**
```bash
google-chrome --remote-debugging-port=9222
```

> ⚠️ This uses your **normal Chrome profile** (with all your logins) — that's the point. But
> because CDP grants full control, only do this on a machine you trust, and close the
> debugging port when you're done (just quit and relaunch Chrome normally).

Verify it's reachable: open `http://127.0.0.1:9222/json/version` in any browser — you should
see a JSON response with a `webSocketDebuggerUrl`.

### 3. Load the extension

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the `apps/extension/` folder.
4. Pin the PinchTab icon to your toolbar.

### 4. Use it

1. Click the PinchTab icon. The popup should show **"connected"** (green) — this confirms the
   PinchTab server is reachable. If it says "no server", check the server is running.
2. In Settings, confirm the **debug port** matches what you launched Chrome with (default 9222).
3. Type a goal (e.g. *"On the current page, find the contact email"*) and click **Run goal**.
4. The agent attaches to your Chrome, reads the page, and works toward the goal.

## How attach differs from launch

| | `launch()` (headless) | `attach()` (this extension's path) |
|---|---|---|
| Browser | PinchTab spawns a fresh headless Chrome | PinchTab connects to **your** Chrome |
| Login state | None — clean profile | **Your** cookies/SSO/2FA |
| Where it runs | Server-side, scalable | Per-user, on your machine |
| Tabs | PinchTab owns them | Opens a new tab *in your browser* |
| Use case | Public sites, scraping, testing | Internal tools, Gmail, anything behind your login |

## What to test (since you're doing the real-browser verification)

When you load the extension, please check:

1. **Popup status shows "connected"** with the PinchTab server running.
2. **Settings save** (server URL + debug port persist after reopening the popup).
3. **A goal runs end-to-end**: type a simple goal, click Run, and confirm the agent attaches
   to your Chrome (you should see a new tab open / navigation happen) and returns an answer.
4. **Attach actually uses your login**: try a goal on a site where you're logged in (e.g.
   *"go to my Gmail inbox and tell me who the most recent email is from"*) — headless Chrome
   couldn't do this; attach can.

If anything fails, the most common issues are:
- Chrome not actually relaunched with `--remote-debugging-port` (must fully quit first).
- Port mismatch between Chrome's launch flag and the extension Settings.
- `http://127.0.0.1:9222/json/version` not returning JSON (Chrome isn't exposing CDP).

## Programmatic attach (without the extension UI)

The attach capability is in the `pinchtab` SDK too, for programmatic use:

```ts
import { PinchTabRuntime } from 'pinchtab';
const rt = new PinchTabRuntime();
const { sessionId } = await rt.attach({ endpoint: 'http://127.0.0.1:9222' });
await rt.navigate(sessionId, 'https://example.com');
```

And as an MCP tool (`browser.attach`) so an AI client (Claude Desktop, ZCode) can attach to
your browser and drive it.

## Future work (seamless path)

Today, Chrome must be launched with `--remote-debugging-port`. The seamless upgrade: use the
extension's `chrome.debugger` API to expose the active tab over CDP and relay frames to the
PinchTab server over a WebSocket — removing the launch-flag requirement entirely. That needs
a full CDP-bridge implementation in the background worker (multi-day work) and is the
documented next step for this surface.

The MVP also opens a **new tab** on attach rather than driving your *currently-active* tab.
Wrapping an existing tab (so the agent works on exactly what you're looking at) needs a
"adopt existing Puppeteer Page" capability in `BrowserSession` that doesn't exist yet —
tracked as a TODO in the substrate's `attach()` method.

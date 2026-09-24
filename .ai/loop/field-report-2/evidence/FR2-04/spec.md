# FR2-04: CLI dialogs (implementation spec)

**Item:** FR2-04 (Phase 1, a silent-wrongness and hang bug). A dialog opened by one CLI process stays open in the detached Chrome after that process exits. Later commands hang, or act on the wrong tab, with no report.

**Decisions in force:**
- §4.9: prefer additive and opt-in changes, the smallest diff, and consistency with the surrounding code.
- CLAUDE.md stealth boundary: no disguised page-primitive overrides (§0.5, D-1).
- MCP and SDK behavior stays unchanged. Only the CLI changes its default.

**Baseline read at:** HEAD `049a899` on `claude/field-report-2-loop`.
- `packages/browser/src/actions/browser-action-engine.ts` has **uncommitted FR2-01 fix-cycle edits** in the working tree right now (the GAP-010 `FAILURE_SCREENSHOT_TIMEOUT_MS`). Engine line numbers below are given at HEAD plus the symbol name. Re-anchor by symbol when implementing.
- Every other file is quoted at HEAD.

**Merge order:** FR2-01 → FR2-03 → FR2-04. FR2-04 is designed on top of FR2-03's *planned* shapes (§0.6).

**Puppeteer source root for citations:** `node_modules/.pnpm/puppeteer-core@25.5.0_yauzl@2.10.0/node_modules/puppeteer-core/src/`, written as `pp:` below. `packages/browser/node_modules/puppeteer-core` symlinks here.

---

## 0. Trace results

### 0.1 What happens today (code-grounded timeline)

| Flow | Path | Result |
|---|---|---|
| `sutradhar click "#alert"` | `cli.ts:309-316` → `runtime.click` → engine `verifiedClickOnHandle` (HEAD `:1455`). The engine races `handle.click` against 1500 ms (`:1519-1522`), then races the delivery-check `evaluate` against 1500 ms, which resolves `true` on timeout (`:1535-1540`). | Prints `Clicked #alert`. `.finally` then calls `disconnect()` (`cli.ts:958`). The 30 s `dialogTimeout` in `BrowserTab` (`browser-tab.ts:579-585`) is a **ref'd** `setTimeout`, so it holds the event loop open until the **unref'd** 3 s force-exit (`cli.ts:963`) kills the process. The timer dies with the process, and the dialog is **orphaned**. Wall time is about 3 s for the click plus up to 3 s of linger. |
| `sutradhar eval "alert(1)"` | `cli.ts:467-485` → `runtime.eval` (`runtime.ts:939-952`) → `page.evaluate` | Blocks until the in-process 30 s auto-dismiss (`browser-tab.ts:30`, `:579-585`) fires, then prints the result. This is the "~30 s" in the finding. |
| `sutradhar nav B` from a page with `beforeunload` | `tab.navigate` → `page.goto` (`browser-tab.ts:242`) | The in-process 3 s auto-accept (`:47`, `:577-585`) rescues it. That's the PROB-038 fix (`known-problems.md:446-452`). |
| Next command after an orphan | `withSession` (`cli.ts:92-147`) → `runtime.attach` (`runtime.ts:283-319`) → `findAllOpenPages` → `browser.pages()` (`runtime.ts:325-336`) | Predicted: Puppeteer page init waits on the blocked renderer until `protocolTimeout` (180 s), per C6 and C9. `findAllOpenPages` swallows that error and returns `[]`, so `attach` opens a **new blank tab** and the command runs against it silently. Alternatively, if `newPage` also blocks, `requirePage` throws inside `fn()` and the self-heal catch (`cli.ts:122-139`) **kills the live Chrome** (GAP-006). Step 1 case E3 measures which. |
| `sutradhar clickpoint x y` on an alert button | `runtime.clickAtPoint` (`runtime.ts:514-545`): `page.mouse.click` then `readTitle` (`:1776-1782`) | There's no dialog race, so `Input.dispatchMouseEvent` waits for the blocked renderer until the in-process 30 s dismiss (MCP has the same issue). |

Nothing tells the CLI caller that a dialog opened: no CLI code reads `getPendingDialog` (`runtime.ts:1495-1499`). MCP's `get_pending_dialog`/`handle_dialog` (`tools.ts:1451-1486`) work only because the MCP process is long-lived.

### 0.2 Puppeteer and CDP semantics (grounded)

| # | Claim | Grounding |
|---|---|---|
| C1 | A `Dialog` object exists only for `Page.javascriptDialogOpening` events received **on the page's own primary CDP session**. `#onDialog` wraps each event in a `CdpDialog` bound to that session and emits `PageEvent.Dialog`. Nothing is buffered, so a listener added later misses it. | `pp:cdp/Page.ts:337` (listener in `#setupPrimaryTargetListeners`, `:325`); `:996-1005` |
| C2 | `CdpDialog.handle` sends `Page.handleJavaScriptDialog` **on the session that received the event**. `handled` flips via `once('Page.javascriptDialogClosed')`. | `pp:cdp/Dialog.ts:18-43` |
| C3 | `accept()`/`dismiss()` set `handled = true` **before** sending. A rejected send (e.g. "No dialog is showing") leaves `handled` true, so `BrowserTab.getPendingDialog()` then returns `undefined` (`browser-tab.ts:422`). | `pp:api/Dialog.ts:100-119` |
| C4 | `puppeteer.connect` resolves without any renderer-side round trip. `TargetManager.initialize` sends browser-level `Target.setDiscoverTargets`/`setAutoAttach`. `#onAttachedToTarget` emits `Ready` **before** the renderer-side `Runtime.runIfWaitingForDebugger`, which is not awaited and has its errors swallowed. | `pp:cdp/TargetManager.ts:144-165`, `:431-452` |
| C5 | `browser.pages()` is `Promise.all(target.page())`, and `page()` is `CdpPage._create` → `#initialize`. One blocked page therefore blocks all of them. | `pp:cdp/BrowserContext.ts:55-72`, `pp:cdp/Target.ts:259-271`, `pp:cdp/Page.ts:118-124`, `:398-414` |
| C6 | Page init **awaits** `Page.enable`, `Page.getFrameTree`, `Page.setLifecycleEventsEnabled` and `Runtime.enable`, followed by `Page.createIsolatedWorld`. These are renderer-answered. | `pp:cdp/FrameManager.ts:226-265` |
| C7 | `target.createCDPSession()` is `Target.attachToTarget({flatten:true})`, which is browser-side, and doesn't initialize a `Page`. A session that never calls `Page.*` never emits or holds dialog events through Puppeteer. | `pp:cdp/Target.ts:122-130`, `pp:cdp/Connection.ts:297-315` |
| C8 | A `PageTarget` builds a `CdpPage` on its own only for popups whose opener page already exists. So a connection that never calls `page()`/`pages()` never runs page init. | `pp:cdp/Target.ts:232-256` |
| C9 | The default `protocolTimeout` is 180 000 ms. `BrowserLauncher.connect` passes nothing (`browser-launcher.ts:190`). A per-call override is available: `session.send(m, p, {timeout})`. | `pp:common/ConnectOptions.ts:129-134`, `pp:cdp/Connection.ts:67`, `pp:cdp/CdpSession.ts:92-95`, `pp:api/CDPSession.ts:60-62`, `pp:common/CallbackRegistry.ts:138-149` |
| C10 | `page.screenshot()` without a clip sends only `Page.captureScreenshot`. With a clip, it first calls `isolatedRealm().evaluate`, which is renderer-side and blocks. | `pp:cdp/Page.ts:1144-1192` |
| C11 | `/json/version` is served by the **browser process's** DevTools HTTP handler, not the renderer. FR2-03's `probeEndpoint` (FR2-03 spec §0.3) should therefore still report `reachable` while a dialog blocks a tab. | Chromium architecture (DevToolsHttpHandler lives in the browser process). Step 1 **E1.jsonVersion** verifies. |
| C12 | **Recalled from Chromium `content/browser/devtools/protocol/page_handler.cc`; not in this repo, so Step 1 decides.** `WebContentsImpl::RunJavaScriptDialog` hands the dialog callback only to PageHandlers that are **enabled at open time**. `PageHandler::HandleJavaScriptDialog` fails with `No dialog is showing` when its own pending callback is null. `PageHandler::Disable` (session detach) leaves the dialog to the embedder's `JavaScriptDialogManager` when one exists: full Chrome, including `--headless=new`, which the CLI uses (`spawn-chrome.ts:75`). I recall no replay of `javascriptDialogOpening` on `Page.enable`. | Not verifiable here. Step 1 cases E2, E4 and E7. |
| C13 | While alert/confirm/prompt is open, the renderer main thread sits in a synchronous dialog IPC. Renderer-dispatched commands (`Runtime.evaluate`, `Page.getFrameTree`, `Runtime.enable`, `Input.dispatch*` acks) queue until the dialog closes. Playwright documents the same: an unhandled dialog stalls actions. | Step 1 **E1.live0**, **E2.getFrameTree/runtimeEnable** |
| C14 | Chrome shows a `beforeunload` dialog only if the frame has sticky user activation. CDP `Input.dispatchMouseEvent`, which the engine's `handle.click` uses, grants it. `Runtime.evaluate` with no `userGesture` does not. PROB-038 saw the dialog about 110 ms after `page.goto`. | `known-problems.md:449-451`. Step 1 **E6/E6b** verifies. |
| C15 | `Page.addScriptToEvaluateOnNewDocument` scripts are scoped to the CDP session that added them and are removed on detach. | Step 1 **E9** |

**Prediction** (about 70% confidence; Step 1 decides):
- E1: `/json/version` answers; liveness is **blocked** and never recovers within 35 s.
- E2: a fresh `Page.enable` gets **no** `javascriptDialogOpening` event, and fresh `handleJavaScriptDialog` fails with `No dialog is showing`.
- E4: a session that was `Page.enable`d **before** the dialog opened **can** handle it after process A exits.
- The result would be **Branch W**.

### 0.3 Step 1: the experiment (runs before any FR2-04 code; results go to evidence)

**File:** `.ai/loop/field-report-2/evidence/FR2-04/step1-experiment.mjs`. The Orchestrator writes it verbatim.

**Run:** `pnpm build` first, then `node .ai/loop/field-report-2/evidence/FR2-04/step1-experiment.mjs [--headed] [--skip-slow]`.
- Run it in the background. It takes about 10 minutes, and E3 alone can take up to about 7.
- Run it once headless (the default, matching the CLI default). Then run `--headed --skip-slow` once as well.

**Outputs:**
- `step1-results.json` (every observation plus the decision)
- `step1-results.headed.json` (the headed run)
- the console log, redirected to `step1-log.txt`

```js
#!/usr/bin/env node
// FR2-04 Step 1 — what does a re-attaching process see when an earlier CLI process left a native
// dialog open? Runs against the CURRENT (pre-FR2-04) worktree build. Writes only into this evidence
// dir and an OS-temp scratch dir it creates and removes. The "observer" session (S.s) NEVER sends
// any Page.* method, so it never holds a dialog callback and cannot contaminate the result; Page.*
// is sent only on the dedicated B/C/F/H/I sessions, at the step that is testing exactly that.
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..');
const CLI = path.join(ROOT, 'packages/cli/dist/cli.js');
const puppeteer = createRequire(path.join(ROOT, 'packages/browser/package.json'))('puppeteer-core');
const HEADED = process.argv.includes('--headed');
const SKIP_SLOW = process.argv.includes('--skip-slow');
const OUT = path.join(HERE, HEADED ? 'step1-results.headed.json' : 'step1-results.json');
const results = [];
const note = (id, desc, observed, expected) => {
  results.push({ id, desc, expected, observed, at: new Date().toISOString() });
  console.log(`[${id}] ${desc}\n   -> ${JSON.stringify(observed).slice(0, 600)}`);
};
const nonce = (tag) => `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>fr2-04 step1</title></head><body>
<button id="alert">alert</button> <button id="confirm">confirm</button> <button id="prompt">prompt</button>
<button id="arm-bu">arm beforeunload</button><pre id="log"></pre>
<script>
const q = new URLSearchParams(location.search); const N = q.get('n') || 'none'; const KEY = 'fr2-04:' + N;
function rec(e) { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); e.seq = a.length + 1; e.t = Date.now();
  a.push(e); localStorage.setItem(KEY, JSON.stringify(a)); document.getElementById('log').textContent = JSON.stringify(a); }
if (q.get('landed')) rec({ kind: 'landed' });
document.getElementById('alert').onclick = () => { rec({kind:'alert',phase:'opening'}); const r = alert('s1 alert ' + N);
  rec({kind:'alert',phase:'returned',result: r === undefined ? '__undefined__' : String(r)}); };
document.getElementById('confirm').onclick = () => { rec({kind:'confirm',phase:'opening'}); const r = confirm('s1 confirm ' + N);
  rec({kind:'confirm',phase:'returned',result:r}); };
document.getElementById('prompt').onclick = () => { rec({kind:'prompt',phase:'opening'}); const r = prompt('s1 prompt ' + N, 's1-default');
  rec({kind:'prompt',phase:'returned',result:r}); };
document.getElementById('arm-bu').onclick = () => { addEventListener('beforeunload', (e) => { rec({kind:'beforeunload',phase:'fired'});
  e.preventDefault(); e.returnValue = 's1 unsaved'; }); rec({kind:'beforeunload',phase:'armed'}); };
const tk = q.get('timerKind'); const tm = Number(q.get('timerMs') || 0);
if (tk && tm) setTimeout(() => { rec({kind: tk, phase: 'opening', timer: true});
  const r = tk === 'alert' ? alert('s1 timer ' + N) : confirm('s1 timer ' + N);
  rec({kind: tk, phase: 'returned', timer: true, result: r === undefined ? '__undefined__' : r}); }, tm);
</script></body></html>`;

const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); res.end(FIXTURE); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/fx.html`;
const STATE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-04-step1-'));
const tmpBefore = new Set((await fs.readdir(os.tmpdir())).filter((n) => n.startsWith('sutradhar-cli-')));

async function timed(p, ms) {
  const t0 = Date.now(); let timer;
  try {
    const v = await Promise.race([p, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`__timeout_${ms}`)), ms); })]);
    return { status: 'resolved', ms: Date.now() - t0, value: v };
  } catch (e) {
    return { status: /__timeout_|timed out/.test(String(e?.message)) ? 'timeout' : 'rejected', ms: Date.now() - t0, error: String(e?.message).slice(0, 300) };
  } finally { clearTimeout(timer); }
}
const tsend = (s, m, p, ms) => timed(s.send(m, p, { timeout: ms }), ms + 500);
async function liveness(s, ms = 2000) {
  const r = await tsend(s, 'Runtime.evaluate', { expression: '1', returnByValue: true }, ms);
  return r.status === 'resolved' ? 'responsive' : r.status === 'timeout' ? 'blocked' : `error:${r.error}`;
}
async function pollLive(s, ms) { const end = Date.now() + ms; let l; do { l = await liveness(s, 1000); if (l === 'responsive') return l; } while (Date.now() < end); return l; }
async function pollBlocked(s, ms) { const end = Date.now() + ms; let l; do { l = await liveness(s, 800); if (l === 'blocked') return l; await delay(200); } while (Date.now() < end); return l; }
async function record(s, n) {
  const r = await tsend(s, 'Runtime.evaluate', { expression: `localStorage.getItem(${JSON.stringify('fr2-04:' + n)})`, returnByValue: true }, 3000);
  return r.status === 'resolved' ? JSON.parse(r.value.result.value ?? 'null') : r;
}
function cli(args, { capMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, SUTRADHAR_CLI_STATE_DIR: STATE_DIR }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '', killed = false;
    child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (err += d));
    const cap = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, capMs);
    child.on('exit', (code) => { clearTimeout(cap); resolve({ args, code, ms: Date.now() - t0, killedAtCap: killed, stdout: out.slice(0, 1500), stderr: err.slice(0, 1500) }); });
  });
}
const readState = async () => JSON.parse(await fs.readFile(path.join(STATE_DIR, 'state.json'), 'utf-8'));
const connect = (ws) => puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null, protocolTimeout: 20000 });
const pageUrls = (b) => b.targets().filter((t) => t.type() === 'page').map((t) => t.url());
async function waitForTarget(b, n, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const t = b.targets().find((x) => x.type() === 'page' && x.url().includes(n)); if (t) return t; await delay(100); }
  throw new Error(`no page target with ${n}`);
}
async function enableAndListen(session, listenMs) {
  const events = [];
  session.on('Page.javascriptDialogOpening', (e) => events.push({ ev: 'opening', type: e.type, message: e.message, defaultPrompt: e.defaultPrompt, t: Date.now() }));
  session.on('Page.javascriptDialogClosed', (e) => events.push({ ev: 'closed', result: e.result, t: Date.now() }));
  const enable = tsend(session, 'Page.enable', undefined, 3000);
  await delay(listenMs); // a bounded MEASUREMENT window for an event that may never come (absence is the observation)
  return { events, enable: await enable };
}
async function freshSession(tag, query = '') {
  await cli(['close'], { capMs: 30000 });
  const n = nonce(tag);
  const nav = await cli(['nav', `${BASE}?n=${n}${query}`, ...(HEADED ? ['--headed'] : [])], { capMs: 60000 });
  const st = await readState();
  const obs = await connect(st.wsEndpoint);
  const target = await waitForTarget(obs, n);
  const s = await target.createCDPSession(); // OBSERVER: Runtime.evaluate / Target.getTargetInfo only
  return { n, nav, st, obs, target, s, port: new URL(st.wsEndpoint.replace(/^ws/, 'http')).port };
}
async function recover(S) { // cleanup only: a browser-initiated reload is the one lever that exists under H1
  if ((await liveness(S.s, 800)) === 'responsive') return 'not-needed';
  const R = await connect(S.st.wsEndpoint); const t = await waitForTarget(R, S.n); const sr = await t.createCDPSession();
  const r = await tsend(sr, 'Page.reload', {}, 10000); await R.disconnect(); return { reload: r, live: await pollLive(S.s, 10000) };
}
const fetchT = (url, ms) => timed(fetch(url, { signal: AbortSignal.timeout(ms) }).then(async (r) => ({ status: r.status, body: (await r.text()).slice(0, 300) })), ms + 200);

try {
  note('E0.env', 'environment', { node: process.version, platform: process.platform, headed: HEADED, cli: CLI });

  // E1 + E2: orphan an alert, then probe it from fresh connections.
  {
    const S = await freshSession('e1');
    note('E0.browser', '/json/version', await fetchT(`http://127.0.0.1:${S.port}/json/version`, 3000));
    const click = await cli(['click', '#alert'], { capMs: 90000 });
    note('E1.click', 'process A: CLI click #alert', click, 'code 0, "Clicked #alert", 4-8 s');
    note('E1.jsonVersion', '/json/version while the dialog is open', await fetchT(`http://127.0.0.1:${S.port}/json/version`, 3000), 'HTTP 200 quickly (browser process)');
    note('E1.jsonList', '/json/list while the dialog is open', await fetchT(`http://127.0.0.1:${S.port}/json/list`, 3000), 'HTTP 200, lists the page');
    note('E1.live0', 'observer Runtime.evaluate(1)', await liveness(S.s, 2000), 'blocked');
    const samples = []; const until = Date.now() + 35000;
    while (Date.now() < until) { samples.push(await liveness(S.s, 2000)); await delay(500); }
    note('E1.window35s', 'liveness over 35 s after A exited', { anyResponsive: samples.includes('responsive'), samples: samples.length }, 'never responsive');

    const B = await connect(S.st.wsEndpoint); const tB = await waitForTarget(B, S.n); const sB = await tB.createCDPSession();
    const en = await enableAndListen(sB, 1500);
    note('E2.pageEnable', 'fresh session Page.enable: dialogOpening re-emitted?', { opening: en.events.filter((e) => e.ev === 'opening'), enable: en.enable }, 'no event; enable times out');
    note('E2.getFrameTree', 'Page.getFrameTree', await tsend(sB, 'Page.getFrameTree', undefined, 3000), 'timeout');
    note('E2.runtimeEnable', 'Runtime.enable', await tsend(sB, 'Runtime.enable', undefined, 3000), 'timeout');
    note('E2.navHistory', 'Page.getNavigationHistory', await tsend(sB, 'Page.getNavigationHistory', undefined, 3000), 'resolved');
    note('E2.targetInfo', 'Target.getTargetInfo', await tsend(sB, 'Target.getTargetInfo', undefined, 3000), 'resolved');
    const shot = await tsend(sB, 'Page.captureScreenshot', { format: 'png' }, 8000);
    note('E2.screenshot', 'Page.captureScreenshot', { status: shot.status, ms: shot.ms, bytes: shot.value?.data?.length, error: shot.error }, 'unknown: recorded');
    const C = await connect(S.st.wsEndpoint);
    note('E2.pagesInit', 'browser.pages() while the dialog is open', await timed(C.pages().then((p) => p.length), 15000), 'timeout (FrameManager.initialize)');
    await C.disconnect();
    const h = await tsend(sB, 'Page.handleJavaScriptDialog', { accept: true }, 3000);
    note('E2.handle', 'fresh session handleJavaScriptDialog(accept)', h, 'rejected "No dialog is showing"');
    const after = await liveness(S.s, 2000);
    note('E2.afterHandle', 'liveness after the fresh handle', after, 'blocked');
    if (after === 'responsive') note('E2.record', 'page record', await record(S.s, S.n), 'alert opening + returned');
    else {
      const sB2 = await tB.createCDPSession(); const en2 = await enableAndListen(sB2, 1500);
      note('E2.handle2', 'second fresh session enable+handle', { events: en2.events, h: await tsend(sB2, 'Page.handleJavaScriptDialog', { accept: true }, 3000), live: await liveness(S.s, 2000) });
      note('E2.reloadRecovery', 'browser-initiated Page.reload as recovery', { ...(await recover(S)), record: await record(S.s, S.n) });
    }
    await B.disconnect(); await S.obs.disconnect();
  }

  // E3: the REAL next CLI command against an orphaned confirm (slow: up to ~7 min).
  if (!SKIP_SLOW) {
    const S = await freshSession('e3');
    await cli(['click', '#confirm'], { capMs: 90000 });
    const before = { pid: S.st.chromePid, pages: pageUrls(S.obs), live: await liveness(S.s, 2000) };
    const snap = await cli(['snap'], { capMs: 420000 });
    let st1 = null; try { st1 = await readState(); } catch {}
    note('E3.snap', 'real CLI snap after an orphaned confirm', { snap, before, pidAfter: st1?.chromePid, selfHealed: before.pid !== st1?.chromePid, pagesAfter: S.obs.connected ? pageUrls(S.obs) : 'observer disconnected (chrome killed?)' },
      '~180 s hang (protocolTimeout), then a new blank tab OR self-heal kill');
    if (S.obs.connected) { note('E3.recover', 'cleanup', await recover(S)); await S.obs.disconnect(); }
  }

  // E4: a holder that was Page-enabled BEFORE the dialog opened (warden viability).
  {
    const S = await freshSession('e4');
    const H = await connect(S.st.wsEndpoint); const tH = await waitForTarget(H, S.n); const sH = await tH.createCDPSession();
    const evs = []; sH.on('Page.javascriptDialogOpening', (e) => evs.push({ type: e.type, message: e.message, defaultPrompt: e.defaultPrompt }));
    note('E4.enableBefore', 'holder Page.enable on a free page', await tsend(sH, 'Page.enable', undefined, 5000), 'resolved');
    note('E4.clickA', 'process A: click #confirm', await cli(['click', '#confirm'], { capMs: 90000 }));
    note('E4.event', 'holder saw dialogOpening', evs.slice(), '1 confirm');
    note('E4.blockedAfterA', 'observer liveness after A exited', await liveness(S.s, 2000), 'blocked');
    const h = await tsend(sH, 'Page.handleJavaScriptDialog', { accept: true }, 5000);
    const live = await pollLive(S.s, 5000);
    note('E4.handle', 'pre-enabled holder handles after A exited', { h, live }, 'resolved + responsive');
    note('E4.record', 'page record', live === 'responsive' ? await record(S.s, S.n) : null, 'confirm returned true');
    evs.length = 0;
    note('E4b.clickA', 'process A: click #prompt', await cli(['click', '#prompt'], { capMs: 90000 }));
    note('E4b.event', 'holder saw the prompt', evs.slice());
    await H.disconnect(); // every pre-enabled holder is now gone
    const F = await connect(S.st.wsEndpoint); const tF = await waitForTarget(F, S.n); const sF = await tF.createCDPSession();
    const enF = await enableAndListen(sF, 1500);
    note('E4b.handleAfterHoldersGone', 'fresh session after all holders detached', { events: enF.events, h: await tsend(sF, 'Page.handleJavaScriptDialog', { accept: true, promptText: 'x' }, 3000), live: await liveness(S.s, 2000) }, 'rejected, blocked');
    note('E4b.recover', 'cleanup', await recover(S)); await F.disconnect(); await S.obs.disconnect();
  }

  // E5: in-process eval baseline.
  { const S = await freshSession('e5'); note('E5.evalConfirm', 'CLI eval confirm()', await cli(['eval', "confirm('s1 eval')"], { capMs: 90000 }), '~30 s, prints false'); await S.obs.disconnect(); }

  // E6: beforeunload via CLI nav (activation via a real CLI click), without activation, and between commands.
  {
    const S = await freshSession('e6');
    note('E6.arm', 'click #arm-bu', await cli(['click', '#arm-bu']));
    const r = await cli(['nav', `${BASE}?n=${S.n}&landed=1`], { capMs: 90000 });
    note('E6.nav', 'nav away from a beforeunload page', { ...r, pages: pageUrls(S.obs) }, 'code 0, ~3 s extra, landed=1');
    note('E6.record', 'page record', await record(S.s, S.n), 'armed, fired, landed');
    await S.obs.disconnect();
  }
  {
    const S = await freshSession('e6b');
    await tsend(S.s, 'Runtime.evaluate', { expression: "document.getElementById('arm-bu').click()" }, 3000);
    note('E6b.noActivation', 'nav after arming WITHOUT a user gesture', await cli(['nav', `${BASE}?n=${S.n}&landed=1`], { capMs: 90000 }), 'fast; no dialog');
    note('E6b.record', 'page record', await record(S.s, S.n)); await S.obs.disconnect();
  }
  {
    const S = await freshSession('e6c');
    await cli(['click', '#arm-bu']);
    await tsend(S.s, 'Runtime.evaluate', { expression: `setTimeout(() => { location.href = ${JSON.stringify(`${BASE}?n=${S.n}&landed=1`)} }, 1500)` }, 3000);
    note('E6c.blocked', 'renderer-initiated nav with beforeunload, no CLI attached', await pollBlocked(S.s, 10000), 'blocked');
    const F = await connect(S.st.wsEndpoint); const tF = await waitForTarget(F, S.n); const sF = await tF.createCDPSession();
    const en = await enableAndListen(sF, 1500);
    note('E6c.fresh', 'fresh enable+handle(accept)', { events: en.events, h: await tsend(sF, 'Page.handleJavaScriptDialog', { accept: true }, 3000), live: await pollLive(S.s, 3000) });
    note('E6c.recover', 'cleanup', await recover(S)); await F.disconnect(); await S.obs.disconnect();
  }

  // E7: a timer dialog that opens while NO process is attached; E7b: a holder enabled before it fires.
  {
    const S = await freshSession('e7', '&timerKind=confirm&timerMs=6000');
    note('E7.blocked', 'timer confirm opened with nobody attached', await pollBlocked(S.s, 15000), 'blocked');
    const F = await connect(S.st.wsEndpoint); const tF = await waitForTarget(F, S.n); const sF = await tF.createCDPSession();
    const en = await enableAndListen(sF, 1500);
    note('E7.fresh', 'fresh enable+handle', { events: en.events, h: await tsend(sF, 'Page.handleJavaScriptDialog', { accept: true }, 3000), live: await liveness(S.s, 2000) }, 'same as E2');
    note('E7.recover', 'cleanup', await recover(S)); await F.disconnect(); await S.obs.disconnect();
  }
  {
    const S = await freshSession('e7b', '&timerKind=confirm&timerMs=6000');
    const H = await connect(S.st.wsEndpoint); const tH = await waitForTarget(H, S.n); const sH = await tH.createCDPSession();
    const got = new Promise((res) => sH.on('Page.javascriptDialogOpening', res));
    await tsend(sH, 'Page.enable', undefined, 5000);
    const ev = await timed(got, 15000);
    note('E7b.holder', 'pre-enabled holder receives and handles a timer confirm', { ev, h: await tsend(sH, 'Page.handleJavaScriptDialog', { accept: true }, 3000), live: await pollLive(S.s, 3000), record: await record(S.s, S.n) }, 'event, resolved, true');
    await H.disconnect(); await S.obs.disconnect();
  }

  // E8: is another tab responsive while tab 1 is blocked?
  {
    const S = await freshSession('e8'); const n2 = nonce('e8b');
    await cli(['newtab', `${BASE}?n=${n2}`]);
    const t2 = await waitForTarget(S.obs, n2); const s2 = await t2.createCDPSession();
    await tsend(S.s, 'Runtime.evaluate', { expression: "setTimeout(() => document.getElementById('confirm').click(), 0)" }, 3000);
    note('E8.tab1', 'tab 1 after a synthetic confirm', await pollBlocked(S.s, 5000), 'blocked');
    note('E8.tab2', 'tab 2 liveness', await liveness(s2, 2000), 'recorded');
    note('E8.recover', 'cleanup', await recover(S)); await S.obs.disconnect();
  }

  // E9: is Page.addScriptToEvaluateOnNewDocument session-scoped (decision 1c)?
  {
    const S = await freshSession('e9'); const I = await connect(S.st.wsEndpoint); const tI = await waitForTarget(I, S.n); const sI = await tI.createCDPSession();
    note('E9.add', 'addScriptToEvaluateOnNewDocument', await tsend(sI, 'Page.addScriptToEvaluateOnNewDocument', { source: 'window.__s1inj = 1' }, 5000));
    await I.disconnect();
    await cli(['nav', `${BASE}?n=${S.n}&after=1`]);
    note('E9.afterDetach', 'injected global after its session detached + new document', await tsend(S.s, 'Runtime.evaluate', { expression: 'String(window.__s1inj)', returnByValue: true }, 3000), '"undefined"');
    await S.obs.disconnect();
  }
} finally {
  await cli(['close'], { capMs: 30000 });
  server.close();
  const O = (id) => results.find((r) => r.id === id)?.observed;
  const O5 = O('E1.jsonVersion')?.status === 'resolved' && O('E1.jsonVersion')?.value?.status === 200;
  const O3 = O('E1.live0');
  const O1 = (O('E2.pageEnable')?.opening?.length ?? 0) > 0;
  const O2 = O('E2.handle')?.status === 'resolved' && O('E2.afterHandle') === 'responsive';
  const O8 = O('E4.handle')?.h?.status === 'resolved' && O('E4.handle')?.live === 'responsive';
  let branch;
  if (!O5) branch = 'STOP';
  else if (O3 === 'responsive') branch = O8 ? 'W' : 'X';   // the liveness probe can't detect a dialog, so detection must be event/holder based
  else if (O1 && O2) branch = 'D';
  else if (!O1 && O2) branch = 'D-hint';
  else if (O8) branch = 'W';
  else branch = 'X';
  await fs.writeFile(OUT, JSON.stringify({ decision: { branch, O1, O2, O3, O5, O8 }, results }, null, 2));
  console.log(`\nDECISION: branch ${branch}  (O1=${O1} O2=${O2} O3=${O3} O5=${O5} O8=${O8}) -> ${OUT}`);
  for (const name of await fs.readdir(os.tmpdir())) {
    if (!name.startsWith('sutradhar-cli-') || tmpBefore.has(name)) continue;
    for (let i = 0; i < 8; i++) { try { await fs.rm(path.join(os.tmpdir(), name), { recursive: true, force: true }); break; } catch { await delay(300 * (i + 1)); } }
  }
  await fs.rm(STATE_DIR, { recursive: true, force: true });
}
```

**Observation → decision tree.** The Orchestrator appends the chosen branch to `decisions.md` together with the evidence path.

| Outcome | Condition | Branch | Consequence |
|---|---|---|---|
| **STOP** | O5 false: `/json/version` doesn't answer while a dialog is open | none | FR2-03's `probeEndpoint` would classify a live session with a dialog as `unresponsive` or `stale`, so GC and self-heal could kill it. Escalate: add a dialog check to FR2-03's classification first, and log a blocker gap. |
| **D** | a fresh `Page.enable` re-emits the event (O1), and a fresh `handleJavaScriptDialog` works (O2) | Direct broker | No new process. The gate (§2.8) detects and handles over raw CDP. |
| **D-hint** | O1 false, O2 true | Direct broker with state-hint detection | Detection combines `lastPendingDialog` in state with the liveness probe. The type and message come from the state hint. With no hint, the gate reports `type:"unknown"`. |
| **W** (predicted) | O1 and O2 false, O8 true | Direct broker for detection, **plus the dialog warden** (§2.5) | A per-session helper process that is `Page.enable`d before dialogs open. It serves the `dialog` verb and applies the policy between commands. |
| **X** | O1, O2 and O8 all false | in-process only | Cross-process handling is impossible. The CLI resolves any pending dialog before it exits (§2.8.7), and the `dialog` verb switches to "arm" semantics. The Orchestrator records a Done-when deviation in `decisions.md`, gets an Auditor opinion, and marks the item DONE-with-deviation or BLOCKED per §6. |

**Secondary readings:**
- E3: if `selfHealed` is true, raise GAP-006 to **major** and mark it fixed-in FR2-04 (§2.8.3). If the command acted on a new blank tab, log GAP-017 (§7.3).
- E6b: if no dialog appeared without activation, confirm C14. The fixture's beforeunload cases then **must** arm through a real CLI `click`.
- E2.screenshot: if it resolved, `screenshot` could later be gate-exempt. That isn't done in FR2-04; only record it.
- E9: if the result is `"undefined"`, that confirms decision D-1's third reason (below).

### 0.4 Timing budgets (the constants used below)

| Constant | Value | Where |
|---|---|---|
| `GATE_CONNECT_TIMEOUT_MS` | 5000 | Direct-broker `puppeteer.connect` race |
| `GATE_LISTEN_MS` | 400 | window for re-emitted events (Branch D only) |
| `LIVENESS_TIMEOUT_MS` | 1000 | `Runtime.evaluate('1')` per page target |
| `WARDEN_HTTP_TIMEOUT_MS` | 500 | every warden call (Branch W) |
| `HANDLE_TIMEOUT_MS` | 5000 | `Page.handleJavaScriptDialog` |
| `VERIFY_UNBLOCK_MS` | 2000 | after a handle: the page must answer liveness within this |
| `DIALOG_POLL_MS` | 100 | in-process pending-dialog poll |
| `PREEMPT_GRACE_MS` | 250 | non-trigger verbs (§2.10) |
| `TRIGGER_PREEMPT_GRACE_MS` | 4000 | click-family verbs. Longer than the engine's own ≈3.0 s dialog race. |
| `WARDEN_READY_TIMEOUT_MS` / `WARDEN_POLICY_GRACE_MS` / `WARDEN_STATE_POLL_MS` | 3000 / 300 / 2000 | §2.5 |
| `CLI_DEADLINE_MS` | 300 000 default; `SUTRADHAR_CLI_DEADLINE_MS` overrides; `wait` uses `max(default, 3*timeoutMs + 30000)` | process watchdog (§2.8.6) |

**Worst case, a command blocked by a dialog:** about 1.9 s in the gate (connect + liveness + listen), plus process startup, then exit 3. A dialog that opens **during** a command is reported ≤ 250 ms after it opens, or ≤ 4 s for click-family verbs.

### 0.5 The decisions asked for

**D-1. Policy semantics.**
- Adopted in every branch: the policy applies (a) during a command's lifetime, in-process in `BrowserTab`, and (b) to dialogs that opened between commands, **on the next command's attach**, through the gate (§2.8.2).
- **Branch W only:** the warden also applies the policy between commands, with no waiting for a next command.
- **Rejected: the `Page.addScriptToEvaluateOnNewDocument` override** of alert, confirm and prompt:
  1. It changes page-observable semantics. `window.alert.toString()` is no longer native code, and pages can recover the native function from a fresh iframe's `contentWindow`. Getting "accept" reported while a real user agent never showed a dialog is false fidelity.
  2. It cannot cover `beforeunload`, which isn't a function call.
  3. The script is session-scoped (C15, verified by E9). It disappears when the CLI process detaches, so it fails for exactly the documents that load between commands, which is the gap it was meant to fill.
  4. Hiding the override from detection would be stealth work, which is out of scope per CLAUDE.md. Leaving it visible makes sites behave differently.

  Native CDP handling is honest: whatever Sutradhar reports is what Chrome actually did.

**D-2. Where the policy lives.**
- The mechanism is in `BrowserTab`: `DialogPolicy {mode:'auto'|'report'|'accept'|'dismiss', promptText?}`.
- A session default is set through `BrowserSession`/`BrowserSessionManager.createSession({dialogPolicy})`, with an optional `SutradharRuntimeOptions.dialogPolicy` and `runtime.setDialogPolicy`.
- The default is `'auto'`, which is today's behavior exactly (30 s dismiss; 3 s accept for beforeunload). **MCP and SDK are unchanged.**
- The CLI passes `'report'` or the persisted policy.
- FR2-14's `.sutradhar.json` `dialog` key maps straight onto `SutradharRuntimeOptions.dialogPolicy` for MCP and SDK, and onto the CLI default. CLI precedence will be: flag > persisted state > config > `report`.

**D-3. Reporting contract.**
- Human output: one extra stdout line per pending dialog, `dialogPending: <one-line JSON>`, plus a `Hint:` line on stderr. One `dialogHandled: <JSON>` line per dialog handled during the command.
- `snap --json`: extra keys `dialogPending` (the oldest, or `null`), `dialogsPending` (an array) and `dialogsHandled` (an array).
- **MCP action results are unchanged in FR2-04.** FR2-07 defines the unified result contract, and `dialogPending` belongs there, once. Logged as GAP-018.

**D-4. Timeouts and exit codes.**
- New exit code **3** means "blocked by or interrupted by an open dialog". 0 and 1 keep their current meanings.
- Every command is bounded three ways:
  - the gate, before it attaches;
  - an in-process pre-emption race, while it runs;
  - a process watchdog, for anything else.
- Exact texts are in §2.8.5.

**D-5. beforeunload.**
- `report` (the CLI default) keeps PROB-038's in-process 3 s auto-accept while a navigation is in flight. `nav` means "leave".
- `accept`: accepted immediately.
- `dismiss`: dismissed immediately, so `nav` fails with an explicit "cancelled by beforeunload" error (exit 1).
- A beforeunload that opens **between** commands (a page-initiated navigation) is gated and handled like any other dialog, with `dialog accept` letting the navigation proceed.
- Pre-emption ignores `beforeunload`, because it always resolves in-process within 3 s.

**D-6. Self-heal and the probe.**
- The gate runs **before** `runtime.attach`, outside the self-heal `try`, and throws only the typed `DialogBlockedError`.
- **FR2-04 also closes GAP-006.** Self-heal is limited to the attach phase, and `fn()` moves out of the `try` (§2.8.3). Dialogs raise the rate of `fn()` errors (a timer dialog during an eval, for example), so leaving `fn()` inside the `try` would make GAP-006 worse.
- `/json/version` is served by the browser process (C11, E1). FR2-03's `sessions`/GC therefore see a dialog-blocked session as `live` (§0.6 row 7).

**D-7. GAP-010 and the engine race.**
- FR2-04 doesn't rely on the screenshot cap: CLI pre-emption stops waiting first. GAP-010's 3 s cap (`FAILURE_SCREENSHOT_TIMEOUT_MS`, working tree `:103`, `:355-373`) still bounds MCP and SDK failure paths on a blocked page (C10).
- The engine's click race (`verifiedClickOnHandle`, HEAD `:1519-1540`) is untouched.
  - Under `accept`/`dismiss`, `BrowserTab` handles the dialog as soon as the event arrives, so `handle.click` resolves normally and the race never fires. Clicks get faster.
  - Under `report`, the race still returns within about 3 s with `success:true`. The delivery check times out to `true`, so there's no double click. `TRIGGER_PREEMPT_GRACE_MS` (4 s) is set above that, so the engine's own result wins in the normal case.

### 0.6 Touchpoints with FR2-03 (planned shapes)

| # | FR2-03 artifact | FR2-04 interaction |
|---|---|---|
| 1 | `CliState` gains `profileDir`, `profileDirOwned`, `cwd` and `createdAt` (FR2-03 §2.5) | FR2-04 adds `dialogPolicy` and `lastPendingDialog`. There's no key overlap. FR2-03's `parseCliState` must **return the parsed object whole**, not a picked subset. The Executor checks this and adds test ST-D1 (§4). |
| 2 | `spawnFreshSession` writes the new fields (FR2-03 §2.5) | FR2-04 adds `dialogPolicy` to the same object literal: the flag if given, otherwise **carried over from the old state on self-heal**. |
| 3 | Self-heal block → `releaseSessionResources` (FR2-03 §2.6) | FR2-04 moves the gate before the `try` and `fn()` after it (§2.8.3). This is the same function. Rebase onto FR2-03's version. |
| 4 | `cmdClose` rewritten (FR2-03 §2.6) | FR2-04: (a) before the profile-save `attach`, run the gate in close mode. If a dialog is pending and there's no policy, skip the save and warn (otherwise it would hang for 180 s, per C5/C6). (b) Branch W: stop the warden and delete `warden.json` **before** `clearStateFileIfUnchanged`. The warden must not hold the state dir open on Windows. |
| 5 | `KNOWN_FLAGS` and `gcFlagError` (FR2-03 §2.7) | Add `--dialog` and `--dialog-text` (valued) and a `dialogFlagError`, validated after `gcFlagError` in `main()`. |
| 6 | `sessions --json` exact key set (FR2-03 test S10) | FR2-04 adds **no** keys. S10 stays untouched. |
| 7 | `probeEndpoint` over `/json/version` (FR2-03 §0.3) | A dialog blocks only the renderer, so the session is classified `live` (C11, E1.jsonVersion). The live-verify case L11 asserts this with the real `sessions --json`. |
| 8 | GC attribution by `--user-data-dir` or markers (FR2-03 §2.8) | Warden processes (Branch W) have neither, so GC ignores them. They exit when their Chrome disconnects. The warden's `cwd` is `os.homedir()`, **never** a profile or state dir, so it can't hold a Windows lock (FR2-03 N13). |
| 9 | `clearStateFileIfUnchanged` removes only `state.json`, then `rmdir` if the dir is empty | `warden.json` (Branch W) keeps the dir, so `close` removes it explicitly. If the warden is already gone, it removed its own file on exit. |
| 10 | Force-exit timer and awaited cleanup (FR2-03 §0.7) | FR2-04's watchdog is armed at `main()` start and is unref'd. It is independent of the 3 s `.finally` timer. |

---

## 1. Files to touch

**Core** (every branch except X, which uses the §2.8.7 variant):

| # | File | Reason |
|---|---|---|
| 1 | `packages/browser/src/session/browser-tab.ts` | `DialogPolicy`, `DialogRecord`, the `setDialogPolicy`/`getDialogPolicy` pair, `getPendingDialogDetail`, `getDialogHistory`, and the `targetId` getter. The listener (`:547-586`) branches on the mode, and `'auto'` is unchanged. `handleDialog` (`:430-445`) records history. New `IBrowserTab` members are **optional**, because `dom-semantic-engine.spec.ts:166,183` builds `IBrowserTab` literals. |
| 2 | `packages/browser/src/session/browser-session.ts` | Constructor param `dialogPolicy?`; passed to every `new BrowserTab` (`:155`, `:233`, `:270`); `setDialogPolicy` (optional on `IBrowserSession`) applies it to existing tabs. |
| 3 | `packages/browser/src/session/session-manager.ts` | `CreateSessionOptions.dialogPolicy?` → `new BrowserSession(...)` (`:182-188`). |
| 4 | `packages/browser/src/session/dialog-cdp.ts` (new) | Raw-CDP primitives: `connectForDialogs`, `listPageTargets`, `livenessProbe`, `collectDialogEvents`, `handleDialogOnTarget`. Everything takes injectable deps. |
| 5 | `packages/browser/src/session/index.ts` | `export * from './dialog-cdp.js'` (plus `./dialog-warden.js` in Branch W) |
| 6 | `packages/capability-runtime/src/runtime.ts` | `SutradharRuntimeOptions.dialogPolicy?` (`:73`); `launch`/`attach` forward it; new `setDialogPolicy`, `getPendingDialogs`, `getDialogHistory`, `getActiveTargetId`. `getPendingDialog`/`handleDialog` (`:1495-1510`) are unchanged. |
| 7 | `packages/capability-runtime/src/types.ts` | `AttachOptions.dialogPolicy?` (`:42-53`); re-export the `DialogPolicy` type |
| 8 | `packages/cli/src/parse-args.ts` | `--dialog`, `--dialog-text`, `dialogFlagError` |
| 9 | `packages/cli/src/state.ts` | `CliState.dialogPolicy?` and `lastPendingDialog?` |
| 10 | `packages/cli/src/dialog-cli.ts` (new, pure) | Policy resolution, formatters, `DialogBlockedError`, `classifyVerb`, `selectDialog`, `raceWithDialog`, `deadlineFor`, `beforeunloadCancelMessage`, exit-code constants |
| 11 | `packages/cli/src/dialog-broker.ts` (new) | `DialogBroker` interface; `DirectCdpBroker`; `runDialogGate` |
| 12 | `packages/cli/src/session-flow.ts` (new) | `withSession` extracted from `cli.ts:92-147`, with injected deps so the GAP-006 split is unit-testable |
| 13 | `packages/cli/src/cli.ts` | Gate wiring, `cmdDialog`, reporting, pre-emption, watchdog, `DialogBlockedError` handling in `main().catch`, the `cmdNav` beforeunload message, `cmdClose` gating, help text |
| 14 | Tests: `packages/browser/tests/unit/browser-tab-observability.spec.ts` (**add only**), `session.spec.ts` (add), `dialog-cdp.spec.ts` (new), `dialog-policy.live.spec.ts` (new, real Chrome); `packages/capability-runtime/tests/unit/runtime.spec.ts` (add); `packages/cli/tests/unit/parse-args.spec.ts` (add), `dialog-cli.spec.ts` (new), `session-flow.spec.ts` (new), `state.spec.ts` (add) | §4 |
| 15 | `tools/scenario-suite/fixtures/fr2-04-dialogs.html` (new), `tools/scenario-suite/verify-fr2-04-dialogs.mjs` (new) | §3, §5 |
| 16 | `packages/cli/README.md`, `AGENT_SETUP.md` (CLI section: one line about `dialog` and `--dialog`), `.ai/loop/field-report-2/evidence/FR2-04/changelog-fragment.md` | The docs match behavior. The CLI default changes from `auto` to `report`, and exit code 3 is new. |

**Branch W additions:**

| # | File | Reason |
|---|---|---|
| W1 | `packages/browser/src/session/dialog-warden.ts` (new) | The `DialogWarden` core: CDP tracking, policy, and a 127.0.0.1 HTTP API. No `process.*` calls; the CLI wraps it. |
| W2 | `packages/cli/src/warden-control.ts` (new) | `readWardenFile`, `ensureWarden`, `stopWarden`, `WardenBroker` |
| W3 | `packages/cli/src/cli.ts` | Hidden verb `__dialog-warden` dispatched **first** in `main()`. It reuses the same bin, so no new esbuild entry is needed in `scripts/build-bundle.mjs:71-87`. |
| W4 | Tests: `packages/browser/tests/unit/dialog-warden.spec.ts`, `packages/cli/tests/unit/warden-control.spec.ts` | §4 |

**Not touched:**
- `tools.ts`: MCP tool count and results are unchanged.
- `packages/sutradhar/src`: the SDK is unchanged.
- `execution-verifier.ts`.
- `spawn-chrome.ts`: no Chrome args change.
- `browser-launcher.ts`: `protocolTimeout` is unchanged (§7 R8).

---

## 2. API / CLI / state diff

### 2.1 `browser-tab.ts`

```ts
// NEW exports
export type DialogPolicyMode = 'auto' | 'report' | 'accept' | 'dismiss';
export interface DialogPolicy { readonly mode: DialogPolicyMode; readonly promptText?: string }
export const DEFAULT_DIALOG_POLICY: DialogPolicy = { mode: 'auto' };
export const MAX_DIALOG_HISTORY = 50;
export interface DialogRecord {
  readonly dialogType: string; readonly message: string; readonly defaultValue?: string; readonly url: string;
  readonly openedAt: string;
  readonly handledAt?: string; readonly action?: 'accept' | 'dismiss'; readonly promptText?: string;
  readonly handledBy?: 'policy' | 'caller' | 'auto-timeout'; readonly error?: string;
}
// IBrowserTab — optional additions (existing literal mocks keep compiling)
readonly targetId?: string;                         // (page.target() as {_targetId?: string})._targetId, internal in pp 25.5.0
setDialogPolicy?(p: DialogPolicy): void;
getDialogPolicy?(): DialogPolicy;
getPendingDialogDetail?(): (PendingDialogInfo & { url: string; openedAt: string }) | undefined;
getDialogHistory?(): readonly DialogRecord[];
// BrowserTab constructor: new 8th optional param `dialogPolicy: DialogPolicy = DEFAULT_DIALOG_POLICY`
```

`getPendingDialog()` (`:421-428`) **keeps its exact shape**, because the existing test at `browser-tab-observability.spec.ts:46-50` uses `toEqual`. The new detail goes in `getPendingDialogDetail`.

Listener behavior (it replaces the timer block at `:564-585`; the event publishing at `:550-562` is unchanged):

| mode | alert / confirm / prompt | beforeunload |
|---|---|---|
| `auto` (default) | today's behavior: 30 s dismiss timer | today's: 3 s accept timer |
| `report` | **no timer**; stays pending | 3 s accept timer (`handledBy:'auto-timeout'`) |
| `accept` | `accept(type==='prompt' ? (promptText ?? dialog.defaultValue()) : undefined)` at once | `accept()` at once |
| `dismiss` | `dismiss()` at once | `dismiss()` at once |

- Policy handling is `void (async () => { try { await ...; push record } catch (e) { push record with error } })()`. It never produces an unhandled rejection.
- Every handled dialog (by policy, by `handleDialog` as `'caller'`, or by a timer as `'auto-timeout'`) pushes a `DialogRecord`. The ring holds `MAX_DIALOG_HISTORY` entries.
- `setDialogPolicy` affects **future** dialogs only. It doesn't retroactively handle a pending one; the gate does that explicitly.
- Prompt accept with no text passes `defaultValue()` explicitly. Accept then means exactly "OK with the prefilled text", and doesn't depend on CDP's behavior when `promptText` is omitted.

### 2.2 `browser-session.ts` / `session-manager.ts`

```ts
// BrowserSession constructor: + 6th optional param `dialogPolicy?: DialogPolicy`; stored in a private field
// every `new BrowserTab(...)` (:155, :233, :270) passes this.dialogPolicy
public setDialogPolicy(p: DialogPolicy): void   // stores it and calls tab.setDialogPolicy?.(p) on every current tab
// IBrowserSession: setDialogPolicy?(p: DialogPolicy): void   (optional)
// CreateSessionOptions: readonly dialogPolicy?: DialogPolicy  → new BrowserSession(id, incognito, bus, logger, instance, options.dialogPolicy)
```

### 2.3 Runtime

```ts
// SutradharRuntimeOptions
/** Default native-dialog policy for sessions this runtime creates. Unset = 'auto' (30 s dismiss; beforeunload 3 s accept). */
dialogPolicy?: DialogPolicy;
// AttachOptions / LaunchOptions: dialogPolicy?: DialogPolicy  (overrides the runtime default for that session)
// launch()/attach(): sessionManager.createSession({ ..., dialogPolicy: options.dialogPolicy ?? this.dialogPolicy })
public setDialogPolicy(sessionId: string, policy: DialogPolicy): void;               // requireSession(...).setDialogPolicy?.(policy)
public getPendingDialogs(sessionId: string): Array<PendingDialogInfo & { tabId: string; url: string; openedAt: string; active: boolean }>;
public getDialogHistory(sessionId: string, tabId?: string): readonly (DialogRecord & { tabId: string })[]; // all tabs when tabId is omitted, oldest first
public getActiveTargetId(sessionId: string): string | undefined;
```

`index.ts` re-exports `type DialogPolicy`, `DialogPolicyMode` and `DialogRecord` from `@sutradhar/browser`.

### 2.4 `dialog-cdp.ts` (browser package; raw CDP, never a Puppeteer `Page`)

```ts
export interface PageTargetInfo { targetId: string; url: string }
export interface ObservedDialog { targetId: string; url: string; type: string; message: string; defaultPrompt?: string; openedAt: string; source: 'event' | 'hint' }
export interface LivenessResult { targetId: string; state: 'responsive' | 'blocked' | 'error'; error?: string }
export async function connectForDialogs(wsEndpoint: string, timeoutMs: number): Promise<Browser | undefined>; // puppeteer.connect({defaultViewport:null}) raced; undefined on failure
export function listPageTargets(b: Browser): Array<{ info: PageTargetInfo; target: Target }>;  // type()==='page', url() not 'about:blank', in targets() order (= attach's adopt order, runtime.ts:303-309)
export async function livenessProbe(session: CDPSession, ms: number): Promise<'responsive' | 'blocked' | 'error'>; // Runtime.evaluate('1', {timeout: ms})
export async function collectDialogEvents(session: CDPSession, info: PageTargetInfo, listenMs: number): Promise<ObservedDialog[]>; // subscribe → send Page.enable (NOT awaited past listenMs) → return events
export async function handleDialogOnTarget(session: CDPSession, accept: boolean, promptText: string | undefined, ms: number): Promise<void>; // Page.handleJavaScriptDialog, throws the CDP message
```

### 2.5 Branch W: `DialogWarden` (browser package) and `warden-control.ts` (CLI)

```ts
export interface WardenOptions { wsEndpoint: string; readPolicy: () => Promise<DialogPolicy | undefined>; isStillCurrent: () => Promise<boolean>;
  onReady: (info: { port: number; token: string }) => Promise<void>; onExit: (reason: string) => Promise<void>;
  policyGraceMs?: number /*300*/; statePollMs?: number /*2000*/; connect?: typeof connectForDialogs }
export class DialogWarden { start(): Promise<void>; stop(reason: string): Promise<void>; pending(): ObservedDialog[] }
```

**Tracking:**
- `connect`, then every existing page target plus every `targetcreated` page target gets `createCDPSession()`.
- On each session, subscribe to `Page.javascriptDialogOpening` (store it, keyed by targetId) and `Page.javascriptDialogClosed` (delete it), then send `Page.enable` without awaiting it beyond 2 s.
- `onReady` is called once every existing target has had `Page.enable` **sent**. The browser-side handler becomes enabled at send time; E4 proves this works.

**Policy:**
- For each opening event, after `policyGraceMs`: if the dialog is still pending and `readPolicy()` returns accept or dismiss, run `Page.handleJavaScriptDialog` using the §2.1 prompt rule.
- `No dialog is showing` errors are logged and ignored. That happens when the in-process `BrowserTab` got there first with the same policy.

**HTTP**, bound to `127.0.0.1:0` (asserted), with the header `authorization: Bearer <token>` (32 random bytes, hex):
- `GET /v1/health` → `{pid, wsEndpoint}`
- `GET /v1/dialogs` → `{dialogs: ObservedDialog[]}`, oldest first
- `POST /v1/dialogs/handle {targetId, accept, promptText?}` → 200 `{handled:true}`; 404 `{error:"No dialog is open on that tab"}`; 409 `{error:<cdp message>}`
- A missing or wrong token gets 401, and no CDP call is made.

**Exit conditions:**
- `browser.on('disconnected')`;
- `isStillCurrent()` returns false, polled every `statePollMs` (the state file is gone, or its `wsEndpoint` differs);
- SIGTERM.

On exit it calls `onExit`, which deletes `warden.json` only if it still names this pid.

**CLI side (`warden-control.ts`):**
- `warden.json` = `{v:1, pid, port, token, wsEndpoint, startedAt}`, stored **next to** `state.json` (a sidecar). Keeping it separate avoids lost updates with the CLI's `writeState` read-modify-write.
- `ensureWarden(stateDir, state)`:
  1. Read `warden.json`, then `GET /v1/health` (500 ms). If `wsEndpoint` matches, reuse the warden.
  2. Otherwise spawn it: `spawn(process.execPath, [process.argv[1], '__dialog-warden', base64url(JSON{wsEndpoint, stateFile})], {detached:true, stdio:'ignore', windowsHide:true, cwd: os.homedir()})`, then `unref()`.
  3. Poll for `warden.json` plus health, up to `WARDEN_READY_TIMEOUT_MS`.
  4. On timeout, write this to stderr and continue degraded: `Warning: the dialog warden did not start, so dialogs left open between commands can't be handled or auto-handled. Run "sutradhar dialog" to check.`
- `ensureWarden` is called in `withSession` after attach or spawn and **before** `fn()`. On spawn it's awaited, so the warden is enabled before the first action can open a dialog.
- `stopWarden(stateDir)`: health-check that the pid matches the file, then `process.kill(pid)`, wait up to 2 s for it to exit, and remove `warden.json`. It's called by `close` and by self-heal (before `releaseSessionResources`).
- `WardenBroker` implements `DialogBroker` over HTTP.

### 2.6 `parse-args.ts`

```ts
// ParsedArgs additions
dialogFlag: 'accept' | 'dismiss' | 'report' | undefined;   // --dialog <v>
dialogFlagGivenButInvalid: boolean;
dialogTextFlag: string | undefined;                        // --dialog-text <text> (the next arg, even if it starts with "--")
// KNOWN_FLAGS += '--dialog', '--dialog-text'; isConsumedValue covers both value positions
export function dialogFlagError(p: ParsedArgs): string | undefined;
//  invalid value            → '--dialog must be one of: accept, dismiss, report (e.g. --dialog accept)'
//  --dialog-text without --dialog accept in the same command
//                           → '--dialog-text only applies with --dialog accept (it is the text entered into prompt() dialogs)'
//  --dialog or --dialog-text with verb "dialog"
//                           → '--dialog sets the session\'s default policy; to handle the open dialog now use: sutradhar dialog accept [text] | sutradhar dialog dismiss'
```

`args.indexOf('--dialog')` matches exactly, so `--dialog-text` never collides with it.

### 2.7 `state.ts`

```ts
/** NEW (FR2-04). The session's default policy for native dialogs, set by `--dialog accept|dismiss` (with
 *  `--dialog-text`) and cleared by `--dialog report`. Absent = report (leave dialogs open and report them).
 *  Re-applied on every reattach, like `viewport`, because in-process dialog handling dies with each process. */
dialogPolicy?: { action: 'accept' | 'dismiss'; promptText?: string; setAt: string };
/** NEW (FR2-04). The last pending dialog a command saw when it exited. Diagnostics, plus detection in Branch D-hint.
 *  The broker is the source of truth. */
lastPendingDialog?: { targetId?: string; type: string; message: string; defaultValue?: string; url: string; openedAt: string };
```

### 2.8 CLI flow

**2.8.1 Effective policy.**
- `resolveDialogPolicy(flag, text, state)` returns `{policy: DialogPolicy, persist: 'set'|'clear'|'keep'}`.
- Precedence: flag > `state.dialogPolicy` > `{mode:'report'}`.
- `withSession` builds `new SutradharRuntime({ logger, allowedDomains, dialogPolicy: policy })`.
- After attach or spawn, if `persist !== 'keep'` and the result differs from the state, it writes the state and prints once to stderr: `Note: dialog policy for this session is now "<accept|dismiss|report>".`

**2.8.2 The gate** (`runDialogGate(state, policy, mode)` in `dialog-broker.ts`; `mode` is `'command' | 'close'`):

1. Get a broker. In Branch W, try `WardenBroker` first; if it's unhealthy, fall back to `DirectCdpBroker`. In Branches D and D-hint, use `DirectCdpBroker`.
   - `DirectCdpBroker.list()` does this:
     - `connectForDialogs(ws, 5000)`. On failure it returns `{status:'unknown'}`, and **attach then proceeds and may self-heal as it does today**.
     - For every page target, in parallel: a liveness probe (1000 ms), and in Branch D only, `collectDialogEvents` (400 ms).
     - D-hint: a blocked target plus a `state.lastPendingDialog` whose URL matches produces an `ObservedDialog{source:'hint'}`. A blocked target with no hint is reported as `{type:'unknown', message:''}`.
     - A blocked target with no dialog known in any branch counts as `busy`. The gate doesn't block: it prints `Note: the page did not respond within 1000ms (a long-running script?).` to stderr and proceeds.
2. No dialogs: return `{status:'clear'}`.
3. Dialogs, with policy `accept` or `dismiss`: handle each through the broker, oldest first, then check each target answers liveness within `VERIFY_UNBLOCK_MS`. Return `{status:'handled', records}`. These records print as `dialogHandled … "by":"policy"`.
   - If handling fails: in `command` mode, throw `DialogBlockedError` (below) with the failure appended. In `close` mode, return `{status:'blocked'}`.
4. Dialogs, with policy `report`:
   - `command` mode: throw `new DialogBlockedError(verb, dialogs, 'blocked')`.
   - `close` mode: return `{status:'blocked', dialogs}`.

The gate runs for every **session verb** except the exempt ones (§2.10). It always runs **before** `runtime.attach`, and outside any self-heal `try`.

**2.8.3 `withSession`** (extracted to `session-flow.ts`; this also closes GAP-006):

```ts
export async function withSessionFlow<T>(deps: SessionFlowDeps, fn: (sessionId: string) => Promise<T>): Promise<T> {
  const state = await deps.readState();
  if (!state) { const sid = await deps.spawnFresh(); await deps.afterAttach(sid, true); return deps.runGuarded(() => fn(sid), sid); }
  await deps.gate(state);                       // may throw DialogBlockedError; nothing else
  let sid: string;
  try { sid = await deps.reattach(state); }     // attach + grants + focusTab + viewport + persist (today's cli.ts:99-120)
  catch (err) { sid = await deps.selfHeal(state, err); }   // FR2-03's release + clear + spawnFresh
  await deps.afterAttach(sid, false);           // persist the policy; Branch W: ensureWarden
  return deps.runGuarded(() => fn(sid), sid);   // OUTSIDE the try: fn() errors never self-heal (GAP-006)
}
```

`cli.ts` supplies the deps and keeps `activeRuntime`/`activeSessionId` as today.

**2.8.4 `runGuarded` and pre-emption.**

`raceWithDialog(work, pollPending, { graceMs, pollMs: 100, ignoreTypes: ['beforeunload'] })` returns either `{kind:'done', value}` or `{kind:'dialog', pending}`.
- `pollPending` is `() => runtime.getPendingDialogs(sid).filter(d => d.active)`.
- It resolves as `dialog` only when a non-ignored dialog has been continuously pending for `graceMs`. A dialog that the policy clears inside the grace doesn't count.

`graceMs` depends on the verb (§2.10): `TRIGGER_PREEMPT_GRACE_MS` for the trigger family, `PREEMPT_GRACE_MS` for everything else.

At the end of **every** session verb (done or pre-empted), `reportDialogs(runtime, sid, commandStartMs)` prints:
- one `dialogHandled:` line per history record with `handledAt >= commandStart`;
- one `dialogPending:` line per pending dialog, oldest first, plus the stderr hint;
- and writes `lastPendingDialog`, the oldest pending, or deletes the key when there is none. It writes only when the value changed.

**2.8.5 Output formats and exit codes** (exact strings; `<type>` is alert, confirm, prompt, beforeunload or unknown):

```
dialogPending: {"type":"confirm","message":"fr2-04 confirm N","defaultValue":null,"url":"http://127.0.0.1:5123/fr2-04-dialogs.html?n=N"}
dialogHandled: {"type":"confirm","message":"fr2-04 confirm N","action":"accept","promptText":null,"by":"policy"}
```

- Key order is fixed: type, message, defaultValue, url; and type, message, action, promptText, by.
- Output is `JSON.stringify` on one line, so newlines in a message are escaped.
- stderr hint after the pending lines: `Hint: a <type> dialog is open and blocking the page. Run "sutradhar dialog accept [text]" or "sutradhar dialog dismiss", or set a policy with --dialog accept|dismiss.`

| Situation | stdout | stderr | exit |
|---|---|---|---|
| Blocked at the gate (report) | `dialogPending:` lines | `Error: a <type> dialog is open and blocking the page, so "<verb>" did not run.` + Hint | **3** |
| Pre-empted, non-trigger verb | `dialogPending:` lines | `Error: a <type> dialog opened while "<verb>" was running and is blocking the page; "<verb>" did not complete (it may have partially run).` + Hint | **3** |
| Pre-empted `nav` (an alert during load) | `Navigation to <url> started, but the page opened a <type> dialog while loading.` + `dialogPending:` | Hint | **3** |
| Pre-empted trigger verb (after 4 s) | `Click dispatched to <ref>; a <type> dialog opened before delivery could be verified.` + `dialogPending:` | Hint | 0 |
| Action finished, dialog left pending (report) | the normal line (e.g. `Clicked #alert`) + `dialogPending:` | Hint | the action's own code (0) |
| `nav` cancelled by beforeunload under dismiss | `Navigate failed: the page's beforeunload dialog was dismissed (--dialog dismiss is in effect), so the navigation to <url> was cancelled. Use --dialog accept to leave pages that ask for confirmation.` | none | 1 |
| Gate's policy handling failed | `dialogPending:` | `Error: a <type> dialog is open, and applying the "<accept|dismiss>" policy failed: <cdp message>.` + Hint | 3 |

- `DialogBlockedError extends Error { name = 'DialogBlockedError'; exitCode = 3; dialogs; stdoutLines(): string[] }`.
- `main().catch` prints `stdoutLines()` to stdout and `message` plus the Hint to stderr, then sets `process.exitCode = 3`. Every other error keeps `Fatal:` and exit 1.
- Exit code 0 when a dialog is left pending is deliberate: the action succeeded. The **next** command reports the dialog again (exit 3) until it's handled.

**2.8.6 Watchdog.**
- `deadlineFor(verb, cleanArgs, env)`: the default is 300 000. `SUTRADHAR_CLI_DEADLINE_MS` overrides it and must be a positive integer, otherwise it's ignored. For `wait` with timeout T, the deadline is `max(d, 3*T + 30000)`.
- It's armed at the start of `main()` with `setTimeout(...).unref()`.
- When it fires: stderr `Error: "sutradhar <verb>" did not finish within <N>s and was stopped. The browser session is still running. If the page is blocked by a dialog, run "sutradhar dialog".`, then `process.exit(1)`.
- It isn't armed for the hidden `__dialog-warden` verb.

**2.8.7 Branch X variant** (only if Step 1 selects X):
- In `report` mode, `reportDialogs` resolves every in-process pending alert, confirm or prompt with `dismiss` **before** the process exits. It prints `dialogHandled … "by":"cli-exit"` and the stderr warning `Warning: Chrome won't let a later process handle this dialog, so it was dismissed on exit. Set --dialog accept|dismiss, or arm the next dialog with "sutradhar dialog accept".`
- `dialog accept|dismiss [text]` persists `state.nextDialog = {action, promptText}`. The next command applies it to the first dialog it sees and then deletes it.
- The gate does detection only (liveness plus hint). On a blocked tab it recommends `sutradhar close`.

### 2.9 The `dialog` verb (gate-exempt; never calls `runtime.attach`)

```
sutradhar dialog                   status: one dialogPending: line per pending dialog, or "No dialog is open."   exit 0
sutradhar dialog accept [text...]  handles the OLDEST pending dialog (FIFO) with accept, text = cleanArgs.slice(1).join(' ')
sutradhar dialog dismiss           same, with dismiss; any extra args → usage error
```

Flow:
1. `readState()`. If there's none, print `No active session.` and exit 1.
2. Get the broker (§2.8.2), then `list()`.
3. If none is pending: for status, exit 0. For accept or dismiss: `Error: no dialog is open to <accept|dismiss>.`, exit 1.
4. `handle(oldest, accept, text)`. On failure: `Error: could not <accept|dismiss> the <type> dialog: <cdp message>`. In Branch D-hint and X, append ` Chrome only lets the connection that saw a dialog open close it; recover with "sutradhar close".` Exit 1.
5. Verify: the target answers liveness within `VERIFY_UNBLOCK_MS`, or a **new** dialog is pending on it (a chain).
6. Print:
   - `Accepted <type> "<message>"`
   - or with text: `Accepted prompt "<message>" with text "<text>"`
   - or for a prompt with no text: `Accepted prompt "<message>" with its default value "<defaultValue>"`
   - or `Dismissed <type> "<message>"`

   Then a `dialogPending:` line for every dialog **still** pending (a chain, or other tabs). Exit 0.
7. Text passed with accept on a non-prompt: stderr `Note: text is only used by prompt() dialogs; ignored for <type>.`
8. `dialog <other>`: usage `usage: sutradhar dialog [accept [text] | dismiss]  (handles the oldest open native dialog: alert/confirm/prompt/beforeunload)`, exit 1.

### 2.10 Per-verb classification (`classifyVerb`)

| class | verbs | gate | pre-emption grace |
|---|---|---|---|
| `exempt` | `dialog`, `doctor`, `profile`, `sessions` (FR2-03), `close` (gate in `close` mode), help or no verb, `__dialog-warden` | no (close: close mode) | none |
| `trigger` | `click`, `clicktext`, `clickrole`, `clickpoint` | yes | 4000 ms |
| `guarded` | every other session verb, including `nav`, `snap`, `axsnap`, `text`, `eval`, `type`, `press`, `select`, `wait`, `hover`, `scroll`, `upload`, `drag`, `dragpoints`, `screenshot`, `audit`, `compare`, `download`, `tabs`, `newtab`, `focustab`, `closetab`, `grant`, `setclipboard`, `getclipboard`, **and any unknown verb** | yes | 250 ms |

**`close` with `profileName`:** the gate runs in close mode. If the result is `blocked`, skip the storage save and warn on stderr `Warning: a <type> dialog is open, so the profile's storage state was not saved. Handle it first ("sutradhar dialog accept|dismiss") if you need it saved.` Then continue with FR2-03's release. Branch W: `stopWarden` runs first.

### 2.11 Help text (the command list gains `dialog`; the Flags section gains two entries)

```
  dialog                       Show any open native dialog (alert/confirm/prompt/beforeunload)
  dialog accept [text]         Accept the oldest open dialog (text = what to type into a prompt)
  dialog dismiss               Dismiss the oldest open dialog
...
  --dialog <accept|dismiss|report>
                        Default policy for native dialogs in this session; persisted until changed.
                        report (the default) leaves alert/confirm/prompt open and prints
                        "dialogPending: {...}"; while one is open, other commands exit with code 3
                        until "sutradhar dialog accept|dismiss". beforeunload during a navigation
                        is accepted after 3s under report
  --dialog-text <text>  With --dialog accept: the text entered into prompt() dialogs (default:
                        the prompt's own default value)
Exit codes: 0 ok, 1 failure, 3 blocked by or interrupted by an open dialog.
```

---

## 3. Fixture: `tools/scenario-suite/fixtures/fr2-04-dialogs.html`

- **Served** by the harness's `http.createServer` on `127.0.0.1:0` (a fresh origin for each run, so a fresh `localStorage`).
- **Every URL** carries `?n=<nonce>` in the **query string**. The decisions.md gotcha: a fragment-only change doesn't reload the page.
- **Recorder:** `const N = q.get('n'); const KEY = 'fr2-04:' + N; rec(e)` appends `{...e, seq, t}` to `localStorage[KEY]` and mirrors the JSON into `#log`. That lets an independent observer read the outcome once the page is unblocked.
- **Messages:** every dialog message embeds N, so the CLI's report must match exactly.

| Control / param | Behavior | Records |
|---|---|---|
| `#alert` | `alert('fr2-04 alert ' + N)` | `{kind:'alert',phase:'opening'}` then `{phase:'returned', result:'__undefined__'}` |
| `#confirm` | `confirm('fr2-04 confirm ' + N)` | opening, then returned with `result:true|false` |
| `#prompt` | `prompt('fr2-04 prompt ' + N, 'fr2-default')` | opening, then returned with `result:<string>|null` and `isNull` |
| `#chain` | `alert('fr2-04 chain-a ' + N)`, then `confirm('fr2-04 chain-b ' + N)` | 4 entries |
| `#arm-bu` | adds a `beforeunload` handler that records `{kind:'beforeunload',phase:'fired'}`, calls `preventDefault()` and sets `returnValue='fr2-04 unsaved'` | `{kind:'beforeunload',phase:'armed'}`. The **real CLI click provides the sticky user activation** (C14). |
| `#arm-bu-nav` | like `#arm-bu`, plus `setTimeout(() => location.href = <same URL + &landed=1>, 2500)` | armed; fired later |
| `?landed=1` | on load | `{kind:'landed'}` |
| `?timerKind=alert|confirm&timerMs=M` | a dialog after M ms, via `setTimeout` | opening and returned, with `timer:true` |
| `?onloadAlert=1` | an inline `<script>` in `<head>` runs `alert('fr2-04 onload ' + N)` **before** DOMContentLoaded | `{kind:'onload',phase:'opening'|'returned'}` |
| `#iframe-host` | a same-origin `srcdoc` iframe `#ifr` containing `#ifr-alert` → `parent.rec(...)` + `alert('fr2-04 iframe ' + N)` | opening and returned, with `frame:true` |
| `document.title` | `'fr2-04 ' + N` | none |

---

## 4. Unit tests (numbered; existing tests are unchanged; no loosening)

**`browser/tests/unit/browser-tab-observability.spec.ts`** (additions; fake timers where timing matters)
- **T1:** no policy argument, confirm event:
  - `vi.advanceTimersByTime(29_999)` gives `dismiss` 0 calls; after `+1`, exactly 1 call.
  - beforeunload: `accept` exactly 1 call at 3000 ms, 0 calls at 2999.
  - This is the regression guard for MCP and SDK.
- **T2:** `{mode:'accept'}` with a confirm:
  - after `await vi.runAllTicks()`, `accept` is called once with `undefined`;
  - `vi.getTimerCount() === 0`;
  - `getPendingDialog()` is `undefined`;
  - `getDialogHistory()[0]` matches `{dialogType:'confirm', action:'accept', handledBy:'policy'}` and has an ISO `handledAt`.
- **T3:** accept with a prompt whose default is `'fr2-default'`:
  - no `promptText` → `accept('fr2-default')`;
  - `{mode:'accept', promptText:'zz'}` → `accept('zz')`;
  - an alert with `promptText:'zz'` → `accept(undefined)`.
- **T4:** `{mode:'dismiss'}` with beforeunload → `dismiss` once, `accept` 0 calls.
- **T5:** `{mode:'report'}`:
  - confirm → timer count 0, and after `advanceTimersByTime(600_000)` both `accept` and `dismiss` have 0 calls and `getPendingDialog()?.dialogType === 'confirm'`;
  - beforeunload → `accept` once at 3000 ms, history `handledBy:'auto-timeout'`.
- **T6:** in report mode with a pending confirm, `setDialogPolicy({mode:'accept'})` → `accept` 0 calls (no retroactive handling). The **next** confirm event → `accept` once.
- **T7:** accept policy where `accept` rejects with `No dialog is showing`:
  - no unhandled rejection (a spy on `process.on('unhandledRejection')` gets 0 calls);
  - the history entry has `error` containing `No dialog is showing`.
- **T8:** `handleDialog('accept','Ada')` → the history entry has `{handledBy:'caller', promptText:'Ada', action:'accept'}`.
- **T9:** 60 policy-handled dialogs → `getDialogHistory().length === 50`, and the first entry is the 11th.
- **T10:** `getPendingDialogDetail()` → `{dialogType, message, defaultValue, url:'https://example.com', openedAt:<ISO>}`. `getPendingDialog()` still equals the 3-key object exactly (the existing test also covers this).

**`browser/tests/unit/session.spec.ts`** (additions)
- **S-D1:** `new BrowserSession(id, false, bus, logger, fakeInstance, {mode:'dismiss'})`. The tabs from `createTab`, `adoptExistingPage` and a popup event all have `getDialogPolicy()` deep-equal to `{mode:'dismiss'}`.
- **S-D2:** `setDialogPolicy({mode:'accept'})` updates 2 existing tabs, and a tab created afterwards also has it.

**`browser/tests/unit/dialog-cdp.spec.ts`** (fake `CDPSession` EventEmitters)
- **B1:** `collectDialogEvents` with an opening event emitted 50 ms after `Page.enable` returns `[{type:'confirm', message, source:'event', targetId, url}]`. `Page.enable` never resolving doesn't prevent a return at 400 ms ± 50 (fake timers).
- **B2:** `livenessProbe`:
  - a `send` that resolves gives `'responsive'`;
  - a rejection matching `/timed out/` gives `'blocked'`;
  - any other rejection gives `'error'`;
  - `send` was called with `('Runtime.evaluate', {expression:'1', returnByValue:true}, {timeout:1000})`.
- **B3:** `handleDialogOnTarget(s, true, 'x', 5000)` sends exactly `('Page.handleJavaScriptDialog', {accept:true, promptText:'x'}, {timeout:5000})`. A CDP rejection propagates its message unchanged.
- **B4:** `connectForDialogs` with a connect that rejects returns `undefined` and never throws. A connect that never resolves returns `undefined` at the timeout.
- **B5:** `listPageTargets` drops `about:blank` and non-page targets and keeps `targets()` order.

**`browser/tests/unit/dialog-policy.live.spec.ts`** (real headless Chrome through `BrowserLauncher.launch`, the same pattern as `launcher.spec.ts`)
- **LV1:** `accept`: `page.evaluate("confirm('x')")` gives `true` in < 2000 ms.
- **LV2:** `dismiss`: gives `false`.
- **LV3:** `accept` with `promptText:'zz'`: `prompt('q','d')` gives `'zz'`. With no text: `'d'`.
- **LV4:** `report`:
  - the evaluate promise is **still pending** after 1500 ms (a race against a `delay` resolving first);
  - `getPendingDialog().dialogType === 'confirm'`;
  - then `handleDialog('accept')` makes the evaluate resolve `true` within 2000 ms.
- **LV5:** `tab.targetId` is a non-empty string equal to the id from `Target.getTargets` for that URL. This guards the internal `_targetId`.

**`capability-runtime/tests/unit/runtime.spec.ts`** (additions)
- **R1:** `new SutradharRuntime({launcher: fake, dialogPolicy:{mode:'accept'}})` then `attach({endpoint})` → spy `createSession` called with `objectContaining({dialogPolicy:{mode:'accept'}})`.
- **R2:** `attach({endpoint, dialogPolicy:{mode:'dismiss'}})` overrides the default.
- **R3:** no option → `createSession` args have `dialogPolicy === undefined`, so the tabs are `'auto'`. That's the MCP/SDK guard.
- **R4:** `setDialogPolicy(sid, p)` calls `session.setDialogPolicy` once with `p`. An unknown sid throws `No browser session`.
- **R5:** `getPendingDialogs` with 2 tabs, one pending → `[{tabId, url, dialogType, message, openedAt, active}]` with `active` correct.
- **R6:** `getDialogHistory(sid)` merges tabs in `handledAt` order and tags each entry with `tabId`.

**`cli/tests/unit/parse-args.spec.ts`** (additions)
- **P-D1:** `['click','#a','--dialog','accept']` → `dialogFlag:'accept'`, `cleanArgs:['#a']`, `unrecognizedFlags:[]`.
- **P-D2:** `--dialog dismiss` and `--dialog report` parse as those values.
- **P-D3:** `['snap','--dialog','bogus']` → `dialogFlag:undefined`, `dialogFlagGivenButInvalid:true`. `['snap','--dialog']` → invalid:true.
- **P-D4:** `['nav','u','--dialog','accept','--dialog-text','hello world']` → `dialogTextFlag:'hello world'`, `cleanArgs:['u']`.
- **P-D5:** `['nav','u','--dialog','accept','--dialog-text','--weird']` → `dialogTextFlag:'--weird'`, `unrecognizedFlags:[]`.
- **P-D6:** `['dialog','accept','some','text']` → `verb:'dialog'`, `cleanArgs:['accept','some','text']`.
- **P-D7:** `dialogFlagError` returns the three exact §2.6 messages for `--dialog bogus`, `['snap','--dialog-text','x']` and `['dialog','accept','--dialog','dismiss']`. It returns `undefined` for P-D1, P-D4 and `['snap']`.
- **P-D8:** `['snap']` → `dialogFlag:undefined`, `dialogTextFlag:undefined`, `dialogFlagGivenButInvalid:false`.

**`cli/tests/unit/dialog-cli.spec.ts`**
- **D1:** `resolveDialogPolicy`:
  - `('accept','t',{dialogPolicy:{action:'dismiss'}})` → `{policy:{mode:'accept',promptText:'t'}, persist:'set'}`;
  - `('report',undefined,{dialogPolicy:{action:'accept'}})` → `{policy:{mode:'report'}, persist:'clear'}`;
  - `(undefined,undefined,{dialogPolicy:{action:'accept',promptText:'p'}})` → `{mode:'accept',promptText:'p'}`, `'keep'`;
  - `(undefined,undefined,{})` → `{mode:'report'}`, `'keep'`.
- **D2:** `formatDialogPending({dialogType:'confirm',message:'Delete?',url:'http://x/'})` equals exactly `'dialogPending: {"type":"confirm","message":"Delete?","defaultValue":null,"url":"http://x/"}'`.
- **D3:** `formatDialogHandled` equals the exact §2.8.5 string for a policy accept, and for a caller prompt with `promptText:'zz'`.
- **D4:** a message with `\n` and `"` produces one line (`!out.includes('\n')`) that round-trips through `JSON.parse(out.slice('dialogPending: '.length)).message`.
- **D5:** `classifyVerb`: click, clicktext, clickrole and clickpoint are `'trigger'`; eval, snap, nav, type, wait and `'unknownverb'` are `'guarded'`; dialog, doctor, profile, sessions, close, `undefined` and `'__dialog-warden'` are `'exempt'`.
- **D6:** `selectDialog` with pending entries at t2 and t1 (unsorted) returns t1 as the target and `[t2]` as the remaining list.
- **D7:** `raceWithDialog` (fake timers):
  - (a) work resolves at 100 ms with no dialog → `{kind:'done'}`;
  - (b) a confirm appears at 100 ms and work never resolves, grace 250 → `{kind:'dialog'}` resolved at ≥ 350 ms and ≤ 450 ms;
  - (c) a confirm appears at 100 ms and disappears at 200 ms, work resolves at 600 → `done`;
  - (d) a beforeunload pending for 5 s while work resolves at 3100 → `done` (the ignore list).
- **D8:** `new DialogBlockedError('snap',[confirm],'blocked')`:
  - `.exitCode === 3`, `.name === 'DialogBlockedError'`;
  - `.message === 'a confirm dialog is open and blocking the page, so "snap" did not run.'`;
  - `stdoutLines()` equals `[formatDialogPending(confirm)]`.
- **D9:** `deadlineFor`:
  - `('snap',[],{})` → 300000;
  - `('wait',['#x','200000'],{})` → 630000;
  - `('snap',[],{SUTRADHAR_CLI_DEADLINE_MS:'5000'})` → 5000;
  - `'abc'` and `'-1'` are ignored (300000).
- **D10:** `beforeunloadCancelMessage('http://b/')` equals the exact §2.8.5 `nav` string. `isBeforeunloadCancel(err, history, since)` is true only for an `ERR_ABORTED` error combined with a beforeunload dismissed by policy since `since`.

**`cli/tests/unit/session-flow.spec.ts`** (injected deps, with call-order recording)
- **W1:** no state → `spawnFresh`, then `afterAttach(sid, true)`, then `fn`. `gate` gets 0 calls.
- **W2:** state present and `reattach` throws → `selfHeal` gets 1 call, then `fn` runs with the healed sid.
- **W3:** `fn` throws `new Error('boom')` → the error propagates, `selfHeal` gets **0** calls (GAP-006), and `reattach` gets 1 call.
- **W4:** `gate` throws a `DialogBlockedError` → it propagates, and `reattach`, `selfHeal` and `fn` all get 0 calls.
- **W5:** the order is `readState` < `gate` < `reattach` < `afterAttach` < `fn`.

**`cli/tests/unit/state.spec.ts`** (additions)
- **ST-D1:** FR2-03's `parseCliState` given `{"sessionId":"s","wsEndpoint":"ws://x","dialogPolicy":{"action":"accept","setAt":"2026-01-01T00:00:00Z"},"lastPendingDialog":{"type":"alert","message":"m","url":"u","openedAt":"t"}}` returns both new keys deep-equal. That proves pass-through.

**Branch W only: `browser/tests/unit/dialog-warden.spec.ts`** (a fake connect with fake targets and sessions; a real `http` server on port 0)
- **WD1:** an opening event makes `GET /v1/dialogs` (with the token) return 1 entry. A closed event then gives 0.
- **WD2:** `readPolicy → accept`, then an opening event → `Page.handleJavaScriptDialog` 0 calls at 299 ms and 1 call at 300 ms. Opening then closed at 100 ms → 0 calls.
- **WD3:** POST handle with a missing or wrong token → 401, and 0 CDP calls.
- **WD4:** POST handle for a targetId with nothing pending → 404 `{"error":"No dialog is open on that tab"}`. A CDP rejection → 409 carrying its message.
- **WD5:** emitting `disconnected` on the fake browser → `onExit('browser-disconnected')` once, and the server is closed (a new request fails with ECONNREFUSED).
- **WD6:** `isStillCurrent → false` → `onExit('state-changed')` within 2 poll intervals.
- **WD7:** `server.address().address === '127.0.0.1'`.
- **WD8:** prompt accept with no text → `promptText` equals the event's `defaultPrompt`.

**Branch W only: `cli/tests/unit/warden-control.spec.ts`**
- **WC1:** a health response with a matching `wsEndpoint` → reuse, spawn 0 calls.
- **WC2:** health fails → spawn called once with argv `[execPath, argv1, '__dialog-warden', <b64>]` and options `{detached:true, windowsHide:true, cwd: os.homedir()}`. The b64 decodes to `{wsEndpoint, stateFile}`.
- **WC3:** readiness never arrives → `undefined` at 3000 ms, and stderr gets the exact §2.5 warning.
- **WC4:** `stopWarden` with a health response whose pid mismatches → kill 0 calls, and the file is still removed.

---

## 5. Live-verify script: `tools/scenario-suite/verify-fr2-04-dialogs.mjs`

**Prerequisite:** `pnpm build`.

**Isolation** follows FR2-03 §3.1:
- scratch root `R = mkdtemp(tmp,'fr2-04-')`;
- child env `{TEMP/TMP/TMPDIR: R/temp, SUTRADHAR_CLI_STATE_ROOT: R/state-root}` with `SUTRADHAR_CLI_STATE_DIR` removed;
- each case runs with `cwd: R/cwd-<case>`.

It drives `node packages/cli/dist/cli.js` as a **separate process for every step**.

**Outputs**, all in `evidence/FR2-04/`:
- `live-cases.jsonl` (per case: argv, stdout, stderr, code, ms, observer readings, pass);
- `live-summary.json`;
- `gate-overhead.json` (per-command wall times for `snap` on a clean page, n = 10, median and p90).

The script exits 1 on any failure.

**Observer rules** (these make contamination structurally impossible):
1. Connect with `puppeteer.connect({browserWSEndpoint, defaultViewport:null})`. **Never** call `observer.pages()` or `target.page()`. Those run `CdpPage` init, which blocks on a dialog-blocked renderer (C5, C6) and enables the Page domain on the observer's session.
2. Get sessions only through `target.createCDPSession()` (C7), wrapped in `guard(session)`. The guard forwards only `Runtime.evaluate` and `Target.getTargetInfo`. Any other method (`Page.*` especially) is pushed to `violations[]` and rejected **before** it is sent.
3. Because the observer never sends `Page.enable`, Chromium never delivers the dialog callback to its session (C12). It couldn't handle a dialog even by accident.
4. It reads page outcomes **only** once the page is unblocked. "Dialog open" is established independently by `liveness(session, 800) === 'blocked'` plus the recorder's `opening` entry, which is read after resolution.
5. Final assertion: `violations.length === 0`, written to `live-summary.json`.

**Process enumeration** (warden and Chrome leftovers) reuses FR2-03's observer enumeration (PowerShell CIM). Matching:
- Chrome: command lines containing `realpath(R)`;
- wardens: `__dialog-warden` whose decoded payload `stateFile` starts with `R`.

| Case | Steps (each bullet is a separate CLI process) | Assertions |
|---|---|---|
| **L0** preflight | fixture server; `nav ?n=L0` | exit 0; `state.dialogPolicy` absent; Branch W: `warden.json` exists and `/v1/health` answers 200 with this pid |
| **L1** alert (report) across processes | `nav ?n=N` → `click #alert` → `snap` → `dialog` → `dialog accept` → `snap` | the click exits 0 in < 8 s, and stdout contains `Clicked #alert` and exactly `dialogPending: {"type":"alert","message":"fr2-04 alert N","defaultValue":null,"url":"<URL>"}`; observer liveness `blocked`; `snap` exits **3** in < 6 s with the same `dialogPending` line and the exact gate error; `state.chromePid` unchanged; observer page-target URLs unchanged (no new blank tab); `dialog` exits 0 and lists it; `dialog accept` exits 0 with stdout `Accepted alert "fr2-04 alert N"`; observer liveness responsive within 2 s; record `[opening, returned "__undefined__"]` exactly; the final `snap` exits 0 with no `dialogPending` |
| **L2** confirm | a: `click #confirm` → `dialog dismiss`; b: fresh nonce → `click #confirm` → `dialog accept` | a: record result `false`, stdout `Dismissed confirm "…"`; b: `true` |
| **L3** prompt with a default | a: `click #prompt` → `dialog accept fr2-typed`; b: `dialog accept`; c: `dialog dismiss` | the pending line has `"defaultValue":"fr2-default"`; a: `'fr2-typed'`, stdout `with text "fr2-typed"`; b: `'fr2-default'`, stdout `with its default value "fr2-default"`; c: `isNull:true` |
| **L4a** beforeunload, report, `nav` | `nav ?n=N` → `click #arm-bu` → `nav ?n=N&landed=1` | exit 0; stdout contains `dialogHandled: {"type":"beforeunload"` … `"action":"accept"` … `"by":"auto-timeout"}`; observer target URL contains `landed=1`; record contains armed, fired, landed |
| **L4b** beforeunload, `--dialog accept` | `nav ?n=N --dialog accept` → `click #arm-bu` → `nav …&landed=1` | exit 0; `dialogHandled` has `"by":"policy"`; landed; `state.dialogPolicy.action === 'accept'` |
| **L4c** beforeunload, `--dialog dismiss` | `nav ?n=N --dialog dismiss` → `click #arm-bu` → `nav …&landed=1` | exit **1**; stdout is exactly the §2.8.5 cancel message; observer URL still `?n=N` (no `landed`); record has `fired` and no `landed`; liveness responsive |
| **L4d** beforeunload between commands | `nav ?n=N` (report) → `click #arm-bu-nav` → (observer waits for `blocked` ≤ 10 s) → `dialog` → `dialog accept` | `dialog` lists type `beforeunload`; after accept, the observer URL contains `landed=1` within 5 s; record has fired and landed |
| **L5** policy between commands | a: `nav ?n=N&timerKind=confirm&timerMs=5000 --dialog accept`, then **no command**; b: the same with report → `snap` → `dialog dismiss` | **Branch W** a: the observer sees `returned true` within 5 s + 3 s of `opening` with no CLI process running (asserts no `cli.js` child alive). **Branch D/D-hint** a: after `blocked`, `snap` exits 0 with `dialogHandled … "by":"policy"` and the record is `true`. b: `snap` exits 3, then `false` |
| **L6** eval in a dialog | a: report: `eval "confirm('fr2-04 eval N')"` → `dialog accept`; b: `eval "confirm('x')" --dialog accept`; c: `eval "prompt('q','d')" --dialog accept --dialog-text zz` | a: exit **3** in < 4 s, and the pending message is exactly `fr2-04 eval N`; b: stdout `true`, exit 0; c: stdout `zz` |
| **L7** chain | `click #chain` → `dialog accept` → `dialog dismiss` | the first `dialog accept` stdout has `Accepted alert "fr2-04 chain-a N"` **and** a `dialogPending` line for `chain-b`; record: alert returned, confirm `false` |
| **L8** persistence | `nav --dialog dismiss` → `click #confirm` (no flag) → `snap --dialog report` → `click #confirm` | state `dismiss`, then the click has `dialogHandled … "action":"dismiss","by":"policy"` and the record is `false`; after `--dialog report` the state has no `dialogPolicy` key and the next click shows `dialogPending` |
| **L9** clickpoint (no engine race) | `eval` to get `#confirm`'s centre via the observer (before any dialog) → `clickpoint x y` | exit 0 in < 8 s; stdout contains the `Click dispatched` line **or** a clickpoint success, plus `dialogPending` confirm |
| **L10** onload alert | `nav ?n=N&onloadAlert=1` → `dialog accept` → `snap` | the `nav` exits 3 with `Navigation to … started, but the page opened a alert dialog while loading.`; after accept, `snap` exits 0 and the title is `fr2-04 N` |
| **L11** no self-heal, probe live | during L1's open dialog: `sessions --json` (FR2-03) | this session's entry has `status:'live'` and `endpointReachable:true`; `chromePid` unchanged across all of L1-L10 |
| **L12** iframe dialog | `eval "document.querySelector('#ifr').contentDocument.querySelector('#ifr-alert').click()"` (report) → `dialog accept` | eval exits 3 with message `fr2-04 iframe N`; after accept, the record has `frame:true` returned |
| **L13** headed smoke (Windows desktop) | L1 with `nav --headed` | same assertions as L1 |
| **L14** cleanup | `close` in every case cwd | 0 Chrome processes containing `realpath(R)`; Branch W: 0 warden processes for R, and no `warden.json` left; `violations.length === 0`; `rm R` with retry |

Every "within N s" assertion polls a condition with a deadline. The only races are "not-yet" races, as in FR2-01.

---

## 6. Negative cases (asserted in §5 unless noted)

| # | Case | Expected |
|---|---|---|
| N1 | `dialog accept` with nothing open | exit 1, `Error: no dialog is open to accept.` |
| N2 | `dialog dismiss extra` | exit 1 with the usage text |
| N3 | `snap --dialog-text x` (no `--dialog accept`) | exit 1 with the §2.6 message; no Chrome contacted (the state file's mtime is unchanged) |
| N4 | `snap --dialog bogus` | exit 1 with the §2.6 message |
| N5 | `dialog accept --dialog dismiss` | exit 1 with the §2.6 message |
| N6 | `dialog` with no session | exit 1, `No active session.` |
| N7 | Observer contamination | `violations === 0`; the observer never called `pages()` (a spy wrapper counts calls: 0) |
| N8 | A dialog on a **background** tab (`newtab` → observer triggers a confirm there) → `snap` | exit 3 (the gate is conservative across tabs); the pending line's URL is the background tab's |
| N9 | A long-running script, not a dialog (`eval "setTimeout(()=>{const t=Date.now();while(Date.now()-t<4000){}},0)"` → `snap` immediately) | the gate prints the `busy` note and does **not** exit 3; `snap` completes (exit 0) |
| N10 | Watchdog | `SUTRADHAR_CLI_DEADLINE_MS=3000`, and the observer opens a blocking confirm on a background tab **after** the gate (a `newtab` whose load triggers `timerKind=confirm&timerMs=200`) → `tabs` | exits 1 within 3000 + 1500 ms with the exact watchdog message |
| N11 | `close --profile` session with an open dialog (adversarial) | exit 0; stderr has the "storage state was not saved" warning; completes in < 10 s (no 180 s attach) |
| N12 | Branch W: kill the warden (`taskkill /PID <w> /F`) → the next command | the next command respawns it (a new pid in `warden.json`); dialogs opened **after** the respawn are handleable |
| N13 | Branch W: a wrong token (adversarial `curl` to the warden port) | 401; the dialog stays pending (observer `blocked`) |
| N14 | Two concurrent `dialog accept` in the same cwd (adversarial) | exactly one prints `Accepted …`, the other exits 1 `no dialog is open` or with a CDP error; the record has exactly one `returned` entry |

---

## 7. Risks, and every caller whose behavior changes

| # | Caller | Change | Mitigation / evidence |
|---|---|---|---|
| R1 | CLI users | Commands exit **3** while a dialog is open, instead of the E3 behavior (a 180 s hang, then a blank tab or a Chrome kill) | New exit code; documented in help, README, changelog |
| R2 | CLI users | **The self-heal no longer covers `fn()` errors** (GAP-006 closed). A mid-command failure now exits 1 instead of respawning Chrome. | W3 test; the next command's attach still self-heals a truly dead endpoint |
| R3 | CLI users | The default dialog mode changes from `auto` to `report`. `eval "alert()"` now exits 3 in under 1 s instead of blocking for 30 s. Click-then-dialog processes no longer linger 3 s (no ref'd 30 s timer). | changelog fragment |
| R4 | CLI performance | Branch D: one extra `puppeteer.connect` plus liveness per command (budget ≤ 300 ms median, measured in `gate-overhead.json`). Branch W: one localhost HTTP call, plus one Node process of about 40 MB per session. | measured; an Auditor gate |
| R5 | MCP, SDK, apps/server | **None by default.** `'auto'` is byte-for-byte today's behavior (T1, R3). There are new optional runtime methods, and no tool-count or result-shape change. | `tools.spec.ts` count unchanged |
| R6 | FR2-03 GC and close | The warden must not lock dirs and must not outlive Chrome | `cwd: homedir`; exits on disconnect or state change (WD5, WD6); `stopWarden` in close (L14) |
| R7 | Internal Puppeteer API | `targetId` reads `_targetId` (pp 25.5.0) | LV5 guards it; it's optional (`undefined` → state hint without targetId) |
| R8 | Residual hang window | A dialog that opens **between** the gate and `attach`'s page init still blocks `browser.pages()` until `protocolTimeout` (180 s), and `findAllOpenPages` then falls back to a blank tab | Bounded by the watchdog (N10). Logged as GAP-017 (make `findAllOpenPages` fail loudly on timeout). `protocolTimeout` isn't lowered, because that would put long legitimate screenshot and PDF calls at risk. |
| R9 | Same-process tabs | A dialog in tab A can block tab B if they share a renderer (opener-related). The gate is conservative across all tabs (N8). | E8 records the real behavior |
| R10 | Double handling (Branch W) | In-process policy and the warden both apply the same policy. At worst the second handle hits the next dialog of a chain, with the same policy, so the same outcome. | WD2's grace; L7 |
| R11 | Chromium behavior drift | C12 is recalled, not in-repo | Step 1 is committed evidence; re-run it when Chrome's major version changes (note in the README maintainer section) |

### 7.1 Decisions to record in decisions.md

| # | Decision |
|---|---|
| D-1 | Native CDP handling. The init-script override is rejected, for the 4 reasons in §0.5. |
| D-2 | The policy lives in `BrowserTab` with a session default. The runtime default is `auto`, so MCP and SDK are unchanged. The CLI default is `report`. |
| D-3 | The `dialogPending:`/`dialogHandled:` one-line JSON contract; MCP results deferred to FR2-07 |
| D-4 | Exit code 3; a 300 s watchdog; the grace constants in §0.4 |
| D-5 | beforeunload: report keeps the 3 s accept during navigation; dismiss cancels, and `nav` exits 1 |
| D-6 | The gate runs before attach; GAP-006 is closed by moving `fn()` out of the self-heal `try` |
| D-7 | The branch chosen by Step 1, with the evidence path |
| D-8 | FIFO `dialog` verb; the gate is conservative across tabs |
| D-9 | Prompt accept with no text means the prompt's default value |
| D-10 | Branch W: `warden.json` is a sidecar (no state-file write races); a hidden verb on the same bin (no new bundle entry) |

### 7.2 Existing tests and scripts to re-run

- `packages/browser`, `capability-runtime`, `cli` and `mcp-server` vitest suites (all).
- `tools/scenario-suite` on all 3 surfaces. There are no dialogs in any scenario (grep confirmed), but `withSession` changed.
- `verify-fr2-01-wait-states.mjs` CLI section.
- `verify-fr2-03-session-gc.mjs` (C1, C2 self-heal, C8 no-harm), because of the `withSession` restructure.

### 7.3 New gaps to log

| gap | severity | description |
|---|---|---|
| GAP-006 | major if E3 shows a self-heal kill | Fixed-in FR2-04 (§2.8.3) |
| GAP-017 | major | `runtime.attach` → `findAllOpenPages` (`runtime.ts:325-336`) swallows a 180 s page-init timeout on a dialog-blocked page and silently adopts a **new blank tab**. This affects MCP `browser.attach` too. |
| GAP-018 | minor | MCP and SDK action results carry no `dialogPending`. Deferred to FR2-07's unified contract. |
| GAP-019 | minor | `runtime.clickAtPoint` (`:514-545`) has no dialog race, so MCP `click_at_point` on a dialog-opening point blocks until the 30 s auto-dismiss |

---

## 8. Rollback

`git revert <FR2-04 commit>`. Everything is additive except the CLI default and the GAP-006 flow.

**Persisted artifacts:**
- `dialogPolicy` and `lastPendingDialog` in `state.json` are ignored by older CLIs.
- Branch W: running wardens exit on their own when their Chrome closes (`close` or GC) or when `state.json` changes endpoint. A leftover `warden.json` is harmless.

**After a revert:**
- the CLI goes back to the E3 behavior (the documented hang);
- append a decisions.md entry;
- set the ledger row back;
- drop the changelog fragment.

**Partial rollback options:**
- If only the warden misbehaves, set the broker selection to Direct. That's a one-line constant in `dialog-broker.ts`, which degrades cross-process handling back to D-hint detection-only.
- If the GAP-006 split causes regressions, restore `fn()` inside the `try`, but keep `DialogBlockedError` rethrown from the catch.

---

### Critical Files for Implementation
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\browser\src\session\browser-tab.ts
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\cli\src\cli.ts
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\capability-runtime\src\runtime.ts
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\cli\src\parse-args.ts
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\browser\src\session\browser-session.ts
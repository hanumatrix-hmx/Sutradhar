#!/usr/bin/env node
/**
 * @file packages/cli/src/cli.ts
 * @description Terminal CLI for driving the PinchTab browser engine directly, without an MCP
 * client or writing a script — `pinchtab nav <url>`, `pinchtab snap`, `pinchtab click <ref>`,
 * etc. Session continuity across separate CLI invocations works via attach()-ing back to the
 * same browser's CDP wsEndpoint, persisted in ~/.pinchtab-cli/state.json between calls.
 */
import { PinchTabRuntime } from '@pinchtab/capability-runtime';
import { StructuredLogger } from '@pinchtab/observability';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readState, writeState, clearState } from './state.js';
import { spawnDetachedChrome, killChromeTree } from './spawn-chrome.js';
import { createSessionId } from '@pinchtab/contracts';

const logger = new StructuredLogger({ minLevel: 'error' }); // CLI output IS the log; keep engine logs quiet
const [, , verb, ...args] = process.argv;
const headed = args.includes('--headed');
const failOnDiff = args.includes('--fail-on-diff');
const profileFlagIndex = args.indexOf('--profile');
const profileFlag = profileFlagIndex !== -1 ? args[profileFlagIndex + 1] : undefined;
const cleanArgs = args.filter(
  (a, i) =>
    a !== '--headed' &&
    a !== '--fail-on-diff' &&
    a !== '--profile' &&
    !(profileFlagIndex !== -1 && i === profileFlagIndex + 1),
);

// Tracked so main()'s cleanup can disconnect the CDP client connection (NOT close the browser)
// before exiting — severing it lets Node's event loop drain and exit naturally, which flushes
// stdout properly. A raw process.exit() right after console.log() can truncate/interleave
// output on Windows if the write hasn't finished flushing yet.
let activeRuntime: PinchTabRuntime | undefined;
let activeSessionId: string | undefined;

function printErrorAndExit(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

async function withSession<T>(fn: (runtime: PinchTabRuntime, sessionId: string) => Promise<T>): Promise<T> {
  const runtime = new PinchTabRuntime({ logger });
  activeRuntime = runtime;
  const state = await readState();

  if (state) {
    try {
      const { sessionId } = await runtime.attach({ endpoint: state.wsEndpoint, sessionId: state.sessionId });
      activeSessionId = sessionId;
      return await fn(runtime, sessionId);
    } catch (err) {
      printErrorAndExit(
        `Could not reconnect to the previous session (${(err as Error).message}). ` +
          `Run "pinchtab close" to clear stale state, then "pinchtab nav <url>" to start over.`,
      );
    }
  }

  // Spawn Chrome directly (detached) rather than via runtime.launch() — Puppeteer's own
  // launcher ties the browser's lifetime to THIS process and would close it the moment this
  // CLI command exits, defeating persistence across separate invocations entirely.
  let profileUserDataDir: string | undefined;
  if (profileFlag) {
    try {
      profileUserDataDir = await runtime.getProfileManager().resolveUserDataDir(profileFlag);
    } catch (err) {
      printErrorAndExit((err as Error).message);
    }
  }
  let spawned: Awaited<ReturnType<typeof spawnDetachedChrome>>;
  try {
    spawned = await spawnDetachedChrome(!headed, profileUserDataDir);
  } catch (err) {
    printErrorAndExit((err as Error).message);
  }
  const attached = await runtime.attach({ endpoint: spawned.wsEndpoint });
  if (!attached.hasRealBrowser) {
    printErrorAndExit('Spawned Chrome but could not attach to it. Run "pinchtab doctor" to diagnose.');
  }
  await writeState({ sessionId: attached.sessionId, wsEndpoint: spawned.wsEndpoint, chromePid: spawned.pid });
  activeSessionId = attached.sessionId;
  return fn(runtime, attached.sessionId);
}

async function cmdProfile(sub: string | undefined, name: string | undefined, rest: string[]) {
  const runtime = new PinchTabRuntime({ logger });
  const profiles = runtime.getProfileManager();

  switch (sub) {
    case 'create': {
      if (!name) printErrorAndExit('usage: pinchtab profile create <name> [description]');
      const info = await profiles.create(name!, rest.join(' ') || undefined);
      console.log(`Created profile "${info.name}" at ${info.userDataDir}`);
      return;
    }
    case 'list': {
      const list = await profiles.list();
      if (list.length === 0) {
        console.log('No profiles yet. Create one with "pinchtab profile create <name>".');
        return;
      }
      for (const p of list) {
        console.log(`${p.name}${p.description ? ` — ${p.description}` : ''} (created ${p.createdAt})`);
      }
      return;
    }
    case 'delete': {
      if (!name) printErrorAndExit('usage: pinchtab profile delete <name>');
      await profiles.delete(name!);
      console.log(`Deleted profile "${name}" (cookies/history/storage removed).`);
      return;
    }
    default:
      printErrorAndExit('usage: pinchtab profile <create|list|delete> [args]');
  }
}

async function cmdDoctor() {
  const runtime = new PinchTabRuntime({ logger });
  const health = runtime.checkHealth();
  console.log(`Platform:        ${process.platform} (${process.arch})`);
  console.log(`Node version:    ${process.version}`);
  console.log(`Chrome found:    ${health.hasChrome ? 'yes' : 'no'}`);
  if (health.executablePath) console.log(`Chrome path:     ${health.executablePath}`);
  if (!health.hasChrome) {
    console.log('\nNo Chrome/Chromium/Edge found on the standard paths for this platform.');
    console.log('Set CHROME_PATH to point at your browser executable, or install Chrome.');
  }
  const state = await readState();
  console.log(`Active session:  ${state ? `${state.sessionId} (attach via saved wsEndpoint)` : 'none'}`);
}

async function cmdNav(url: string | undefined) {
  if (!url) printErrorAndExit('usage: pinchtab nav <url> [--headed]');
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.navigate(sessionId, url!);
    console.log(`Navigated to ${result.url}`);
    console.log(`Title: ${result.title}`);
  });
}

async function cmdSnap() {
  await withSession(async (runtime, sessionId) => {
    const snap = await runtime.snapshot(sessionId);
    // interactiveElements already includes its own "URL: ... / Title: ... / Interactive
    // elements (N):" header — printing snap.url/title/elementCount again separately would just
    // duplicate it (and elementCount counts ALL DOM graph nodes, not just the interactive
    // subset the header's own count describes, so the two numbers can legitimately differ).
    console.log(snap.interactiveElements);
  });
}

async function cmdAxSnap() {
  await withSession(async (runtime, sessionId) => {
    const snap = await runtime.axSnapshot(sessionId);
    console.log(`URL: ${snap.url}`);
    console.log(`Title: ${snap.title}`);
    console.log(`\nAccessible elements (${snap.nodeCount}):`);
    console.log(snap.listing);
    console.log(
      '\n(No ids here — act on these via "pinchtab click <text>" / typing into a labeled ' +
        'field; this listing never goes stale even if the page re-renders.)',
    );
  });
}

async function cmdText() {
  await withSession(async (runtime, sessionId) => {
    const snap = await runtime.snapshot(sessionId);
    console.log(snap.pageText);
  });
}

async function cmdClick(ref: string | undefined) {
  if (!ref) printErrorAndExit('usage: pinchtab click <ref>  (ref = a selector, or a numeric id from "pinchtab snap")');
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.click(sessionId, ref!);
    console.log(result.success ? `Clicked ${ref}` : `Click failed: ${result.error}`);
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdClickText(text: string | undefined) {
  if (!text) printErrorAndExit('usage: pinchtab clicktext <text>  (matches an element containing this text, from "pinchtab axsnap")');
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.clickByText(sessionId, text!);
    console.log(result.success ? `Clicked element containing "${text}"` : `Click failed: ${result.error}`);
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdClickRole(role: string | undefined, name: string | undefined) {
  if (!role) printErrorAndExit('usage: pinchtab clickrole <role> [name]  (role from "pinchtab axsnap", e.g. button)');
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.clickByRole(sessionId, role!, name);
    console.log(result.success ? `Clicked role "${role}"${name ? ` "${name}"` : ''}` : `Click failed: ${result.error}`);
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdType(ref: string | undefined, text: string | undefined) {
  if (!ref || text === undefined) printErrorAndExit('usage: pinchtab type <ref> <text>');
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.type(sessionId, ref!, text!);
    console.log(result.success ? `Typed into ${ref}` : `Type failed: ${result.error}`);
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdPress(ref: string | undefined, key: string | undefined) {
  if (!ref || !key) printErrorAndExit('usage: pinchtab press <ref> <key>  (e.g. pinchtab press 3 Enter)');
  await withSession(async (runtime, sessionId) => {
    await runtime.click(sessionId, ref!).catch(() => {}); // focus the target first, best-effort
    const result = await runtime.pressKey(sessionId, key!);
    console.log(result.success ? `Pressed ${key}` : `Press failed: ${result.error}`);
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdScreenshot(outPath: string | undefined) {
  const dest = path.resolve(outPath ?? 'screenshot.png');
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.screenshot(sessionId);
    await writeFile(dest, Buffer.from(result.base64, 'base64'));
    console.log(`Saved screenshot to ${dest}`);
  });
}

async function cmdAudit(url: string | undefined, outDir: string | undefined) {
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.audit(sessionId, { url });
    const dir = path.resolve(outDir ?? '.');
    const screenshotPath = path.join(dir, 'audit-screenshot.png');
    await writeFile(screenshotPath, Buffer.from(result.screenshotBase64, 'base64'));

    console.log(`URL: ${result.url}`);
    console.log(`Title: ${result.title}`);
    console.log(`Screenshot: ${screenshotPath}`);
    console.log(`\nWeb Vitals:`);
    console.log(`  LCP: ${result.webVitals.lcpMs ?? 'n/a'}ms`);
    console.log(`  CLS: ${result.webVitals.cls ?? 'n/a'}`);
    console.log(`  FCP: ${result.webVitals.fcpMs ?? 'n/a'}ms`);
    console.log(`  TTFB: ${result.webVitals.ttfbMs ?? 'n/a'}ms`);
    console.log(`\nConsole errors: ${result.consoleErrors.length}`);
    for (const e of result.consoleErrors) console.log(`  - ${e.text}`);
    console.log(`Page errors: ${result.pageErrors.length}`);
    for (const e of result.pageErrors) console.log(`  - ${e.message}`);
    console.log(`Broken requests (4xx/5xx): ${result.brokenRequests.length}`);
    for (const r of result.brokenRequests) console.log(`  - [${r.status}] ${r.url}`);
    console.log(`\nAccessibility issues: ${result.accessibilityIssues.length}`);
    for (const issue of result.accessibilityIssues) {
      console.log(`  - ${issue.description} (${issue.count})`);
    }
  });
}

async function cmdCompare(urlA: string | undefined, urlB: string | undefined, outPath: string | undefined) {
  if (!urlA || !urlB) printErrorAndExit('usage: pinchtab compare <urlA> <urlB> [diffOutPath] [--fail-on-diff]');
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.compareUrls(sessionId, urlA!, urlB!);
    const dest = path.resolve(outPath ?? 'diff.png');
    await writeFile(dest, Buffer.from(result.diffImageBase64, 'base64'));

    console.log(`${urlA} vs ${urlB}`);
    console.log(`Diff: ${result.diffPixelCount} / ${result.totalPixels} pixels (${result.diffPercentage.toFixed(2)}%)`);
    console.log(`Diff image: ${dest}`);
    if (failOnDiff && result.diffPercentage > 0) process.exitCode = 1; // CI-friendly gate, opt-in only
  });
}

async function cmdClose() {
  const state = await readState();
  if (!state) {
    console.log('No active session.');
    return;
  }
  if (state.chromePid) {
    // attach()-ed sessions only ever DETACH on shutdown (by design — see spawn-chrome.ts's
    // SpawnedChrome doc comment), so for a Chrome process THIS CLI spawned, runtime.shutdown()
    // alone would leak it. Kill the actual process (and its child renderer/GPU processes).
    killChromeTree(state.chromePid);
  } else {
    const runtime = new PinchTabRuntime({ logger });
    try {
      const { sessionId } = await runtime.attach({ endpoint: state.wsEndpoint, sessionId: state.sessionId });
      await runtime.shutdown(sessionId);
    } catch {
      // Already gone (browser closed externally, etc.) — clearing state is still the right move.
    }
  }
  await clearState();
  console.log('Session closed.');
}

async function main() {
  switch (verb) {
    case 'doctor':
      return cmdDoctor();
    case 'nav':
      return cmdNav(cleanArgs[0]);
    case 'snap':
      return cmdSnap();
    case 'axsnap':
      return cmdAxSnap();
    case 'text':
      return cmdText();
    case 'click':
      return cmdClick(cleanArgs[0]);
    case 'clicktext':
      return cmdClickText(cleanArgs.join(' '));
    case 'clickrole':
      return cmdClickRole(cleanArgs[0], cleanArgs[1]);
    case 'type':
      return cmdType(cleanArgs[0], cleanArgs.slice(1).join(' '));
    case 'press':
      return cmdPress(cleanArgs[0], cleanArgs[1]);
    case 'screenshot':
      return cmdScreenshot(cleanArgs[0]);
    case 'audit':
      return cmdAudit(cleanArgs[0], cleanArgs[1]);
    case 'compare':
      return cmdCompare(cleanArgs[0], cleanArgs[1], cleanArgs[2]);
    case 'close':
      return cmdClose();
    case 'profile':
      return cmdProfile(cleanArgs[0], cleanArgs[1], cleanArgs.slice(2));
    default:
      console.log(`PinchTab CLI

Usage: pinchtab <command> [args] [--headed] [--profile <name>]

Commands:
  nav <url>                    Navigate to a URL (launches a session if none is active)
  snap                         Print the interactive-element listing for the current page
  axsnap                       Accessibility-tree listing — no ids, never goes stale even if
                                the page re-renders; pair with clicktext/clickrole below
  text                         Print the current page's visible text
  click <ref>                  Click an element (selector, or a numeric id from "snap")
  clicktext <text>             Click the element containing this text (from "axsnap")
  clickrole <role> [name]      Click by accessibility role, optionally narrowed by name
                                (from "axsnap", e.g. clickrole button Submit)
  type <ref> <text>            Type text into an element
  press <ref> <key>            Focus an element then press a key (e.g. Enter)
  screenshot [path]            Save a screenshot (default: ./screenshot.png)
  audit [url] [outDir]         Screenshot + console/page/network errors + accessibility
                                checks + Core Web Vitals for a page (current page if no url)
  compare <urlA> <urlB> [out]  Visual regression: pixel-diff two pages, save a diff image
  close                        Close the active session
  doctor                       Environment diagnostics (Chrome detection, active session)
  profile create <name> [desc] Create a named, persistent profile (cookies/history/storage
                                survive across separate launches)
  profile list                 List profiles
  profile delete <name>        Delete a profile (irreversibly removes its stored data)

Flags:
  --profile <name>     Launch as a named persistent profile (only applies to "nav" when
                        starting a new session — create one first with "profile create")
  --headed             Launch visibly instead of headless (only applies to "nav" when
                        starting a new session)
  --fail-on-diff        "compare" exits nonzero if any pixel difference is found (CI gating)

Session state persists across commands in ~/.pinchtab-cli/state.json — run "close" when done.`);
      process.exitCode = verb ? 1 : 0;
  }
}

main()
  .catch((err) => {
    console.error(`Fatal: ${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Every command here is one-shot — nothing legitimately needs to keep the process running
    // after it prints its result. The open CDP WebSocket connection to Chrome (left
    // intentionally alive so the browser survives for the NEXT CLI invocation to attach to)
    // would otherwise keep Node's event loop alive forever. Disconnect the CDP *client*
    // connection (NOT the browser — `disconnect()`, never `close()`/`shutdown()`) so the event
    // loop drains and the process exits naturally, flushing stdout properly. A raw
    // process.exit() immediately after console.log() can truncate/interleave output on Windows
    // if the write hasn't finished flushing yet — this avoids needing that hammer at all.
    const session = activeSessionId
      ? activeRuntime?.getSessionManager().getSession(createSessionId(activeSessionId))
      : undefined;
    await session?.getPuppeteerBrowser()?.disconnect();

    // Fallback safety net: if something else is still holding the event loop open a few
    // seconds later, force-exit rather than hang forever. unref()'d so it never itself keeps
    // the process alive if everything already drained cleanly.
    setTimeout(() => process.exit(process.exitCode ?? 0), 3000).unref();
  });

#!/usr/bin/env node
/**
 * @file packages/cli/src/cli.ts
 * @description Terminal CLI for driving the Sutradhar browser engine directly, without an MCP
 * client or writing a script — `sutradhar nav <url>`, `sutradhar snap`, `sutradhar click <ref>`,
 * etc. Session continuity across separate CLI invocations works via attach()-ing back to the
 * same browser's CDP wsEndpoint, persisted in ~/.sutradhar-cli/state.json between calls.
 */
import { SutradharRuntime } from '@sutradhar/capability-runtime';
import { StructuredLogger } from '@sutradhar/observability';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readState, writeState, clearState } from './state.js';
import { spawnDetachedChrome, killChromeTree } from './spawn-chrome.js';
import { createSessionId } from '@sutradhar/contracts';
import { parseArgs } from './parse-args.js';

const logger = new StructuredLogger({ minLevel: 'error' }); // CLI output IS the log; keep engine logs quiet
const {
  verb,
  cleanArgs,
  headed,
  failOnDiff,
  jsonMode,
  profileFlag,
  userAgentFlag,
  allowlistDomainsFlag,
  baselineFlag,
  settle,
} = parseArgs(process.argv.slice(2));

// Tracked so main()'s cleanup can disconnect the CDP client connection (NOT close the browser)
// before exiting — severing it lets Node's event loop drain and exit naturally, which flushes
// stdout properly. A raw process.exit() right after console.log() can truncate/interleave
// output on Windows if the write hasn't finished flushing yet.
let activeRuntime: SutradharRuntime | undefined;
let activeSessionId: string | undefined;

function printErrorAndExit(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

/** Spawns a fresh detached Chrome (see spawn-chrome.ts for why not runtime.launch()), attaches
 *  to it, and persists the new session as CLI state. Shared by the "no prior session" and the
 *  "prior session is dead, self-heal" paths in withSession — a session-worthy new spawn is the
 *  same operation regardless of which one led to it. */
async function spawnFreshSession(runtime: SutradharRuntime): Promise<string> {
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
    spawned = await spawnDetachedChrome(!headed, profileUserDataDir, userAgentFlag);
  } catch (err) {
    printErrorAndExit((err as Error).message);
  }
  const attached = await runtime.attach({ endpoint: spawned.wsEndpoint });
  if (!attached.hasRealBrowser) {
    printErrorAndExit('Spawned Chrome but could not attach to it. Run "sutradhar doctor" to diagnose.');
  }
  await writeState({
    sessionId: attached.sessionId,
    wsEndpoint: spawned.wsEndpoint,
    chromePid: spawned.pid,
    profileName: profileFlag,
  });
  activeSessionId = attached.sessionId;
  return attached.sessionId;
}

async function withSession<T>(fn: (runtime: SutradharRuntime, sessionId: string) => Promise<T>): Promise<T> {
  const runtime = new SutradharRuntime({ logger, allowedDomains: allowlistDomainsFlag });
  activeRuntime = runtime;
  const state = await readState();

  if (state) {
    try {
      const { sessionId } = await runtime.attach({ endpoint: state.wsEndpoint, sessionId: state.sessionId });
      activeSessionId = sessionId;
      return await fn(runtime, sessionId);
    } catch (err) {
      // Self-heal instead of hard-erroring: a dead previous session (Chrome crashed, was
      // closed externally, or the wsEndpoint just went stale) is not something the caller can
      // do anything about except exactly what we're about to do ourselves — clear the stale
      // state and start a new session. Surfacing a manual "run sutradhar close first" error
      // here just adds an extra round-trip for a long-running agent session to get unstuck
      // (found live via INSIGHTS.md's field campaign: this blocked the next command until a
      // human intervened). Best-effort cleanup of the old Chrome process first, in case it's a
      // zombie rather than genuinely gone — killChromeTree is already safe to call on a PID
      // that's already dead.
      console.error(
        `Note: previous session was unreachable (${(err as Error).message}) — starting a fresh session.`,
      );
      if (state.chromePid) killChromeTree(state.chromePid);
      await clearState();
      const sessionId = await spawnFreshSession(runtime);
      return await fn(runtime, sessionId);
    }
  }

  // Spawn Chrome directly (detached) rather than via runtime.launch() — Puppeteer's own
  // launcher ties the browser's lifetime to THIS process and would close it the moment this
  // CLI command exits, defeating persistence across separate invocations entirely.
  const sessionId = await spawnFreshSession(runtime);
  return fn(runtime, sessionId);
}

async function cmdProfile(sub: string | undefined, name: string | undefined, rest: string[]) {
  const runtime = new SutradharRuntime({ logger });
  const profiles = runtime.getProfileManager();

  switch (sub) {
    case 'create': {
      if (!name) printErrorAndExit('usage: sutradhar profile create <name> [description]');
      const info = await profiles.create(name!, rest.join(' ') || undefined);
      console.log(`Created profile "${info.name}" at ${info.userDataDir}`);
      return;
    }
    case 'list': {
      const list = await profiles.list();
      if (list.length === 0) {
        console.log('No profiles yet. Create one with "sutradhar profile create <name>".');
        return;
      }
      for (const p of list) {
        console.log(`${p.name}${p.description ? ` — ${p.description}` : ''} (created ${p.createdAt})`);
      }
      return;
    }
    case 'delete': {
      if (!name) printErrorAndExit('usage: sutradhar profile delete <name>');
      await profiles.delete(name!);
      console.log(`Deleted profile "${name}" (cookies/history/storage removed).`);
      return;
    }
    case 'export-state': {
      const outFile = rest[0];
      if (!name || !outFile) printErrorAndExit('usage: sutradhar profile export-state <name> <outFile>');
      const state = await profiles.loadStorageState(name!);
      if (!state) {
        printErrorAndExit(
          `Profile "${name}" has no saved storage state yet. Launch with "--profile ${name}", log in, ` +
            'then "sutradhar close" (which saves it automatically) before exporting.',
        );
      }
      await writeFile(outFile!, JSON.stringify(state, null, 2), 'utf-8');
      console.log(`Exported storage state for profile "${name}" to ${outFile}`);
      return;
    }
    case 'import-state': {
      const inFile = rest[0];
      if (!name || !inFile) printErrorAndExit('usage: sutradhar profile import-state <name> <inFile>');
      let state: unknown;
      try {
        state = JSON.parse(await readFile(inFile!, 'utf-8'));
      } catch (err) {
        printErrorAndExit(`Could not read/parse "${inFile}": ${(err as Error).message}`);
      }
      if (
        typeof state !== 'object' ||
        state === null ||
        !('cookies' in state) ||
        !('localStorage' in state) ||
        !('sessionStorage' in state)
      ) {
        printErrorAndExit(
          `"${inFile}" does not look like a storage-state file (expected cookies/localStorage/sessionStorage ` +
            'fields — the shape produced by "sutradhar profile export-state" or browser.get_storage_state).',
        );
      }
      // saveStorageState() itself throws a clear "no profile named X" error if it doesn't exist
      // yet — not re-checked here, so that error stays the single source of truth.
      await profiles.saveStorageState(name!, state as Parameters<typeof profiles.saveStorageState>[1]);
      console.log(
        `Imported storage state into profile "${name}" — it will be restored automatically on the next ` +
          `"nav ... --profile ${name}" launch.`,
      );
      return;
    }
    default:
      printErrorAndExit('usage: sutradhar profile <create|list|delete|export-state|import-state> [args]');
  }
}

async function cmdDoctor() {
  const runtime = new SutradharRuntime({ logger });
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
  if (!url) printErrorAndExit('usage: sutradhar nav <url> [--headed]');
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.navigate(sessionId, url!);
    console.log(`Navigated to ${result.url}`);
    console.log(`Title: ${result.title}`);

    // Restore a profile's saved storage state after navigating, mirroring what
    // SutradharRuntime.launch({profileName, initialUrl}) does internally — but the CLI never
    // goes through launch() (it spawns Chrome itself and attach()es, see spawn-chrome.ts), so
    // that internal restore path never runs for CLI sessions. Re-check state here (not passed
    // through withSession) since it may have just been written by a fresh spawn in this same
    // call. Origin-matched and best-effort, same as the runtime's own version — a profile with
    // no saved state, or one saved for a different origin, is a normal no-op, not an error.
    const state = await readState();
    if (state?.profileName) {
      const profiles = runtime.getProfileManager();
      const saved = await profiles.loadStorageState(state.profileName).catch(() => undefined);
      if (saved && saved.origin === new URL(result.url).origin) {
        await runtime.setStorageState(sessionId, saved).catch(() => {});
      }
    }
  });
}

async function cmdSnap(jsonMode: boolean) {
  await withSession(async (runtime, sessionId) => {
    if (jsonMode) {
      // Opt-in structured output (C6) — the raw per-element data interactiveElements was
      // itself rendered from, for a caller that wants real fields (boundingBox, confidence,
      // isEnabled, ...) instead of re-parsing the compact text listing.
      const snap = await runtime.snapshot(sessionId, undefined, undefined, { includeNodes: true });
      console.log(JSON.stringify({ url: snap.url, title: snap.title, elementCount: snap.elementCount, nodes: snap.nodes }, null, 2));
      return;
    }
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
      '\n(No ids here — act on these via "sutradhar click <text>" / typing into a labeled ' +
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
  if (!ref) printErrorAndExit('usage: sutradhar click <ref> [--settle]  (ref = a selector, or a numeric id from "sutradhar snap")');
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.click(sessionId, ref!, undefined, undefined, undefined, settle);
    console.log(result.success ? `Clicked ${ref}` : `Click failed: ${result.error}`);
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdClickText(text: string | undefined) {
  if (!text) printErrorAndExit('usage: sutradhar clicktext <text>  (matches an element containing this text, from "sutradhar axsnap")');
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.clickByText(sessionId, text!);
    console.log(result.success ? `Clicked element containing "${text}"` : `Click failed: ${result.error}`);
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdClickRole(role: string | undefined, name: string | undefined) {
  if (!role) printErrorAndExit('usage: sutradhar clickrole <role> [name]  (role from "sutradhar axsnap", e.g. button)');
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.clickByRole(sessionId, role!, name);
    console.log(result.success ? `Clicked role "${role}"${name ? ` "${name}"` : ''}` : `Click failed: ${result.error}`);
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdType(ref: string | undefined, text: string | undefined) {
  if (!ref || text === undefined) printErrorAndExit('usage: sutradhar type <ref> <text> [--settle]');
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.type(sessionId, ref!, text!, undefined, settle);
    console.log(result.success ? `Typed into ${ref}` : `Type failed: ${result.error}`);
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdPress(ref: string | undefined, key: string | undefined) {
  if (!ref || !key) printErrorAndExit('usage: sutradhar press <ref> <key>  (e.g. sutradhar press 3 Enter)');
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

    let visualDiffPercentage = 0;
    if (baselineFlag) {
      // One-command regression gate: audit's own findings (Web Vitals/console/page/a11y) plus
      // a visual pixel-diff against a known-good baseline URL, instead of running "audit" and
      // "compare" as two separate commands and correlating their output by hand.
      const compareResult = await runtime.compareUrls(sessionId, baselineFlag, result.url);
      const diffPath = path.join(dir, 'audit-baseline-diff.png');
      await writeFile(diffPath, Buffer.from(compareResult.diffImageBase64, 'base64'));
      visualDiffPercentage = compareResult.diffPercentage;
      console.log(`\nVisual diff vs baseline (${baselineFlag}):`);
      console.log(
        `  ${compareResult.diffPixelCount} / ${compareResult.totalPixels} pixels (${compareResult.diffPercentage.toFixed(2)}%)`,
      );
      console.log(`  Diff image: ${diffPath}`);
    }

    if (
      failOnDiff &&
      (result.consoleErrors.length > 0 ||
        result.pageErrors.length > 0 ||
        result.brokenRequests.length > 0 ||
        visualDiffPercentage > 0)
    ) {
      process.exitCode = 1; // CI-friendly gate, opt-in only — same convention as "compare --fail-on-diff"
    }
  });
}

async function cmdCompare(urlA: string | undefined, urlB: string | undefined, outPath: string | undefined) {
  if (!urlA || !urlB) printErrorAndExit('usage: sutradhar compare <urlA> <urlB> [diffOutPath] [--fail-on-diff]');
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

async function cmdSelect(ref: string | undefined, value: string | undefined) {
  if (!ref || value === undefined) printErrorAndExit('usage: sutradhar select <ref> <value>  (ref = a selector, or a numeric id from "snap"; value = the <option>\'s value)');
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.selectOption(sessionId, ref!, value!);
    console.log(result.success ? `Selected "${value}" on ${ref}` : `Select failed: ${result.error}`);
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdWait(ref: string | undefined, timeoutMsArg: string | undefined) {
  if (!ref) printErrorAndExit('usage: sutradhar wait <ref> [timeoutMs]  (ref = a selector, or a numeric id from "snap")');
  const timeoutMs = timeoutMsArg ? Number(timeoutMsArg) : undefined;
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.waitForSelector(sessionId, ref!, timeoutMs);
    console.log(result.success ? `${ref} appeared` : `Wait failed: ${result.error}`);
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdEval(code: string | undefined) {
  if (!code) printErrorAndExit('usage: sutradhar eval <js-expression>  (runs in the page\'s top-level context)');
  await withSession(async (runtime, sessionId) => {
    try {
      const result = await runtime.eval(sessionId, code!);
      console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    } catch (err) {
      console.log(`Eval failed: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });
}

async function cmdHover(ref: string | undefined) {
  if (!ref) printErrorAndExit('usage: sutradhar hover <ref>  (ref = a selector, or a numeric id from "snap")');
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.hover(sessionId, ref!);
    console.log(result.success ? `Hovered ${ref}` : `Hover failed: ${result.error}`);
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdScroll(direction: string | undefined, amountArg: string | undefined) {
  const dir = (direction ?? 'down') as 'up' | 'down' | 'top' | 'bottom';
  if (!['up', 'down', 'top', 'bottom'].includes(dir)) {
    printErrorAndExit('usage: sutradhar scroll [up|down|top|bottom] [amountPx]  (default: down 500px)');
  }
  const amount = amountArg ? Number(amountArg) : undefined;
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.scroll(sessionId, dir, amount);
    console.log(result.success ? `Scrolled ${dir}` : `Scroll failed: ${result.error}`);
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdUpload(ref: string | undefined, filePath: string | undefined) {
  if (!ref || !filePath) printErrorAndExit('usage: sutradhar upload <ref> <filePath>  (ref = a selector, or a numeric id from "snap", targeting an <input type="file">)');
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.uploadFile(sessionId, ref!, path.resolve(filePath!));
    console.log(result.success ? `Uploaded ${filePath} to ${ref}` : `Upload failed: ${result.error}`);
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdDrag(sourceRef: string | undefined, destRef: string | undefined) {
  if (!sourceRef || !destRef) printErrorAndExit('usage: sutradhar drag <sourceRef> <destRef>  (both = a selector, or a numeric id from "snap")');
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.dragAndDrop(sessionId, sourceRef!, destRef!);
    console.log(result.success ? `Dragged ${sourceRef} onto ${destRef}` : `Drag failed: ${result.error}`);
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdDownload(ref: string | undefined, downloadDir: string | undefined) {
  if (!ref) printErrorAndExit('usage: sutradhar download <ref> [downloadDir]  (ref = the element that triggers the download, a selector or a numeric id from "snap")');
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.downloadFile(sessionId, ref!, downloadDir ? path.resolve(downloadDir) : undefined);
    if (result.success) {
      const output = result.output as { downloadedFilename?: string; downloadedPath?: string } | undefined;
      console.log(`Downloaded "${output?.downloadedFilename}" to ${output?.downloadedPath}`);
    } else {
      console.log(`Download failed: ${result.error}`);
      process.exitCode = 1;
    }
  });
}

async function cmdClose() {
  const state = await readState();
  if (!state) {
    console.log('No active session.');
    return;
  }
  if (state.profileName) {
    // Best-effort: persist the current storage state into the profile before killing Chrome,
    // so a login done under "--profile <name>" survives to the next launch. This can't rely on
    // SutradharRuntime.shutdown()'s own auto-save-on-shutdown-for-a-profiled-session logic —
    // that only fires for sessions IT launched via launch({profileName}), which populates its
    // internal sessionProfiles map; the CLI always attach()es to a separately-spawned Chrome
    // instead (see spawn-chrome.ts's doc comment for why), so that bookkeeping never applies
    // here. Replicates the same save step directly against the CLI's own session model.
    try {
      const runtime = new SutradharRuntime({ logger });
      const { sessionId } = await runtime.attach({ endpoint: state.wsEndpoint, sessionId: state.sessionId });
      const storageState = await runtime.getStorageState(sessionId);
      await runtime.getProfileManager().saveStorageState(state.profileName, storageState);
    } catch {
      // Best-effort — a page that navigated away from any real origin, or a session that's
      // already gone, just means there's nothing meaningful to save. Not a reason to block close.
    }
  }
  if (state.chromePid) {
    // attach()-ed sessions only ever DETACH on shutdown (by design — see spawn-chrome.ts's
    // SpawnedChrome doc comment), so for a Chrome process THIS CLI spawned, runtime.shutdown()
    // alone would leak it. Kill the actual process (and its child renderer/GPU processes).
    killChromeTree(state.chromePid);
  } else {
    const runtime = new SutradharRuntime({ logger });
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
      return cmdSnap(jsonMode);
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
    case 'select':
      return cmdSelect(cleanArgs[0], cleanArgs[1]);
    case 'wait':
      return cmdWait(cleanArgs[0], cleanArgs[1]);
    case 'eval':
      return cmdEval(cleanArgs.join(' '));
    case 'hover':
      return cmdHover(cleanArgs[0]);
    case 'scroll':
      return cmdScroll(cleanArgs[0], cleanArgs[1]);
    case 'upload':
      return cmdUpload(cleanArgs[0], cleanArgs[1]);
    case 'drag':
      return cmdDrag(cleanArgs[0], cleanArgs[1]);
    case 'download':
      return cmdDownload(cleanArgs[0], cleanArgs[1]);
    case 'close':
      return cmdClose();
    case 'profile':
      return cmdProfile(cleanArgs[0], cleanArgs[1], cleanArgs.slice(2));
    default:
      console.log(`Sutradhar CLI

Usage: sutradhar <command> [args] [--headed] [--profile <name>] [--allowlist-domains <domains>]

Commands:
  nav <url>                    Navigate to a URL (launches a session if none is active)
  snap                         Print the interactive-element listing for the current page
  snap --json                  Same, plus the raw structured element data as JSON
  axsnap                       Accessibility-tree listing — no ids, never goes stale even if
                                the page re-renders; pair with clicktext/clickrole below
  text                         Print the current page's visible text
  click <ref>                  Click an element (selector, or a numeric id from "snap")
  clicktext <text>             Click the element containing this text (from "axsnap")
  clickrole <role> [name]      Click by accessibility role, optionally narrowed by name
                                (from "axsnap", e.g. clickrole button Submit)
  type <ref> <text>            Type text into an element
  press <ref> <key>            Focus an element then press a key (e.g. Enter)
  select <ref> <value>         Select an <option> by value on a <select>
  wait <ref> [timeoutMs]       Wait for an element to appear and be visible
  eval <js-expression>         Evaluate JS in the page's top-level context, print the result
  hover <ref>                  Hover an element
  scroll [dir] [amountPx]      Scroll the page (dir: up/down/top/bottom, default down 500px)
  upload <ref> <filePath>      Upload a local file into an <input type="file">
  drag <sourceRef> <destRef>   Drag one element onto another
  download <ref> [dir]         Click an element that triggers a download, print the saved path
  screenshot [path]            Save a screenshot (default: ./screenshot.png)
  audit [url] [outDir]         Screenshot + console/page/network errors + accessibility
                                checks + Core Web Vitals for a page (current page if no url)
  audit [url] [outDir] --baseline <baselineUrl>
                                Same, plus a visual pixel-diff against a known-good baseline
                                URL — a one-command regression gate combining audit + compare
  compare <urlA> <urlB> [out]  Visual regression: pixel-diff two pages, save a diff image
  close                        Close the active session
  doctor                       Environment diagnostics (Chrome detection, active session)
  profile create <name> [desc] Create a named, persistent profile (cookies/history/storage
                                survive across separate launches)
  profile list                 List profiles
  profile delete <name>        Delete a profile (irreversibly removes its stored data)
  profile export-state <name> <outFile>
                                Export a profile's saved login state (cookies/localStorage/
                                sessionStorage) to a portable JSON file
  profile import-state <name> <inFile>
                                Pre-bake a profile with login state from a JSON file (e.g. one
                                produced by export-state, or browser.get_storage_state) —
                                restored automatically on the next launch with that profile

Flags:
  --profile <name>     Launch as a named persistent profile (only applies to "nav" when
                        starting a new session — create one first with "profile create")
  --user-agent <ua>    Launch with a custom navigator.userAgent (only applies to "nav" when
                        starting a new session)
  --headed             Launch visibly instead of headless (only applies to "nav" when
                        starting a new session)
  --json                "snap" additionally prints structured per-element data as JSON
  --fail-on-diff        "compare" exits nonzero if any pixel difference is found (CI gating);
                        "audit" exits nonzero if any console/page/broken-request error was
                        found, or (with --baseline) any visual diff from the baseline
  --baseline <url>      "audit" also visually diffs the audited page against this URL
  --settle              "click"/"type" wait for the page to stop actively changing (no DOM
                        mutations, no in-flight network requests) before returning — helps when
                        the action triggers a menu/modal/toast that renders a moment later
  --allowlist-domains <a.com,b.com>
                        Block navigation to any domain not in this comma-separated list (and
                        their subdomains). Per-command, not persisted in session state — pass
                        it on every command that might navigate ("nav", "compare") if you want
                        the guard to hold for the whole session. Does not intercept
                        page-initiated navigation from a clicked link (browser-internal, not
                        routed through this check) — see .ai/known-problems.md PROB-018.

Session state persists across commands in ~/.sutradhar-cli/state.json — run "close" when done.`);
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

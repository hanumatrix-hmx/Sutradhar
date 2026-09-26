#!/usr/bin/env node
/**
 * @file packages/cli/src/cli.ts
 * @description Terminal CLI for driving the Sutradhar browser engine directly, without an MCP
 * client or writing a script — `sutradhar nav <url>`, `sutradhar snap`, `sutradhar click <ref>`,
 * etc. Session continuity across separate CLI invocations works via attach()-ing back to the
 * same browser's CDP wsEndpoint, persisted per-project-directory under
 * ~/.sutradhar-cli/<hash-of-cwd>/state.json between calls (see state.ts).
 */
import { SutradharRuntime } from '@sutradhar/capability-runtime';
import { StructuredLogger } from '@sutradhar/observability';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readState, writeState, clearState, STATE_FILE_PATH, resolveStateRoot, type CliState } from './state.js';
import { spawnDetachedChrome, killChromeTree } from './spawn-chrome.js';
import { createSessionId } from '@sutradhar/contracts';
import { parseArgs, gcFlagError } from './parse-args.js';
import os from 'node:os';
import { getProcessCommandLine, isPidAlive } from './process-list.js';
import { isOwnedTempProfileDir, removeDirWithRetry } from './profile-cleanup.js';
import { buildSessionsSnapshot, formatSessionsHuman, toSessionsJson } from './sessions.js';
import { collectGcSnapshot, planGc, executeGc, formatGcHuman } from './gc.js';
import { validateSelectorArgs, validateFrameChain } from './selector-args.js';

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
  noText,
  idsOnly,
  scanListeners,
  modifiersFlag,
  frameFlag,
  viewportFlag,
  viewportFlagGivenButInvalid,
  stateFlag,
  stateFlagGivenButInvalid,
  unrecognizedFlags,
  allStale,
  gc,
  dryRun,
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
    spawned = await spawnDetachedChrome(!headed, profileUserDataDir, userAgentFlag, viewportFlag, STATE_FILE_PATH);
  } catch (err) {
    printErrorAndExit((err as Error).message);
  }
  let attached: Awaited<ReturnType<typeof runtime.attach>>;
  try {
    attached = await runtime.attach({ endpoint: spawned.wsEndpoint });
  } catch (err) {
    await killChromeTree(spawned.pid).catch(() => {});
    if (spawned.ownsUserDataDir) await removeDirWithRetry(spawned.userDataDir).catch(() => {});
    printErrorAndExit((err as Error).message);
  }
  if (!attached.hasRealBrowser) {
    // Spawned Chrome but the attach didn't produce a usable browser — clean up before erroring
    // out, same as any other spawn-then-fail path (FR2-03: a failed nav must never leak).
    await killChromeTree(spawned.pid).catch(() => {});
    if (spawned.ownsUserDataDir) await removeDirWithRetry(spawned.userDataDir).catch(() => {});
    printErrorAndExit('Spawned Chrome but could not attach to it. Run "sutradhar doctor" to diagnose.');
  }
  if (viewportFlag) {
    await runtime.setViewport(attached.sessionId, viewportFlag);
  }
  await writeState({
    sessionId: attached.sessionId,
    wsEndpoint: spawned.wsEndpoint,
    chromePid: spawned.pid,
    profileName: profileFlag,
    viewport: viewportFlag,
    profileDir: spawned.userDataDir,
    profileDirOwned: spawned.ownsUserDataDir,
    cwd: path.resolve(process.cwd()),
    createdAt: new Date().toISOString(),
  });
  activeSessionId = attached.sessionId;
  return attached.sessionId;
}

/** Shared close/self-heal cleanup (FR2-03 §2.6) — never throws; warnings go to stderr. Kills
 *  the session's Chrome ONLY when it's verifiably still this session's (reachable, or a
 *  command-line match on the recorded profile dir), then removes the owned profile dir. */
async function releaseSessionResources(state: CliState): Promise<void> {
  const probe = state.wsEndpoint ? await probeEndpointSafe(state.wsEndpoint) : false;
  if (state.chromePid) {
    if (probe) {
      await killChromeTree(state.chromePid).catch(() => {});
    } else if (isPidAlive(state.chromePid)) {
      const cmd = await getProcessCommandLine(state.chromePid);
      const tempRoot = os.tmpdir();
      const legacyPrefix = `${tempRoot}${path.sep}sutradhar-cli-`;
      const matches =
        cmd.ok &&
        cmd.commandLine !== undefined &&
        (state.profileDir
          ? cmd.commandLine.includes(state.profileDir) || cmd.commandLine.includes(`--user-data-dir=${state.profileDir}`)
          : cmd.commandLine.includes(legacyPrefix));
      if (matches) {
        await killChromeTree(state.chromePid).catch(() => {});
      } else {
        console.error(
          `Warning: not killing PID ${state.chromePid}: could not verify it is this session's Chrome (${
            cmd.ok ? 'command line does not reference this session\'s profile dir' : cmd.reason
          }).`,
        );
      }
    }
    // else: not alive — nothing to kill.
  }
  if (state.profileDir && state.profileDirOwned) {
    if (isOwnedTempProfileDir(state.profileDir, os.tmpdir(), 'cli')) {
      const r = await removeDirWithRetry(state.profileDir);
      if (r.status === 'failed') {
        console.error(
          `Warning: could not remove profile dir ${state.profileDir} (${r.code} after ${r.attempts} attempts). ` +
            'Reclaim it later with "sutradhar doctor --gc".',
        );
      }
    }
  } else if (!state.profileDir) {
    console.error(
      'Note: this session was created by an older Sutradhar version that did not record its profile dir. ' +
        'Run "sutradhar doctor --gc" to reclaim it.',
    );
  }
}

async function probeEndpointSafe(wsEndpoint: string): Promise<boolean> {
  const { probeEndpoint } = await import('./sessions.js');
  const r = await probeEndpoint(wsEndpoint);
  return r.reachable;
}

async function withSession<T>(fn: (runtime: SutradharRuntime, sessionId: string) => Promise<T>): Promise<T> {
  const runtime = new SutradharRuntime({ logger, allowedDomains: allowlistDomainsFlag });
  activeRuntime = runtime;
  const state = await readState();

  if (state) {
    try {
      const { sessionId } = await runtime.attach({ endpoint: state.wsEndpoint, sessionId: state.sessionId });
      activeSessionId = sessionId;
      // Re-apply any permissions granted in a prior invocation — see CliState.grantedPermissions'
      // doc comment for why this is necessary (the grant itself doesn't survive the reconnect).
      for (const { origin, permissions } of state.grantedPermissions ?? []) {
        await runtime.grantPermissions(sessionId, origin, permissions).catch(() => {});
      }
      // Restore a previously-focused tab — see CliState.activeTabId's doc comment for why this
      // is necessary (setActiveTab's effect is in-memory only and doesn't survive the reconnect).
      if (state.activeTabId && (await runtime.listTabs(sessionId)).some((t) => t.id === state.activeTabId)) {
        await runtime.focusTab(sessionId, state.activeTabId).catch(() => {});
      }
      // Apply this invocation's --viewport if given (and persist it), otherwise re-apply
      // whatever viewport a prior invocation set — see CliState.viewport's doc comment for why
      // this is necessary on every reattach, not just once.
      const effectiveViewport = viewportFlag ?? state.viewport;
      if (effectiveViewport) {
        await runtime.setViewport(sessionId, effectiveViewport).catch(() => {});
      }
      if (viewportFlag) {
        await writeState({ ...state, sessionId, viewport: viewportFlag }).catch(() => {});
      }
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
      await releaseSessionResources(state);
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

  // Leaked-session/profile summary (FR2-03) — computed from a dry plan so `doctor` alone never
  // mutates anything; the summary is what points a user at "--gc --dry-run" in the first place.
  try {
    const snapshot = await collectGcSnapshot();
    const plan = planGc(snapshot);
    const liveCount = snapshot.sessions.sessions.filter((s) => s.status === 'live').length;
    const staleCount = snapshot.sessions.sessions.filter((s) => s.status === 'stale').length;
    const total = snapshot.sessions.sessions.length;
    console.log(`Sessions:        ${total} (${liveCount} live, ${staleCount} stale): "sutradhar sessions" for details`);
    const orphanDirCount = plan.actions.filter((a) => a.type === 'deleteDir').length;
    const orphanProcCount = plan.actions.filter((a) => a.type === 'kill' && a.role === 'browser').length;
    console.log(
      `Leaked profiles: ${orphanDirCount} dirs, ${orphanProcCount} orphan Chrome processes: ` +
        '"sutradhar doctor --gc --dry-run" to preview cleanup',
    );
  } catch (err) {
    console.error(`(Could not compute leaked-session summary: ${(err as Error).message})`);
  }
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
      const snap = await runtime.snapshot(sessionId, undefined, undefined, {
        includeNodes: true,
        scanEventListeners: scanListeners,
      });
      console.log(
        JSON.stringify(
          {
            url: snap.url,
            title: snap.title,
            elementCount: snap.elementCount,
            nodes: snap.nodes,
            skippedFrames: snap.skippedFrames ?? [],
          },
          null,
          2,
        ),
      );
      return;
    }
    const snap = await runtime.snapshot(sessionId, undefined, undefined, { noText, idsOnly, scanEventListeners: scanListeners });
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
  const selectorErr = validateSelectorArgs([ref]);
  if (selectorErr) printErrorAndExit(selectorErr);
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
  const selectorErr = validateSelectorArgs([ref]);
  if (selectorErr) printErrorAndExit(selectorErr);
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.type(sessionId, ref!, text!, undefined, settle);
    console.log(result.success ? `Typed into ${ref}` : `Type failed: ${result.error}`);
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdPress(ref: string | undefined, key: string | undefined) {
  if (!ref || !key) {
    printErrorAndExit(
      'usage: sutradhar press <ref> <key> [--modifiers Control,Shift]  ' +
        '(e.g. sutradhar press 3 Enter, or sutradhar press 3 ArrowRight --modifiers Control,Shift)',
    );
  }
  const selectorErr = validateSelectorArgs([ref]);
  if (selectorErr) printErrorAndExit(selectorErr);
  await withSession(async (runtime, sessionId) => {
    // Focus (not click) the target first, best-effort — a real click would reset any cursor/
    // selection position a prior `press` in the same sequence already established (e.g. Home,
    // then Ctrl+Shift+Right to select a word); .focus() doesn't move the cursor at all.
    await runtime.focus(sessionId, ref!).catch(() => {});
    const result = await runtime.pressKey(sessionId, key!, undefined, modifiersFlag);
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
  const selectorErr = validateSelectorArgs([ref]);
  if (selectorErr) printErrorAndExit(selectorErr);
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.selectOption(sessionId, ref!, value!);
    console.log(result.success ? `Selected "${value}" on ${ref}` : `Select failed: ${result.error}`);
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdWait(ref: string | undefined, timeoutMsArg: string | undefined) {
  if (!ref)
    printErrorAndExit(
      'usage: sutradhar wait <ref> [timeoutMs] [--state visible|attached|hidden]  (ref = a selector, or a numeric id from "snap")',
    );
  // GAP-032: `Number('5s')` (a plausible typo for "5 seconds") is `NaN`, and `Number('')` on an
  // empty-but-present arg is `0` (a real, meaningful "check once" value, so only reject when
  // parsing genuinely fails) — validate here instead of letting a non-finite value reach the
  // engine, which now rejects it too, but with a less actionable message than the CLI can give
  // for its own most likely cause (a typo'd unit suffix).
  const timeoutMs = timeoutMsArg ? Number(timeoutMsArg) : undefined;
  if (timeoutMs !== undefined && !Number.isFinite(timeoutMs)) {
    printErrorAndExit(
      `Invalid timeoutMs "${timeoutMsArg}" — expected a plain number of milliseconds (e.g. 5000 for 5s), ` +
        'not a unit suffix like "5s".',
    );
  }
  const state = stateFlag ?? 'visible';
  const selectorErr = validateSelectorArgs([ref]);
  if (selectorErr) printErrorAndExit(selectorErr);
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.waitForSelector(sessionId, ref!, timeoutMs, undefined, stateFlag);
    console.log(
      result.success
        ? `${ref} is ${state === 'hidden' ? 'hidden or absent' : state} (state=${state})`
        : `Wait failed: ${result.error}`,
    );
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdEval(code: string | undefined) {
  if (!code) {
    printErrorAndExit(
      'usage: sutradhar eval <js-expression> [--frame <selector>]  ' +
        '(runs in the page\'s top-level context by default; --frame targets a specific <iframe>, ' +
        'including a genuinely cross-origin one, by CSS selector or a numeric id from "snap" — ' +
        'chain with :: for an iframe nested inside another iframe, e.g. --frame "iframe.widget::iframe.payment")',
    );
  }
  const frameErr = validateFrameChain(frameFlag);
  if (frameErr) printErrorAndExit(frameErr);
  await withSession(async (runtime, sessionId) => {
    try {
      const result = await runtime.eval(sessionId, code!, undefined, frameFlag);
      console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    } catch (err) {
      console.log(`Eval failed: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });
}

async function cmdHover(ref: string | undefined) {
  if (!ref) printErrorAndExit('usage: sutradhar hover <ref>  (ref = a selector, or a numeric id from "snap")');
  const selectorErr = validateSelectorArgs([ref]);
  if (selectorErr) printErrorAndExit(selectorErr);
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.hover(sessionId, ref!);
    console.log(result.success ? `Hovered ${ref}` : `Hover failed: ${result.error}`);
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdScroll(direction: string | undefined, amountArg: string | undefined, target: string | undefined) {
  const dir = (direction ?? 'down') as 'up' | 'down' | 'top' | 'bottom';
  if (!['up', 'down', 'top', 'bottom'].includes(dir)) {
    printErrorAndExit('usage: sutradhar scroll [up|down|top|bottom] [amountPx] [targetRef] [--settle]  (default: down 500px, window)');
  }
  const amount = amountArg ? Number(amountArg) : undefined;
  const selectorErr = validateSelectorArgs([target]);
  if (selectorErr) printErrorAndExit(selectorErr);
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.scroll(sessionId, dir, amount, undefined, target, settle);
    console.log(
      result.success
        ? `Scrolled ${dir}${target ? ` within ${target}` : ''}`
        : `Scroll failed: ${result.error}`,
    );
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdUpload(ref: string | undefined, filePath: string | undefined) {
  if (!ref || !filePath) printErrorAndExit('usage: sutradhar upload <ref> <filePath>  (ref = a selector, or a numeric id from "snap", targeting an <input type="file">)');
  const selectorErr = validateSelectorArgs([ref]);
  if (selectorErr) printErrorAndExit(selectorErr);
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.uploadFile(sessionId, ref!, path.resolve(filePath!));
    console.log(result.success ? `Uploaded ${filePath} to ${ref}` : `Upload failed: ${result.error}`);
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdDrag(sourceRef: string | undefined, destRef: string | undefined) {
  if (!sourceRef || !destRef) printErrorAndExit('usage: sutradhar drag <sourceRef> <destRef>  (both = a selector, or a numeric id from "snap")');
  const selectorErr = validateSelectorArgs([sourceRef, destRef]);
  if (selectorErr) printErrorAndExit(selectorErr);
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.dragAndDrop(sessionId, sourceRef!, destRef!);
    console.log(result.success ? `Dragged ${sourceRef} onto ${destRef}` : `Drag failed: ${result.error}`);
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdClickPoint(x: string | undefined, y: string | undefined) {
  const xNum = Number(x);
  const yNum = Number(y);
  if (!x || !y || Number.isNaN(xNum) || Number.isNaN(yNum)) {
    printErrorAndExit('usage: sutradhar clickpoint <x> <y>  (absolute viewport coordinates — for canvas-rendered UI with no addressable element)');
  }
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.clickAtPoint(sessionId, xNum, yNum);
    console.log(result.success ? `Clicked at (${xNum}, ${yNum})` : `Click failed: ${result.error}`);
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdDragPoints(
  fromX: string | undefined,
  fromY: string | undefined,
  toX: string | undefined,
  toY: string | undefined,
) {
  const nums = [fromX, fromY, toX, toY].map(Number);
  if ([fromX, fromY, toX, toY].some((v) => v === undefined) || nums.some(Number.isNaN)) {
    printErrorAndExit(
      'usage: sutradhar dragpoints <fromX> <fromY> <toX> <toY>  ' +
        '(absolute viewport coordinates — a real mouse-down->move->up sequence, for canvas-rendered ' +
        'drag targets like a signature pad, slider, or chart handle drawn on a <canvas>)',
    );
  }
  const [fx, fy, tx, ty] = nums;
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.dragAtPoints(sessionId, fx!, fy!, tx!, ty!);
    console.log(result.success ? `Dragged (${fx}, ${fy}) -> (${tx}, ${ty})` : `Drag failed: ${result.error}`);
    if (!result.success) process.exitCode = 1;
  });
}

async function cmdSetClipboard(text: string | undefined) {
  if (text === undefined) printErrorAndExit('usage: sutradhar setclipboard <text>  (requires clipboard permission — see "grant")');
  await withSession(async (runtime, sessionId) => {
    try {
      await runtime.setClipboard(sessionId, text!);
      console.log(`Set clipboard to ${JSON.stringify(text)}`);
    } catch (err) {
      console.log(`Set clipboard failed: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });
}

async function cmdGetClipboard() {
  await withSession(async (runtime, sessionId) => {
    try {
      const text = await runtime.getClipboard(sessionId);
      console.log(text);
    } catch (err) {
      console.log(`Get clipboard failed: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });
}

async function cmdGrant(origin: string | undefined, permissions: string[]) {
  if (!origin || permissions.length === 0) {
    printErrorAndExit(
      'usage: sutradhar grant <origin> <permission...>  ' +
        '(e.g. sutradhar grant https://example.com clipboard-read clipboard-write — required before ' +
        'setclipboard/getclipboard will work against most real sites)',
    );
  }
  await withSession(async (runtime, sessionId) => {
    try {
      await runtime.grantPermissions(sessionId, origin!, permissions);
      console.log(`Granted [${permissions.join(', ')}] for ${origin}`);
      // Persist so the next (separate-process) command re-applies it on reattach — see
      // CliState.grantedPermissions' doc comment.
      const state = await readState();
      if (state) {
        const existing = state.grantedPermissions ?? [];
        const merged = existing.filter((g) => g.origin !== origin);
        merged.push({ origin: origin!, permissions });
        await writeState({ ...state, grantedPermissions: merged });
      }
    } catch (err) {
      console.log(`Grant failed: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });
}

async function cmdTabs() {
  await withSession(async (runtime, sessionId) => {
    const tabs = await runtime.listTabs(sessionId);
    if (tabs.length === 0) {
      console.log('No tabs.');
      return;
    }
    for (const tab of tabs) {
      console.log(`${tab.isActive ? '* ' : '  '}${tab.id}  ${tab.title || '(no title)'}  ${tab.url}`);
    }
  });
}

/** Persists which tab should be active on the next command's reattach — see
 * CliState.activeTabId's doc comment. */
async function persistActiveTab(tabId: string) {
  const state = await readState();
  if (state) await writeState({ ...state, activeTabId: tabId });
}

async function cmdNewTab(url: string | undefined) {
  await withSession(async (runtime, sessionId) => {
    const tab = await runtime.createTab(sessionId, url);
    await persistActiveTab(tab.id);
    console.log(`New tab ${tab.id}${url ? ` opened at ${url}` : ''}`);
  });
}

async function cmdFocusTab(tabId: string | undefined) {
  if (!tabId) printErrorAndExit('usage: sutradhar focustab <tabId>  (see "tabs" for the list of open tab ids)');
  await withSession(async (runtime, sessionId) => {
    try {
      await runtime.focusTab(sessionId, tabId!);
      await persistActiveTab(tabId!);
      console.log(`Focused tab ${tabId}`);
    } catch (err) {
      console.log(`Focus tab failed: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });
}

async function cmdCloseTab(tabId: string | undefined) {
  if (!tabId) printErrorAndExit('usage: sutradhar closetab <tabId>  (see "tabs" for the list of open tab ids)');
  await withSession(async (runtime, sessionId) => {
    try {
      await runtime.closeTab(sessionId, tabId!);
      console.log(`Closed tab ${tabId}`);
    } catch (err) {
      console.log(`Close tab failed: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });
}

async function cmdDownload(ref: string | undefined, downloadDir: string | undefined) {
  if (!ref) printErrorAndExit('usage: sutradhar download <ref> [downloadDir]  (ref = the element that triggers the download, a selector or a numeric id from "snap")');
  const selectorErr = validateSelectorArgs([ref]);
  if (selectorErr) printErrorAndExit(selectorErr);
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
    // alone would leak it. releaseSessionResources kills it (PID-verified) and removes its
    // owned profile dir.
    await releaseSessionResources(state);
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

/** `sutradhar close --all-stale` and `sutradhar doctor --gc` are exact aliases (FR2-03 D3) —
 *  same plan, same execution, same output, same exit codes. `--dry-run` prints the plan and
 *  exits 0 without changing anything. */
async function cmdGc(dryRunFlag: boolean, jsonModeFlag: boolean): Promise<void> {
  // GAP-175: if THIS invocation's own environment happens to carry SUTRADHAR_CLI_STATE_DIR
  // (e.g. gc is run from within the same shared-state shell that a session was started in),
  // scan that directory too -- it may sit outside the default state root entirely. This is a
  // secondary discovery path; the primary fix (finding a session's real state file via the
  // `--sutradhar-state` marker on its own Chrome process, even when gc's OWN env has no idea
  // that custom dir exists) lives in `collectGcSnapshot` itself. See spec §0.1/G8 and decisions.md.
  const extraStateDirs = process.env.SUTRADHAR_CLI_STATE_DIR ? [process.env.SUTRADHAR_CLI_STATE_DIR] : [];
  const snapshot = await collectGcSnapshot({ extraStateDirs });
  const plan = planGc(snapshot);
  const report = await executeGc(plan, snapshot, dryRunFlag);
  if (jsonModeFlag) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatGcHuman(report));
  }
  process.exitCode = report.exitCode;
}

async function cmdSessions(jsonModeFlag: boolean): Promise<void> {
  const { listProcesses } = await import('./process-list.js');
  const tempRoot = os.tmpdir();
  const stateRoot = resolveStateRoot(process.env.SUTRADHAR_CLI_STATE_ROOT);
  const processEnumeration = await listProcesses();
  const snapshot = await buildSessionsSnapshot({
    stateRoot,
    currentStateFile: STATE_FILE_PATH,
    processEnumeration,
    tempRoot,
  });
  if (jsonModeFlag) {
    console.log(JSON.stringify(toSessionsJson(snapshot), null, 2));
  } else {
    console.log(formatSessionsHuman(snapshot));
  }
}

async function main() {
  // A `--foo`-shaped argument the parser doesn't recognize is almost certainly a typo'd or
  // misplaced flag, not literal positional data — reject it here, before any command gets a
  // chance to silently treat it as a filename/selector/etc. Found live (external field report,
  // PROB-042): `sutradhar screenshot --help` created a real file literally named `--help` on
  // disk instead of erroring or showing help, because `screenshot`'s positional `[path]` arg
  // just took whatever was left over with no validation at all.
  if (unrecognizedFlags.length > 0) {
    printErrorAndExit(
      `Unrecognized flag ${unrecognizedFlags.map((f) => `"${f}"`).join(', ')} — run "sutradhar" ` +
        'with no arguments to see the full command/flag list, or check for a typo.',
    );
  }
  if (viewportFlagGivenButInvalid) {
    printErrorAndExit('--viewport must be WIDTHxHEIGHT (e.g. --viewport 390x844)');
  }
  if (stateFlagGivenButInvalid) {
    printErrorAndExit('--state must be one of: visible, attached, hidden (e.g. wait "#toast" --state hidden)');
  }
  const gcErr = gcFlagError({
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
    noText,
    idsOnly,
    scanListeners,
    modifiersFlag,
    frameFlag,
    viewportFlag,
    viewportFlagGivenButInvalid,
    stateFlag,
    stateFlagGivenButInvalid,
    unrecognizedFlags,
    allStale,
    gc,
    dryRun,
  });
  if (gcErr) printErrorAndExit(gcErr);
  switch (verb) {
    case 'doctor':
      if (gc) return cmdGc(dryRun, jsonMode);
      return cmdDoctor();
    case 'sessions':
      return cmdSessions(jsonMode);
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
      return cmdScroll(cleanArgs[0], cleanArgs[1], cleanArgs[2]);
    case 'upload':
      return cmdUpload(cleanArgs[0], cleanArgs[1]);
    case 'drag':
      return cmdDrag(cleanArgs[0], cleanArgs[1]);
    case 'clickpoint':
      return cmdClickPoint(cleanArgs[0], cleanArgs[1]);
    case 'dragpoints':
      return cmdDragPoints(cleanArgs[0], cleanArgs[1], cleanArgs[2], cleanArgs[3]);
    case 'setclipboard':
      return cmdSetClipboard(cleanArgs.join(' '));
    case 'getclipboard':
      return cmdGetClipboard();
    case 'grant':
      return cmdGrant(cleanArgs[0], cleanArgs.slice(1));
    case 'tabs':
      return cmdTabs();
    case 'newtab':
      return cmdNewTab(cleanArgs[0]);
    case 'focustab':
      return cmdFocusTab(cleanArgs[0]);
    case 'closetab':
      return cmdCloseTab(cleanArgs[0]);
    case 'download':
      return cmdDownload(cleanArgs[0], cleanArgs[1]);
    case 'close':
      if (allStale) return cmdGc(dryRun, jsonMode);
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
  snap --no-text                Same elements, drops name/label/placeholder/value text
                                (keeps tag+role+id) — smaller listing when you already know
                                what you're targeting and just need fresh ids
  snap --ids-only                Smallest listing: only the bracketed [#id], nothing else
  snap --scan-listeners          Also finds elements with only a real addEventListener-attached
                                handler (no onclick=/role=/tabindex/cursor:pointer) — e.g.
                                SortableJS-style drag lists. Slower; real CDP introspection.
  axsnap                       Accessibility-tree listing — no ids, never goes stale even if
                                the page re-renders; pair with clicktext/clickrole below
  text                         Print the current page's visible text
  click <ref>                  Click an element (selector, or a numeric id from "snap")
  clicktext <text>             Click the element containing this text (from "axsnap")
  clickrole <role> [name]      Click by accessibility role, optionally narrowed by name
                                (from "axsnap", e.g. clickrole button Submit)
  Selectors are CSS (shadow roots crossed), a numeric id from "snap", or pierce/ xpath/ aria/
                                text/; Playwright syntax (text=, >>, role=) is rejected — use
                                clicktext/clickrole.
  type <ref> <text>            Type text into an element
  press <ref> <key>            Focus an element then press a key (e.g. Enter)
  press <ref> <key> --modifiers Control,Shift
                                Hold modifier keys while pressing (e.g. Ctrl+Shift+ArrowRight
                                to select a word — a real rich-text-editor toolbar formatting
                                workflow)
  select <ref> <value>         Select an <option> by value on a <select>
  wait <ref> [timeoutMs] [--state S]
                                Wait for an element to become visible (default), --state attached
                                (just in the DOM), or --state hidden (removed or not visible).
                                "visible" means non-empty size AND visibility not hidden/collapse
                                — opacity:0 and off-screen elements still count as visible; zero
                                size, display:none and visibility:hidden count as hidden.
                                Visibility is checked on the FIRST matching element only. "hidden"
                                succeeds immediately if nothing matches the selector at all.
                                timeoutMs applies to each internal attempt; retries (GAP-001,
                                still open) can extend the real total wait beyond it. timeoutMs
                                <= 0 checks the current state once, immediately, with no waiting
                                or retrying. Waiting states poll roughly every 100ms, so a state
                                that's only true for less than ~100ms (a fast visibility flicker)
                                may be missed.
  eval <js-expression>         Evaluate JS in the page's top-level context, print the result
  eval <js-expression> --frame <selector>
                                Same, but inside a specific <iframe> (selector or a numeric id
                                from "snap") — including a genuinely cross-origin one the
                                top-level page's own JS could never reach into itself. Chain
                                with :: for an iframe nested inside another iframe, e.g.
                                --frame "iframe.widget::iframe.payment"
  hover <ref>                  Hover an element
  scroll [dir] [amountPx]      Scroll the page (dir: up/down/top/bottom, default down 500px)
  scroll [dir] [amountPx] [targetRef]
                                Scroll a specific element's own scroll container instead of
                                the window (a data grid's rows, a chat pane, a modal body) —
                                pair with --settle to reliably see newly-revealed content
  upload <ref> <filePath>      Upload a local file into an <input type="file">
  drag <sourceRef> <destRef>   Drag one element onto another
  clickpoint <x> <y>           Click at an absolute viewport coordinate — no element/selector,
                                for canvas-rendered UI with nothing DOM-addressable to target
  dragpoints <fromX> <fromY> <toX> <toY>
                                Real mouse-down->move->up drag between two absolute viewport
                                coordinates — for canvas-rendered drag targets (a signature pad,
                                a slider/chart handle drawn on a <canvas>)
  grant <origin> <permission...>
                                Grant browser permissions for an origin (e.g. clipboard-read,
                                clipboard-write, geolocation, notifications) — needed before
                                setclipboard/getclipboard work against most real sites
  setclipboard <text>          Set the system clipboard (e.g. to then paste into a rich-text
                                editor via press <ref> v --modifiers Control)
  getclipboard                 Print the current system clipboard contents
  tabs                         List open tabs (id, title, url) — * marks the active one
  newtab [url]                 Open a new tab, optionally navigating it immediately
  focustab <tabId>             Switch the active tab (e.g. after a link opened target=_blank)
  closetab <tabId>              Close a specific tab
  download <ref> [dir]         Click an element that triggers a download, print the saved path
  screenshot [path]            Save a screenshot (default: ./screenshot.png)
  audit [url] [outDir]         Screenshot + console/page/network errors + accessibility
                                checks + Core Web Vitals for a page (current page if no url)
  audit [url] [outDir] --baseline <baselineUrl>
                                Same, plus a visual pixel-diff against a known-good baseline
                                URL — a one-command regression gate combining audit + compare
  compare <urlA> <urlB> [out]  Visual regression: pixel-diff two pages, save a diff image
  close                        Close the active session
  close --all-stale [--dry-run]
                                Alias of "doctor --gc" — kills orphaned Sutradhar Chrome
                                processes and deletes leaked throwaway profile directories
                                across every CLI session, not just this one
  sessions [--json]            List every CLI session under the state root (live/unresponsive/
                                unknown/stale/unreadable), with age, PID and endpoint status
  doctor                       Environment diagnostics (Chrome detection, active session)
  doctor --gc [--dry-run]      Garbage-collect leaked CLI/runtime Chrome processes and profile
                                directories this Sutradhar orphaned (crashed CLI, killed Node
                                process, etc.) — --dry-run previews without changing anything
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
  --viewport <WxH>      Set the CDP viewport (e.g. --viewport 390x844) and, when --headed, the
                        real OS window's size too. Applies at session creation and persists
                        across later commands until a new --viewport is given
  --json                "snap" additionally prints structured per-element data as JSON
  --fail-on-diff        "compare" exits nonzero if any pixel difference is found (CI gating);
                        "audit" exits nonzero if any console/page/broken-request error was
                        found, or (with --baseline) any visual diff from the baseline
  --baseline <url>      "audit" also visually diffs the audited page against this URL
  --settle              "click"/"type"/"scroll" wait for the page to stop actively changing (no
                        DOM mutations, no in-flight network requests) before returning — helps
                        when the action triggers a menu/modal/toast/virtualized-list-update that
                        renders a moment later
  --state <S>           "wait" only: visible (default), attached (just in the DOM), or hidden
                        (removed or not visible). Ignored on other commands. "visible" is a
                        non-empty box AND visibility not hidden/collapse — opacity:0 and
                        off-screen elements still count as visible; zero size, display:none and
                        visibility:hidden count as hidden. Checked on the FIRST matching element
                        only. "hidden" succeeds immediately if nothing matches at all. timeoutMs
                        is per attempt; retries can extend the real total wait (still open, see
                        GAP-001).
  --no-text             "snap" drops per-element text, keeping tag+role+id (see command list)
  --ids-only            "snap" keeps only the bracketed id, nothing else (see command list)
  --scan-listeners      "snap" also finds real addEventListener-only elements (see command list)
  --allowlist-domains <a.com,b.com>
                        Block navigation to any domain not in this comma-separated list (and
                        their subdomains). Per-command, not persisted in session state — pass
                        it on every command that might navigate ("nav", "compare") if you want
                        the guard to hold for the whole session. Does not intercept
                        page-initiated navigation from a clicked link (browser-internal, not
                        routed through this check) — see .ai/known-problems.md PROB-018.

Boundary: Sutradhar does not attempt to evade bot-detection or solve CAPTCHAs, and Cloudflare
challenges, CAPTCHA walls, and IP-level blocks stop it exactly as they would stop any other
automation tool run the same way. The only launch argument here with detection-relevant
behavior is --disable-blink-features=AutomationControlled, which hides navigator.webdriver
from scripts that check for it -- measured directly: navigator.webdriver is true without the
flag and false with it. It does not defeat Cloudflare, CAPTCHA, or any other real bot-detection
service, and other simple signals -- the default headless user agent's HeadlessChrome
substring and --enable-automation still being present in the launch command line -- remain
unmasked.

Session state persists across commands, scoped to this directory, in
~/.sutradhar-cli/<hash-of-cwd>/state.json — run "close" when done. Override with
SUTRADHAR_CLI_STATE_DIR to share state across directories or use a custom path, or
SUTRADHAR_CLI_STATE_ROOT to relocate the whole ~/.sutradhar-cli root (e.g. for a test harness).`);
      process.exitCode = verb ? 1 : 0;
  }
}

main()
  .catch((err) => {
    console.error(`Fatal: ${(err as Error).message}`);
    process.exitCode = 1;
  })
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Promise.finally awaits this teardown before the one-shot CLI exits.
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

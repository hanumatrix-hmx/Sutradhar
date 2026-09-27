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
import { readState, writeState, clearState, STATE_DIR, type CliState } from './state.js';
import { spawnDetachedChrome, killChromeTree } from './spawn-chrome.js';
import { createSessionId } from '@sutradhar/contracts';
import { parseArgs, dialogFlagError } from './parse-args.js';
import { validateSelectorArgs, validateFrameChain } from './selector-args.js';
import {
  resolveDialogPolicy,
  formatDialogPending,
  formatDialogHandled,
  DIALOG_HINT,
  beforeunloadCancelMessage,
  isBeforeunloadCancel,
  classifyVerb,
  selectDialog,
  raceWithDialog,
  deadlineFor,
  DialogBlockedError,
  PREEMPT_GRACE_MS,
  TRIGGER_PREEMPT_GRACE_MS,
  type PendingDialogEntry,
} from './dialog-cli.js';
import { DirectCdpBroker, WardenBroker, runDialogGate, type DialogBroker, type BrokerDialog } from './dialog-broker.js';
import { withSessionFlow } from './session-flow.js';
import {
  ensureWarden,
  stopWarden,
  readWardenFile,
  writeWardenFile,
  removeWardenFileIfOwned,
  policyFromState,
  isRivalWardenAlive,
} from './warden-control.js';
import { DialogWarden } from '@sutradhar/browser';

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
  dialogFlag,
  dialogFlagGivenButInvalid,
  dialogTextFlag,
  unrecognizedFlags,
} = parseArgs(process.argv.slice(2));

// FR2-04: this command's own start time, used to filter `reportDialogs`' `dialogHandled:` lines
// to ones that happened DURING this command (not stale history from a much earlier command).
const COMMAND_START_ISO = new Date().toISOString();

// Tracked so main()'s cleanup can disconnect the CDP client connection (NOT close the browser)
// before exiting — severing it lets Node's event loop drain and exit naturally, which flushes
// stdout properly. A raw process.exit() right after console.log() can truncate/interleave
// output on Windows if the write hasn't finished flushing yet.
let activeRuntime: SutradharRuntime | undefined;
let activeSessionId: string | undefined;

/** FR2-04: the exit code a deliberate outcome (a dialog pre-empted/blocked a command, or
 *  main().catch() decided one) has already chosen. Asserted one final time from a
 *  `process.on('exit')` hook below — see the pre-emption branch in `withSession` for why a
 *  simple `process.exitCode = N` assignment isn't reliable on its own here: an ABANDONED command
 *  promise (raced against a dialog and lost) keeps running in the background and can otherwise
 *  clobber `process.exitCode` with its own, now-irrelevant, later failure. */
let finalExitCode: number | undefined;
process.on('exit', () => {
  if (finalExitCode !== undefined) process.exitCode = finalExitCode;
});

function printErrorAndExit(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────
// FR2-04 Branch W: the hidden `__dialog-warden` process
// ─────────────────────────────────────────────────────────────────────────

/** Reads a `state.json` at an ARBITRARY path — unlike `state.ts`'s `readState()`, which is
 *  scoped to a STATE_DIR resolved once at module load from the *current* process's cwd/env, the
 *  warden runs detached with `cwd: os.homedir()` and must read the STATE_FILE its spawner told
 *  it about (payload.stateFile), which is almost always a different path. */
async function readStateFileAt(file: string): Promise<CliState | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf-8')) as CliState;
  } catch {
    return undefined;
  }
}

/** Runs THIS process as a `DialogWarden` (spec §2.5/W3). Never returns until the warden stops
 *  (browser disconnect, state change, or SIGTERM) — the caller (main dispatch, below) must not
 *  route this through the normal one-shot `.finally()` teardown, which would force-exit it after
 *  3s exactly like any other command. */
async function runWardenProcess(payloadB64: string): Promise<void> {
  const { wsEndpoint, stateFile } = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as {
    wsEndpoint: string;
    stateFile: string;
  };
  const stateDir = path.dirname(stateFile);

  // GAP-231 warden-side singleton check (fix-2): even if this process's spawner won the spawn
  // lock's race in error (or an old, stale warden.json still names a rival that's actually
  // alive), never let two wardens for the same wsEndpoint both start acting — exit immediately,
  // before ever connecting to Chrome, if a live, healthy rival is already there. Deliberately
  // checked BEFORE `new DialogWarden(...)`/`.start()`, so a loser never attaches to a single
  // target, races the winner for a paused-target release, or double-handles a dialog.
  if (await isRivalWardenAlive(stateDir, wsEndpoint, process.pid)) {
    process.exit(0);
  }

  const warden = new DialogWarden({
    wsEndpoint,
    readPolicy: async () => policyFromState(await readStateFileAt(stateFile)),
    isStillCurrent: async () => {
      const current = await readStateFileAt(stateFile);
      return !!current && current.wsEndpoint === wsEndpoint;
    },
    onReady: async ({ port, token }) => {
      await writeWardenFile(stateDir, {
        v: 1,
        pid: process.pid,
        port,
        token,
        wsEndpoint,
        startedAt: new Date().toISOString(),
      });
      // GAP-231 (fix-2, hardening): the pre-start check above closes the common case, but two
      // spawns that both start within the same few hundred milliseconds can each pass IT before
      // either one has published `warden.json` at all — a real, narrow TOCTOU window fix-2's own
      // lock-race-probe still measured live (down from 8/10 stale rounds with up to 4 wardens
      // alive to a residual few/10 with at most 2, after the CLI-side lock fix alone). Re-read
      // `warden.json` after a short settle window: if it no longer names THIS pid, a concurrent
      // rival's write landed after ours and is the one every future command will actually talk
      // to (readWardenFile is the CLI's only way to find a warden) — so continuing to run here
      // would just be an unreachable, dialog-double-handling zombie. Stop rather than linger.
      await new Promise((r) => setTimeout(r, 300));
      const settled = await readWardenFile(stateDir);
      if (settled && settled.pid !== process.pid) {
        void warden.stop('duplicate-warden-lost-settle-race');
      }
    },
    onExit: async (_reason) => {
      await removeWardenFileIfOwned(stateDir, process.pid);
      process.exit(0);
    },
  });

  process.on('SIGTERM', () => {
    void warden.stop('sigterm');
  });

  await warden.start();
  // Deliberately never resolves on its own beyond this — the process lives until `stop()`
  // (called from one of the three exit conditions above) calls `process.exit(0)`.
  await new Promise(() => {});
}

/** Spawns a fresh detached Chrome (see spawn-chrome.ts for why not runtime.launch()), attaches
 *  to it, and persists the new session as CLI state. Shared by the "no prior session" and the
 *  "prior session is dead, self-heal" paths in withSession — a session-worthy new spawn is the
 *  same operation regardless of which one led to it.
 *
 *  `carry` (FR2-04): a dialogPolicy to carry over from the OLD state on self-heal — a fresh
 *  Chrome has no dialog open, so `lastPendingDialog` is deliberately never carried, only the
 *  policy itself. */
async function spawnFreshSession(
  runtime: SutradharRuntime,
  carry?: Pick<CliState, 'dialogPolicy'>,
): Promise<string> {
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
    spawned = await spawnDetachedChrome(!headed, profileUserDataDir, userAgentFlag, viewportFlag);
  } catch (err) {
    printErrorAndExit((err as Error).message);
  }
  const attached = await runtime.attach({ endpoint: spawned.wsEndpoint });
  if (!attached.hasRealBrowser) {
    printErrorAndExit('Spawned Chrome but could not attach to it. Run "sutradhar doctor" to diagnose.');
  }
  if (viewportFlag) {
    await runtime.setViewport(attached.sessionId, viewportFlag);
  }
  const { policy: resolved, persist } = resolveDialogPolicy(dialogFlag, dialogTextFlag, carry);
  // D10 (corrected): 'set' persists whatever mode was resolved, INCLUDING 'report' — it is not
  // special-cased to "no key" any more. 'keep' carries over whatever the old state already had
  // (self-heal) or nothing at all (a genuinely fresh spawn with no flag and no prior state).
  const dialogPolicy =
    persist === 'set'
      ? { action: resolved.mode as 'accept' | 'dismiss' | 'report', promptText: resolved.promptText, setAt: new Date().toISOString() }
      : carry?.dialogPolicy;
  await writeState({
    sessionId: attached.sessionId,
    wsEndpoint: spawned.wsEndpoint,
    chromePid: spawned.pid,
    profileName: profileFlag,
    viewport: viewportFlag,
    dialogPolicy,
  });
  if (dialogPolicy) {
    runtime.setDialogPolicy(attached.sessionId, { mode: dialogPolicy.action, promptText: dialogPolicy.promptText });
  } else {
    // The CLI's own default is 'report' — every session it creates gets this, unlike the
    // runtime's own MCP/SDK-facing default of 'auto' (D-2).
    runtime.setDialogPolicy(attached.sessionId, { mode: 'report' });
  }
  activeSessionId = attached.sessionId;
  return attached.sessionId;
}

/** FR2-04 §2.8.2: builds the broker for this command's dialog gate. Branch W tries the warden
 *  first (it alone can both see AND handle a truly orphaned dialog — Step 1 O8); an unhealthy/
 *  absent warden falls back to a degraded `DirectCdpBroker` (detection-only via a state hint —
 *  see that class's doc comment) rather than failing the command outright. */
async function getBroker(state: CliState): Promise<DialogBroker> {
  const wardenFile = await readWardenFile(STATE_DIR);
  if (wardenFile) {
    try {
      const res = await fetch(`http://127.0.0.1:${wardenFile.port}/v1/health`, {
        headers: { authorization: `Bearer ${wardenFile.token}` },
        signal: AbortSignal.timeout(500),
      });
      if (res.ok) {
        const body = (await res.json()) as { wsEndpoint: string };
        if (body.wsEndpoint === state.wsEndpoint) {
          return new WardenBroker(`http://127.0.0.1:${wardenFile.port}`, wardenFile.token);
        }
      }
    } catch {
      // fall through to the direct broker
    }
  }
  return new DirectCdpBroker(state.wsEndpoint, state.lastPendingDialog);
}

/** FR2-04: prints every `dialogHandled:`/`dialogPending:` line for this command (§2.8.4) and
 *  updates `state.lastPendingDialog`. Called at the end of every session verb, whether the verb
 *  finished normally or was pre-empted by a dialog. */
async function reportDialogs(runtime: SutradharRuntime, sessionId: string): Promise<void> {
  const history = runtime.getDialogHistory(sessionId);
  for (const record of history) {
    if (record.handledAt && record.handledAt >= COMMAND_START_ISO) {
      console.log(
        formatDialogHandled({
          type: record.dialogType,
          message: record.message,
          action: record.action ?? 'dismiss',
          promptText: record.promptText,
          by: record.handledBy === 'auto-timeout' ? 'policy' : (record.handledBy ?? 'policy'),
        }),
      );
    }
  }
  const pending = runtime.getPendingDialogs(sessionId);
  for (const p of pending) {
    console.log(formatDialogPending({ type: p.dialogType, message: p.message, defaultValue: p.defaultValue, url: p.url }));
  }
  if (pending.length > 0) {
    console.error(DIALOG_HINT(pending[0]!.dialogType));
  }
  const state = await readState();
  if (!state) return;
  const oldest = pending[0];
  const newValue = oldest
    ? { type: oldest.dialogType, message: oldest.message, defaultValue: oldest.defaultValue, url: oldest.url, openedAt: oldest.openedAt }
    : undefined;
  const changed = JSON.stringify(state.lastPendingDialog) !== JSON.stringify(newValue);
  if (changed) {
    const fresh = await readState(); // R-F: re-read immediately before writing, spread onto it
    if (fresh) await writeState({ ...fresh, lastPendingDialog: newValue }).catch(() => {});
  }
}

async function withSession<T>(fn: (runtime: SutradharRuntime, sessionId: string) => Promise<T>): Promise<T> {
  const runtime = new SutradharRuntime({ logger, allowedDomains: allowlistDomainsFlag });
  activeRuntime = runtime;
  const verbClass = classifyVerb(verb);

  const sessionId = await withSessionFlow<string>({
    readState: async () => readState(),
    spawnFresh: async () => spawnFreshSession(runtime),
    gate: async (rawState) => {
      if (verbClass === 'exempt') return;
      const state = rawState as CliState;
      const { policy } = resolveDialogPolicy(dialogFlag, dialogTextFlag, state);
      const broker = await getBroker(state);
      const result = await runDialogGate(verb, broker, policy, 'command');
      if (result.status === 'handled') {
        for (const r of result.records) {
          console.log(
            formatDialogHandled({ type: r.dialog.dialogType, message: r.dialog.message, action: r.action, promptText: r.promptText, by: 'policy' }),
          );
        }
      }
    },
    reattach: async (rawState) => {
      const state = rawState as CliState;
      const { sessionId: sid } = await runtime.attach({ endpoint: state.wsEndpoint, sessionId: state.sessionId });
      for (const { origin, permissions } of state.grantedPermissions ?? []) {
        await runtime.grantPermissions(sid, origin, permissions).catch(() => {});
      }
      if (state.activeTabId && (await runtime.listTabs(sid)).some((t) => t.id === state.activeTabId)) {
        await runtime.focusTab(sid, state.activeTabId).catch(() => {});
      }
      const effectiveViewport = viewportFlag ?? state.viewport;
      if (effectiveViewport) {
        await runtime.setViewport(sid, effectiveViewport).catch(() => {});
      }
      activeSessionId = sid;
      return sid;
    },
    selfHeal: async (rawState, err) => {
      const state = rawState as CliState;
      console.error(
        `Note: previous session was unreachable (${(err as Error).message}) — starting a fresh session.`,
      );
      await stopWarden(STATE_DIR).catch(() => {});
      if (state.chromePid) killChromeTree(state.chromePid);
      await clearState();
      return spawnFreshSession(runtime, { dialogPolicy: state.dialogPolicy });
    },
    afterAttach: async (sid, isFreshSpawn) => {
      const state = await readState();
      const { policy, persist } = resolveDialogPolicy(dialogFlag, dialogTextFlag, state);
      if (!isFreshSpawn) {
        runtime.setDialogPolicy(sid, policy);
        if (persist === 'set' && state) {
          // R-F: re-read state immediately before writing, spread onto the FRESH copy.
          const fresh = await readState();
          if (fresh) {
            const dialogPolicy = { action: policy.mode as 'accept' | 'dismiss' | 'report', promptText: policy.promptText, setAt: new Date().toISOString() };
            await writeState({ ...fresh, dialogPolicy }).catch(() => {});
            console.error(`Note: dialog policy for this session is now "${policy.mode}".`);
          }
        }
        if (viewportFlag && state) {
          const fresh = await readState();
          if (fresh) await writeState({ ...fresh, sessionId: sid, viewport: viewportFlag }).catch(() => {});
        }
      }
      const nowState = await readState();
      if (nowState) {
        await ensureWarden({ stateDir: STATE_DIR, wsEndpoint: nowState.wsEndpoint }).catch(() => undefined);
      }
    },
    fn: async (sid) => sid,
  });

  if (verbClass === 'exempt') {
    return fn(runtime, sessionId);
  }

  const graceMs = verbClass === 'trigger' ? TRIGGER_PREEMPT_GRACE_MS : PREEMPT_GRACE_MS;
  const work = fn(runtime, sessionId);
  const raced = await raceWithDialog(work, () => runtime.getPendingDialogs(sessionId) as PendingDialogEntry[], {
    graceMs,
    ignoreTypes: ['beforeunload'],
  });

  if (raced.kind === 'dialog') {
    // The ABANDONED `work` promise (the original command body) is not cancelled — it keeps
    // running to completion in the background (Puppeteer/CDP calls have no cancellation token to
    // give it). Found live: its eventual settlement can print a stray duplicate line (e.g.
    // "Clicked #x" a second time) and, worse, silently clobber the exit code we're about to set
    // here (a command's own `catch` block setting `process.exitCode = 1` on the delivery-check's
    // late "Target closed" rejection). Fixed two ways: (1) this function does ALL of its own
    // console output before returning/throwing, and never relies on main().catch() to re-print
    // anything for this path (avoids the double `dialogPending:` bug); (2) `finalExitCode` is
    // asserted one more time in a `process.on('exit')` hook (see below `main()`), which runs
    // after everything else, so a late clobber from the abandoned work can't win.
    const dialogType = raced.pending[0]!.dialogType;
    if (verbClass === 'trigger') {
      // §2.8.5: a pre-empted trigger verb still exits 0 — the click itself likely succeeded and
      // opened the dialog; only the delivery-verification race was interrupted.
      console.log(`Click dispatched to ${cleanArgs[0] ?? ''}; a ${dialogType} dialog opened before delivery could be verified.`);
      await reportDialogs(runtime, sessionId);
      finalExitCode = 0;
      return undefined as T;
    }
    if (verb === 'nav') {
      console.log(`Navigation to ${cleanArgs[0] ?? ''} started, but the page opened a ${dialogType} dialog while loading.`);
    }
    await reportDialogs(runtime, sessionId);
    console.error(`Error: a ${dialogType} dialog opened while "${verb}" was running and is blocking the page; "${verb}" did not complete (it may have partially run).`);
    finalExitCode = 3;
    return undefined as T;
  }

  await reportDialogs(runtime, sessionId);
  return raced.value;
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
  const navStartedAt = Date.now();
  await withSession(async (runtime, sessionId) => {
    let result;
    try {
      result = await runtime.navigate(sessionId, url!);
    } catch (err) {
      // FR2-04 D-5: under --dialog dismiss, a beforeunload prompt is dismissed at once, which
      // aborts the navigation Puppeteer-side (net::ERR_ABORTED) — report that as the specific,
      // actionable cancellation it is, not a generic navigation failure. The dismiss itself is a
      // separate async CDP round trip (BrowserTab.applyPolicyNow) racing this same rejection, so
      // the history entry can genuinely not exist YET the instant navigate() rejects — found live
      // (a real race, not a hypothetical): poll briefly rather than checking once.
      let matched = false;
      for (let i = 0; i < 10 && !matched; i++) {
        const history = runtime.getDialogHistory(sessionId);
        matched = isBeforeunloadCancel(err, history, navStartedAt);
        if (!matched) await new Promise((r) => setTimeout(r, 50));
      }
      if (matched) {
        console.log(beforeunloadCancelMessage(url!));
        process.exitCode = 1;
        return;
      }
      throw err;
    }
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

/** FR2-04 §2.9: status/accept/dismiss the OLDEST open native dialog. Gate-exempt — this verb
 *  NEVER calls `runtime.attach` (that's the whole point: it must work even while a dialog would
 *  make a normal attach hang). */
/** FR2-04: reports an error from `cmdDialog` WITHOUT calling `process.exit()` synchronously.
 *  `cmdDialog`'s error paths are always reached after at least one `fetch()` call (the warden
 *  HTTP broker) — found live: calling `printErrorAndExit`'s synchronous `process.exit(1)` right
 *  after an in-flight `fetch(..., {signal: AbortSignal.timeout(...)})` crashed the Node process
 *  outright on Windows (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\\win\\
 *  async.c`) — a real libuv/Node interaction, not application logic. Using `process.exitCode` and
 *  returning lets pending handles close naturally instead of racing a forced synchronous exit. */
function dialogErrorAndReturn(message: string): void {
  console.error(`Error: ${message}`);
  finalExitCode = 1;
  process.exitCode = 1;
}

async function listDialogs(state: CliState): Promise<PendingDialogEntry[]> {
  const broker = await getBroker(state);
  try {
    const listed = await broker.list();
    return listed.status === 'ok' ? listed.dialogs : [];
  } finally {
    await broker.dispose();
  }
}

async function cmdDialog(sub: string | undefined, rest: string[]): Promise<void> {
  const state = await readState();
  if (!state) return dialogErrorAndReturn('No active session.');

  if (sub !== undefined && sub !== 'accept' && sub !== 'dismiss') {
    return dialogErrorAndReturn(
      'usage: sutradhar dialog [accept [text] | dismiss]  (handles the oldest open native dialog: alert/confirm/prompt/beforeunload)',
    );
  }
  // A syntax error (extra args to `dismiss`) is checked BEFORE looking at dialog state — it's
  // wrong regardless of whether anything happens to be open right now (N2).
  if (sub === 'dismiss' && rest.length > 0) {
    return dialogErrorAndReturn('usage: sutradhar dialog dismiss  (takes no extra arguments)');
  }

  const dialogs = await listDialogs(state);

  if (sub === undefined) {
    if (dialogs.length === 0) {
      console.log('No dialog is open.');
      return;
    }
    for (const d of dialogs) {
      console.log(formatDialogPending({ type: d.dialogType, message: d.message, defaultValue: d.defaultValue, url: d.url }));
      describeUnknownDialog(d).forEach((line) => console.error(line));
    }
    return;
  }

  // GAP-248(a): `rest` (the pre-handle snapshot's collateral/confirmed-safe entries) is
  // deliberately unused here — see the fresh re-list after handling below, which replaces it
  // entirely rather than trusting a snapshot that predates the actual accept/dismiss.
  const { target } = selectDialog(dialogs);
  if (!target) {
    return dialogErrorAndReturn(`no dialog is open to ${sub}.`);
  }
  const accept = sub === 'accept';
  const text = accept ? rest.join(' ') || undefined : undefined;
  if (text !== undefined && target.dialogType !== 'prompt') {
    console.error(`Note: text is only used by prompt() dialogs; ignored for ${target.dialogType}.`);
  }
  // D-9: accept with no text means "OK with the prefilled text" — pass the dialog's own default
  // value explicitly rather than leaving promptText undefined (CDP does NOT reliably fill it in
  // on its own — found live: an undefined promptText resolved the prompt with an EMPTY string,
  // not the dialog's actual default).
  const effectivePromptText = accept && target.dialogType === 'prompt' ? (text ?? target.defaultValue) : undefined;
  let outcome: { closedTarget?: boolean; message?: string; redirectTo?: string; redirectUrl?: string; refused?: boolean } | void;
  try {
    const broker2 = await getBroker(state);
    try {
      outcome = await broker2.handle(target.targetId!, accept, effectivePromptText, target.dialogId);
    } finally {
      await broker2.dispose();
    }
  } catch (err) {
    return dialogErrorAndReturn(`could not ${sub} the ${target.dialogType} dialog: ${(err as Error).message}`);
  }

  // GAP-230: an `unknown` dialog was recovered by closing its tab rather than actually resolved —
  // say so plainly instead of claiming "Accepted"/"Dismissed" for a dialog we never touched.
  if (outcome?.closedTarget) {
    console.log(outcome.message ?? `Tab was closed because its dialog could not be addressed directly.`);
    return;
  }
  // FR2-04 fix-3/GAP-236, decision point 3: the target `selectDialog` picked turned out (on a
  // fresh re-probe, inside the broker) to be only collaterally blocked by the ACTUAL holder — this
  // is a defensive fallback (normal `selectDialog` already filters out `blockedBy` entries), only
  // reachable if attribution shifted between `list()` and this `handle()` call. Report the real
  // holder plainly rather than claiming success for a target nothing was actually done to.
  if (outcome?.redirectTo) {
    console.log(outcome.message ?? `Tab ${target.targetId} is not the dialog holder; run "sutradhar dialog" again.`);
    return;
  }
  // FR2-04 escalation-1, decision 1+3 (GAP-245/246/247), supersedes fix-3's `isolated` refusal:
  // recovery declined to act — either this target's OWN history proves it cannot be hiding a
  // dialog (the warden's `confirmedSafe`), or the broker has no history at all to ground a
  // decision in (`DirectCdpBroker` with the warden down) — either way, closing something here would
  // be a guess, and guessing has been measured to close the wrong, innocent tab. `sutradhar close`
  // remains the escape hatch for a real stuck dialog with no provable evidence.
  if (outcome?.refused) {
    console.log(
      outcome.message ??
        `Tab ${target.targetId} is busy or unresponsive, but nothing identifies this as an actual dialog — no automatic recovery was attempted.`,
    );
    process.exitCode = 1;
    return;
  }

  if (accept) {
    if (target.dialogType === 'prompt' && text) {
      console.log(`Accepted prompt "${target.message}" with text "${text}"`);
    } else if (target.dialogType === 'prompt') {
      console.log(`Accepted prompt "${target.message}" with its default value "${target.defaultValue ?? ''}"`);
    } else {
      console.log(`Accepted ${target.dialogType} "${target.message}"`);
    }
  } else {
    console.log(`Dismissed ${target.dialogType} "${target.message}"`);
  }

  // FR2-04 escalation-1, GAP-248(a): `remaining` is a snapshot taken BEFORE `target` was actually
  // handled — any entry in it that was only reported because it shared a blocked renderer with
  // `target` (a `blockedBy`/`confirmedSafe`-attributed collateral entry, the common case at scale:
  // audit-4 measured K=40 stale 'unknown' lines printed after a clean accept) may have become fully
  // responsive the instant the real dialog was resolved above. Never trust that stale snapshot for
  // what to print — always re-verify with a fresh list. This ALSO still needs to poll (not a single
  // immediate re-list) because a "remaining" dialog can instead be one that hadn't opened YET at
  // handle time — e.g. a chained alert->confirm, where the confirm() call only runs once the page's
  // own JS resumes after the alert returns (found live: an immediate re-list after the FIRST accept
  // of a chain missed the second dialog entirely).
  let finalPending: PendingDialogEntry[] = [];
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 80));
    finalPending = (await listDialogs(state)).filter((d) => d.targetId !== target.targetId || d.openedAt !== target.openedAt);
    if (finalPending.length > 0) break;
  }
  for (const d of finalPending) {
    console.log(formatDialogPending({ type: d.dialogType, message: d.message, defaultValue: d.defaultValue, url: d.url }));
    describeUnknownDialog(d).forEach((line) => console.error(line));
  }
}

/** FR2-04 escalation-1, GAP-248(b): "dialog"'s own output must show WHICH tab any following
 *  `dialog accept|dismiss` would actually act on, before that command runs — a liveness-inferred
 *  `unknown` entry alone (just a type/message/url, per §2.8.5's frozen `dialogPending:` contract)
 *  gives an agent no way to tell a real, addressable holder apart from a collateral/confirmed-safe
 *  entry it would never act on. Printed as extra `Note:` lines (stderr, so §2.8.5's exact stdout
 *  contract is untouched) rather than changing `formatDialogPending`'s frozen key set. Returns []
 *  for anything that isn't a liveness-inferred entry (a real, tracked dialog needs no such note). */
function describeUnknownDialog(d: PendingDialogEntry): string[] {
  if (d.dialogType !== 'unknown') return [];
  const tab = d.targetId ? `tab ${d.targetId}` : 'this tab';
  if (d.confirmedSafe && d.blockedBy) {
    return [`  Note: ${tab} is busy, but its own history proves it cannot be hiding a dialog -- the still-unresolved candidate is tab ${d.blockedBy}.`];
  }
  if (d.confirmedSafe) {
    return [`  Note: ${tab} is busy, but its own history proves it cannot be hiding a dialog (likely just a slow script) -- "dialog accept/dismiss" will not act on it.`];
  }
  if (d.blockedBy) {
    return [`  Note: ${tab} is unresponsive only because it shares a browser process with tab ${d.blockedBy}, which appears to actually hold the dialog -- "dialog accept/dismiss" would act on tab ${d.blockedBy}, not this one.`];
  }
  return [`  Note: ${tab} appears to be the actual dialog holder -- "dialog accept/dismiss" would act on this tab.`];
}

async function cmdClose() {
  const state = await readState();
  if (!state) {
    console.log('No active session.');
    return;
  }
  // FR2-04: run the gate in 'close' mode BEFORE either attach below — a dialog left open would
  // otherwise make the profile-save attach (or the no-chromePid attach+shutdown) hang for up to
  // 180s (spec §2.10/N11). No policy resolution needed here — 'close' mode never applies accept/
  // dismiss automatically unless the session's own persisted policy already says to.
  const { policy } = resolveDialogPolicy(dialogFlag, dialogTextFlag, state);
  let blockedDialogs: BrokerDialog[] = [];
  if (policy.mode === 'accept' || policy.mode === 'dismiss') {
    const broker = await getBroker(state);
    const result = await runDialogGate(verb, broker, policy, 'close');
    if (result.status === 'handled') {
      for (const r of result.records) {
        console.log(formatDialogHandled({ type: r.dialog.dialogType, message: r.dialog.message, action: r.action, promptText: r.promptText, by: 'policy' }));
      }
    }
    if (result.status === 'blocked') {
      blockedDialogs = result.dialogs;
      // FR2-04 fix-3/GAP-242: even though this gate run ultimately blocked (e.g. a chain limit),
      // print whatever it DID manage to resolve first — same reasoning as `main().catch`'s
      // DialogBlockedError handling.
      for (const r of result.records ?? []) {
        console.log(formatDialogHandled({ type: r.dialog.dialogType, message: r.dialog.message, action: r.action, promptText: r.promptText, by: 'policy' }));
      }
    }
  } else {
    const broker = await getBroker(state);
    try {
      const listed = await broker.list();
      if (listed.status === 'ok' && listed.dialogs.length > 0) blockedDialogs = listed.dialogs;
    } finally {
      await broker.dispose();
    }
  }
  const closeBlocked = blockedDialogs.length > 0;
  if (closeBlocked) {
    // GAP-227: don't claim the profile's storage state wasn't saved when there was never a
    // profile to save it to, and name the actual dialog type per spec §2.10.
    const type = blockedDialogs[0]?.dialogType ?? 'unknown';
    if (state.profileName) {
      console.error(
        `Warning: a ${type} dialog is open, so the profile's storage state was not saved. Handle it first ` +
          '("sutradhar dialog accept|dismiss") if you need it saved.',
      );
    } else {
      console.error(
        `Warning: a ${type} dialog is open. Handle it first ("sutradhar dialog accept|dismiss") if you need it handled.`,
      );
    }
  }
  await stopWarden(STATE_DIR).catch(() => {});
  if (state.profileName && !closeBlocked) {
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
    // alone would leak it. Kill the actual process (and its child renderer/GPU processes). Never
    // attaches, so it's unaffected by closeBlocked (no 180s hang risk here either way).
    killChromeTree(state.chromePid);
  } else if (!closeBlocked) {
    // FR2-04 N11: this attach WOULD hang for up to 180s against a dialog-blocked page — skipped
    // whenever the gate reported 'blocked' above.
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
  const dialogErr = dialogFlagError({ verb, dialogFlag, dialogFlagGivenButInvalid, dialogTextFlag });
  if (dialogErr) {
    printErrorAndExit(dialogErr);
  }
  switch (verb) {
    case 'dialog':
      return cmdDialog(cleanArgs[0], cleanArgs.slice(1));
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
  dialog                       Show any open native dialog (alert/confirm/prompt/beforeunload)
  dialog accept [text]         Accept the oldest open dialog (text = what to type into a prompt)
  dialog dismiss               Dismiss the oldest open dialog
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
  --dialog <accept|dismiss|report>
                        Default policy for native dialogs in this session; persisted until changed.
                        report (the default) leaves alert/confirm/prompt open and prints
                        "dialogPending: {...}"; while one is open, other commands exit with code 3
                        until "sutradhar dialog accept|dismiss". beforeunload during a navigation
                        is accepted after 3s under report
  --dialog-text <text>  With --dialog accept: the text entered into prompt() dialogs (default:
                        the prompt's own default value)

Exit codes: 0 ok, 1 failure, 3 blocked by or interrupted by an open dialog.

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
SUTRADHAR_CLI_STATE_DIR to share state across directories or use a custom path.`);
      process.exitCode = verb ? 1 : 0;
  }
}

if (verb === '__dialog-warden') {
  // FR2-04 W3: a long-running process, not a one-shot command — must never go through the
  // one-shot `.finally()` teardown below (which force-exits after 3s; that would kill the warden
  // almost immediately) or the watchdog (also one-shot-command-only).
  runWardenProcess(cleanArgs[0]!).catch((err) => {
    console.error(`Fatal: ${(err as Error).message}`);
    process.exit(1);
  });
} else {
  // FR2-04 §2.8.6: the process watchdog. Armed for every real command (not the warden, and not
  // help/no-verb, which return synchronously fast anyway) — if a bug or an unforeseen hang keeps
  // a command running past its deadline, this stops it with a clear, actionable message instead
  // of hanging the caller (an agent, a script) forever. `unref()`'d so it never itself keeps the
  // process alive once the command finishes normally.
  const watchdog = setTimeout(() => {
    console.error(
      `Error: "sutradhar ${verb ?? ''}" did not finish within ${Math.round(deadlineFor(verb, cleanArgs, process.env) / 1000)}s and was stopped. ` +
        'The browser session is still running. If the page is blocked by a dialog, run "sutradhar dialog".',
    );
    process.exit(1);
  }, deadlineFor(verb, cleanArgs, process.env));
  watchdog.unref();

  main()
    .catch((err) => {
      if (err instanceof DialogBlockedError) {
        // FR2-04 fix-3/GAP-242: print any dialogs THIS gate run already resolved before it hit
        // the condition that made it block anyway (a chain limit, a probe timeout) — dropping
        // these silently would make real, completed work invisible to the caller.
        for (const line of err.handledStdoutLines()) console.log(line);
        for (const line of err.stdoutLines()) console.log(line);
        console.error(`Error: ${err.message}`);
        console.error(DIALOG_HINT(err.dialogs[0]?.dialogType ?? 'unknown'));
        finalExitCode = err.exitCode;
        process.exitCode = err.exitCode;
        return;
      }
      console.error(`Fatal: ${(err as Error).message}`);
      finalExitCode = 1;
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
}

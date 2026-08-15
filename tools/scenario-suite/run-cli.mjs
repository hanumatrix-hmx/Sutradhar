// CLI-surface driver for the GLM 5.3 field-report regression suite (tools/scenario-suite/scenarios.mjs).
// Drives the REAL `sutradhar` CLI binary (packages/cli/dist/cli.js) as a real child process per
// step — exactly the way a real user types commands one at a time — using the CLI's own
// documented commands (doctor, nav, snap, axsnap, text, click, clicktext, clickrole, type, press,
// select, wait, eval, hover, scroll, upload, drag, download, screenshot, audit, compare, close,
// profile). Originally written as a Phase 1 PRE-FIX baseline when select/wait/eval/hover/scroll/
// upload/drag/download did not exist yet (each such gap recorded honestly, not papered over) —
// UC-05's sort step was updated in Phase 4 (.ai/field-report-remediation-plan.md) to use the new
// `select` command for real once it existed, rather than leaving the stale placeholder.
//
// Follows the timed()/result-shape convention from tools/engine-comparison/sutradhar-extreme.mjs:
// { id, title, surface: 'cli', success, ms, detail, error }.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, fx } from './scenarios.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const CLI = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');
const DOWNLOADS_DIR = path.join(os.homedir(), 'Downloads');

const scenarioById = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));

// ── Low-level CLI invocation ────────────────────────────────────────────────────────────────
/** Spawns `node CLI <argv...>` as a real, separate child process — same as a user typing
 *  `sutradhar <argv...>` at a shell (assuming the global bin resolves to this same dist/cli.js). */
function runCli(argv, { timeout = 90_000 } = {}) {
  const start = Date.now();
  const res = spawnSync(process.execPath, [CLI, ...argv], {
    encoding: 'utf-8',
    timeout,
    cwd: repoRoot,
    windowsHide: true,
  });
  return {
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
    code: res.status,
    ms: Date.now() - start,
    timedOut: res.error?.code === 'ETIMEDOUT',
    spawnError: res.error ? res.error.message : null,
  };
}

function closeSession() {
  return runCli(['close']);
}

/** `nav` intermittently throws inside the CLI's own runtime.navigate() call (observed live while
 *  building this harness) — main()'s catch prints "Fatal: ..." and exits 1, leaving whatever page
 *  the freshly-spawned Chrome happened to be on (e.g. chrome://new-tab-page/) as the "current"
 *  page for every subsequent command. Silently continuing past that produces a misleading
 *  downstream failure attributed to the wrong step, so every scenario checks this explicitly. */
function requireNav(navRes, label) {
  if (!navRes.stdout.includes('Navigated to')) {
    fail(`navigation failed (${label})`, { stdout: navRes.stdout, stderr: navRes.stderr, code: navRes.code });
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function timed(id, fn) {
  const title = scenarioById[id].title;
  const start = Date.now();
  try {
    const detail = await fn();
    return { id, title, surface: 'cli', success: true, ms: Date.now() - start, detail: detail ?? null, error: null };
  } catch (err) {
    return {
      id,
      title,
      surface: 'cli',
      success: false,
      ms: Date.now() - start,
      detail: err.detail ?? null,
      error: err.message || String(err),
    };
  }
}

/** Throws with an attached `.detail` payload so partial evidence survives into the result even
 *  on a thrown failure (matches sutradhar-extreme.mjs's pattern of rich failure detail). */
function fail(message, detail) {
  const err = new Error(message);
  err.detail = detail;
  throw err;
}

// ── snap-output helpers ─────────────────────────────────────────────────────────────────────
/** Extracts the live `value="..."` an input is reporting from a `snap` text listing, by matching
 *  the line carrying a given placeholder. Returns '' if the input has no (or empty) value —
 *  `formatGraphForLlm` omits the `value="..."` fragment entirely when the DOM value is falsy, so
 *  "not present" and "empty string" are indistinguishable from this text alone, which is itself
 *  noted in the relevant scenario's detail. */
function readSnapValueByPlaceholder(snapText, placeholder) {
  const line = snapText.split('\n').find((l) => l.includes(`placeholder="${placeholder}"`));
  if (!line) return { found: false, value: undefined };
  const m = line.match(/value="([^"]*)"/);
  return { found: true, value: m ? m[1] : '' };
}

/** Real user behavior for a CLI command known (from this session's live pre-checks) to
 *  intermittently no-op (A1): type, then independently read back via a fresh `snap` call (NOT
 *  trusting the `type` command's own reported success), retrying up to maxAttempts times before
 *  giving up. Records every attempt's reported-success vs actually-landed value — this IS the
 *  evidence the baseline needs for A1/A2, not a workaround that hides the bug. */
function typeWithReadback(ref, text, placeholder, { maxAttempts = 3 } = {}) {
  const attempts = [];
  for (let i = 1; i <= maxAttempts; i++) {
    const typeRes = runCli(['type', ref, text]);
    const snapRes = runCli(['snap']);
    const { found, value } = readSnapValueByPlaceholder(snapRes.stdout, placeholder);
    const landed = value === text;
    attempts.push({
      attempt: i,
      typeReportedSuccess: typeRes.code === 0 && typeRes.stdout.startsWith('Typed into'),
      typeStdout: typeRes.stdout,
      typeMs: typeRes.ms,
      readbackFound: found,
      readbackValue: value,
      landed,
    });
    if (landed) break;
  }
  const finalLanded = attempts[attempts.length - 1]?.landed ?? false;
  return { attempts, finalLanded, finalValue: attempts[attempts.length - 1]?.readbackValue };
}

// ── UC-01: Bot detection surface ────────────────────────────────────────────────────────────
async function uc01() {
  closeSession();
  const nav = runCli(['nav', scenarioById['UC-01'].url]);
  await sleep(2500); // harness-level pacing — CLI has no `wait` command; this is the driver
  // script pacing invocations, not a CLI capability being exercised.
  const textRes = runCli(['text']);
  const t = textRes.stdout;

  const uaLine = t.match(/HeadlessChrome\/[\d.]+/)?.[0];
  const webdriverNew = /WebDriver\s*\n?\(New\)\s*\n?\s*([^\n]+)/.exec(t)?.[1]?.trim();
  const webdriverAdvanced = /WebDriver Advanced\s*\n?\s*([^\n]+)/.exec(t)?.[1]?.trim();
  const chromeNew = /Chrome\s*\n?\(New\)\s*\n?\s*([^\n]+)/.exec(t)?.[1]?.trim();
  const pluginsIsArray = /Plugins is of type PluginArray\s*\n?\s*([^\n]+)/.exec(t)?.[1]?.trim();
  const failMarkers = [...t.matchAll(/^(\S+)\s+FAIL\s*$/gm)].map((m) => m[1]);

  if (!nav.stdout.includes('Navigated to')) fail('navigation failed', { nav });

  return {
    navigated: nav.stdout,
    userAgentDetected: uaLine ?? null,
    headlessLeakedInUA: Boolean(uaLine),
    webdriverNew,
    webdriverAdvanced,
    chromeNew,
    pluginsIsArray,
    failMarkers,
    note:
      'HeadlessChrome/151 leaking in the User-Agent row is EXPECTED and deliberate (scope decision in ' +
      'field-report-remediation-plan.md — no covert UA masking). failMarkers lists every fingerprint ' +
      'sub-test whose own page script reported FAIL; HEADCHR_UA failing is a direct consequence of the ' +
      'same deliberate UA choice, not a Sutradhar defect. Any other names appearing there are a real, ' +
      'reportable finding, whatever they are (recorded, not filtered).',
    rawTextLength: t.length,
  };
}

// ── UC-02: CAPTCHA grounding ─────────────────────────────────────────────────────────────────
async function uc02() {
  closeSession();
  const nav = runCli(['nav', scenarioById['UC-02'].url]);
  await sleep(2000);
  const snap = runCli(['snap']);
  const checkboxLine = snap.stdout.split('\n').find((l) => /role=checkbox/i.test(l));
  if (!nav.stdout.includes('Navigated to')) fail('navigation failed', { nav });
  if (!checkboxLine) {
    fail('reCAPTCHA checkbox not found in default snap listing (no click attempted, per scope)', {
      snap: snap.stdout,
    });
  }
  return {
    checkboxGroundable: true,
    checkboxSnapLine: checkboxLine,
    fullSnap: snap.stdout,
    note: 'Grounding only — no click/solve attempted, per scope (out-of-bounds by design).',
  };
}

// ── UC-03: Auth + session persistence ───────────────────────────────────────────────────────
async function uc03() {
  closeSession();
  const profileName = 'scenario-suite-uc03';
  const create = runCli(['profile', 'create', profileName, 'baseline UC-03 persistence check']);
  // idempotent: a second run of this suite hitting "already exists" is fine, not a failure.

  const nav1 = runCli(['nav', scenarioById['UC-03'].url, '--profile', profileName]);
  requireNav(nav1, 'initial login nav');
  const loginResult = typeWithReadback('#user-name', 'standard_user', 'Username', { maxAttempts: 3 });
  const passResult = typeWithReadback('#password', 'secret_sauce', 'Password', { maxAttempts: 3 });
  const click = runCli(['click', '#login-button']);
  const afterLoginText = runCli(['text']);
  const loggedIn = afterLoginText.stdout.includes('Products');

  const closeAfterLogin = closeSession();
  const nav2 = runCli(['nav', scenarioById['UC-03'].url, '--profile', profileName]);
  requireNav(nav2, 'relaunch nav');
  const afterRelaunchText = runCli(['text']);
  const survivedSession = afterRelaunchText.stdout.includes('Products') && !afterRelaunchText.stdout.includes('Accepted usernames');

  closeSession();

  if (!loggedIn) {
    fail('could not even establish the initial logged-in state to test persistence against', {
      loginResult,
      passResult,
      click,
      afterLoginText: afterLoginText.stdout,
    });
  }

  return {
    profileCreate: create.stdout || create.stderr,
    loggedInInitially: loggedIn,
    loginTypeAttempts: { username: loginResult.attempts.length, password: passResult.attempts.length },
    afterRelaunchText: afterRelaunchText.stdout,
    survivedSession,
    note: survivedSession
      ? 'Session survived a relaunch under the same profile — NOT the expected sessionStorage gap; report as-is.'
      : 'Session did NOT survive (landed back on login page) — matches the expected gap: saucedemo\'s ' +
        'login flag is sessionStorage-based, and named profiles (Chrome --user-data-dir) do not persist ' +
        'sessionStorage by design. This is exactly the C2 gap Phase 5 addresses.',
  };
}

// ── UC-04: Canvas blindness (Google Maps) ───────────────────────────────────────────────────
async function uc04() {
  closeSession();
  let nav = runCli(['nav', scenarioById['UC-04'].url]);
  requireNav(nav, 'google maps nav');
  await sleep(3000);
  let snap = runCli(['snap']);

  // Observed live while building this harness: `nav` can report success (real "Navigated to"
  // stdout, real title) yet the page has moved to chrome://new-tab-page/ by the time the NEXT
  // command runs — not reproducible on a lone manual retry, so recorded as a real, intermittent
  // anomaly rather than a deterministic Sutradhar bug. One retry (a real user's first instinct)
  // before treating it as a genuine grounding failure.
  let retried = false;
  if (snap.stdout.startsWith('URL: chrome://')) {
    retried = true;
    closeSession();
    nav = runCli(['nav', scenarioById['UC-04'].url]);
    requireNav(nav, 'google maps nav (retry)');
    await sleep(3000);
    snap = runCli(['snap']);
  }

  const searchBox = snap.stdout.split('\n').find((l) => /Search Google Maps/i.test(l));
  const zoomIn = snap.stdout.split('\n').find((l) => /Zoom in/i.test(l));
  const zoomOut = snap.stdout.split('\n').find((l) => /Zoom out/i.test(l));
  const groundable = Boolean(searchBox && (zoomIn || zoomOut));
  if (!groundable) fail('search box and/or zoom controls not groundable via snap', { snap: snap.stdout, retried });

  return {
    searchBoxLine: searchBox,
    zoomInLine: zoomIn,
    zoomOutLine: zoomOut,
    groundable,
    retriedDueToStaleNewTabPage: retried,
    note:
      'Search box and zoom/pan controls are groundable via the normal DOM interactive listing — ' +
      'expected, they are real DOM elements. The map surface itself is a <canvas>: opaque to DOM-based ' +
      'grounding by construction, same as every DOM-reading tool (Playwright/Puppeteer included). No ' +
      'attempt was made to read canvas pixel content — out of scope, matches successCriteria.',
  };
}

// ── UC-05: Long 10+ step flow (headed, long-lived session — candidate A2 repro condition) ──
async function uc05() {
  closeSession();
  const nav = runCli(['nav', scenarioById['UC-05'].url, '--headed']);
  requireNav(nav, 'initial nav');
  const userType = typeWithReadback('#user-name', 'standard_user', 'Username');
  const passType = typeWithReadback('#password', 'secret_sauce', 'Password');
  const loginClick = runCli(['click', '#login-button']);
  const inventorySnap = runCli(['snap']);
  if (!inventorySnap.stdout.includes('inventory.html') && !inventorySnap.stdout.includes('Products')) {
    // fall through — snap doesn't print URL for a cmdSnap without axsnap; check via text
  }
  const inventoryText = runCli(['text']);
  const reachedInventory = inventoryText.stdout.includes('Products');

  // Sort step: Phase 4 added a `select` CLI command (field-report remediation C1) — use it for
  // real, instead of the honest-gap placeholder this used to be pre-Phase-4.
  const sortSelectId = inventorySnap.stdout.split('\n').find((l) => /^\[#\d+\] select/.test(l))?.match(/^\[#(\d+)\]/)?.[1];
  const sortResult = sortSelectId ? runCli(['select', sortSelectId, 'lohi']) : { skipped: 'no select element found in inventory snap' };
  const sortBlocked = {
    step: 'sort products by price',
    blockedBecause: sortSelectId ? null : 'no select element found in inventory snap',
    workaroundAttempted: true,
    sortResult,
  };

  // Re-snap after sorting — product order (and therefore node ids) changed if the sort landed.
  const postSortSnap = sortSelectId && sortResult.code === 0 ? runCli(['snap']) : inventorySnap;
  const productLink = postSortSnap.stdout.split('\n').find((l) => /Sauce Labs Backpack/.test(l));
  const productId = productLink?.match(/^\[#(\d+)\]/)?.[1];
  if (!productId) fail('could not find "Sauce Labs Backpack" product link in snap', { inventorySnap: postSortSnap.stdout, sortBlocked });

  const detailClick = runCli(['click', productId]);
  const detailSnap = runCli(['snap']);
  const addToCartLine = detailSnap.stdout.split('\n').find((l) => /Add to cart/.test(l));
  const addToCartId = addToCartLine?.match(/^\[#(\d+)\]/)?.[1];
  if (!addToCartId) fail('could not find "Add to cart" button on product detail page', { detailSnap: detailSnap.stdout, sortBlocked });
  const addClick = runCli(['click', addToCartId]);

  const cartIconSnap = runCli(['snap']); // re-snap for a fresh cart-icon ref, ids can shift per page
  const cartIconLine = cartIconSnap.stdout.split('\n')[1]; // header line[0] is elements count; badge is [#7] typically but re-derive safely below
  const cartLinkId = cartIconSnap.stdout.split('\n').find((l) => /^\[#\d+\] a "\d+"/.test(l))?.match(/^\[#(\d+)\]/)?.[1];
  if (!cartLinkId) fail('could not find cart icon link in snap after add-to-cart', { cartIconSnap: cartIconSnap.stdout, sortBlocked });
  const cartClick = runCli(['click', cartLinkId]);

  const cartSnap = runCli(['snap']);
  const checkoutId = cartSnap.stdout.split('\n').find((l) => /Checkout/.test(l))?.match(/^\[#(\d+)\]/)?.[1];
  if (!checkoutId) fail('could not find Checkout button in cart', { cartSnap: cartSnap.stdout, sortBlocked });
  const checkoutClick = runCli(['click', checkoutId]);

  const checkoutSnap1 = runCli(['snap']);
  const firstNameId = checkoutSnap1.stdout.split('\n').find((l) => /placeholder="First Name"/.test(l))?.match(/^\[#(\d+)\]/)?.[1];
  const lastNameId = checkoutSnap1.stdout.split('\n').find((l) => /placeholder="Last Name"/.test(l))?.match(/^\[#(\d+)\]/)?.[1];
  const zipId = checkoutSnap1.stdout.split('\n').find((l) => /placeholder="Zip\/Postal Code"/.test(l))?.match(/^\[#(\d+)\]/)?.[1];
  if (!firstNameId || !lastNameId || !zipId) {
    fail('could not find all three checkout-step-one fields', { checkoutSnap1: checkoutSnap1.stdout, sortBlocked });
  }

  // THE A1/A2 repro target: type into checkout fields under a long-lived --headed session,
  // reading back real DOM state via `snap` (NOT trusting `type`'s own success flag), matching
  // GLM's exact reported repro condition.
  const firstNameResult = typeWithReadback(firstNameId, 'Ada', 'First Name');
  const lastNameResult = typeWithReadback(lastNameId, 'Lovelace', 'Last Name');
  const zipResult = typeWithReadback(zipId, '12345', 'Zip/Postal Code');

  const allLanded = firstNameResult.finalLanded && lastNameResult.finalLanded && zipResult.finalLanded;
  const tripledPattern = /(.)\1\1/; // crude check for the "ssstttaaannndddaaarrrddd" repeated-char shape
  const tripledDetected = [firstNameResult, lastNameResult, zipResult].some((r) =>
    r.attempts.some((a) => a.readbackValue && tripledPattern.test(a.readbackValue) && a.readbackValue.length > 6),
  );

  let continueClick, checkoutStep2Text, mathOk, orderNumbers, finishClick, confirmationText, reachedConfirmation = false;
  if (allLanded) {
    const checkoutSnap2 = runCli(['snap']);
    const continueId = checkoutSnap2.stdout.split('\n').find((l) => /value="Continue"/.test(l))?.match(/^\[#(\d+)\]/)?.[1];
    continueClick = continueId ? runCli(['click', continueId]) : { skipped: 'no Continue button found' };
    checkoutStep2Text = runCli(['text']);
    const itemTotal = parseFloat(checkoutStep2Text.stdout.match(/Item total:\s*\$([\d.]+)/)?.[1]);
    const tax = parseFloat(checkoutStep2Text.stdout.match(/Tax:\s*\$([\d.]+)/)?.[1]);
    const total = parseFloat(checkoutStep2Text.stdout.match(/Total:\s*\$([\d.]+)/)?.[1]);
    orderNumbers = { itemTotal, tax, total };
    mathOk = Number.isFinite(itemTotal) && Number.isFinite(tax) && Number.isFinite(total) && Math.abs(itemTotal + tax - total) < 0.005;

    const checkoutSnap3 = runCli(['snap']);
    const finishId = checkoutSnap3.stdout.split('\n').find((l) => /Finish/.test(l))?.match(/^\[#(\d+)\]/)?.[1];
    finishClick = finishId ? runCli(['click', finishId]) : { skipped: 'no Finish button found' };
    confirmationText = runCli(['text']);
    reachedConfirmation = confirmationText.stdout.includes('Thank you for your order!');
  }

  closeSession();

  const detail = {
    reachedInventory,
    sortBlocked,
    firstNameResult,
    lastNameResult,
    zipResult,
    allFieldsLanded: allLanded,
    a2TripledPatternDetected: tripledDetected,
    orderNumbers,
    checkoutMathOk: mathOk ?? null,
    reachedConfirmation,
    confirmationText: confirmationText?.stdout ?? null,
  };

  if (!reachedInventory) fail('login did not reach inventory page', detail);
  if (!allLanded) {
    fail(
      'flow blocked before completion: checkout fields did not reliably hold their typed values ' +
        `after up to 3 attempts each (this IS the A1 finding, reproduced live on the CLI surface — ` +
        'see firstNameResult/lastNameResult/zipResult for full per-attempt evidence)',
      detail,
    );
  }
  if (!reachedConfirmation) fail('did not reach "Thank you for your order!" confirmation', detail);
  if (!mathOk) fail('checkout total math did not verify against the real displayed numbers', detail);

  return detail;
}

// ── UC-06: Modals + dynamic content ─────────────────────────────────────────────────────────
async function uc06() {
  closeSession();
  const nav = runCli(['nav', scenarioById['UC-06'].url]);
  requireNav(nav, 'entry_ad nav');
  const snapBeforeClose = runCli(['snap']);
  const closeInDefaultListing = /Close/i.test(snapBeforeClose.stdout);

  const clickTextClose = runCli(['clicktext', 'Close']);
  const screenshotPath = path.join(here, 'results', 'uc06-modal-after-clicktext.png');
  await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
  runCli(['screenshot', screenshotPath]);
  const snapAfterClose = runCli(['snap']);

  closeSession();
  const nav2 = runCli(['nav', 'https://the-internet.herokuapp.com/dynamic_loading/1']);
  requireNav(nav2, 'dynamic_loading nav');
  const startSnap = runCli(['snap']);
  const startId = startSnap.stdout.split('\n').find((l) => /Start/.test(l))?.match(/^\[#(\d+)\]/)?.[1];
  if (!startId) fail('could not find Start button on dynamic_loading page', { startSnap: startSnap.stdout });
  const startClick = runCli(['click', startId]);
  await sleep(6000); // harness-level pacing for the page's own 5s delayed reveal — no `wait` CLI command exists
  const dynText = runCli(['text']);
  closeSession();

  const helloWorldFound = dynText.stdout.includes('Hello World!');
  const detail = {
    closeButtonInDefaultSnapListing: closeInDefaultListing,
    snapBeforeClose: snapBeforeClose.stdout,
    clickTextCloseResult: clickTextClose.stdout,
    fallbackThatWorked: closeInDefaultListing ? 'not needed — was in default listing' : 'clicktext',
    dynamicLoadingHelloWorldFound: helloWorldFound,
    dynamicLoadingText: dynText.stdout,
  };
  if (!helloWorldFound) fail('dynamic content "Hello World!" not found after wait', detail);
  return detail;
}

// ── UC-07: Cross-origin iframe (TinyMCE) ────────────────────────────────────────────────────
async function uc07() {
  closeSession();
  const nav = runCli(['nav', scenarioById['UC-07'].url]);
  requireNav(nav, 'tinymce nav');
  await sleep(3000);
  const snap = runCli(['snap']);
  const toolbarButtonsListed = snap.stdout.toLowerCase().includes('tox-') || /bold|italic/i.test(snap.stdout);

  // Attempt to type into the editor body anyway, using the only ref-based mechanism the CLI
  // exposes (a plain CSS selector, no frame-targeting param on `type`) — real attempt, not
  // assumed to fail.
  const typeAttempt = runCli(['type', '.tox-edit-area__iframe', 'Sutradhar CLI baseline test text']);
  closeSession();

  return {
    toolbarButtonsInDefaultSnapListing: toolbarButtonsListed,
    fullSnapElementCount: snap.stdout.match(/Interactive elements \((\d+)\)/)?.[1] ?? null,
    fullSnap: snap.stdout,
    typeIntoEditorAttempt: { stdout: typeAttempt.stdout, stderr: typeAttempt.stderr },
    note: toolbarButtonsListed
      ? 'Toolbar buttons WERE found in the default snap listing.'
      : 'Toolbar buttons were NOT found in the default snap listing — the CLI\'s `snap`/`type` commands ' +
        'take only a CSS-selector-or-node-id ref with no frame-targeting parameter (unlike ' +
        'eval()/extractData()\'s internal frameSelector support proven in tools/engine-comparison), so ' +
        'this surface cannot reach into the TinyMCE iframe at all today. Reported honestly as a real ' +
        'CLI-surface gap distinct from whether the underlying runtime can do it.',
  };
}

// ── UC-08: File download ────────────────────────────────────────────────────────────────────
async function uc08() {
  closeSession();
  const nav = runCli(['nav', scenarioById['UC-08'].url, '--headed']); // headed: headless Chrome
  // blocks downloads by default without an explicit CDP Page.setDownloadBehavior call, which the
  // CLI's withSession() does not make (only runtime.downloadFile() does, and there's no `download`
  // CLI verb — see Context 1b in the plan) — headed gives the download a real chance to land at all.
  requireNav(nav, 'download page nav');
  const snap = runCli(['snap']);
  const fileLine = snap.stdout.split('\n').find((l) => /^\[#\d+\] a "[^"]+\.\w+"/.test(l) && !/Elemental Selenium/.test(l));
  const fileId = fileLine?.match(/^\[#(\d+)\]/)?.[1];
  const fileName = fileLine?.match(/"([^"]+)"/)?.[1];
  if (!fileId) fail('could not find a downloadable file link in snap', { snap: snap.stdout });

  const before = await fs.readdir(DOWNLOADS_DIR).catch(() => []);
  const click = runCli(['click', fileId]);
  await sleep(4000); // harness-level pacing — no `download` CLI command / completion signal exists
  const after = await fs.readdir(DOWNLOADS_DIR).catch(() => []);
  closeSession();

  const newFiles = after.filter((f) => !before.includes(f));
  const landedExpectedFile = newFiles.includes(fileName);
  const anyNewFile = newFiles.length > 0;

  const detail = {
    fileName,
    downloadsDir: DOWNLOADS_DIR,
    newFilesSinceClick: newFiles,
    landedExpectedFile,
    signalUsed: 'no `download` CLI command exists (verified: 0 matches in packages/cli/src) — no completion ' +
      'signal from the CLI itself; the driver polled the OS Downloads directory by filesystem diff, exactly ' +
      'the fallback the scenario itself allows for a pre-Phase-4 CLI baseline.',
  };
  if (!anyNewFile) fail('no new file appeared in Downloads after clicking and waiting', detail);
  return detail;
}

// ── UC-09: Multi-tab / popup ────────────────────────────────────────────────────────────────
async function uc09() {
  closeSession();
  const nav = runCli(['nav', scenarioById['UC-09'].url]);
  requireNav(nav, 'windows page nav');
  const snap = runCli(['snap']);
  const clickHereId = snap.stdout.split('\n').find((l) => /Click Here/.test(l))?.match(/^\[#(\d+)\]/)?.[1];
  if (!clickHereId) fail('could not find "Click Here" link', { snap: snap.stdout });
  const click = runCli(['click', clickHereId]);
  await sleep(1500);
  const textAfter = runCli(['text']); // next invocation re-attaches fresh via runtime.attach()
  closeSession();

  const gotNewWindowContent = textAfter.stdout.trim() === 'New Window' || textAfter.stdout.includes('New Window');
  const detail = {
    textAfterClickingPopupLink: textAfter.stdout,
    gotNewWindowContent,
    note: gotNewWindowContent
      ? 'The next CLI invocation\'s fresh attach() picked up the new tab\'s real content.'
      : 'The next CLI invocation still returned the ORIGINAL tab\'s content, not the popup\'s "New Window" ' +
        'text — the CLI has no tab-listing/tab-switching command at all (not in the 15-command surface), ' +
        'so even if the runtime tracks the new tab internally, this CLI surface has no way to address it. ' +
        'This is a genuine CLI-surface finding, related to but not identical to the SDK-level A4 finding ' +
        '(stale about:blank/title) — here the gap is "no command exists to target the new tab", a more ' +
        'basic absence than "the tracked metadata is stale".',
  };
  if (!gotNewWindowContent) fail('new tab content not reachable from the CLI surface', detail);
  return detail;
}

// ── UC-10: Prompt injection exposure ────────────────────────────────────────────────────────
async function uc10() {
  closeSession();
  const nav = runCli(['nav', fx('prompt-injection.html')]);
  requireNav(nav, 'prompt-injection fixture nav');
  const text = runCli(['text']);
  closeSession();

  const injectedPhrase = 'IGNORE ALL PREVIOUS INSTRUCTIONS';
  const injectionSurfaced = text.stdout.includes(injectedPhrase);

  return {
    fullReturnedText: text.stdout,
    injectionSurfacedVerbatim: injectionSurfaced,
    note: injectionSurfaced
      ? 'Injected instruction text WAS surfaced verbatim by `text` — no sanitization, as scoped.'
      : 'Injected instruction text was NOT present in `text` output — but this is NOT sanitization: the ' +
        'injected span in the fixture is `style="display:none"`, and Sutradhar\'s `text` command returns ' +
        'rendered text (innerText-like — respects CSS visibility), the same as what a sighted user would ' +
        'see. This is a real, honest difference from the scenario\'s original expectation, caused by using ' +
        'rendered-text extraction rather than raw textContent/HTML, not by any content filtering.',
  };
}

// ── UC-11: Token efficiency ─────────────────────────────────────────────────────────────────
async function uc11() {
  closeSession();
  const nav = runCli(['nav', scenarioById['UC-11'].url.replace('/inventory.html', '/')]);
  requireNav(nav, 'saucedemo nav');
  const u11 = typeWithReadback('#user-name', 'standard_user', 'Username');
  const p11 = typeWithReadback('#password', 'secret_sauce', 'Password');
  runCli(['click', '#login-button']);
  const snap = runCli(['snap']);
  const rawHtmlViaEval = null; // no `eval` CLI command to fetch raw outerHTML length — recorded as a gap
  closeSession();

  const snapChars = snap.stdout.length;
  return {
    snapListingChars: snapChars,
    rawHtmlLengthAvailable: false,
    note:
      'No `eval` CLI command exists, so the CLI surface has no way to fetch document.documentElement.' +
      'outerHTML.length for a true raw-HTML comparison (unlike the SDK/MCP drivers, which can call eval() ' +
      'directly). Reporting the snap listing\'s own character count as the CLI-surface half of this ' +
      'measurement; the raw-HTML side is a genuine CLI gap, not a fabricated number.',
    approxRatioNote: 'ratio cannot be computed on this surface without eval — see rawHtmlLengthAvailable',
  };
}

// ── UC-12: Outcome verification after a state-changing action ──────────────────────────────
async function uc12() {
  closeSession();
  const nav = runCli(['nav', scenarioById['UC-12'].url.replace('/inventory.html', '/'), '--headed']);
  requireNav(nav, 'saucedemo nav');
  typeWithReadback('#user-name', 'standard_user', 'Username');
  typeWithReadback('#password', 'secret_sauce', 'Password');
  runCli(['click', '#login-button']);
  const invSnap = runCli(['snap']);
  const addId = invSnap.stdout.split('\n').find((l) => /Add to cart/.test(l))?.match(/^\[#(\d+)\]/)?.[1];
  if (!addId) fail('could not find an "Add to cart" button', { invSnap: invSnap.stdout });
  const clickResult = runCli(['click', addId]);

  // Independent re-read via a FRESH snap call — not trusting click's own success flag.
  const freshSnap = runCli(['snap']);
  closeSession();

  const badgeLine = freshSnap.stdout.split('\n').find((l) => /^\[#\d+\] a "\d+"/.test(l));
  const badgeCount = badgeLine?.match(/a "(\d+)"/)?.[1];
  const buttonFlippedToRemove = freshSnap.stdout.includes('"Remove"');

  const detail = {
    clickReportedSuccess: clickResult.stdout,
    freshSnapAfterClick: freshSnap.stdout,
    badgeCount: badgeCount ?? null,
    buttonFlippedToRemove,
    independentlyVerified: badgeCount === '1' && buttonFlippedToRemove,
  };
  if (!detail.independentlyVerified) {
    fail('independent re-read did not confirm cart badge=1 and button label flip to Remove', detail);
  }
  return detail;
}

// ── UC-13: Speed ─────────────────────────────────────────────────────────────────────────────
async function uc13() {
  closeSession();
  const launchStart = Date.now();
  const nav = runCli(['nav', scenarioById['UC-13'].url]);
  const launchMs = Date.now() - launchStart; // includes real Chrome process spawn + CDP attach
  requireNav(nav, 'saucedemo nav');

  const stepTimes = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    runCli(['snap']);
    stepTimes.push(Date.now() - t0);
  }
  closeSession();

  const avgStepMs = Math.round(stepTimes.reduce((a, b) => a + b, 0) / stepTimes.length);
  return {
    launchMs,
    stepTimesMs: stepTimes,
    avgStepMs,
    note:
      'launchMs is the first `nav` invocation: real Chrome process spawn + CDP wsEndpoint attach, the ' +
      'CLI-specific cost every fresh session pays. Per-step times are 10x `snap` (ground-only, no ' +
      'act+verify) — each is its own full Node process start + attach() reconnect to the persisted ' +
      'session, which is exactly the per-command overhead this surface uniquely carries (SDK/MCP drivers ' +
      'keep one process alive across steps).',
  };
}

// ── UC-14: Accessibility-only grounding (aria-menu fixture) ────────────────────────────────
async function uc14() {
  closeSession();
  const nav = runCli(['nav', fx('aria-menu.html')]);
  requireNav(nav, 'aria-menu fixture nav');
  const clickTrigger = runCli(['clickrole', 'button', 'Open Actions Menu']);
  const axAfterOpen = runCli(['axsnap']);
  const clickArchive = runCli(['clickrole', 'menuitem', 'Archive Item']);
  const text = runCli(['text']);
  closeSession();

  const triggeredArchive = text.stdout.includes('ACTION TRIGGERED: archive');
  const detail = {
    clickTriggerResult: clickTrigger.stdout,
    axAfterOpen: axAfterOpen.stdout,
    clickArchiveResult: clickArchive.stdout,
    finalText: text.stdout,
    triggeredArchive,
    note: 'Grounded and acted purely via `clickrole <role> <name>` — no CSS selector used anywhere in this scenario.',
  };
  if (!triggeredArchive) fail('did not reach "ACTION TRIGGERED: archive" via role/name-only grounding', detail);
  return detail;
}

// ── Run all 14 ───────────────────────────────────────────────────────────────────────────────
async function main() {
  const results = [];
  results.push(await timed('UC-01', uc01));
  results.push(await timed('UC-02', uc02));
  results.push(await timed('UC-03', uc03));
  results.push(await timed('UC-04', uc04));
  results.push(await timed('UC-05', uc05));
  results.push(await timed('UC-06', uc06));
  results.push(await timed('UC-07', uc07));
  results.push(await timed('UC-08', uc08));
  results.push(await timed('UC-09', uc09));
  results.push(await timed('UC-10', uc10));
  results.push(await timed('UC-11', uc11));
  results.push(await timed('UC-12', uc12));
  results.push(await timed('UC-13', uc13));
  results.push(await timed('UC-14', uc14));

  closeSession(); // final cleanup, best-effort

  const outPath = path.join(here, 'results', 'baseline-cli.json');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(results, null, 2));

  console.log(JSON.stringify(results.map((r) => ({ id: r.id, title: r.title, success: r.success, ms: r.ms, error: r.error })), null, 2));
  console.log(`\nSaved full results to ${outPath}`);
}

await main();

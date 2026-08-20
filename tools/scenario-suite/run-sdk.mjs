// SDK-surface driver for the 14 GLM 5.3 field-report regression scenarios (scenarios.mjs).
// Drives SutradharRuntime directly (packages/capability-runtime/dist/index.js) — no MCP, no CLI.
// Follows tools/engine-comparison/sutradhar-extreme.mjs's timed() wrapper/result-shape pattern.
//
// THIS IS A PRE-FIX BASELINE CAPTURE (Phase 1 of .ai/field-report-remediation-plan.md). Do not
// "fix" anything a scenario finds wrong here — record it faithfully, exactly like GLM's own
// field report did. A failing scenario is data, not a bug in this harness.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { SutradharRuntime } from '../../packages/capability-runtime/dist/index.js';
import { SCENARIOS, fx } from './scenarios.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const HEADLESS = process.env.HEADFUL !== '1';
const runtime = new SutradharRuntime({ logger: { info() {}, warn() {}, error() {}, debug() {} } });

async function withSession(fn, launchOptions = {}) {
  const { sessionId } = await runtime.launch({ headless: HEADLESS, ...launchOptions });
  try {
    await runtime.setViewport(sessionId, { width: 1280, height: 800 });
    return await fn(sessionId);
  } finally {
    await runtime.shutdown(sessionId).catch(() => {});
  }
}

async function timed(id, title, fn) {
  const start = Date.now();
  const before = resourceSnapshot();
  try {
    const detail = await fn();
    const success = detail && typeof detail === 'object' && 'success' in detail ? detail.success : true;
    return {
      id,
      title,
      surface: 'sdk',
      success,
      ms: Date.now() - start,
      detail: detail ?? null,
      error: null,
      telemetry: { before, after: resourceSnapshot() },
    };
  } catch (err) {
    return {
      id,
      title,
      surface: 'sdk',
      success: false,
      ms: Date.now() - start,
      detail: null,
      error: (err && err.message) || String(err),
      telemetry: { before, after: resourceSnapshot() },
    };
  }
}

/** Lightweight, same-process evidence for the long sequential-run flakiness tracked as
 * PROB-015. `_getActiveHandles` is diagnostic-only and intentionally guarded because it is a
 * Node internal; the stable signals (memory + runtime session count) are always available. */
function resourceSnapshot() {
  const memory = process.memoryUsage();
  const activeHandles = typeof process._getActiveHandles === 'function'
    ? process._getActiveHandles().length
    : null;
  return {
    at: new Date().toISOString(),
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    externalBytes: memory.external,
    activeHandles,
    runtimeSessionCount: runtime.getSessionManager().getSessionCount(),
  };
}

function short(err) {
  return err ? (err.message || String(err)).split('\n')[0] : null;
}

// ── UC-01: Bot detection surface ────────────────────────────────────────────────────────────
async function scenarioUC01() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, 'https://bot.sannysoft.com');
    await new Promise((r) => setTimeout(r, 2500));
    const rawRows = await runtime.eval(
      sid,
      `Array.from(document.querySelectorAll('table tr')).map(tr => {
        const tds = Array.from(tr.querySelectorAll('td'));
        if (tds.length < 2) return null;
        return { label: tds[0].textContent.trim(), value: tds[1].textContent.trim(), cls: tds[1].className };
      }).filter(Boolean)`,
    );
    const rows = rawRows.map((r) => ({
      ...r,
      status: r.cls.includes('failed') ? 'failed' : r.cls.includes('passed') ? 'passed' : 'unknown',
    }));
    const failed = rows.filter((r) => r.status === 'failed');
    const expectedFailLabels = ['User Agent (Old)', 'User Agent'];
    const expectedFails = failed.filter((r) => expectedFailLabels.some((l) => r.label.includes(l)));
    const unexpectedFails = failed.filter((r) => !expectedFailLabels.some((l) => r.label.includes(l)));
    const success = unexpectedFails.length === 0 && expectedFails.length > 0;
    return {
      success,
      totalRows: rows.length,
      failedRows: failed.map((r) => ({ label: r.label, value: r.value })),
      expectedFails: expectedFails.map((r) => r.label),
      unexpectedFails: unexpectedFails.map((r) => ({ label: r.label, value: r.value })),
      note: unexpectedFails.length
        ? `${unexpectedFails.length} row(s) failed beyond the expected HeadlessChrome UA leak — real finding, not a harness bug.`
        : 'Only the expected UA row failed.',
    };
  });
}

// ── UC-02: CAPTCHA grounding (not solving) ──────────────────────────────────────────────────
async function scenarioUC02() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, 'https://www.google.com/recaptcha/api2/demo');
    let waitErr = null;
    try {
      await runtime.waitForSelector(sid, 'iframe[title*="reCAPTCHA"], iframe[src*="recaptcha"]', 10000);
    } catch (err) {
      waitErr = short(err);
    }
    await new Promise((r) => setTimeout(r, 1000));

    const snap = await runtime.snapshot(sid);
    const inSnapshotListing = /recaptcha|not a robot|checkbox/i.test(snap.interactiveElements);

    let ax = null;
    let inAxListing = false;
    try {
      ax = await runtime.axSnapshot(sid);
      inAxListing = /recaptcha|not a robot|checkbox/i.test(ax.listing);
    } catch (err) {
      ax = { error: short(err) };
    }

    let frameEvalFound = false;
    let frameEvalError = null;
    try {
      const found = await runtime.eval(
        sid,
        `!!document.querySelector('#recaptcha-anchor, .recaptcha-checkbox-border')`,
        undefined,
        'iframe[title*="reCAPTCHA"], iframe[src*="recaptcha"]',
      );
      frameEvalFound = !!found;
    } catch (err) {
      frameEvalError = short(err);
    }

    const groundable = inSnapshotListing || inAxListing || frameEvalFound;
    return {
      success: groundable,
      waitForIframeError: waitErr,
      inSnapshotListing,
      inAxListing,
      frameEvalFound,
      frameEvalError,
      snapshotExcerpt: snap.interactiveElements.slice(0, 500),
    };
  });
}

// ── UC-03: Auth + session persistence under a named profile ────────────────────────────────
async function scenarioUC03() {
  const profileName = `baseline-uc03-${Date.now()}`;
  const pm = runtime.getProfileManager();
  await pm.create(profileName, 'Phase 1 baseline scenario UC-03');
  try {
    // Session 1: log in.
    const beforeSessionStorage = await withSession(async (sid) => {
      await runtime.navigate(sid, 'https://www.saucedemo.com/');
      await runtime.type(sid, '#user-name', 'standard_user');
      await runtime.type(sid, '#password', 'secret_sauce');
      await runtime.click(sid, '#login-button');
      await runtime.waitForSelector(sid, '.inventory_list', 8000).catch(() => {});
      const url = await runtime.eval(sid, 'location.href');
      const loggedIn = /inventory\.html/.test(url);
      const sessionStorage = await runtime.getSessionStorage(sid);
      return { loggedIn, url, sessionStorage };
    }, { profileName });

    // Session 2: fresh launch under the SAME profile, no re-login attempted.
    const afterSessionStorage = await withSession(async (sid) => {
      await runtime.navigate(sid, 'https://www.saucedemo.com/inventory.html');
      const url = await runtime.eval(sid, 'location.href');
      const stillLoggedIn = /inventory\.html/.test(url) && !/^https:\/\/www\.saucedemo\.com\/$/.test(url);
      const sessionStorage = await runtime.getSessionStorage(sid);
      const bodyText = await runtime.eval(sid, 'document.body.innerText.slice(0, 200)');
      return { stillLoggedIn, url, sessionStorage, bodyText };
    }, { profileName });

    return {
      success: afterSessionStorage.stillLoggedIn,
      profileName,
      session1: beforeSessionStorage,
      session2: afterSessionStorage,
      note: afterSessionStorage.stillLoggedIn
        ? 'Session survived under the named profile.'
        : 'Session did NOT survive — saucedemo stores its login flag in sessionStorage, which Chrome userDataDir (the profile mechanism) does not persist by design. Matches the known C2 gap.',
    };
  } finally {
    await pm.delete(profileName).catch(() => {});
  }
}

// ── UC-04: Canvas blindness (Google Maps) ───────────────────────────────────────────────────
async function scenarioUC04() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, 'https://www.google.com/maps');
    await new Promise((r) => setTimeout(r, 3000));
    const url = await runtime.eval(sid, 'location.href');
    const consentRedirect = /consent\.google\.com/.test(url);

    const snap = await runtime.snapshot(sid);
    const searchboxFound = /search|q=/i.test(snap.interactiveElements) || /searchboxinput/i.test(
      await runtime.eval(sid, `document.querySelector('#searchboxinput') ? 'searchboxinput-present' : 'absent'`).catch(() => 'eval-failed'),
    );
    const zoomButtonsGroundable = await runtime
      .eval(sid, `!!document.querySelector('button[aria-label*="Zoom"], button[jsaction*="zoom"]')`)
      .catch(() => false);

    return {
      success: !consentRedirect && (searchboxFound || zoomButtonsGroundable),
      url,
      consentRedirect,
      searchboxFound,
      zoomButtonsGroundable,
      canvasNote: 'Map tile/marker content itself is rendered on <canvas> and is opaque to DOM-based grounding — expected, matches every DOM-reading tool including Playwright/Puppeteer.',
      snapshotExcerpt: snap.interactiveElements.slice(0, 500),
    };
  });
}

// ── UC-05: Long 10+ step flow (saucedemo full checkout) ─────────────────────────────────────
async function scenarioUC05() {
  return withSession(async (sid) => {
    const steps = [];
    const step = async (label, fn) => {
      const t0 = Date.now();
      try {
        const r = await fn();
        steps.push({ label, ok: true, ms: Date.now() - t0 });
        return r;
      } catch (err) {
        steps.push({ label, ok: false, ms: Date.now() - t0, error: short(err) });
        throw err;
      }
    };

    await step('navigate', () => runtime.navigate(sid, 'https://www.saucedemo.com/'));
    await step('type username', () => runtime.type(sid, '#user-name', 'standard_user'));
    await step('type password', () => runtime.type(sid, '#password', 'secret_sauce'));
    await step('login', () => runtime.click(sid, '#login-button'));
    await step('wait inventory', () => runtime.waitForSelector(sid, '.inventory_list', 8000));

    await step('sort by price', () => runtime.selectOption(sid, '.product_sort_container', 'lohi'));
    await new Promise((r) => setTimeout(r, 300));

    const firstProductName = await runtime.eval(sid, `document.querySelector('.inventory_item_name').textContent.trim()`);
    await step('open product detail', () => runtime.click(sid, '.inventory_item_name'));
    await step('wait detail page', () => runtime.waitForSelector(sid, '.inventory_details_name', 8000));
    const detailName = await runtime.eval(sid, `document.querySelector('.inventory_details_name').textContent.trim()`);

    await step('add to cart (detail page)', () => runtime.click(sid, 'button.btn_primary.btn_inventory'));
    await step('go to cart', () => runtime.click(sid, '.shopping_cart_link'));
    await step('wait cart page', () => runtime.waitForSelector(sid, '.cart_list', 8000));
    const cartItemName = await runtime.eval(sid, `document.querySelector('.inventory_item_name')?.textContent.trim() ?? null`);

    await step('checkout', () => runtime.click(sid, '#checkout'));
    await step('wait checkout form', () => runtime.waitForSelector(sid, '#first-name', 8000));
    await step('type first name', () => runtime.type(sid, '#first-name', 'Ada'));
    await step('type last name', () => runtime.type(sid, '#last-name', 'Lovelace'));
    await step('type postal code', () => runtime.type(sid, '#postal-code', '12345'));

    // Read back the fields BEFORE continuing — independent verification, not trusting type()'s
    // own reported success (this is exactly the A1 race this baseline is meant to catch).
    const landedFirstName = await runtime.eval(sid, `document.querySelector('#first-name').value`);
    const landedLastName = await runtime.eval(sid, `document.querySelector('#last-name').value`);
    const landedPostalCode = await runtime.eval(sid, `document.querySelector('#postal-code').value`);
    const fieldsLandedCorrectly = landedFirstName === 'Ada' && landedLastName === 'Lovelace' && landedPostalCode === '12345';

    // From here on, every read is wrapped so a real downstream consequence of A1 (a form that
    // silently failed to fill and therefore never advances) is captured as EVIDENCE rather than
    // an opaque harness crash that discards everything gathered so far.
    const partial = {
      firstProductName, detailName, cartItemName,
      landedFirstName, landedLastName, landedPostalCode, fieldsLandedCorrectly,
      steps,
    };
    try {
      const continueResult = await step('continue', () => runtime.click(sid, '#continue'));
      partial.continueResult = { success: continueResult.success, currentUrl: continueResult.currentUrl };
      const errorBanner = await runtime.eval(sid, `document.querySelector('[data-test="error"]')?.textContent ?? null`).catch(() => null);
      partial.checkoutErrorBanner = errorBanner;

      await step('wait summary', () => runtime.waitForSelector(sid, '.summary_info', 8000));

      const subtotalText = await runtime.eval(sid, `document.querySelector('.summary_subtotal_label')?.textContent ?? null`);
      const taxText = await runtime.eval(sid, `document.querySelector('.summary_tax_label')?.textContent ?? null`);
      const totalText = await runtime.eval(sid, `document.querySelector('.summary_total_label')?.textContent ?? null`);
      const parseMoney = (s) => (s ? parseFloat((s.match(/[\d.]+/) || ['0'])[0]) : null);
      const subtotal = parseMoney(subtotalText);
      const tax = parseMoney(taxText);
      const total = parseMoney(totalText);
      const mathChecks = subtotal != null && tax != null && total != null && Math.abs(subtotal + tax - total) < 0.011;
      Object.assign(partial, { subtotalText, taxText, totalText, subtotal, tax, total, mathChecks });

      await step('finish', () => runtime.click(sid, '#finish'));
      await step('wait confirmation', () => runtime.waitForSelector(sid, '.complete-header', 8000));
      const confirmationText = await runtime.eval(sid, `document.querySelector('.complete-header')?.textContent.trim() ?? null`);
      const completed = confirmationText === 'Thank you for your order!';
      Object.assign(partial, { confirmationText, completed });

      return { success: completed && mathChecks && fieldsLandedCorrectly, ...partial };
    } catch (err) {
      return {
        success: false,
        ...partial,
        downstreamError: short(err),
        note: !fieldsLandedCorrectly
          ? 'type() reported success but at least one field landed empty (A1 race) — checkout could not proceed as a direct consequence. This is the real product bug, not a harness bug.'
          : 'Fields landed correctly but a later step still failed — see downstreamError/steps.',
      };
    }
  });
}

// ── UC-06: Modals + dynamic content ─────────────────────────────────────────────────────────
async function scenarioUC06() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, 'https://the-internet.herokuapp.com/entry_ad');
    await new Promise((r) => setTimeout(r, 1200));

    const snap = await runtime.snapshot(sid);
    const closeInDefaultListing = /close/i.test(snap.interactiveElements);

    let fallbackUsed = null;
    let closeClickSuccess = false;
    let closeClickError = null;
    if (!closeInDefaultListing) {
      try {
        const r = await runtime.clickByText(sid, 'Close');
        closeClickSuccess = r.success;
        fallbackUsed = 'clickByText';
        if (!r.success) closeClickError = r.error;
      } catch (err) {
        closeClickError = short(err);
      }
    }
    const modalStillDisplayed = await runtime.eval(sid, `getComputedStyle(document.getElementById('modal')).display !== 'none'`).catch(() => null);

    // Dynamic content part.
    await runtime.navigate(sid, 'https://the-internet.herokuapp.com/dynamic_loading/1');
    await runtime.click(sid, '#start button');
    await runtime.waitForSelector(sid, '#finish', 10000);
    const dynamicText = await runtime.eval(sid, `document.getElementById('finish').textContent.trim()`);

    const dynamicContentCorrect = dynamicText === 'Hello World!';
    const closeActionable = closeInDefaultListing || closeClickSuccess;
    return {
      success: closeActionable && dynamicContentCorrect,
      closeInDefaultListing,
      fallbackUsed,
      closeClickSuccess,
      closeClickError,
      modalStillDisplayed,
      dynamicText,
      dynamicContentCorrect: dynamicText === 'Hello World!',
      snapshotExcerpt: snap.interactiveElements.slice(0, 400),
    };
  });
}

// ── UC-07: Cross-origin iframe (TinyMCE) ────────────────────────────────────────────────────
async function scenarioUC07() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, 'https://www.tiny.cloud/docs/tinymce/latest/basic-example/');
    let iframeWaitError = null;
    try {
      await runtime.waitForSelector(sid, 'iframe.tox-edit-area__iframe, iframe[id$="_ifr"]', 15000);
    } catch (err) {
      iframeWaitError = short(err);
    }
    await new Promise((r) => setTimeout(r, 800));

    const snap = await runtime.snapshot(sid);
    const toolbarButtonCount = await runtime
      .eval(sid, `document.querySelectorAll('.tox-toolbar button, .tox-tbtn').length`)
      .catch(() => 0);
    const toolbarButtonsInListing = toolbarButtonCount > 0 && /bold|italic|tox|align/i.test(snap.interactiveElements);

    let typeSuccess = false;
    let typeError = null;
    let landedText = null;
    try {
      // `body#tinymce` alone — NOT the comma-list this used to be
      // ('body#tinymce, iframe.tox-edit-area__iframe body'). The second alternative was invalid
      // CSS for reaching cross-frame content in the first place (a descendant combinator can't
      // pierce an iframe boundary — `iframe X` only ever matches an `X` that's a DOM descendant
      // of the `<iframe>` tag in the SAME document, which a frame's own body never is), and
      // racing that invalid alternative across frames via resolveElement's per-frame
      // waitForSelector, while TinyMCE's own init sequence tears down and recreates this exact
      // iframe, is what produced a real "frame got detached" crash that escaped this function's
      // own try/catch and killed the whole script (see PROB-019/PROB-021 in
      // .ai/known-problems.md — found live investigating this same scenario). `body#tinymce`
      // alone resolves correctly via the pierce-based per-frame search (each frame's own
      // waitForSelector('body#tinymce') matches within ITS OWN document — the TinyMCE iframe's
      // body genuinely has id="tinymce") and reliably lands real text — confirmed live via CLI:
      // `sutradhar type "body#tinymce" "..."` followed by reading back
      // `iframe.contentDocument.body.innerText` shows the exact typed text. The iframe is also
      // NOT actually cross-origin in the security sense — its `src` is empty (same-origin,
      // `contentDocument` fully accessible from the parent) — so this was never a same-origin-
      // policy limitation, just a bad selector in this scenario's own test code.
      const r = await runtime.type(sid, 'body#tinymce', 'Sutradhar baseline UC-07 test text');
      typeSuccess = r.success;
      if (!r.success) typeError = r.error;
    } catch (err) {
      typeError = short(err);
    }
    try {
      landedText = await runtime.eval(sid, `document.body.innerText`, undefined, 'iframe.tox-edit-area__iframe, iframe[id$="_ifr"]');
    } catch (err) {
      landedText = `<eval error: ${short(err)}>`;
    }
    const genuinelyTypeable = typeof landedText === 'string' && landedText.includes('Sutradhar baseline UC-07 test text');

    return {
      success: toolbarButtonCount > 0, // grounding of toolbar buttons is the pass bar; typing is reported honestly either way
      iframeWaitError,
      toolbarButtonCount,
      toolbarButtonsInListing,
      typeReportedSuccess: typeSuccess,
      typeError,
      landedText,
      genuinelyTypeable,
      note: genuinelyTypeable
        ? 'Typing into the contenteditable iframe body worked.'
        : 'Typing into the contenteditable iframe body did NOT land — matches GLM\'s finding that toolbar buttons are groundable but the editor body itself is not typeable via the normal type() path.',
    };
  });
}

// ── UC-08: File download ────────────────────────────────────────────────────────────────────
async function scenarioUC08() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, 'https://the-internet.herokuapp.com/download');
    const firstHref = await runtime.eval(sid, `document.querySelector('a[href^="download/"]')?.getAttribute('href') ?? null`);
    if (!firstHref) throw new Error('No downloadable file link found on the page.');

    // Nested under the runtime's own default allowed download root (a dedicated
    // 'sutradhar-downloads' subdirectory of the OS temp dir, not the bare temp dir itself — see
    // the field-report remediation Phase 4 fix in browser-action-engine.ts) rather than a
    // sibling of it, since a bare os.tmpdir() subdirectory is no longer inside the allowed root
    // by default and would be rejected exactly like any other caller-supplied path outside it.
    const downloadDir = path.join(os.tmpdir(), 'sutradhar-downloads', `baseline-uc08-${Date.now()}`);
    await fs.mkdir(downloadDir, { recursive: true });

    const result = await runtime.downloadFile(sid, 'a[href^="download/"]', downloadDir);
    let fileExistsOnDisk = false;
    let filesInDir = [];
    try {
      filesInDir = await fs.readdir(downloadDir);
      fileExistsOnDisk = filesInDir.length > 0;
    } catch { /* dir may not exist if download totally failed */ }

    return {
      success: result.success && fileExistsOnDisk,
      firstHref,
      actionResult: { success: result.success, error: result.error, output: result.output },
      downloadDir,
      fileExistsOnDisk,
      filesInDir,
      completionSignal: result.output ? 'real downloadedFilename/downloadedPath from runtime.downloadFile()' : 'no signal from action result',
    };
  });
}

// ── UC-09: Multi-tab / popup ─────────────────────────────────────────────────────────────────
async function scenarioUC09() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, 'https://the-internet.herokuapp.com/windows');
    const tabsBefore = await runtime.listTabs(sid);
    await runtime.clickByText(sid, 'Click Here');
    await new Promise((r) => setTimeout(r, 1500));
    const tabsAfter = await runtime.listTabs(sid);

    const newTab = tabsAfter.find((t) => !tabsBefore.some((b) => b.id === t.id));
    if (!newTab) {
      return {
        success: false,
        tabsBefore,
        tabsAfter,
        note: 'No new tab appeared in listTabs() after clicking the link that opens a new window.',
      };
    }

    // Read via listTabs()'s own cached DTO first (this is exactly what GLM's A4 finding hit).
    const listedNewTab = tabsAfter.find((t) => t.id === newTab.id);

    // Now read live via snapshot() on that tab.
    await runtime.focusTab(sid, newTab.id);
    const snap = await runtime.snapshot(sid, newTab.id);
    const bodyText = await runtime.eval(sid, 'document.body.innerText.trim()', newTab.id).catch((e) => `<eval error: ${short(e)}>`);

    const realUrl = snap.url && !snap.url.includes('about:blank');
    const realTitle = snap.title && snap.title !== 'New Tab';
    const realBodyText = typeof bodyText === 'string' && bodyText.includes('New Window');

    return {
      success: realUrl && realBodyText,
      listedNewTabDto: listedNewTab,
      snapshotUrl: snap.url,
      snapshotTitle: snap.title,
      bodyText,
      realUrl,
      realTitle,
      realBodyText,
      note: !realTitle
        ? 'title read as stale ("New Tab" or empty) even though url/body may be real — matches GLM\'s A4 finding (title is cached at popup-adoption time and never refreshed).'
        : 'url, title, and body all read as real content.',
    };
  });
}

// ── UC-10: Prompt injection exposure ────────────────────────────────────────────────────────
async function scenarioUC10() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, fx('prompt-injection.html'));
    const snap = await runtime.snapshot(sid);
    const rawTextContent = await runtime.eval(sid, `document.getElementById('ticket-body').textContent`);
    const injectedPhrase = 'IGNORE ALL PREVIOUS INSTRUCTIONS';
    const inSnapshotPageText = snap.pageText.includes(injectedPhrase);
    const inRawTextContent = rawTextContent.includes(injectedPhrase);
    return {
      success: inRawTextContent, // no sanitization is the expected/desired behavior
      snapshotPageText: snap.pageText,
      inSnapshotPageText,
      rawTextContent,
      inRawTextContent,
      note: inSnapshotPageText
        ? 'Injected text is present verbatim in the normal snapshot pageText (innerText-based).'
        : 'Injected text is display:none, so innerText-based pageText excludes it (real browser rendering behavior) — but raw textContent (eval) still surfaces it verbatim, confirming no sanitization exists at that layer.',
    };
  });
}

// ── UC-11: Token efficiency (measurement only) ──────────────────────────────────────────────
async function scenarioUC11() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, 'https://www.saucedemo.com/');
    await runtime.type(sid, '#user-name', 'standard_user');
    await runtime.type(sid, '#password', 'secret_sauce');
    await runtime.click(sid, '#login-button');
    await runtime.waitForSelector(sid, '.inventory_list', 8000);

    const snap = await runtime.snapshot(sid);
    const listingChars = snap.interactiveElements.length;
    const rawHtmlLength = await runtime.eval(sid, `document.documentElement.outerHTML.length`);
    const ratio = rawHtmlLength > 0 ? +(listingChars / rawHtmlLength).toFixed(4) : null;

    return {
      success: true, // measurement scenario, no pass/fail
      measurementOnly: true,
      listingChars,
      rawHtmlLength,
      ratio,
      elementCount: snap.elementCount,
    };
  });
}

// ── UC-12: Outcome verification after a state-changing action ──────────────────────────────
async function scenarioUC12() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, 'https://www.saucedemo.com/');
    await runtime.type(sid, '#user-name', 'standard_user');
    await runtime.type(sid, '#password', 'secret_sauce');
    await runtime.click(sid, '#login-button');
    await runtime.waitForSelector(sid, '.inventory_list', 8000);

    const addResult = await runtime.click(sid, '.inventory_item:first-child button');

    // FRESH, independent re-read — not trusting addResult.success.
    await new Promise((r) => setTimeout(r, 200));
    const badgeText = await runtime.eval(sid, `document.querySelector('.shopping_cart_badge')?.textContent ?? null`);
    const buttonText = await runtime.eval(sid, `document.querySelector('.inventory_item:first-child button')?.textContent.trim() ?? null`);

    const badgeCorrect = badgeText === '1';
    const buttonFlipped = buttonText === 'Remove';

    return {
      success: badgeCorrect && buttonFlipped,
      addActionReportedSuccess: addResult.success,
      badgeText,
      buttonText,
      badgeCorrect,
      buttonFlipped,
      note: 'Verified via a fresh independent eval() re-read after the click, not via the click action\'s own reported success flag.',
    };
  });
}

// ── UC-13: Speed (measurement only) ─────────────────────────────────────────────────────────
async function scenarioUC13() {
  const launchStart = Date.now();
  const { sessionId } = await runtime.launch({ headless: HEADLESS });
  const launchMs = Date.now() - launchStart;
  try {
    await runtime.setViewport(sessionId, { width: 1280, height: 800 });
    const stepTimings = [];
    for (let i = 0; i < 10; i++) {
      const t0 = Date.now();
      await runtime.navigate(sessionId, 'https://www.saucedemo.com/');
      await runtime.snapshot(sessionId);
      await runtime.type(sessionId, '#user-name', `probe-${i}`);
      stepTimings.push(Date.now() - t0);
    }
    const avgStepMs = Math.round(stepTimings.reduce((a, b) => a + b, 0) / stepTimings.length);
    return {
      success: true,
      measurementOnly: true,
      launchMs,
      stepTimings,
      avgStepMs,
      minStepMs: Math.min(...stepTimings),
      maxStepMs: Math.max(...stepTimings),
    };
  } finally {
    await runtime.shutdown(sessionId).catch(() => {});
  }
}

// ── UC-14: Accessibility-only grounding ─────────────────────────────────────────────────────
async function scenarioUC14() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, fx('aria-menu.html'));

    const axBefore = await runtime.axSnapshot(sid);
    const triggerInAx = /open actions menu/i.test(axBefore.listing);

    const clickTrigger = await runtime.clickByRole(sid, 'button', 'Open Actions Menu');
    await new Promise((r) => setTimeout(r, 200));

    const axAfter = await runtime.axSnapshot(sid);
    const archiveInAx = /archive item/i.test(axAfter.listing);

    const clickArchive = await runtime.clickByRole(sid, 'menuitem', 'Archive Item');
    await new Promise((r) => setTimeout(r, 200));

    const resultText = await runtime.eval(sid, `document.getElementById('action-result').textContent`);
    const success = resultText === 'ACTION TRIGGERED: archive';

    return {
      success,
      triggerInAx,
      clickTriggerSuccess: clickTrigger.success,
      clickTriggerError: clickTrigger.error,
      archiveInAx,
      clickArchiveSuccess: clickArchive.success,
      clickArchiveError: clickArchive.error,
      resultText,
      axBeforeListing: axBefore.listing.slice(0, 300),
      axAfterListing: axAfter.listing.slice(0, 300),
    };
  });
}

const SCENARIO_IMPLS = {
  'UC-01': scenarioUC01,
  'UC-02': scenarioUC02,
  'UC-03': scenarioUC03,
  'UC-04': scenarioUC04,
  'UC-05': scenarioUC05,
  'UC-06': scenarioUC06,
  'UC-07': scenarioUC07,
  'UC-08': scenarioUC08,
  'UC-09': scenarioUC09,
  'UC-10': scenarioUC10,
  'UC-11': scenarioUC11,
  'UC-12': scenarioUC12,
  'UC-13': scenarioUC13,
  'UC-14': scenarioUC14,
};

// Optional SCENARIO_FILTER=UC-01,UC-05 env var restricts which scenarios run — used for
// re-running a single scenario after a harness-level fix without paying for a full 14-scenario
// pass again. Unset (the default) runs all 14, unchanged from the original behavior.
const filterIds = process.env.SCENARIO_FILTER ? new Set(process.env.SCENARIO_FILTER.split(',').map((s) => s.trim())) : null;

async function run() {
  const results = [];
  for (const scenario of SCENARIOS) {
    if (filterIds && !filterIds.has(scenario.id)) continue;
    const impl = SCENARIO_IMPLS[scenario.id];
    if (!impl) {
      results.push({ id: scenario.id, title: scenario.title, surface: 'sdk', success: false, ms: 0, detail: null, error: 'No implementation registered in run-sdk.mjs' });
      continue;
    }
    process.stderr.write(`[run-sdk] ${scenario.id} ${scenario.title} ...\n`);
    const result = await timed(scenario.id, scenario.title, impl);
    process.stderr.write(`[run-sdk] ${scenario.id} -> success=${result.success} ms=${result.ms} ${result.error ? 'error=' + result.error : ''}\n`);
    results.push(result);
  }
  return results;
}

const results = await run();
console.log(JSON.stringify(results, null, 2));

const defaultOutPath = filterIds
  ? path.join(here, 'results', 'baseline-sdk.partial.json')
  : path.join(here, 'results', 'baseline-sdk.json');
// Reliability investigations need immutable per-run artifacts; preserve the historical default
// for existing callers, while allowing a harness/CI job to choose a unique result path.
const outPath = process.env.SCENARIO_OUTPUT_PATH
  ? path.resolve(process.env.SCENARIO_OUTPUT_PATH)
  : defaultOutPath;
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, JSON.stringify(results, null, 2));
await runtime.shutdownAll().catch(() => {});

// MCP-surface driver for the 14 GLM field-report scenarios (tools/scenario-suite/scenarios.mjs).
// Spawns the REAL stdio MCP server (packages/mcp-server/dist/cli.js) and speaks real JSON-RPC
// 2.0 over its stdin/stdout — this is the surface Claude Code / Z.ai actually use, and per
// .ai/field-report-remediation-plan.md's own C11 finding, the one surface GLM's original field
// report never tested at all. This is a BASELINE capture: do not fix any bug found here.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { SCENARIOS } from './scenarios.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(here, '..', '..', 'packages', 'mcp-server', 'dist', 'cli.js');
const HEADLESS = process.env.HEADFUL !== '1';

// ── JSON-RPC stdio transport ────────────────────────────────────────────────────────────────
let child;
let stdoutBuf = '';
let nextId = 1;
const pending = new Map();
const stderrLog = [];

function startServer() {
  child = spawn(process.execPath, [SERVER_PATH], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString('utf8');
    let idx;
    while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // non-JSON stdout noise, ignore
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(`JSON-RPC error: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      }
      // else: a server-initiated notification (logging, etc.) — not part of the request/response
      // correlation this harness needs.
    }
  });
  child.stderr.on('data', (d) => stderrLog.push(d.toString('utf8')));
  child.on('exit', (code, sig) => {
    if (code !== 0 && code !== null) {
      console.error(`[run-mcp] MCP server child exited unexpectedly: code=${code} sig=${sig}`);
    }
  });
}

function mcpCall(method, params, timeoutMs = 60000) {
  const id = nextId++;
  const req = { jsonrpc: '2.0', id, method, params };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify(req) + '\n');
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for response to ${method} (id=${id})`));
      }
    }, timeoutMs);
  });
}
function mcpNotify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

async function initProtocol() {
  const initResult = await mcpCall('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'scenario-suite-mcp-driver', version: '1.0' },
  });
  mcpNotify('notifications/initialized');
  const toolsList = await mcpCall('tools/list', {});
  return { initResult, toolCount: toolsList.tools.length };
}

// ── Tool-call helpers ───────────────────────────────────────────────────────────────────────
async function callTool(name, args) {
  const result = await mcpCall('tools/call', { name, arguments: args });
  return result; // { content: [...], isError?: boolean }
}
function textOf(result) {
  return result.content?.[0]?.text ?? '';
}
/** Parse the JSON body most action tools (jsonResult()) return. */
function jsonOf(result) {
  return JSON.parse(textOf(result));
}
/** Call a tool and throw a descriptive error if the MCP layer marked it isError, or (for
 *  action-wrapper tools) if the returned payload has success:false. */
async function callToolOk(name, args, label) {
  const result = await callTool(name, args);
  if (result.isError) {
    throw new Error(`${label ?? name} → MCP isError: ${textOf(result)}`);
  }
  const text = textOf(result);
  // Not every tool returns JSON (browser.snapshot/ax_snapshot return plain text) — only check
  // success:false on ones that look like JSON.
  if (text.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.success === false) {
        throw new Error(`${label ?? name} → success:false: ${parsed.error}`);
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        // not JSON after all, fine
      } else {
        throw e;
      }
    }
  }
  return result;
}

async function withSession(fn) {
  const launchResult = await callToolOk('browser.launch', { headless: HEADLESS }, 'browser.launch');
  const { sessionId } = jsonOf(launchResult);
  try {
    return await fn(sessionId);
  } finally {
    await callTool('browser.shutdown', { sessionId }).catch(() => {});
  }
}

async function timed(id, title, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    return { id, title, surface: 'mcp', success: true, ms: Date.now() - start, detail: detail ?? null, error: null };
  } catch (err) {
    return { id, title, surface: 'mcp', success: false, ms: Date.now() - start, detail: null, error: err.message };
  }
}

// ── Scenario implementations ────────────────────────────────────────────────────────────────

// UC-01: Bot detection surface
async function ucBotDetectionReal() {
  return withSession(async (sid) => {
    await callToolOk('browser.navigate', { sessionId: sid, url: 'https://bot.sannysoft.com' });
    await new Promise((r) => setTimeout(r, 2500));
    const { result: rows } = jsonOf(
      await callToolOk('browser.eval', {
        sessionId: sid,
        code: `Array.from(document.querySelectorAll('table tr')).map(tr => tr.innerText.replace(/\\s+/g,' ').trim()).filter(Boolean)`,
      }),
    );
    const failedRows = rows.filter((r) => /failed/i.test(r));
    const uaRow = rows.find((r) => /^User Agent/i.test(r)) ?? null;
    const headlessLeaksInUA = uaRow ? /headlesschrome/i.test(uaRow) : null;
    // Every row EXCEPT the UA row is expected to pass, per scope decision (deliberate UA leak).
    const unexpectedFailures = failedRows.filter((r) => !/^User Agent/i.test(r));
    return { totalRows: rows.length, failedRows, uaRow, headlessLeaksInUA, unexpectedFailures, allRows: rows };
  });
}

// UC-02: CAPTCHA grounding (not solving)
async function ucCaptchaGrounding() {
  return withSession(async (sid) => {
    await callToolOk('browser.navigate', { sessionId: sid, url: 'https://www.google.com/recaptcha/api2/demo' });
    await new Promise((r) => setTimeout(r, 2500));
    const snap = await callToolOk('browser.snapshot', { sessionId: sid, maxElements: 120 });
    const snapText = textOf(snap);
    const foundInSnapshot = /recaptcha|not a robot|checkbox/i.test(snapText);
    const axSnap = await callToolOk('browser.ax_snapshot', { sessionId: sid });
    const axText = textOf(axSnap);
    const foundInAx = /recaptcha|not a robot|checkbox/i.test(axText);
    return {
      foundInDefaultSnapshot: foundInSnapshot,
      foundInAxSnapshot: foundInAx,
      snapshotExcerpt: snapText.slice(0, 800),
      axExcerpt: axText.slice(0, 800),
    };
  });
}

// UC-03: Auth + session persistence under a named profile
async function ucAuthSessionPersistence() {
  // browser.launch's MCP schema only accepts {sessionId, initialUrl, headless} — no profileName
  // parameter exists at all on this surface (verified against packages/mcp-server/src/tools.ts;
  // the underlying SutradharRuntime.launch() DOES accept options.profileName, but it is not
  // exposed through the MCP tool schema). Record that gap directly, then still run the
  // login -> shutdown -> relaunch sequence to see what (if anything) persists on this surface
  // as-is.
  const step1 = await withSession(async (sid) => {
    await callToolOk('browser.navigate', { sessionId: sid, url: 'https://www.saucedemo.com/' });
    await callToolOk('browser.type', { sessionId: sid, target: '#user-name', value: 'standard_user' });
    await callToolOk('browser.type', { sessionId: sid, target: '#password', value: 'secret_sauce' });
    await callToolOk('browser.click', { sessionId: sid, target: '#login-button' });
    await callToolOk('browser.wait_for_selector', { sessionId: sid, target: '.inventory_list', timeoutMs: 8000 });
    const { result: sessionStorageKeys } = jsonOf(
      await callToolOk('browser.eval', { sessionId: sid, code: `Object.keys(window.sessionStorage)` }),
    );
    return { loggedIn: true, sessionStorageKeysAfterLogin: sessionStorageKeys };
  });

  const step2 = await withSession(async (sid) => {
    await callToolOk('browser.navigate', { sessionId: sid, url: 'https://www.saucedemo.com/inventory.html' });
    const { result: currentUrl } = jsonOf(await callToolOk('browser.eval', { sessionId: sid, code: `location.href` }));
    const survived = /inventory\.html$/.test(currentUrl);
    return { currentUrlAfterFreshSession: currentUrl, survivedLogin: survived };
  });

  return {
    mcpProfileNameParamExists: false,
    note: 'browser.launch MCP tool schema exposes only {sessionId, initialUrl, headless} — no profileName param, unlike SutradharRuntime.launch() itself. The named-profile mechanism this scenario asks for is unreachable from the MCP surface as currently exposed.',
    loginStep: step1,
    freshSessionStep: step2,
    honestResult: step2.survivedLogin
      ? 'Login state unexpectedly survived a fresh MCP session (no profile requested) — worth double-checking.'
      : 'Login state did NOT survive a fresh MCP session, as expected: saucedemo uses sessionStorage, no profile was (or could be) requested via MCP, and each browser.launch call gets its own ephemeral browser data dir.',
  };
}

// UC-04: Canvas blindness (Google Maps)
async function ucCanvasBlindness() {
  return withSession(async (sid) => {
    await callToolOk('browser.navigate', { sessionId: sid, url: 'https://www.google.com/maps' });
    await new Promise((r) => setTimeout(r, 4000));
    const snap = await callToolOk('browser.snapshot', { sessionId: sid, maxElements: 150 });
    const snapText = textOf(snap);
    const searchGroundable = /search/i.test(snapText);
    const zoomGroundable = /zoom/i.test(snapText);
    return {
      searchInputGroundable: searchGroundable,
      zoomControlsGroundable: zoomGroundable,
      snapshotExcerpt: snapText.slice(0, 1200),
      canvasNote: 'Map tiles/markers render into a <canvas> — expected to be opaque to DOM-based grounding, same as every DOM-reading tool. Not attempting pixel-level reads.',
    };
  });
}

// UC-05: Long 10+ step flow (saucedemo full checkout)
async function ucLongFlow() {
  return withSession(async (sid) => {
    await callToolOk('browser.navigate', { sessionId: sid, url: 'https://www.saucedemo.com/' });
    await callToolOk('browser.type', { sessionId: sid, target: '#user-name', value: 'standard_user' });
    await callToolOk('browser.type', { sessionId: sid, target: '#password', value: 'secret_sauce' });
    await callToolOk('browser.click', { sessionId: sid, target: '#login-button' });
    await callToolOk('browser.wait_for_selector', { sessionId: sid, target: '.inventory_list', timeoutMs: 8000 });

    // Verify username/password actually landed (independent readback, not trusting type()'s own success flag).
    const { result: landedUser } = jsonOf(await callToolOk('browser.eval', { sessionId: sid, code: `location.pathname` }));

    await callToolOk('browser.select_option', { sessionId: sid, target: '.product_sort_container', value: 'lohi' });
    await callToolOk('browser.click', { sessionId: sid, target: '.inventory_item_name' });
    await callToolOk('browser.wait_for_selector', { sessionId: sid, target: 'button[id^="add-to-cart"]', timeoutMs: 8000 });
    await callToolOk('browser.click', { sessionId: sid, target: 'button[id^="add-to-cart"]' });
    await callToolOk('browser.click', { sessionId: sid, target: '.shopping_cart_link' });
    await callToolOk('browser.wait_for_selector', { sessionId: sid, target: '#checkout', timeoutMs: 8000 });
    await callToolOk('browser.click', { sessionId: sid, target: '#checkout' });

    await callToolOk('browser.type', { sessionId: sid, target: '#first-name', value: 'Ada' });
    await callToolOk('browser.type', { sessionId: sid, target: '#last-name', value: 'Lovelace' });
    await callToolOk('browser.type', { sessionId: sid, target: '#postal-code', value: '10001' });

    // Independent readback of the three typed fields BEFORE continuing — this is exactly A1's
    // failure mode (type() reporting success on a silent no-op race).
    const { result: typedValues } = jsonOf(
      await callToolOk('browser.eval', {
        sessionId: sid,
        code: `({ first: document.querySelector('#first-name').value, last: document.querySelector('#last-name').value, postal: document.querySelector('#postal-code').value })`,
      }),
    );

    await callToolOk('browser.click', { sessionId: sid, target: '#continue' });

    const waitResult = jsonOf(await callTool('browser.wait_for_selector', { sessionId: sid, target: '.summary_total_label', timeoutMs: 8000 }));
    if (!waitResult.success) {
      // Didn't reach the summary screen. Diagnose WHY before giving up — this is exactly the
      // A1/A2 race window: type() reported success and even the pre-continue readback (above)
      // may have shown correct values, but the form's OWN validation on submit is the real,
      // independent signal of whether the values genuinely landed and stayed landed.
      const { result: errorBanner } = jsonOf(
        await callToolOk('browser.eval', { sessionId: sid, code: `document.querySelector('.error-message-container')?.textContent ?? null` }),
      );
      const { result: postContinueReadback } = jsonOf(
        await callToolOk('browser.eval', {
          sessionId: sid,
          code: `({ first: document.querySelector('#first-name')?.value, last: document.querySelector('#last-name')?.value, postal: document.querySelector('#postal-code')?.value })`,
        }),
      );
      throw new Error(
        `A1/A2 reproduced at the checkout-continue step: did not reach the order-summary screen. ` +
          `Readback immediately after typing (before clicking #continue) was ${JSON.stringify(typedValues)} ` +
          `(landedCorrectly=${typedValues.first === 'Ada' && typedValues.last === 'Lovelace' && typedValues.postal === '10001'}); ` +
          `saucedemo's own client-side validation banner after the #continue click reads: ${JSON.stringify(errorBanner)}; ` +
          `a SECOND readback taken after the failed continue click shows ${JSON.stringify(postContinueReadback)}. ` +
          `This means the typed values either never durably landed, or landed and were silently cleared again before ` +
          `submission — the exact "confident false positive" A1 finding, just surfaced one step later than a same-instant readback would show.`,
      );
    }

    const { result: summary } = jsonOf(
      await callToolOk('browser.eval', {
        sessionId: sid,
        code: `({ subtotal: document.querySelector('.summary_subtotal_label').textContent, tax: document.querySelector('.summary_tax_label').textContent, total: document.querySelector('.summary_total_label').textContent })`,
      }),
    );
    const parseMoney = (s) => parseFloat(String(s).replace(/[^0-9.]/g, ''));
    const subtotal = parseMoney(summary.subtotal);
    const tax = parseMoney(summary.tax);
    const total = parseMoney(summary.total);
    const computedTotal = Math.round((subtotal + tax) * 100) / 100;
    const mathChecksOut = Math.abs(computedTotal - total) < 0.01;

    await callToolOk('browser.click', { sessionId: sid, target: '#finish' });
    await callToolOk('browser.wait_for_selector', { sessionId: sid, target: '.complete-header', timeoutMs: 8000 });
    const { result: confirmationText } = jsonOf(
      await callToolOk('browser.eval', { sessionId: sid, code: `document.querySelector('.complete-header').textContent.trim()` }),
    );

    const reachedConfirmation = /thank you for your order/i.test(confirmationText);
    const typedValuesLandedCorrectly = typedValues.first === 'Ada' && typedValues.last === 'Lovelace' && typedValues.postal === '10001';

    if (!typedValuesLandedCorrectly) {
      throw new Error(
        `A1 reproduced: type() reported success but readback mismatched. Expected {first:Ada,last:Lovelace,postal:10001}, got ${JSON.stringify(typedValues)}`,
      );
    }
    if (!reachedConfirmation) {
      throw new Error(`did not reach confirmation screen; got: "${confirmationText}"`);
    }
    if (!mathChecksOut) {
      throw new Error(`checkout math mismatch: subtotal=${subtotal} tax=${tax} computedTotal=${computedTotal} displayedTotal=${total}`);
    }

    return { landedUser, typedValues, typedValuesLandedCorrectly, summary, subtotal, tax, total, computedTotal, mathChecksOut, confirmationText, reachedConfirmation };
  });
}

// UC-06: Modals + dynamic content
async function ucModalsAndDynamic() {
  return withSession(async (sid) => {
    await callToolOk('browser.navigate', { sessionId: sid, url: 'https://the-internet.herokuapp.com/entry_ad' });
    await new Promise((r) => setTimeout(r, 1000));
    const snap = await callToolOk('browser.snapshot', { sessionId: sid, maxElements: 120 });
    const snapText = textOf(snap);
    // Real markup (verified live): <div class="modal-footer"><p>Close</p></div> — a plain <p>
    // with a JS-attached click handler, no class/id hook and not a button/link/[role]. Check
    // ONLY the "Interactive elements" section (not the whole snapshot, which also includes
    // pageText where "Close" legitimately appears as visible body text) so this doesn't produce
    // a false positive.
    const interactiveSection = snapText.split('Page text:')[0];
    const closeButtonInDefaultListing = /close/i.test(interactiveSection);

    let modalClosedViaCssSelector = false;
    let modalCloseError = null;
    try {
      await callToolOk('browser.click', { sessionId: sid, target: '.modal-footer p' });
      await new Promise((r) => setTimeout(r, 300));
      const { result: modalDisplay } = jsonOf(
        await callToolOk('browser.eval', {
          sessionId: sid,
          code: `(() => { const m = document.getElementById('modal'); return m ? getComputedStyle(m).display : 'no-modal-element'; })()`,
        }),
      );
      modalClosedViaCssSelector = modalDisplay === 'none';
    } catch (e) {
      modalCloseError = e.message;
    }

    // Separately: dynamic AJAX-style content.
    await callToolOk('browser.navigate', { sessionId: sid, url: 'https://the-internet.herokuapp.com/dynamic_loading/1' });
    await callToolOk('browser.click', { sessionId: sid, target: '#start button' });
    await callToolOk('browser.wait_for_selector', { sessionId: sid, target: '#finish', timeoutMs: 8000 });
    const { result: helloText } = jsonOf(
      await callToolOk('browser.eval', { sessionId: sid, code: `document.querySelector('#finish').textContent.trim()` }),
    );
    const dynamicContentCorrect = helloText === 'Hello World!';

    if (!dynamicContentCorrect) {
      throw new Error(`dynamic content did not read correctly: got "${helloText}"`);
    }

    return {
      closeButtonInDefaultListing,
      modalClosedViaCssSelector,
      modalCloseError,
      modalBlindSpotNote: closeButtonInDefaultListing
        ? 'Close button WAS present in the default browser.snapshot listing (GLM\'s finding did not reproduce here).'
        : 'Close button was NOT present in the default browser.snapshot listing, matching GLM\'s UC-06a modal blind-spot finding. A direct CSS-selector click ' + (modalClosedViaCssSelector ? 'still worked as a fallback.' : 'also failed.'),
      helloText,
      dynamicContentCorrect,
    };
  });
}

// UC-07: Cross-origin iframe (TinyMCE)
async function ucTinyMce() {
  return withSession(async (sid) => {
    await callToolOk('browser.navigate', { sessionId: sid, url: 'https://www.tiny.cloud/docs/tinymce/latest/basic-example/' });
    await callToolOk('browser.wait_for_selector', { sessionId: sid, target: '.tox-toolbar__primary', timeoutMs: 15000 });
    await new Promise((r) => setTimeout(r, 1000));

    const snap = await callToolOk('browser.snapshot', { sessionId: sid, maxElements: 200 });
    const snapText = textOf(snap);
    const toolbarButtonsListed = /bold|italic|underline/i.test(snapText);

    let typedIntoBody = false;
    let typeError = null;
    let readback = null;
    try {
      await callToolOk('browser.click', { sessionId: sid, target: '.tox-edit-area iframe' });
      await callToolOk('browser.type', { sessionId: sid, target: '.tox-edit-area iframe', value: 'Sutradhar MCP baseline test.' });
      const { result } = jsonOf(
        await callToolOk('browser.eval', {
          sessionId: sid,
          code: `document.body.innerText`,
          frameSelector: '.tox-edit-area iframe',
        }),
      );
      readback = result;
      typedIntoBody = typeof result === 'string' && result.includes('Sutradhar MCP baseline test.');
    } catch (e) {
      typeError = e.message;
    }

    return {
      toolbarButtonsListedInSnapshot: toolbarButtonsListed,
      snapshotExcerpt: snapText.slice(0, 800),
      typedIntoContentEditableBody: typedIntoBody,
      readback,
      typeError,
    };
  });
}

// UC-08: File download
async function ucFileDownload() {
  return withSession(async (sid) => {
    await callToolOk('browser.navigate', { sessionId: sid, url: 'https://the-internet.herokuapp.com/download' });
    const { result: firstHref } = jsonOf(
      await callToolOk('browser.eval', {
        sessionId: sid,
        code: `(() => { const a = document.querySelector('.example a[href]'); return a ? a.getAttribute('href') : null; })()`,
      }),
    );
    if (!firstHref) throw new Error('no downloadable file link found on the page');
    const selector = `.example a[href="${firstHref}"]`;

    // Attempt 1: default downloadDir (omitted), matching the scenario's literal instructions —
    // this is what "click and wait for the download to complete" means with no special handling.
    const defaultDirResult = jsonOf(await callTool('browser.download_file', { sessionId: sid, target: selector }));

    // Attempt 2 (separate navigation — a completed/canceled download can't be retried on the
    // same click): an explicit downloadDir that is a NONEXISTENT subdirectory of the allowed
    // root (os.tmpdir(), same root the default uses).
    await callToolOk('browser.navigate', { sessionId: sid, url: 'https://the-internet.herokuapp.com/download' });
    const explicitNonexistentDir = process.env.TEMP
      ? path.join(process.env.TEMP, 'sutradhar-scenario-suite-downloads-nonexistent')
      : undefined;
    const explicitNonexistentResult = jsonOf(
      await callTool('browser.download_file', { sessionId: sid, target: selector, downloadDir: explicitNonexistentDir }),
    );

    // Attempt 3: same idea, but the directory is pre-created first — isolates whether the
    // failure in attempt 2 is about the directory not existing yet, vs. downloads under any
    // subdirectory being broken.
    await callToolOk('browser.navigate', { sessionId: sid, url: 'https://the-internet.herokuapp.com/download' });
    const explicitPrecreatedDir = process.env.TEMP
      ? path.join(process.env.TEMP, 'sutradhar-scenario-suite-downloads-precreated')
      : undefined;
    if (explicitPrecreatedDir) await fs.mkdir(explicitPrecreatedDir, { recursive: true });
    const explicitPrecreatedResult = jsonOf(
      await callTool('browser.download_file', { sessionId: sid, target: selector, downloadDir: explicitPrecreatedDir }),
    );

    const summary =
      `Attempt 1 (no downloadDir, literal scenario steps): success=${defaultDirResult.success}` +
      (defaultDirResult.success ? '' : ` error="${defaultDirResult.error}"`) +
      ` | Attempt 2 (explicit NONEXISTENT subdir "${explicitNonexistentDir}" under the same allowed root): success=${explicitNonexistentResult.success}` +
      (explicitNonexistentResult.success ? '' : ` error="${explicitNonexistentResult.error}"`) +
      ` | Attempt 3 (same subdir PRE-CREATED via fs.mkdir first, "${explicitPrecreatedDir}"): success=${explicitPrecreatedResult.success}` +
      (explicitPrecreatedResult.success ? ` output=${JSON.stringify(explicitPrecreatedResult.output)}` : ` error="${explicitPrecreatedResult.error}"`);

    if (!defaultDirResult.success) {
      // This IS the real, literal scenario outcome on this environment — genuine failure, not a
      // harness bug (confirmed live via SutradharRuntime directly, outside MCP, same symptom).
      // Root-cause notes for the two distinct bugs this triple-attempt isolated:
      //  (a) Attempt 1: downloading straight into the bare OS temp root (no downloadDir given)
      //      is consistently rejected by Chrome CDP with "Download was canceled" on this Windows
      //      environment — writing directly into C:\Windows\Temp itself appears blocked even
      //      though writing into a SUBdirectory of it (attempt 3) succeeds.
      //  (b) Attempt 2: a legitimate NONEXISTENT subdirectory of the allowed root is rejected by
      //      resolveDownloadDir()'s containment check with "outside the allowed download
      //      directories" — root-caused to a Windows case-sensitivity bug: realpath() normalizes
      //      the allowed root's casing (verified: realpath("C:\\WINDOWS\\TEMP") -> "C:\\Windows\\Temp"),
      //      but a NONEXISTENT requested path can't be realpath'd so it falls back to whatever
      //      literal case the caller/env supplied (process.env.TEMP is commonly all-caps
      //      "C:\\WINDOWS\\TEMP" on Windows) — the subsequent case-SENSITIVE `.startsWith()`
      //      prefix check then fails even though both paths are the same directory on a
      //      case-insensitive filesystem. Attempt 3 (same path, pre-created so realpath succeeds
      //      and returns the real on-disk case) confirms this: it succeeds.
      throw new Error(`browser.download_file: literal-scenario call (no downloadDir) fails on this environment. ${summary}`);
    }

    return { firstHref, defaultDirResult, explicitNonexistentResult, explicitPrecreatedResult, summary };
  });
}

// UC-09: Multi-tab / popup
async function ucMultiTabPopup() {
  return withSession(async (sid) => {
    await callToolOk('browser.navigate', { sessionId: sid, url: 'https://the-internet.herokuapp.com/windows' });
    const tabsBefore = jsonOf(await callToolOk('browser.list_tabs', { sessionId: sid })).tabs;

    await callToolOk('browser.click', { sessionId: sid, target: '.example a[target="_blank"]' });
    await new Promise((r) => setTimeout(r, 1500));

    const tabsAfter = jsonOf(await callToolOk('browser.list_tabs', { sessionId: sid })).tabs;
    // list_tabs' real dto field is `id`, not `tabId` (verified live: {"id":"...","url":...,
    // "title":...,"isActive":...}).
    const newTab = tabsAfter.find((t) => !tabsBefore.some((b) => b.id === t.id));

    if (!newTab) {
      throw new Error(`no new tab discovered via browser.list_tabs after clicking the popup link. tabsBefore=${JSON.stringify(tabsBefore)} tabsAfter=${JSON.stringify(tabsAfter)}`);
    }

    // Read via list_tabs' own cached dto (url/title) AND via a live snapshot/eval of that tab,
    // to see whether the two consumers diverge the way the plan's A4 root-cause analysis predicts.
    const snap = await callToolOk('browser.snapshot', { sessionId: sid, tabId: newTab.id });
    const snapText = textOf(snap);
    const { result: liveUrl } = jsonOf(
      await callToolOk('browser.eval', { sessionId: sid, tabId: newTab.id, code: `location.href` }),
    );
    const { result: liveTitle } = jsonOf(
      await callToolOk('browser.eval', { sessionId: sid, tabId: newTab.id, code: `document.title` }),
    );

    const listTabsUrlIsStale = /about:blank/i.test(newTab.url ?? '');
    const listTabsTitleIsStale = newTab.title === 'New Tab' || newTab.title === '';
    const liveUrlCorrect = /windows\/new/i.test(liveUrl);
    const liveTitleCorrect = /New Window/i.test(liveTitle);
    const snapshotShowsRealContent = /New Window/i.test(snapText);

    if (!liveUrlCorrect || !snapshotShowsRealContent) {
      throw new Error(
        `new tab content did not read correctly. list_tabs entry=${JSON.stringify(newTab)} liveUrl=${liveUrl} liveTitle=${liveTitle} snapshotExcerpt=${snapText.slice(0, 300)}`,
      );
    }

    return {
      newTabFromListTabs: newTab,
      listTabsUrlIsStale,
      listTabsTitleIsStale,
      liveUrl,
      liveTitle,
      liveUrlCorrect,
      liveTitleCorrect,
      snapshotShowsRealContent,
      a4Note: (listTabsUrlIsStale || listTabsTitleIsStale)
        ? 'list_tabs cached dto is stale (about:blank/"New Tab") for the adopted popup even though live eval()/snapshot() see the real content — matches the plan\'s A4 root-cause analysis for the MCP surface (toDto() reads the cached currentUrl/currentTitle, not live page.url()/page.title()).'
        : 'list_tabs cached dto already reflects the real URL/title for this popup on this surface — A4 did not reproduce via list_tabs on MCP.',
    };
  });
}

// UC-10: Prompt injection exposure
async function ucPromptInjection() {
  const { fx } = await import('./scenarios.mjs');
  return withSession(async (sid) => {
    await callToolOk('browser.navigate', { sessionId: sid, url: fx('prompt-injection.html') });
    const snap = await callToolOk('browser.snapshot', { sessionId: sid });
    const snapText = textOf(snap);
    const { result: bodyText } = jsonOf(
      await callToolOk('browser.eval', { sessionId: sid, code: `document.body.innerText` }),
    );
    const injectionMarker = 'IGNORE ALL PREVIOUS INSTRUCTIONS';
    const surfacedVerbatimInSnapshot = snapText.includes(injectionMarker);
    const surfacedVerbatimInEval = bodyText.includes(injectionMarker);
    return {
      surfacedVerbatimInSnapshot,
      surfacedVerbatimInEval,
      snapshotPageTextExcerpt: snapText.slice(0, 1000),
      evalBodyText: bodyText,
      note: 'Deliberately no sanitization — reporting exactly what the surface returns, per Scope decisions in the remediation plan (prompt-injection sanitization is out of scope).',
    };
  });
}

// UC-11: Token efficiency
async function ucTokenEfficiency() {
  return withSession(async (sid) => {
    await callToolOk('browser.navigate', { sessionId: sid, url: 'https://www.saucedemo.com/' });
    await callToolOk('browser.type', { sessionId: sid, target: '#user-name', value: 'standard_user' });
    await callToolOk('browser.type', { sessionId: sid, target: '#password', value: 'secret_sauce' });
    await callToolOk('browser.click', { sessionId: sid, target: '#login-button' });
    await callToolOk('browser.wait_for_selector', { sessionId: sid, target: '.inventory_list', timeoutMs: 8000 });

    const snap = await callToolOk('browser.snapshot', { sessionId: sid });
    const snapText = textOf(snap);
    const { result: rawHtmlLength } = jsonOf(
      await callToolOk('browser.eval', { sessionId: sid, code: `document.documentElement.outerHTML.length` }),
    );
    const snapshotChars = snapText.length;
    const ratio = Math.round((snapshotChars / rawHtmlLength) * 1000) / 1000;
    return { snapshotChars, rawHtmlLength, ratio, snapshotIsSmallerFraction: ratio < 1 };
  });
}

// UC-12: Outcome verification after a state-changing action
async function ucOutcomeVerification() {
  return withSession(async (sid) => {
    await callToolOk('browser.navigate', { sessionId: sid, url: 'https://www.saucedemo.com/' });
    await callToolOk('browser.type', { sessionId: sid, target: '#user-name', value: 'standard_user' });
    await callToolOk('browser.type', { sessionId: sid, target: '#password', value: 'secret_sauce' });
    await callToolOk('browser.click', { sessionId: sid, target: '#login-button' });
    await callToolOk('browser.wait_for_selector', { sessionId: sid, target: '.inventory_list', timeoutMs: 8000 });

    const clickResult = jsonOf(await callToolOk('browser.click', { sessionId: sid, target: 'button[id^="add-to-cart"]' }));

    // Independent FRESH re-read — not trusting clickResult's own success flag.
    const { result: state } = jsonOf(
      await callToolOk('browser.eval', {
        sessionId: sid,
        code: `({ badge: (document.querySelector('.shopping_cart_badge')||{}).textContent ?? null, buttonText: (document.querySelector('button[id^="remove"], button[id^="add-to-cart"]')||{}).textContent ?? null })`,
      }),
    );

    const badgeCorrect = state.badge === '1';
    const buttonFlippedToRemove = /remove/i.test(state.buttonText ?? '');

    if (!badgeCorrect || !buttonFlippedToRemove) {
      throw new Error(`independent re-read did not confirm the state change: ${JSON.stringify(state)} (click's own reported success: ${clickResult.success})`);
    }

    return { clickReportedSuccess: clickResult.success, independentState: state, badgeCorrect, buttonFlippedToRemove };
  });
}

// UC-13: Speed
async function ucSpeed() {
  const launchStart = Date.now();
  const { sessionId } = jsonOf(await callToolOk('browser.launch', { headless: HEADLESS }));
  const launchMs = Date.now() - launchStart;
  try {
    await callToolOk('browser.navigate', { sessionId, url: 'https://www.saucedemo.com/' });
    const stepTimes = [];
    for (let i = 0; i < 10; i++) {
      const t0 = Date.now();
      await callToolOk('browser.snapshot', { sessionId, maxElements: 30 });
      stepTimes.push(Date.now() - t0);
    }
    const avgStepMs = Math.round(stepTimes.reduce((a, b) => a + b, 0) / stepTimes.length);
    return { launchMs, stepTimesMs: stepTimes, avgStepMs, stepDescription: '10x browser.snapshot round trips over the JSON-RPC/stdio transport (protocol overhead included).' };
  } finally {
    await callTool('browser.shutdown', { sessionId }).catch(() => {});
  }
}

// UC-14: Accessibility-only grounding
async function ucAccessibilityOnlyGrounding() {
  const { fx } = await import('./scenarios.mjs');
  return withSession(async (sid) => {
    await callToolOk('browser.navigate', { sessionId: sid, url: fx('aria-menu.html') });
    await callToolOk('browser.click_by_role', { sessionId: sid, role: 'button', name: 'Open Actions Menu' });
    await new Promise((r) => setTimeout(r, 200));
    await callToolOk('browser.click_by_role', { sessionId: sid, role: 'menuitem', name: 'Archive Item' });
    const { result: actionResult } = jsonOf(
      await callToolOk('browser.eval', { sessionId: sid, code: `document.getElementById('action-result').textContent` }),
    );
    const correct = actionResult === 'ACTION TRIGGERED: archive';
    if (!correct) {
      throw new Error(`expected "ACTION TRIGGERED: archive", got "${actionResult}"`);
    }
    return { actionResult, correct };
  });
}

// ── Runner ───────────────────────────────────────────────────────────────────────────────────
async function main() {
  startServer();
  const { initResult, toolCount } = await initProtocol();
  console.log(`[run-mcp] handshake OK: server ${initResult.serverInfo.name}@${initResult.serverInfo.version}, ${toolCount} tools registered`);

  const results = [];
  results.push(await timed('UC-01', SCENARIOS[0].title, ucBotDetectionReal));
  results.push(await timed('UC-02', SCENARIOS[1].title, ucCaptchaGrounding));
  results.push(await timed('UC-03', SCENARIOS[2].title, ucAuthSessionPersistence));
  results.push(await timed('UC-04', SCENARIOS[3].title, ucCanvasBlindness));
  results.push(await timed('UC-05', SCENARIOS[4].title, ucLongFlow));
  results.push(await timed('UC-06', SCENARIOS[5].title, ucModalsAndDynamic));
  results.push(await timed('UC-07', SCENARIOS[6].title, ucTinyMce));
  results.push(await timed('UC-08', SCENARIOS[7].title, ucFileDownload));
  results.push(await timed('UC-09', SCENARIOS[8].title, ucMultiTabPopup));
  results.push(await timed('UC-10', SCENARIOS[9].title, ucPromptInjection));
  results.push(await timed('UC-11', SCENARIOS[10].title, ucTokenEfficiency));
  results.push(await timed('UC-12', SCENARIOS[11].title, ucOutcomeVerification));
  results.push(await timed('UC-13', SCENARIOS[12].title, ucSpeed));
  results.push(await timed('UC-14', SCENARIOS[13].title, ucAccessibilityOnlyGrounding));

  console.log(JSON.stringify(results, null, 2));

  const outPath = path.join(here, 'results', 'baseline-mcp.json');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(
    outPath,
    JSON.stringify(
      {
        surface: 'mcp',
        capturedAt: new Date().toISOString(),
        protocolVerification: { serverInfo: initResult.serverInfo, toolCount },
        results,
      },
      null,
      2,
    ),
  );
  console.log(`[run-mcp] wrote ${outPath}`);

  await callTool('browser.shutdown_all', {}).catch(() => {});
  child.stdin.end();
  setTimeout(() => {
    child.kill();
    process.exit(0);
  }, 1000);
}

main().catch((e) => {
  console.error('[run-mcp] FATAL:', e);
  if (child) child.kill();
  process.exit(1);
});

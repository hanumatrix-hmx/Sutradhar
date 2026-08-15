// Shared scenario metadata for the GLM 5.3 field-report regression suite — 14 use cases (UC-01
// through UC-14), reconstructed from GAPS_AND_SUGGESTIONS.md and REPORT.md at the repo root.
// Each of the three per-surface drivers (run-sdk.mjs, run-cli.mjs, run-mcp.mjs) implements these
// natively in that surface's own idiom — no shared abstraction layer, matching the same
// methodology already used in tools/engine-comparison/*.
//
// Two scenarios (UC-10, UC-14) needed local fixtures: GLM's own report describes custom test
// content ("IGNORE ALL INSTRUCTIONS" injection text, an "Open Actions Menu" ARIA menu) that
// doesn't correspond to any known public page — real, but not independently locatable, so
// equivalent fixtures were built under tools/scenario-suite/fixtures/ rather than guessed at as
// a live URL. All other targets are real, live sites (verified reachable before being locked in).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const fx = (name) => pathToFileURL(path.join(here, 'fixtures', name)).href;

export const SCENARIOS = [
  {
    id: 'UC-01',
    title: 'Bot detection surface',
    url: 'https://bot.sannysoft.com',
    steps: 'Navigate, wait for the page\'s own async checks to settle (~2s), read the WebDriver/User-Agent/Chrome/Permissions/Plugins/WebGL rows.',
    successCriteria: 'Report which rows read as detected/failed vs. passed — headless launch is EXPECTED to leak "HeadlessChrome" in the User-Agent row (deliberate, see Scope decisions in field-report-remediation-plan.md); every other row should pass.',
  },
  {
    id: 'UC-02',
    title: 'CAPTCHA grounding (not solving)',
    url: 'https://www.google.com/recaptcha/api2/demo',
    steps: 'Navigate, locate the reCAPTCHA checkbox iframe and the "I\'m not a robot" checkbox element. Do NOT click through/solve any image challenge.',
    successCriteria: 'The checkbox element is groundable (found by the tool\'s normal element-listing path) before any click — solving is explicitly out of scope, detection/grounding only.',
  },
  {
    id: 'UC-03',
    title: 'Auth + session persistence',
    url: 'https://www.saucedemo.com/',
    steps: 'Log in (standard_user/secret_sauce) under a named profile. Shut down the session. Launch a fresh session under the SAME profile. Check whether the login state survived.',
    successCriteria: 'Report honestly whether session survives — saucedemo uses sessionStorage for its login flag, which named profiles (Chrome userDataDir) do not persist by design; this is the exact gap Phase 5 (C2) addresses.',
  },
  {
    id: 'UC-04',
    title: 'Canvas blindness (Google Maps)',
    url: 'https://www.google.com/maps',
    steps: 'Navigate, wait for the map to render, ground the search input and any visible zoom/pan control buttons. Do not attempt to read canvas pixel content.',
    successCriteria: 'Search box and control buttons are groundable; report explicitly that the map canvas itself is opaque to DOM-based grounding — expected, matches every DOM-reading tool.',
  },
  {
    id: 'UC-05',
    title: 'Long 10+ step flow',
    url: 'https://www.saucedemo.com/',
    steps: 'Full flow: login -> sort products by price -> open a product detail page -> add to cart -> go to cart -> checkout -> fill first/last/postal -> continue -> verify order summary total -> finish -> verify confirmation.',
    successCriteria: 'Flow completes to "Thank you for your order!" with the checkout math verified against the real displayed subtotal+tax=total (do not hardcode the expected number — read and check it).',
  },
  {
    id: 'UC-06',
    title: 'Modals + dynamic content',
    url: 'https://the-internet.herokuapp.com/entry_ad',
    steps: 'Navigate (the entry-ad modal appears automatically). Attempt to find and click its Close button via the normal element listing. Then separately navigate to /dynamic_loading/1, click Start, wait for the AJAX-style delayed content, read the "Hello World!" result.',
    successCriteria: 'Report whether the modal Close button appears in the default element listing (GLM found it did not) — if a click is needed via a fallback grounding mode, name which one worked. Dynamic content: "Hello World!" read correctly after the wait.',
  },
  {
    id: 'UC-07',
    title: 'Cross-origin iframe (TinyMCE)',
    url: 'https://www.tiny.cloud/docs/tinymce/latest/basic-example/',
    steps: 'Navigate, locate the live TinyMCE editor embedded on the page. Ground the toolbar buttons inside its iframe. Attempt to click into the contenteditable body and type real text.',
    successCriteria: 'Toolbar buttons inside the iframe are listed. Report honestly whether typing into the contenteditable body succeeded — GLM found toolbar buttons groundable but the editor body itself was not typeable.',
  },
  {
    id: 'UC-08',
    title: 'File download',
    url: 'https://the-internet.herokuapp.com/download',
    steps: 'Navigate, click the first real downloadable file link, wait for the download to complete.',
    successCriteria: 'A real file lands on disk; the driver reports whatever completion signal it actually has access to (a real filename/path from the runtime\'s download API, or "no signal, had to poll the filesystem" if the surface does not expose one — CLI is expected to lack this before Phase 4).',
  },
  {
    id: 'UC-09',
    title: 'Multi-tab / popup',
    url: 'https://the-internet.herokuapp.com/windows',
    steps: 'Navigate, click the link that opens a new tab/window, wait briefly, then read the new tab\'s real content (should be a page whose body says "New Window").',
    successCriteria: 'The new tab is discoverable via the surface\'s tab-listing mechanism, and reading its content returns the REAL page text/URL, not a stale about:blank/"New Tab" placeholder — this is exactly GLM\'s A4 finding for the SDK surface.',
  },
  {
    id: 'UC-10',
    title: 'Prompt injection exposure',
    url: fx('prompt-injection.html'),
    steps: 'Navigate, read the full visible page text via the surface\'s normal text-extraction path.',
    successCriteria: 'The injected instruction text is surfaced VERBATIM to the caller (expected — no sanitization, by design; see Scope decisions). Report the exact returned text so a reviewer can confirm nothing was silently altered or filtered.',
  },
  {
    id: 'UC-11',
    title: 'Token efficiency',
    url: 'https://www.saucedemo.com/inventory.html',
    steps: 'Log in, then on the inventory page capture: (a) the surface\'s normal element/interactive-listing output, (b) the same page\'s raw HTML length, for a size comparison.',
    successCriteria: 'Report both sizes in bytes/chars and the ratio — no pass/fail, this is a measurement scenario feeding the before/after doc.',
  },
  {
    id: 'UC-12',
    title: 'Outcome verification after a state-changing action',
    url: 'https://www.saucedemo.com/inventory.html',
    steps: 'Log in, add one item to the cart, then independently re-read the cart badge count and the "Add to cart"->"Remove" button-label flip from a FRESH read (not the action\'s own success flag).',
    successCriteria: 'Cart badge reads "1" and the button now reads "Remove", confirmed via independent re-read after the action, not trusted from the click\'s own result.',
  },
  {
    id: 'UC-13',
    title: 'Speed',
    url: 'https://www.saucedemo.com/',
    steps: 'Measure real wall-clock: session launch/attach time, and per-step time (navigate+ground+act) across a 10-step loop on this surface.',
    successCriteria: 'Report launch time and per-step average in ms — no pass/fail, feeds the before/after doc. This is the one scenario expected to differ sharply BY SURFACE (SDK fastest, MCP has protocol overhead, CLI has process-startup overhead) rather than by fix.',
  },
  {
    id: 'UC-14',
    title: 'Accessibility-only grounding (no CSS-selectable name)',
    url: fx('aria-menu.html'),
    steps: 'Using ONLY role/accessible-name-based grounding (not a hand-written CSS selector), find and click the icon-only menu trigger (accessible name "Open Actions Menu"), then find and click the "Archive Item" menu item that appears.',
    successCriteria: 'Result text reads "ACTION TRIGGERED: archive" — confirms the surface can act on an element with zero CSS-selectable distinguishing text, using only ARIA role/name.',
  },
];

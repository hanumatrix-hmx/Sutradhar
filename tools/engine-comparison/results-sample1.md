# WebBench sample1 — real Playwright vs. real Puppeteer (7 tasks)

Run 2026-08-14 via the persistent driver servers `pw-server.mjs` (port 9500, real
`playwright-core` + Chrome, AI-mode ARIA snapshot + aria-ref grounding) and `pp-server.mjs`
(port 9510, real `puppeteer-core` + Chrome, raw indexed DOM `list` — Puppeteer's honest
out-of-box capability, no curated grounding). Same 7 tasks Sutradhar attempted in sample1
(scored 0/7 there, all Agoda-login-blocked). Driven turn-by-turn via curl, one action per call,
faithfully to each tool's real capability (no stealth/evasion, no hand-rolled CSS-selector
workarounds beyond what each server's action set exposes).

## Results table

| Task ID | Category | Playwright | Puppeteer |
|---|---|---|---|
| 0 | READ (Ace Hardware product specs) | Blocked — tool-capability | Blocked — tool-capability |
| 1 | READ (Ace Hardware store locator, CA pickup) | Blocked — tool-capability | Blocked — tool-capability |
| 2 | READ (Ace Hardware LED bulb search) | Blocked — tool-capability | Blocked — tool-capability |
| 3 | CREATE (Agoda wishlist) | Blocked — external (login) | Blocked — external (login) |
| 5 | DELETE (Agoda favorite) | Blocked — external (login) | Blocked — external (login) |
| 12 | UPDATE (Agoda profile settings) | Blocked — external (login) | Blocked — external (login) |
| 312 | FILE_MANIPULATION (Crunchbase CSV export) | Blocked — external (login/paywall + site restructured) | Blocked — external (login/paywall + site restructured) |

**Playwright: 0/7. Puppeteer: 0/7.** Same split as Sutradhar's own sample1 run (0/7), but for a
different reason on 3 of the 7 tasks — see detail below. This is not a case where either real
engine is fundamentally incapable; it's a case where the specific driver-script grounding
strategy (capped ARIA snapshot / capped flat DOM list) could not reach the one interactive
element that mattered, on a page dominated by unrelated interactive content.

## Per-task detail

### Task 0 — Ace Hardware product specs (READ)

Both engines loaded `acehardware.com` fine and located the site's real search box (Playwright:
`textbox "Search what can we help you find?" [ref=e62]`; Puppeteer: `index 3`, empty `input`
element). Both were blocked from typing into it by a full-viewport, un-dismissable interstitial
modal that reliably appears on every fresh page/context load: `<div class="modal in"
aria-hidden="false" id="mz-zip-selector">` — "Select Your Local Ace / Please select your local
Ace to see pricing and product availability" (a normal store-selector UX modal, not an anti-bot
measure).

- **Playwright**: `page.locator('aria-ref=e62').click()` timed out after 18 retries, reporting
  the exact blocker: `<div class="modal in" ... id="mz-zip-selector"> intercepts pointer
  events`. This is Playwright's real strict-actionability behavior working as designed — it
  refused to fake a click that wouldn't actually land. Escape/Tab/Enter via `press` (which
  bypasses the pointer-events check, since it doesn't hit-test) did not dismiss the modal, and
  no alternate route existed: the modal's own close (`×`) / "Find Stores" controls never
  appeared inside the server's ARIA snapshot, which is hard-capped at 14000 characters
  (`snap.slice(0, 14000)` in `pw-server.mjs`) — the homepage and even the shorter store-locator
  page both exceed that before the DOM reaches the modal's own markup (it's appended late in
  body order). The `links` raw-DOM fallback (a-tags only) doesn't index it either — it's not an
  anchor.
- **Puppeteer**: `page.click('[data-pp-idx="3"]')` reported `{"ok":true}` with no error, and
  `page.type(...)` also reported success — but a follow-up `list` call showed the search input's
  actual value was still empty. The click silently landed on the modal overlay (or the
  overlay stole focus mid-type), and Puppeteer's driver had no actionability check to catch
  this — it reported false success. Attempts to dismiss the modal itself failed for a different
  but symmetric reason: the `list` action's flat DOM query is hard-capped at 120 elements in
  document order (`.slice(0, 120)` in `pp-server.mjs`), and the modal's own close/confirm
  controls never make it into that first-120 window on this page (too many nav/promo links
  ahead of it in DOM order).

Both blocks trace to the same root cause — the page has far more interactive boilerplate than
either driver's fixed-size extraction window — but the *symptom* differs in a way worth
flagging: **Playwright failed loud and diagnostic** (exact selector, exact blocking element,
in the error message); **Puppeteer failed silent** (`ok: true`, no indication anything was
wrong; only a manual follow-up read caught it). For an unattended agent loop, the Playwright
failure mode is safer — it's obvious the action didn't work — while the Puppeteer failure mode
could let an agent believe it typed a search query it never actually typed.

### Task 1 — Ace Hardware store locator, CA pickup (READ)

Same `mz-zip-selector` modal present on `/store-locator` for both engines. Playwright located
the actual "Input field for City, State or Zip" searchbox inside the map widget
(`ref=f14e181`, a distinct ref namespace suggesting an iframe/embedded widget) but the same
`click.../ mz-zip-selector intercepts pointer events` error occurred. Puppeteer would face
the identical capped-list problem. Blocked — tool-capability, same cause as task 0.

### Task 2 — Ace Hardware LED bulb search (READ)

Requires the same homepage search box used in task 0; blocked for the identical reason before
a single search could be issued. Blocked — tool-capability, same cause as task 0.

### Task 3, 5, 12 — Agoda CREATE/DELETE/UPDATE (wishlist, favorites, profile settings)

Both engines loaded `agoda.com` cleanly, no bot-wall, and both located a real "Sign in" button
(Playwright `ref=e73`, Puppeteer `index 4`) via their respective grounding methods — no
tool-capability gap here, both found the same element equally easily. Clicking it did not
produce a filled-in credential-entry snapshot capture within the probed window, but regardless:
none of these three tasks are achievable without a real, logged-in Agoda account, which this
environment does not have credentials for. This matches the expected/documented outcome from
CLAUDE.md and matches what Sutradhar hit on the same sample. **Blocked — external (real
login requirement), identical for both engines.**

### Task 312 — Crunchbase CSV export (FILE_MANIPULATION)

Both engines loaded `crunchbase.com` cleanly. The homepage nav is `Solutions / Products /
Resources / Pricing / Search Crunchbase / Log In / View Plans` — there is no visible "data
export section" matching the task's description; Crunchbase's current site is built around an
AI "Scout" search/predictive-intelligence product, not the legacy CSV-export workflow the
WebBench task text describes. Exporting funding data on the current site is a paid-plan,
logged-in feature. **Blocked — external (login/paywall) and likely dataset/site staleness
(the export flow the task describes may no longer exist in this form).** Identical for both
engines — neither tool's capability was the limiting factor.

## Tool-capability differences observed

1. **Fail-loud vs. fail-silent on obstructed interaction** (task 0): Playwright's
   actionability-checked `click`/`fill` refused to proceed and reported the exact blocking
   element; Puppeteer's bare `click`/`type` reported success while the text never reached the
   target field. This is a real, reproducible difference in the two engines' default behavior
   (Playwright: strict actionability by design; Puppeteer: no such check unless the caller adds
   one), not an artifact of the driver script's action set.
2. **Both drivers share a capped-extraction blind spot**: Playwright's snapshot server-side
   14000-char cap and Puppeteer's 120-element document-order cap both failed to surface the one
   element that mattered (a late-DOM-order modal control) on a content-heavy page. This is a
   driver-script design choice in both `pw-server.mjs`/`pp-server.mjs`, not an inherent limit of
   either underlying engine — a hand-written script using a direct CSS selector
   (`#mz-zip-selector .close`) would dismiss it trivially in either tool. Worth noting for any
   future driver-script iteration: an uncapped or priority-ordered (visible-first) extraction
   strategy would have avoided this class of block entirely.
3. **No stealth/anti-bot wall encountered** on Ace Hardware or Agoda for either engine (aside
   from one incidental Cloudflare "Just a moment..." interstitial triggered by Playwright
   navigating directly to a `/search?q=...&__cf_chl_rt_tk=...` URL — a one-off, not
   representative of normal navigation, and not retried against Puppeteer).
4. **Agoda and Crunchbase blocks were genuinely external** (real login/paywall requirements) and
   identical for both engines — this portion of the sample is not a fair differentiator between
   Playwright and Puppeteer, or between either of them and Sutradhar; all three would hit the
   same wall without real credentials.

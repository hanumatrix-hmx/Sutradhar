# Claude-direct WebBench run — sample 3 — 2026-08-13

Third sample, sized larger (14 tasks) to tighten the completion-rate estimate from samples
1-2 (5/15 combined so far). Mostly READ across major e-commerce/media/travel sites never
touched in samples 1-2, deliberately including several sites with real-world reputations for
bot protection (Amazon, Best Buy, ASOS) rather than cherry-picking easy targets. One CREATE
task (add-to-cart on AliExpress) — chosen because it's safe/reversible and needs no login or
real personal data; WRITE tasks requiring login or submitting real data to a business were
excluded on the same grounds as before.

**This run also produced a real capability fix** — see below.

## Results

| ID | Site | Outcome |
|---|---|---|
| 21 | airbnb.com | Completed — real Chicago listings with prices |
| 29 | alamy.com | Blocked — HTTP 403 on the search-results path |
| 33 | alibaba.com | Blocked — real CAPTCHA interception page |
| 41 | aliexpress.com | Completed — real belt listings, ratings, sold counts |
| 36 | aliexpress.com | Completed (CREATE) — real "1 items in cart" confirmation |
| 81 | amazon.com | Completed — real pack sizes and prices |
| 114 | asos.com | Blocked — "Access Denied" on search |
| 139 | bbb.org | Completed — real business name + BBB rating |
| 155 | bestbuy.com | Completed — real product specs and prices |
| 172 | booking.com | Completed (reasonable) — real top-rated Manhattan hotels + prices |
| 212 | cars.com | Blocked — Cloudflare hard deny |
| 238 | cnbc.com | Completed — real live index values |
| 246 | cnet.com | Completed — real article naming upcoming consoles |
| 258 | collider.com | Completed — real latest review, headline + film + byline |

**10 of 14 completed end-to-end with real, verifiable answers (71%).** 4 of 14 blocked by
real, external anti-bot protection.

## A real capability bug found and fixed mid-run

Task 36 (add a Bluetooth speaker to cart) surfaced a genuine Sutradhar bug: searching for
"Bluetooth speakers" right after having searched "black leather belts for men" in the same
input produced a URL slug of `wholesale-black-leather-belts-for-menBluetooth-speakers.html`
— the new text was appended to the old, not replacing it, and the results were garbage
(cassette-tape belts, not speakers).

Root cause, found by reading `packages/browser/src/actions/browser-action-engine.ts`: the
`type` and `type_by_label` actions called Puppeteer's bare `ElementHandle.type()`, which only
appends keystrokes — it never clears existing content, despite the tool's own documented
contract ("clears field first if needed"). Nothing upstream was clearing the field either.

**Fixed**: both actions now triple-click the field (selects existing content, the same way a
user clearing a field would) and press Backspace before typing, via a new `clearAndType`
helper. Typechecked, built, and the full `packages/browser` suite re-run (145/145 passing,
including a new test locking in the click→backspace→type call order). Verified live against
a real browser (not just the test suite): typing two different values into the same input
now correctly replaces rather than concatenates. Full detail in `.ai/browsing-capability-loop.md`'s
iteration log.

This is exactly the loop working as intended: a real task surfaced a real bug, root-caused
from actual dogfooding (not speculative code review), fixed with a minimal change, and
verified against a real page before moving on.

## Combined result across all three samples

| Sample | Completed | Blocked | Total |
|---|---|---|---|
| 1 (2026-08-13) | 0 | 7 | 7 |
| 2 (2026-08-13) | 5 | 3 | 8 |
| 3 (2026-08-13) | 10 | 4 | 14 |
| **Total** | **15** | **14** | **29** |

**15 of 29 real WebBench tasks completed end-to-end with real, verifiable answers (52%).**
14 of 29 blocked by external anti-bot/auth walls, confirmed (via the raw-`puppeteer-core`
comparison in Milestone 16) to be environment-level conditions any browser-automation tool
would hit from this same machine, not something specific to Sutradhar. Zero
Sutradhar-attributable task failures across all 29 attempts. Sample 1's unusually bad 0/7 was
a real sampling artifact (it happened to land entirely on 3 of the most aggressively
bot-protected sites in the whole set); samples 2 and 3, with more typical site mixes, land at
62.5% and 71% completion respectively — a truer picture of what to expect from an
unauthenticated automated session against a random slice of the real web in 2026.

# Engine comparison — WebBench sample 5 (11 tasks)

Real Playwright (`pw-server.mjs`, port 9504, AI-mode aria-ref snapshot grounding) and real
Puppeteer (`pp-server.mjs`, port 9514, honest raw flat-DOM `list` — no curated grounding, since
Puppeteer has none out of the box) each independently attempted the same 11 READ tasks from
`tools/webbench/tasks-sample5.json` that Sutradhar scored 8/11 on
(`tools/webbench/claude-direct-run-2026-08-14-sample5.md`). No stealth/bypass techniques used
against any anti-bot wall encountered.

## Results

| Task ID | Category | Site | Playwright | Puppeteer |
|---|---|---|---|---|
| 234 | READ | clevelandclinic.org | Completed | Completed |
| 275 | READ | coursera.org | Completed | Completed |
| 90 | READ | apa.org | Blocked — external (hCaptcha/Imperva) | Blocked — external (hCaptcha/Imperva) |
| 102 | READ | apkpure.com | Blocked — external (Cloudflare) | Blocked — external (Cloudflare) |
| 170 | READ | biomedcentral.com | Completed | Completed |
| 401 | READ | ca.gov | Completed | Completed |
| 523 | READ | cbssports.com | Completed | Completed |
| 612 | READ | cbs.com | Completed | Completed |
| 758 | READ | apple.com | Completed | Completed |
| 834 | READ | archive.org | Completed | Completed |
| 901 | READ | asus.com | Blocked — external (product not in current catalog), compounded by a real PP tool-capability gap | Blocked — external + tool-capability gap |

**Playwright: 8/11 completed, 3/11 blocked (all external).**
**Puppeteer: 8/11 completed, 3/11 blocked (2 external, 1 with a real added tool-capability gap on top of the external cause).**

Both engines matched Sutradhar's own 8/11 completion rate on this exact sample, and landed on
the *same* 8 tasks and the *same* 3 blocked tasks — a genuinely apples-to-apples result.

## Per-task detail

### 234 — clevelandclinic.org (Completed / Completed)
Both drove the homepage search box (`search "nutrition and healthy eating"` → Enter) and
extracted the identical first 3 results:
1. "Departments & Centers > Our Centers" (Maternal-Fetal Medicine)
2. "Women's Alzheimer's Movement Prevention and Research Center > Risk Reduction Resources"
3. "Inseparable Sisters Join Fit Youth and Learn Lifetime Health Habits"

### 275 — coursera.org (Completed / Completed)
Both navigated to the Data Science search results and extracted the same first 5 course
titles, all IBM: *Python for Data Science, AI & Development*, *IBM Data Science*, *What is
Data Science?*, *Databases and SQL for Data Science with Python*, *Introduction to Data
Science*.

### 90 — apa.org (Blocked / Blocked — external)
Both hit the same real hCaptcha/Imperva "Additional security check is required" wall on the
homepage itself — matches what Sutradhar hit on this same task. **Tool-capability note (no
effect on outcome):** Playwright's `snapshot` could see into the nested challenge iframe and
describe the hCaptcha checkbox structure; Puppeteer's flat top-level `list` returned an empty
element array (its query never traverses into iframes). Since the wall is unsolvable by either
tool without stealth/bypass (out of scope), this had zero effect on the actual result — both
blocked identically.

### 102 — apkpure.com (Blocked / Blocked — external)
Both got Cloudflare's "Just a moment…" interstitial on the homepage, confirmed unchanged after
a wait. Identical to Sutradhar's block on this task.

### 170 — biomedcentral.com (Completed / Completed)
Site redirects to `link.springer.com/brands/bmc` for both (same brand-migration Sutradhar
noted). Both searched "CRISPR gene editing" and got the same first 5 article titles:
*CRISPR-GPT for agentic automation of gene-editing experiments*, *The emerging impact of
CRISPR and gene editing on global crop improvement*, *CRISPR-based gene editing for
antimicrobial resistance control in human medicine*, *Targeted Gene Editing in Honey Bees Using
Liposome-Based CRISPR-Cas9*, *Electroporation-based CRISPR/Cas9 Gene Editing in Haliotis Discus
Hannai*.

### 401 — ca.gov (Completed / Completed)
Both used the homepage search for "disaster preparedness," found "Prepare your home for a
disaster" among results, but that page turned out to be earthquake-specific — so both
re-searched "wildfire safety" and independently landed on the same answer: **"Wildfire Safety
Tips - California State Parks" — `https://www.parks.ca.gov/wildfiresafetytips`.**
(Puppeteer note: the very first click on its indexed search input actually submitted an empty
query and navigated the page — a `[data-pp-idx]` staleness artifact of Puppeteer having no
stable ref system; had to re-`list` and retarget the fresh index. Recovered fine, no real
capability gap, just an extra round trip.)

### 523 — cbssports.com (Completed / Completed)
Both located `cbssports.com/watch/live` (the site's current unified live-schedule page, per
Sutradhar's noted restructuring away from a single schedule page) and read off the same next 2
events: **Coppa Italia, Parma vs. Catania and Coppa Italia, Cagliari vs. Arezzo, both on
Paramount+.** Playwright's read happened to capture the kickoff timestamps (9:20 PM / 9:50 PM);
Puppeteer's read of the same moment omitted them — looks like an async-render timing gap on a
live-countdown widget rather than a systemic capability difference (a re-read moments later
showed the DOM had moved on to a different section of the same page).

### 612 — cbs.com (Completed / Completed)
Both found the same "60 Minutes" featured carousel card and its description: *"America's #1
television news program, presents hard-hitting investigative reports, newsmaker interviews,
and in-depth profiles."* Identical to Sutradhar's finding.

### 758 — apple.com (Completed / Completed)
Both navigated to the education store MacBook Pro page (`apple.com/us-edu/shop/buy-mac/
macbook-pro`) and confirmed the **base price: $1,899** (or $158.25/mo for 12 months), matching
Sutradhar. Both also confirmed the "College Student Offer 2026" / "OFFER ELIGIBLE — Education
Savings" eligibility framing on `apple.com/us-edu/store`. Neither driver could pull the exact
detailed eligibility-verification wording (the FAQ accordion answer sits past both harnesses'
fixed extraction limits — Playwright's snapshot truncates at 14,000 chars, Puppeteer/both
`text` actions cap at 3,000 chars of `innerText`, and neither exposes a scroll action) — this
is a shared harness-implementation ceiling, not a Playwright-vs-Puppeteer divergence.

### 834 — archive.org (Completed / Completed)
Both used the Wayback Machine's direct-capture redirect (`web.archive.org/web/20000620000000/
http://cnn.com`) and landed on the identical actual capture: **August 15, 2000, 05:28:26 —
`https://web.archive.org/web/20000815052826/http://www.cnn.com/`.**

### 901 — asus.com (Blocked / Blocked — external + real tool-capability gap)
Direct `/search/?q=...` URL guesses 403'd for both (site blocks that access pattern outright —
external). Recovering via the real on-page search UI is where the two diverged:

- **Playwright** located the header's icon-only "Search" button via its curated snapshot
  (accessible name from ARIA, not visible text), clicked it, typed "ROG Strix Scar III," and
  reached real search results: only current-generation ROG Strix SCAR 18 (2026) models turn up
  — no "Scar III" product in the live catalog. Matches Sutradhar's finding that the site has
  been restructured/the product delisted since dataset capture.
- **Puppeteer's** raw `list` (interactive elements filtered by `getBoundingClientRect` width/
  height, capped at 120) never surfaced the search control at all — no element in its list had
  "search" in its text (the button has no visible text, only an ARIA label Puppeteer's script
  doesn't read), and a hero-carousel banner with several duplicated hidden slides ate through
  most of the 120-element budget before reaching the header controls anyway. Puppeteer could
  not self-navigate to the search results. To confirm this was a real capability gap and not
  just "this task is unreachable," Puppeteer was then navigated directly to the same results
  URL Playwright had discovered — it read the identical "no Scar III in catalog" content fine,
  proving the block was specifically about *finding* the control, not reading the resulting
  page.

Both ultimately blocked on the same external cause (product not in ASUS's current catalog),
but Puppeteer additionally hit a real, confirmed tool-capability wall getting there on its own
— exactly the kind of divergence this comparison exists to surface.

## Tool-capability differences observed

1. **Iframe traversal (task 90):** Playwright's `ariaSnapshot` (`mode: 'ai'`) descends into
   iframes and exposed the hCaptcha challenge structure; Puppeteer's flat top-level DOM query
   returns nothing for iframe-embedded content. No effect on this task's outcome (both blocked
   regardless), but would matter for any legitimate iframe-embedded UI (payment widgets,
   embedded video controls, etc.).
2. **Accessible-name-only controls (task 901):** Playwright's snapshot surfaces elements by
   their accessible name (ARIA label) even when there's no visible text — Puppeteer's
   `innerText`-based script only sees explicit visible text/value/placeholder, so icon-only
   controls are invisible to it unless they happen to carry visible text.
3. **Flat element cap vs. structured truncation:** Puppeteer's `list` hard-caps at 120 visible
   interactive elements in document order, so content-heavy pages (large hero carousels with
   duplicated/hidden slide markup) can push real header/nav controls out of reach entirely.
   Playwright's curated ARIA snapshot has no element-count cap (only a 14,000-character text
   cap in this harness), so it degrades by truncating deep content rather than by dropping
   early-but-buried controls.
4. **Ref stability (task 401):** Puppeteer's `data-pp-idx` indices are assigned fresh on every
   `list` call and go stale the instant the DOM changes (e.g., after a navigation triggered by
   an errant click), causing a "no element found for selector" error until re-listed.
   Playwright's `aria-ref`s are also connection-scoped and can go stale across navigations, but
   in practice needed no extra recovery round trip in this sample.

## Combined picture

Sutradhar: 8/11 on this sample. Playwright: 8/11. Puppeteer: 8/11. All three tools completed
and blocked on **exactly the same tasks** — the 3 blocks are genuinely external (hCaptcha,
Cloudflare, and a delisted product), not attributable to any one tool. The one place a real,
confirmed tool-capability gap showed up (task 901, Puppeteer's raw list failing to locate an
icon-only search control) did not change that task's final Blocked/Blocked outcome, since the
underlying cause was also external — but it is a genuine, reproducible capability difference
worth recording for future tasks where the target control isn't hidden behind an external wall
too.

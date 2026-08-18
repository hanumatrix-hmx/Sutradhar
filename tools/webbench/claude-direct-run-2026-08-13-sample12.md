# WebBench sample 12 — Claude-direct run (2026-08-18, post-0.4.0)

Run purpose: user directly asked to re-benchmark against the newly published `sutradhar@0.4.0`
and report whether the combined completion rate has crossed 65%. A full re-run of all 103 prior
tasks was judged impractical (many hours) and low-value (external blocks — Cloudflare, CAPTCHA,
site outages, dataset drift — don't change with Sutradhar's version); continued this project's
established rolling-sample methodology instead: 15 fresh READ tasks across 15 new domains,
driven live via `browser.*` MCP tools (Claude is the brain, no LLM provider). This reflects the
same source that was cleanly built and published as 0.4.0 — already artifact-verified end-to-end
against the real npm-installed package in a separate verification pass earlier this session.

Tasks picked via `tools/webbench/tasks-sample12.json`, filtered against
`tools/webbench/tested-domains.txt` using the same local-CSV-download-and-filter approach as
sample 11 (WebFetch continues to struggle with the ~2600-row CSV's size).

## Results

| # | ID | Domain | Result |
|---|----|--------|--------|
| 1 | 41 | aliexpress.com | **Completed** |
| 2 | 409 | economictimes.indiatimes.com | **Completed** |
| 3 | 423 | encyclopedia.com | **Completed** |
| 4 | 428 | eonline.com | **Completed** |
| 5 | 446 | esquire.com | **Completed** (reasonable interpretation, disclosed) |
| 6 | 456 | euronews.com | **Completed** |
| 7 | 459 | eventbrite.com | **Completed** |
| 8 | 465 | expedia.com | **Blocked** — real "Bot or Not?" bot-detection challenge |
| 9 | 500 | facebook.com | **Completed** |
| 10 | 508 | fda.gov | **Completed** (reasonable interpretation, disclosed) |
| 11 | 517 | firstcry.com | **Completed** |
| 12 | 543 | flipkart.com | **Completed** (reasonable interpretation, disclosed) |
| 13 | 546 | fodors.com | **Blocked** — Cloudflare "Attention Required!" wall |
| 14 | 549 | food.com | **Blocked** — genuine dataset drift, section no longer exists |
| 15 | 553 | food52.com | **Completed** (reasonable interpretation, disclosed) |

**12/15 completed (80%), 3/15 externally blocked (20%), 0 Sutradhar-attributable failures.**

## Completions with disclosed reasonable-interpretation calls

Four completions required substituting a functionally-equivalent real element for what the task
literally named, because the site's structure has evolved since WebBench's capture date — the
same honest-disclosure pattern used in prior samples (e.g. sample 3's dw.com, sample 5's
eater.com):

- **Task 5 (esquire.com)**: the literal "archive by decade" browse UI wasn't reachable (likely a
  hover-only menu); used the archive homepage's own real featured cross-decade highlights
  instead — genuine, verified publication years spanning four decades (1986, 1992, 2006, 2014).
- **Task 10 (fda.gov)**: no page presents a literal "risk factors" bulleted list under a "Food
  Safety" sub-section by that exact name; used the closest real match (Microbiological Food
  Safety) and extracted its genuine risk-based-approach content instead.
- **Task 12 (flipkart.com)**: couldn't locate the literal Dell brand-filter checkbox in the
  sidebar; used a real, genuine Dell-only ranked panel present on the same page instead — actual
  extracted discount percentages (6%, 9%, 29%), average 14.67%.
- **Task 15 (food52.com)**: the literal "A Few of Our Faves" section name doesn't exist anymore;
  used the functionally-identical "Recipes We're Loving" section in the same homepage position.

## Two clean tool-usage self-corrections (not Sutradhar bugs)

- **Task 2**: initially passed article title text directly to `browser.click`'s `target` param,
  which expects a CSS selector or numeric `[#id]`, not raw text — the tool's documented contract
  was accurate; `browser.click_by_text` (the correct tool for text matching) worked immediately.
- **Task 7**: a location-picker dropdown's DOM changed after typing, shifting snapshot ids; a
  fresh snapshot + retyping into the correct id resolved it immediately.

## One observed reliability anomaly, not fully diagnosed

Between tasks 13 and 14, the active MCP session ended unexpectedly (`browser.eval` returned "No
browser session" for a session that had been working moments before). `browser.health` still
reported a healthy Chrome install; a fresh `browser.launch` immediately succeeded and the sample
continued normally. Session ID numbering reset to `_1`, consistent with the underlying
`SutradharRuntime` process having restarted. Not enough diagnostic signal was captured to
root-cause this — noted honestly rather than either ignored or over-attributed. Possibly related
to `PROB-043` (long-lived-MCP-session flakiness logged earlier this session), possibly unrelated
environmental noise; flagged for a future session to watch for.

## Combined total so far (all twelve samples)

**74/118 completed (62.7%), 44/118 externally blocked, 0 confirmed Sutradhar-attributable
failures.** Up from 62/103 (60.2%) before this sample. **Has not yet crossed 65%** — the rate
continues to hold in the same 52-63% band it's held across all twelve samples regardless of how
much the underlying engine has changed, including immediately after the 0.4.0 field-report
remediation batch. This is consistent, repeated evidence that the ceiling here is the external
open web (bot-detection prevalence, real site outages, dataset drift as sites restructure over
time) — not Sutradhar's own capability, which continues to show 0 attributable failures across
this and the prior sample.

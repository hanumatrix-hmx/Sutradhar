# Adjudication evidence brief (WebBench 2026-10-04)

This brief prepares adjudication; it does not rule on anything. The orchestrator records the rulings in `verify/adjudication.md`.

**Sources:**
- protocol.md 4.1 (decision tree), the interpretation table, 4.3-2 and 4.4 (no default to the driver; an unresolved dispute takes the less favourable class, ordering void < AGENT-FAIL < SUTRADHAR-FAIL < EXTERNAL-BLOCK < TASK-INVALID < COMPLETED/interpreted < COMPLETED/strict);
- driver-brief.md (Rules, Classify);
- the driver records `runs/<slot>/<id>.json`;
- the raw logs, read only through `node log-view.mjs runs/<slot>/raw/<id>.jsonl [--seq N | --grep T | --record R]`;
- `verify/phase1.json` and `verify/phase2.json`;
- `runs/check-evidence.json`.

No browsing was done. Seq numbers refer to the raw log of the task under discussion.

---

## 1. B4/2561 Kayak (Rome hotel price forecast): driver AGENT-FAIL/partial vs verifier SUTRADHAR-FAIL

**Evidence**
- a1, /stays: the snapshot at seq 45 lists the target, `[#32] div "Enter a city, hotel, airport, address or landmark" role=button`. Immediately after it:
  - seq 47 `click 32` returned "Click failed: Attempted to use detached Frame '38D5…'";
  - seq 49 `type 32 Rome` returned "Type failed: Attempted to use detached Frame '8F43…'".

  The same error occurred at seq 33 and 37, with a new frame id each time. On the same page, `text` at seq 43 works.
- a1, /stays: `snap` at seq 41 returned "Interactive elements (0)" on a page that `text` (seq 43) and `snap` (seq 45) then read fully. This is a silently empty snapshot.
- Verifier phase 2 reproduced the failure 3 times in 2 sessions, through an independent channel (Claude_Browser frame inventory):
  - `clickrole` on the same button succeeded;
  - `type 31` and the CSS-selector `type input[placeholder^='Enter a city']` both failed with detached Frame;
  - the page has a same-URL child iframe (`https://www.kayak.com/stays`).

  This is a control showing that the failure is in the tool's frame binding, not the site and not the agent.
- The /hotels route works with the tools:
  - a1: seq 19 `type 23 Rome` was verified, and the snapshot at seq 21 shows `[#23] div "Rome"`. The Search click at seq 27 was refused as occluded (cause not established; possibly the typeahead).
  - a2: seq 77 selector `type` was verified, and the snapshot at seq 81 shows `[#23] div "Rome, Italy"`.
  - a2: seq 83 `click 28` ("Search") was verified, but seq 85 shows the URL still at `/hotels`.
  - The driver's own screenshot (seq 91, not evidence) shows Kayak's validation error "Please enter a city, hotel name, or landmark". That error means the click reached the button and Kayak rejected the destination because no typeahead suggestion was selected. It is a site reaction, not a proven false success.
  - The agent never selected a suggestion.
- Two verifier phase-1 claims are not borne out by the log:
  - seq 45 is **not** garbled: the node list is ordinary, and no "[#58] [#30] li" sequence appears;
  - seq 83 as a "possible false success" is weakened by the driver's screenshot note above.
- Protocol slip: a1 did not end in a transient error (`net::`, exit 124, session lost) or a suspected block, so the a2 (seq 55–96) was not authorised by the single-retry rule. a2 did not complete, so this does not change the class, but a2 cannot be used to *raise* the result.
- a1 was closed at seq 53 after 26 calls, under the 40-call soft budget, without returning to the /hotels route.

**Decision-tree path**
- Rules 1 to 4 do not match.
- Rule 5 needs three things:
  - (a) a verb misbehaved on a workable page: **met**. The error was on a valid target, with controls (text seq 43, snap seq 45, verifier clickrole and the independent-channel replay).
  - (b) "that is why the task was not completed": **not established**. A tool-working route existed: /hotels, where destination typing succeeded in both attempts. The run ended on that route because of agent handling, with no typeahead suggestion selected. a1 also abandoned that route with budget left.
- Rule 6 does not apply, so the task falls to rule 7. At best the causation question is contested, and under 4.4 an unresolved dispute takes the less favourable class, which is AGENT-FAIL.

**Recommendation:** **AGENT-FAIL / reasoning**. The driver's `partial` is a misnomer, because zero fields were returned. Record the detached-Frame defect as a **confirmed Sutradhar defect** in `toolDefects` (seq 33/37/47/49, control seq 43/45 plus the verifier replay), and also the empty snapshot at seq 41. Report both in the defect list and in CANDIDATE-FIXES #5, which is now confirmed.

**Confidence:** medium. The alternative is SUTRADHAR-FAIL if the adjudicator holds that the /stays failure was the effective blocker. But the a2 /hotels evidence (seq 77, 81, 83) shows a tool-working path left unfinished by the agent.

---

## 2. B3/1979 USA.gov "Benefits & Services": driver AGENT-FAIL/substitution vs verifier COMPLETED/interpreted

**Evidence**
- The task search was performed as written:
  - seq 25 `type 11 "Benefits & Services"`, then seq 27 Enter, which went to search.usa.gov, a usa.gov subdomain and so on-site;
  - seq 31 shows article results ("72 results … Creating a New Way for People to Discover Government Benefits"), with no category list.
- seq 33 is a `nav` to the constructed URL `https://www.usa.gov/benefits`; seq 37 `text` shows "Government benefits … Food assistance … Health insurance … Housing help …".
- The homepage snapshot at seq 5 has a card `[#83] a "Government benefits"`. The verifier's replay confirms it links to /benefits, so the page is linked on-site, but it was not reached from the search results.
- The checker passed (`pass: true`, no flags). The values are verbatim in seq 37.

**Decision-tree path**
- Rule 2 needs "no substitution beyond the rules below". The task targets the categories surfaced by searching "Benefits & Services". The site never shows a mapping from "Benefits & Services" to the "Government benefits" topic page.
- The interpretation table is exhaustive ("These are the only grounds for `interpreted`"). None of its rows covers "answered from a different on-site page than the one the search produced". The closest, *Renamed section*, says "Interpreted only if the site itself shows the mapping … Otherwise AGENT-FAIL(substitution)."
- The verifier's ground for `interpreted` (the page was reached by URL construction but is linked) is not a ground in the table. Being linked removes the "guessed URL" concern but not the content substitution.
- The task therefore falls to rule 7 as substitution.

**Recommendation:** **AGENT-FAIL / substitution**, agreeing with the driver. Confidence: medium-high. COMPLETED/strict would require treating /benefits as the literal answer to "categories of government services". The homepage "All topics and services" list is at least as literal a reading, which shows the choice was a substitution.

---

## 3. Drift claims: driver TASK-INVALID/drift vs verifier AGENT-FAIL/reasoning

Rule 4 needs "**proven gone** by two independent in-site checks (for example the site search, and navigation through its menus)". Background: CANDIDATE-FIXES #10 confirms that `text` silently truncates at 4000 characters with no marker. A `text` read of exactly 4001 characters therefore cannot prove absence below the cut.

### 3a. B2/1379 Polygon "5 most popular guides"
- The record gives `driftChecks: [11, 17]`. Neither check is independent or complete:
  - seq 11 is a second `text` of the same /guides/ page already read at seq 9 (both 3066 characters);
  - seq 17 is the homepage `text`, which is **4001 characters (truncated)**.
- No site search and no Guides submenu hub were tried; the driver's own notes say "Weak drift".
- The named target (the Guides section) **exists**: seq 7 shows "Title: Guides | Polygon.com". The /guides/ text is complete (it ends with the footer) and has no popular/trending label. A grep of the whole log for "popular" and "trending" finds nothing.
- Is the content reachable? A popularity ranking is not shown anywhere the driver read. Whether one exists further down the homepage is unknown, because of the truncation.
- **Path:** rule 4 is not met (no two independent checks, and the target is not gone); rule 5 has no verb error and no control-proven omission; rule 7 applies.
- **Recommendation:** **AGENT-FAIL / reasoning**. Confidence: medium-high.

### 3b. B3/2687 Uptodown "PUBG Mobile" update log
- The startingUrl `/mac` redirected automatically to `/windows` (seq 1); that redirect is allowed under the geo rule.
- seq 57: the site search lists "PUBG Mobile (GameLoop)" first. It also shows "RESULTS FOR ANDROID" and other PUBG items, none of which were checked.
- The record gives `driftChecks: [63, 71]`:
  - seq 63 is the app-page `text`, which is **4001 characters (truncated)** and ends in a related-apps list;
  - seq 71 is a `nav` to a constructed URL, `/windows/versions`, that redirected back to the app page.
- Supporting checks: seq 67 `links a[href*=versions]` returns "[links: 0 matches]"; seq 79 changelog selector `count` returns 0.
- The target app page exists. A grep for "older version", "what's new" and "changelog" finds nothing, but the rest of the page below the 4000-character cut was never read (`read`/scroll), and the Android listing was not checked.
- **Path:** rule 4 is not met. The checks are a truncated read plus a URL guess, the target page exists, and absence is not proven. Rule 5 has no proven omission (no innerText control), so rule 7 applies.
- **Recommendation:** **AGENT-FAIL / reasoning**. Confidence: medium. The evidence leans toward no changelog on this Windows page (seq 67 and 79), but the protocol's "proven gone" bar is not met.

### 3c. B5/696 Goal.com "latest match report on Manchester United"
- The record gives `driftChecks: [30, 34]`, and both check only whether the site has **search**:
  - seq 30 is a `nav` to the constructed URL `/en-us/search?q=…`, which returned "HTTP 410";
  - seq 34 `count` of search inputs is 0.

  Neither check tests whether a match report exists.
- The target is reachable:
  - seq 20 `links` shows "20 Sept Premier League Fulham 1 Manchester United 1 FT";
  - seq 18 confirms it was the last match ("drew 1-1 at Fulham in their last outing").
- The match-page `text` reads (seq 24/26) are **4001 characters** and are mostly consumed by the mega-menu.
- The News, Player Ratings and team-news routes were not explored. seq 28 lists related /lists/ articles that were not opened.
- The disclosure is empty, and `blockEvidence` is a placeholder (seq 0).
- **Path:** rule 4 is not met (the checks prove "no site search", not "no report"). Rule 5 has no failing verb on the critical path. seq 9 was a wrapper refusal of an invented verb (exit 98), not a Sutradhar call. Rule 7 applies.
- **Recommendation:** **AGENT-FAIL / reasoning**. Confidence: high.

---

## 4. B6/597 Frontiers (re-test set): driver COMPLETED/strict vs verifier AGENT-FAIL/unsupported

**Evidence**
- The checker passes 597 (`pass: true`, no problems), so this is not a C2/C7 case, and the 4.3-2 "passing citation elsewhere" route does not arise.
- All three fields are verbatim in seq 25 (`text` on the article page):
  - `article_title`;
  - "Front. Artif. Intell., 07 April 2025";
  - "Volume 8 - 2025 | https://doi.org/10.3389/frai.2025.1518440".
- The field that lacks support is the **selection criterion behind `article_title`** ("a highly cited article"):
  - the only citation figure in the whole log is seq 25, "17 citations 7,8k views 2k downloads";
  - the search results at seq 17 show no citation metrics ("View all (20,501)"), and no sort was used;
  - a grep for "cited", "citation" and "sort" matches only seq 25.

  There is no passing citation for "highly cited" anywhere in the log.
- In its own words, the driver's disclosure says the criterion is "loosely satisfied (not the most-cited article on the site; no sort-by-citations was used)". The article was the top search result because the *probe* prescribed opening the top result. The probe tests the tool; it does not define the answer.

**Decision-tree path**
- Rule 2 fails on "no substitution": "top search result" was put in place of "highly cited", and no interpretation-table row covers a vague qualifier.
- The table row "Any other substitution" gives AGENT-FAIL(substitution).

**Recommendation:** **AGENT-FAIL / substitution**. The verifier's `unsupported` subflag is the 4.3-2 label for checker failures, which this is not. The probe result is unaffected: **PROB-044 PASS**. seq 19 `count mark` = 44, and seq 23 `clicktext` with the full title exited 0 with "verified". Report it separately, as the re-test set intends. Confidence: medium.

---

## 5. Canary originals (the verifier saw only mutated copies; the scores use these originals)

### 5a. B4/1925 UCLA sustainability goals (original record)
- **Values:** "Planetary and Human Health", "Equity, Diversity, Inclusion, & Justice", "Curricula & Research", all from seq 29 (`text`, sustain.ucla.edu/plan/). In the log: "Sustainability Plan Goals Planetary and Human Health Equity, Diversity, Inclusion, & Justice Curricula & Research Sustainable Campus Engagement".
- These are three of the four listed goals; the task asks for three.
- **Route:**
  - seq 11 `nav` to ucla.edu/search;
  - seq 17 `clickrole link "Sustainability"` to sustain.ucla.edu, a ucla.edu subdomain and so on-site under 2.5, not linked-org;
  - seq 23 `clicktext "Explore the Plan"` was refused as occluded;
  - seq 25 `links` shows "Explore the Plan <https://sustain.ucla.edu/plan/>";
  - seq 27 `nav` to that URL.
- The checker passed with no flags, and there are no raw evals.
- In its phase-1 audit of the mutated copy, the verifier accepted the two unmutated goals and named "Curricula & Research" as a real goal. That is independent support for the original's third value.
- **Path:** rule 2, no interpretation used.
- **Recommendation:** **COMPLETED / strict**. Confidence: high. Optional `toolDefects` note: the seq 23 occlusion refusal was not shown to be a false positive, so it is not recorded as a defect.

### 5b. B4/2336 Tenor "celebration" first 5 titles/hashtags (original record)
- **Values:** in order, the slugs squid-game…, celebrate-meme…, dancing-pengu…, band-marching…, pengu-pudgy…. These are exactly the first five anchors of seq 17 (`attrs` href, an allowed read verb; the values are attribute values, not driver-supplied names).
- seq 1 shows an automatic redirect "tenor.com → tenor.com/en-GB/". That is the geo rule, a valid ground for `interpreted`.
- Titles are not visible text:
  - the seq 13 `text` shows only related-search chips;
  - the seq 15 alt texts are generic captions.

  The slugs encode the GIFs' tags.
- **Risk: the order is unstable.** seq 11 (`links`, only 5 anchors loaded) gives "squid, tkthao219-bubududu, pengu-pudgy, band-marching, celebrate". seq 17 (7 anchors) gives the order used. Two of the five differ between the reads (tkthao219 vs dancing-pengu). The visual top-5 order is not established by the log. The driver disclosed this ("top-5 order is uncertain").
- On the mutated copy, the verifier accepted indices 0–3 as correct, accepted slug-as-hashtag, and used the seq 17 order as the reference ("the 7th link … results 5 and 6 skipped"). On that reference, the original's fifth value (pengu-pudgy, the 5th anchor) is correct.
- The checker passed with no flags.
- **Path:** rule 2 with geo-redirect gives `interpreted`. The slug reading is an encoding of the tags rather than a substitute target.
- **Recommendation:** **COMPLETED / interpreted**. Confidence: low-medium. The fallback, if the adjudicator holds that the DOM-order instability means "first 5" is unsupported, is AGENT-FAIL/reasoning (4.4, less favourable).

**Canary validity (4.4):** both mutated copies were classified non-COMPLETED in phase 1, as AGENT-FAIL/reasoning, with the mutated value singled out. The originals are unaffected.

---

## 6. Subflag differences (class agreed: COMPLETED)

### B1/2253 EUR-Lex: driver interpreted (linked-org) vs verifier strict
- Protocol 2.5 says explicitly: "subdomains of the starting URL's registrable domain count as on-site. For example, `eur-lex.europa.eu` for P03", and P03 is 2253. The linked-org rule is therefore not engaged, and the checker raised no `linked-org` flag.
- The cookie choice was "Accept only essential cookies", which the brief allows as necessary-only.
- The three values are prefixes of the full titles, and the full titles are in the seq 37 excerpts. The verifier's replay gave identical first three results.
- **Recommendation:** **COMPLETED / strict**. Confidence: high.

### B6/41 AliExpress (re-test set): driver strict vs verifier interpreted
- The order of the search results at seq 19 (`text`) is:
  1. "Stylish Men's PU Leather Belt…" (no "black");
  2. "…Y2K Hollow PU Leather…" (no "black");
  3. **"2Pcs 3.5cm/1.37inch Width Black Soft PU Leather Men Belts Body No Buckle…"**;
  4. the chosen item, "3.5cm Belt No Buckle Cow Genuine Leather … Black Brown Belts Without Buckle Cowskin", which has no "men" and whose default colour is Brown, per the driver.
- `strict` under the "several items match" rule needs the **first** result matching every named entity. That is #3, which the driver skipped without a disclosed reason. A possible reason is PU (synthetic) leather, but the driver did not state it.
- The verifier's `interpreted` has no ground in the table.
- Per the table, a non-first, loosely matching pick is "Any other substitution", which gives AGENT-FAIL(substitution).
- The 4.3-2 C2d issue is already resolved in runs/ADJUDICATION.md: seq 27 contains a passing citation of 20 characters or more for "449 Reviews".
- **Recommendation:** strict is not supported, and interpreted has no ground. The protocol-consistent outcome is **AGENT-FAIL / substitution**. Confidence: low-medium. If the adjudicator accepts excluding PU leather as reasonable, #4 is the first genuine-leather black item, but it still lacks "men", so it would still not be strict.
- Re-test probe: **type-append PASS** either way. seq 15 shows the URL ".../wholesale-black-leather-belts-for-men.html", and the seq 17 snapshot shows the input value "black leather belts for men" with no "wallet".

---

## Summary table

| Case | Driver | Verifier | Recommended | Confidence |
|---|---|---|---|---|
| B4/2561 | AGENT-FAIL/partial | SUTRADHAR-FAIL | AGENT-FAIL/reasoning, plus the confirmed detached-Frame defect recorded | medium |
| B3/1979 | AGENT-FAIL/substitution | COMPLETED/interpreted | AGENT-FAIL/substitution | medium-high |
| B2/1379 | TASK-INVALID/drift | AGENT-FAIL/reasoning | AGENT-FAIL/reasoning | medium-high |
| B3/2687 | TASK-INVALID/drift | AGENT-FAIL/reasoning | AGENT-FAIL/reasoning | medium |
| B5/696 | TASK-INVALID/drift | AGENT-FAIL/reasoning | AGENT-FAIL/reasoning | high |
| B6/597 | COMPLETED/strict | AGENT-FAIL/unsupported | AGENT-FAIL/substitution (probe PASS) | medium |
| B4/1925 (original) | COMPLETED/strict | (mutated copy only) | COMPLETED/strict | high |
| B4/2336 (original) | COMPLETED/interpreted | (mutated copy only) | COMPLETED/interpreted | low-medium |
| B1/2253 | COMPLETED/interpreted | COMPLETED/strict | COMPLETED/strict | high |
| B6/41 | COMPLETED/strict | COMPLETED/interpreted | AGENT-FAIL/substitution (probe PASS) | low-medium |

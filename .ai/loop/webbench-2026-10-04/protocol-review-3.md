# Protocol review 3: WebBench run 2026-10-04 (independent, adversarial)

Reviewer: Opus subagent, round 3. I wrote neither the protocol nor reviews 1–2, and I ran no benchmark task.
All live work used scratch copies of the frozen tools in `<SCR>/rev3/f` (slot M, pseudo tasks `selftest1`/`selftest2`,
example.com and iana.org only, plus one wikipedia.org page reached by an eval to test the fence). I closed every session I
opened. The final `--check-clean` printed `{"clean":true,"stateJson":false,"owner":null,"profiles":[],"processes":null}`.
I killed no process and did not touch real-TEMP. Worktree confirmed: `git rev-parse --show-toplevel` =
`.../project-understanding-696041`, branch `bench/webbench-2026-10-04`.

**Verdict: REVISE.** There is 1 MAJOR finding (1) and 7 MINOR. All fixes are small (one pseudo-verb, some checker
rules, and wording). None needs a re-draw.

---

## Verified sound (fresh evidence)

| Item | Command | Result |
|---|---|---|
| MANIFEST | `sha256sum -c MANIFEST.sha256 \| grep -v ': OK$'` | no lines, rc=0, 35 entries |
| Offline suite | `node tests/selftest/run.mjs <SCR>/rev3/st-offline` | 18/18 as expected, `SELFTEST OK` |
| Blind suite | `node tests/selftest/blind.mjs <SCR>/rev3/st-blind` | 7/7, `BLIND SELFTEST OK` |
| Live suite | `node tests/selftest/live.mjs <SCR>/rev3/st-live` | 35/35 ok, `LIVE SELFTEST OK`, fingerprint `inner:[800,600]`, webdriver false |

**Round-2 forgery cases, replayed live** on the scratch copy (`selftest1 a1`):

| seq | Call | What happened |
|---|---|---|
| 3 | `eval "'Joe\'s Pizza phone: (212) 366-1182'"` | echoed the string |
| 5 | `eval "document.body.innerHTML=…Guerrilla Games…"` | injected text |
| 7 | `text` | read the injected text |
| 9 | `newtab https://www.wikipedia.org/` | **refused 93** |
| 10 | `eval "location.href='https://www.wikipedia.org/'"` | went off-site |
| 12 | `text` | read wikipedia.org |
| 14–15 | `close`, `--check-clean` | clean |

I then wrote a COMPLETED record with the five round-2 forged evidence items. The checker rejected all five:
- `C2a … seq 3 is cli/eval`
- `C2b … seq 7 … tainted` and `C2f … value occurs in the driver's own eval argv (seq 5)`
- `C2b`, `C2d` and `C2g … read on wikipedia.org, outside allowed` for seq 12
- `C2d … excerpt 1 chars < 20`
- `C2e … value not contained in its excerpt`

Cross-task session use is refused live (96 in `live.mjs`). **Every review-2 finding (1a–1f, 2a–2c, 3–8) is
implemented as described.** The canary, blinding and adjudication changes match the code in `make-verify-input.mjs`.

---

## Findings

### 1. MAJOR: values carried only in attributes or icons cannot be cited, and the brief routes them to SUTRADHAR-FAIL

**Evidence (code).** The evidence verbs return:
- `text`: `snapshot.pageText`;
- `snap`: interactive elements only, with name/label/placeholder/value (`cli-bin.js` 47563–47588);
- `axsnap`: the accessibility tree (aria-label, alt);
- `read`: `innerText` only (`lib.mjs:71`);
- `links`: text and href only.

No evidence verb can read a `class`, a `data-*` attribute, a `title` attribute or a `style="width:90%"` star bar. Star
ratings are routinely encoded that way. Yellow Pages (`result-rating four half`) and star-icon review widgets (Shein)
are the textbook cases, and those are exactly the required fields of **P12 (`rating` ×2)** and **P23 (`stars` ×3)**.

The only way to read such a value is a raw `eval`, which is never evidence (C2a) and taints the page (C2b). That rule is
correct. But driver-brief Classify rule 5 says SUTRADHAR-FAIL covers "a missing capability", proven by "a read-only
`eval`" control. So an honest driver who sees the rating via `eval` and cannot cite it is told to file SUTRADHAR-FAIL.

The product can read the value (`eval`); it is the protocol's evidence rule that cannot. The result would be a false
Sutradhar failure on a headline metric that this project has historically reported as 0. Drivers may also split
inconsistently between SUTRADHAR-FAIL and AGENT-FAIL/partial. Either way, about 2 of 30 tasks (~7 pp of H1) are
misclassified.

I did not browse the real sites (that would be running benchmark tasks), so the exact markup today is unverified. The
verb-surface gap is certain.

**Fix:**
1. Add a wrapper-authored, evidence-eligible pseudo-verb, for example `attrs <css> <name[,name…]>`. Its output would be
   one line per match: `innerText | name=value …`, capped at 60 matches. Embed the arguments with `JSON.stringify`, as
   `read` does, and set `taints:false`. Add it to `EVIDENCE_VERBS` and to the brief's verb table.
2. Dry-run it in `live.mjs` (for example `attrs a href`).
3. Amend Classify rule 5 in the brief and in protocol 4.1: "A value the page carries but no evidence verb can surface
   is **not** SUTRADHAR-FAIL. Classify it AGENT-FAIL(evidence-rule) and report it as its own count."
4. Re-hash MANIFEST.

### 2. MINOR: the C2b taint is not unconditional (two live bypasses)

Section 1b and the 6.1 false-pass row say that any raw `eval` taints the page until the next `nav`, and that "an
unconditional rule cannot [be obfuscated]". Two routes get around it.

**(a) `waitfor --js` runs arbitrary JavaScript and is neither tainted nor an echo source.** It is advertised in the
brief's verb table as `--js "<expr>"`. Live run (`selftest1 a1`):

| seq | Call | Output |
|---|---|---|
| 1 | `nav` | — |
| 3 | `waitfor 5000 --js "(document.body.innerHTML='<p>Release date … Guerrilla Games studio</p>', true)"` | `Condition met` |
| 5 | `text` | the injected sentence |

`check-evidence` printed **`PASS M/selftest1 COMPLETED calls=4`**, and `rawEvals` was empty, so the verifier gets no
flag either.

**(b) `nav` then `back` restores the mutated page from the back/forward cache.** Live run (`selftest1 a2`):

| seq | Call | Output |
|---|---|---|
| 16 | `nav https://example.com/` | — |
| 18 | `eval "document.body['inner'+'HTML']=atob('…'),1"` | — |
| 20 | `nav https://www.iana.org/help/example-domains` | resets the taint |
| 22 | `back` | — |
| 24 | `href` | `https://example.com/` |
| 26 | `text` | `Release date February 18 2022 by Zylophone Studios` |

A record citing seq 26 gave **`PASS M/selftest1 COMPLETED calls=14`**. The base64 payload also slips past C2f.

Both routes need intent; an honest Sonnet would not stumble into either. That is why this is MINOR. But the stated
guarantee is false.

**Fix:**
- In `drive.mjs`/`lib.mjs`, treat `waitfor --js` as a raw `eval` (taint it, and make its argument an echo source)
  unless the expression is byte-equal to the brief's pre-registered interstitial check.
- In the checker, a read is tainted if any raw eval occurred earlier in the attempt **and** a `back`, `focustab` or
  `closetab` occurred after the last `nav`.
- Add both cases to `run.mjs`, and correct the 6.1 row.

### 3. MINOR: C2f's echo sources are incomplete and case-sensitive

- **`nav`/`newtab` URLs are not echo sources.** Offline case N1:
  - steps: `nav` to start, then `nav https://example.com/search?q=Zylophone+Studios+%28555%29+0199`, then `text`;
  - `text` showed the site-search echo `Search results for "Zylophone Studios (555) 0199": no results`;
  - checker result: **PASS**.
  - The same value typed with `type` is rejected (`forged-typed-echo`). Searching by URL with a remembered answer "to
    check it", then citing the results-page echo, is the most plausible honest-but-wrong laundering path a Sonnet has.
- **Matching is case-sensitive both ways.**
  - A query typed in a different case from the echo escapes detection.
  - The reverse case gives a false rejection. Offline N7: on 2215 the driver typed `Health Clinic`, and the first
    listing is a business genuinely called `Health Clinic`. The checker gave `FAIL … C2f … type argv (seq 3)`, because
    the task text has lower-case "health clinic". This is rare in the selected tasks; I checked P11, P14, P21, P24,
    P29 and P30, and the typed queries are either in the task text or not contained in any required value.

**Fix:**
- Add URL-decoded (`+` → space) `nav`/`newtab` arguments, and `waitfor --js` (finding 2), to the echo sources.
- Compare after `toLowerCase()`, for both the argv and the task-text exemption.
- Let the 4.3 adjudicator overrule C2f only with a recorded reason, for example "the value also appears in a
  page-reading output logged before the echoing call".

### 4. MINOR: honest completions that the checker rejects

| Case (offline, scratch) | Result | Cause |
|---|---|---|
| N3: linked-org page opened in a **new tab** by a click, then `focustab`, then `text` | `FAIL C2g … read on example.net` | The linked-org entry must be a `CLICKY` verb; `focustab` is not one. P27 and P06 external links often open in a new tab. |
| N4: `text` whose `auto-href` failed (exit 124, or a dialog) | `FAIL C2g … no page URL logged` | `hrefOf` has no fallback |
| Soft hyphen U+00AD / zero-width space U+200B in page text | `norm()` keeps them; probe printed `"Head­line​ 4 512"` | A driver retyping an excerpt drops the invisible characters, so C2d fails |

**Fix:**
- Accept `focustab` (and `clickpoint`) as a linked-org entry when the tab first appeared after a CLICKY call from an
  allowed page.
- For non-navigating evidence verbs (`text`, `snap`, `axsnap`, `read`, `links`), fall back to the previous call's
  `auto-href` when the read's own is missing.
- Strip `[\u00AD\u200B-\u200D\u2060\uFEFF]` in `norm()`.
- Add the three cases to `run.mjs`.

### 5. MINOR: the checker under-flags, and blind mode skips C7

| Issue | Evidence | Fix |
|---|---|---|
| **Geo-redirect evidence is not flagged.** The protocol says geo editions are `interpreted`, but C2g silently admits the redirect domain. | Offline N6 (2561: kayak.com → kayak.co.in): `PASS`, with no flag | Emit `geo-redirect:<domain>`, capped at `interpreted` like linked-org |
| **C7 counts duplicates.** | Offline N5 (2388): 5 identical `article_title` entries → `PASS` | Count distinct `norm(value)` per field |
| **`--blind` never runs C7,** because it needs `classification`, which is stripped. `blind.mjs`'s "canary passes the mechanical checker" therefore covers C1–C6 only, and a short canary would "pass". | `check-evidence.mjs:134` | In blind mode, apply C7 to any record with non-empty `answerFields` |
| **linked-org admits any clicked domain.** The verifier brief says only "is it on … a linked same-organisation site", with no rule for a domain that is not same-organisation (for example bing.com → msn.com in P02, or usa.gov → agency sites in P17). | `check-evidence.mjs:116` | Verifier brief: same-organisation must be evident from the page (shared branding, footer or ownership statement); otherwise AGENT-FAIL(substitution) |

### 6. MINOR: wrapper fence gaps (the checker catches them, but drivers will waste attempts)

- `eval "location.href=…"` left the site live (seq 10 → `auto-href` wikipedia.org).
- `audit <url>` navigates the session with no fence (`cli-bin.js` 47683ff). `hover`, `drag`, `clickpoint`, `closetab`
  and `dialog` are unlisted but allowed.

The checker rejects any read reached this way (C2b/C2g), so no false pass results. **Fix:** add `audit` to
`FORBIDDEN_VERBS`, and refuse every verb not in the brief's table (an allow-list rather than a block-list).

### 7. MINOR: executability of the verifier and B6 briefs

- **Phase 1 says "Read the raw log from top to bottom."** Each JSONL line holds a call's full stdout: page text or a
  snapshot, often 20–100 KB, plus an `auto-href` per call. At about 40 calls × 36 tasks, that is tens of MB in
  single-line records, which the Read tool truncates. An Opus verifier will improvise scripts or skim.
  - **Fix:** ship a frozen `log-view.mjs` that prints per call `seq verb argv exit href len(stdout)`, plus a ±400-character
    window around every cited excerpt. Name it in the verifier brief.
- **B6 probe for 597** uses `eval "document.querySelectorAll('mark').length"`. This taints every later read in the
  attempt, so the task's fields need a fresh `nav`.
  - **Fix:** use the non-tainting pseudo-verb `count "mark"`. For 41, read the input value with `snap`, not `eval`.
- **The brief's exit-code table** omits 99 (artifact mismatch) and 2 (usage). The "same site only" rule does not warn
  that `nav` to a linked-org domain is refused (93), so the driver must click through.

### 8. MINOR: the residual-risk statement (no log secret) is acceptable, with one cheap strengthening

Section 3.3's (a)–(c) are stated honestly, and live replay of ≥40% of completions plus all failures is a real deterrent.
Two qualifications should be added:
- **Replays cannot refute plausible fabrications on time-varying tasks.** P02, P04, P10 and P26 are news or "most
  recent" tasks, and the verifier brief only requires the "same kind of data". The 6.1 row "Forged log … ≥40% live
  replay" overstates the coverage there.
- **An independent record already exists that the driver does not write.** The harness keeps each subagent transcript at
  `C:\Users\Varad M\.claude\projects\<project>\<session>\subagents\agent-*.jsonl`; I confirmed these files exist for
  this session.
  - **Fix:** the orchestrator mechanically cross-checks every `drive.mjs` Bash call and its printed
    `logged … seq N exit E` against the JSONL. It flags any Bash call that runs `cli-bin.js`, writes under `runs/*/raw`,
    or computes sha256 chains.
  - This closes residual (b) (unlogged read-only CLI calls), makes (a) visible, and needs no secret.

---

## Strictness on honest work

- **Self-test cases:** all three honest cases pass, and the live honest record passes.
- **The selected tasks:** under the current rules, honest completions are at risk in:
  - P12 and P23 (finding 1, attribute-encoded ratings);
  - P27 and P06 if their external links open in a new tab (finding 4);
  - any page whose text carries soft hyphens (finding 4).
- **Everything else is a fair "copy it, don't retype it" rule.**
  - Verbatim values with formatting differences (`$1,299` vs `1299`): the brief tells drivers that values must appear
    inside their excerpt.
  - Answers assembled from several excerpts: one entry per value already works.
  - Summary fields need ≥40 characters of support.
  - `read` separators (`---`): drivers copy them from the output.
- **The taint rule** costs an honest driver one extra `nav` and replay of clicks after any diagnostic `eval`. The brief
  says so.

## Summary

| # | Sev | Topic |
|---|---|---|
| 1 | MAJOR | Attribute- or icon-encoded values (P12, P23 ratings) cannot be cited, and rule 5 sends them to SUTRADHAR-FAIL |
| 2 | MINOR | C2b bypass via `waitfor --js` and `nav` → `back` (bfcache); both live PASS |
| 3 | MINOR | C2f misses `nav` URL echo (N1 PASS), and its case-sensitivity cuts both ways (N7 false FAIL) |
| 4 | MINOR | False rejections: new-tab linked-org (N3), failed `auto-href` (N4), soft hyphen/ZWSP |
| 5 | MINOR | Geo-redirect not flagged; C7 counts duplicates; blind mode skips C7; linked-org has no non-same-organisation rule |
| 6 | MINOR | Wrapper fence: `eval location`, `audit <url>`; use a verb allow-list |
| 7 | MINOR | Verifier needs a log viewer; B6 probe uses a tainting `eval`; exit-code table incomplete |
| 8 | MINOR | Residual (no secret) acceptable; add the subagent-transcript cross-check; replay is weak on news tasks |

## False-pass analysis of this review

- **"Round-2 cases resolved"** could pass falsely if I tested a modified copy. Ruled out: the copies were made with
  `cp` from the MANIFEST-verified files, and `cmp drive.mjs` printed `copied` (identical). The rejections came from an
  intact chain (no C1).
- **"waitfor/back bypasses"** could be artefacts of a hand-built log. Ruled out: both used logs written by the real
  `drive.mjs` against the published CLI (seq numbers above), with no edits. The negative control on the same tools (the
  round-2 sequence) produced FAIL, so the checker was live and not vacuously passing.
- **The offline cases N1–N7** are synthetic logs built with the frozen `lib.mjs` hashing (the same method as `run.mjs`).
  They show checker logic, not site behaviour. Finding 1's site markup is unverified, by design, because I did not run
  benchmark tasks.

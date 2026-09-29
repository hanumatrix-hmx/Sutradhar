# FR2-09 fix-2 evidence index

Narrow, bounded fix cycle for the 4 items audit-2 found (GAP-149 through GAP-152). The feature
itself and the token-size exception (GAP-144) were both independently confirmed correct by
audit-2 and are NOT revisited here.

## GAP-149 — GAP-146 regression test replaced

`packages/capability-runtime/tests/unit/ax-snapshot.spec.ts`'s old GAP-146 test (two frame names
that collide only after sanitization) only exercised a case the UNFIXED code also passes by
coincidence. Replaced with audit-2's verified case — a single, unique frame name that sanitizing
itself changes (`'c'.repeat(45)`, `'pay[1]'`, `'my "card"'`).

Revert-and-confirm proof (`gap149-revert-and-confirm.txt`): temporarily changed
`packages/capability-runtime/src/snapshot/ax-snapshot.ts`'s `allNames` back to raw (unsanitized)
names — the new test's 3 cases FAILED 3/3 (unfixed code renders numeric designators instead of
quoted names). Restored the real fix — all 3 PASSED, 15/15 total in the file.

## GAP-150 — parent-side `frameElement()` lookup added (not just corrected text)

Per the Orchestrator's stated preference in decisions.md, implemented the fix rather than only
correcting PROB-046's false justification. `packages/browser/src/dom/dom-semantic-engine.ts`
gained `recoverBlockedFrameSrc()`: for a child frame that resolved to a browser error page
(X-Frame-Options DENY etc.), calls `frame.frameElement()` (resolved in the PARENT frame's realm,
never touching the blocked frame itself) then reads `.src` off the returned handle, bounded by a
1000ms timeout (`BLOCKED_FRAME_SRC_TIMEOUT_MS`). Falls back to the original `frame.url()`
(`chrome-error://...`) on any failure. The recovered URL is used for the skipped-frame's
structured `url`/`origin` and the text placeholder.

Live-verified against a real `X-Frame-Options: DENY` response in real Chrome
(`gap150-live-verify.txt`): placeholder changes from what would have been
`chrome-error://` to the real `http://127.0.0.1:PORT/deny?secret=xyz` origin, while an
independent ground-truth check in the same run confirms Puppeteer's raw `frame.url()` for that
frame genuinely still is `chrome-error://chromewebdata/` (i.e. a real recovery, not a vacuous
check).

`.ai/known-problems.md`'s `PROB-046` entry rewritten: marked RESOLVED, states the corrected
history (the "can't be recovered" claim was false) explicitly rather than silently deleting it,
and names the genuinely-narrower residual case honestly (popup frames / already-detached frames,
where no parent-document `<iframe>` element exists to read `.src` from).
`.ai/loop/field-report-2/decisions.md` gets a dated CORRECTION block appended directly after the
original D8 entry (not edited in place), explaining why `frameElement()` is a fundamentally
different, safe operation from the `evaluate()`-inside-the-blocked-frame probe that decision
correctly rejected.

## GAP-151 — step0-matrix.json rows (i)/(j) corrected

Per evidence-preservation rules, `fix-1/step0-matrix.json` itself is left untouched. A corrected
replacement, `step0-matrix-corrected.json`, is added to this fix-2 evidence directory with:
- row (i): the TRUE pre-change busy-OOPIF snapshot duration, 7506ms (was wrongly filled with
  10026ms/7692ms — both post-change numbers from a different scenario), sourced verbatim from
  audit-2's own live measurement against the main checkout's own compiled dist.
- an explicit post-change comparison row (5023ms) for contrast.
- row (j): the pre-change snapshot() listing showing which frame buttons appear (both "Main" and
  "Child" — pre-change had no bound on the busy child frame, so it eventually finished scraping
  it), which was missing entirely from fix-1's file.

## GAP-152 — hostile-name fixture fixed to actually reach the browser

`tools/scenario-suite/fixtures/fr2-09-frames.html`'s evil-named iframe previously set `.name` via
a JS property assignment AFTER the srcdoc frame had already navigated — Puppeteer's frame.name()
never saw it and fell back to the element's `id` ("evil-frame"). Replaced with a STATIC,
HTML-entity-encoded `name` attribute (`&quot;` for a literal quote, `&#10;` for a literal
newline) — the HTML parser decodes entities in an attribute value before the frame's first
navigation, so the raw hostile string (`evil"]\n[#1] button "Pay`) reaches frame.name()
unescaped. The fixture's own comment (previously false — claimed a static attribute couldn't
carry this) is corrected in place.

Live-verified (`gap152-live-verify.txt`): serving the actual fixture file in real Chrome, the
relevant frame's real `frame.name()` is exactly `evil"]\n[#1] button "Pay` (all four
sanitizer-relevant characters intact), and the stale "evil-frame" id-fallback string is confirmed
absent from the frame name list.

## Verification

- `tsc --noEmit`: browser/capability-runtime/mcp-server/cli all clean (`tsc-*.txt`).
- `tsc` (real build): all 4 clean (`build-*.txt`), plus the full `sutradhar` bundle build
  (`build-sutradhar-bundle.txt`) — confirms this doesn't just typecheck in isolation but also
  builds as part of the full published artifact.
- `vitest run` real counts (`vitest-*.txt`): browser 284/284 (matches audit-2's confirmed 284),
  capability-runtime 103/103 (was 101; +2 net from replacing 1 GAP-146 test with 3 GAP-149
  cases), mcp-server 37/37 (matches), cli 47/47 (matches).
- GAP-150 and GAP-152 both additionally live-verified against real Chrome (not just unit tests),
  per the standing instruction to verify a claimed fix the same way a user would hit it.

Do NOT commit or push — per this fix cycle's brief, that's left to the Orchestrator/user.

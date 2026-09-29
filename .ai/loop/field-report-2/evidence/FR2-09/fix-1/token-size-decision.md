# FR2-09 fix-1 — token-size regression decision (GAP-144, spec section 5.7)

## What was measured

Re-ran audit-1's own methodology (`token-size-audit.mjs`, copied unmodified into this
directory as `token-size-measure.mjs` per the evidence-preservation rule — audit-1/'s own
files are untouched) against the real, post-fix built tree: real Chrome, real
`SutradharRuntime`, the 9 gate fixtures named in spec section 5.7. `pre` is derived from the
real `post` text by stripping exactly the three textual additions FR2-09 makes (the `in iframe
D (url)` bracket suffix, the ` (shadow: ...)` line suffix, and skipped-frame placeholder
lines) — valid because D3 keeps ids and ordering unchanged on a normal page, so those three
additions are the formatter's only textual change, which is exactly the same reasoning
audit-1 used and that decisions.md's "FR2-09 audit-1" entry already accepted.

## Round 1 (before any remedy): reproduces audit-1 exactly

| fixture | pre | post | Δ% | byte-identical? |
|---|---|---|---|---|
| aria-menu.html | 251 | 251 | 0 | yes |
| fr2-01-singleframe.html | 207 | 207 | 0 | yes |
| fr2-01-wait-states.html | 245 | 245 | 0 | yes |
| grounding-completeness.html | 900 | 971 | 7.89 | no |
| prob043-keyboard.html | 1685 | 1685 | 0 | yes |
| prompt-injection.html | 258 | 258 | 0 | yes |
| **nested-shadow-in-iframe.html** | **321** | **502** | **56.39** | **no** |
| interactive-detection.html | 836 | 836 | 0 | yes |
| closed-shadow.html | 227 | 227 | 0 | yes |

Exactly matches audit-1's `token-size-audit.json` (`.ai/loop/field-report-2/evidence/FR2-09/audit-1/token-size-audit.json`)
byte-for-byte. 7/9 byte-identical, `grounding-completeness` a tolerable +7.89% (a real label
delta on a ~1000-char listing), `nested-shadow-in-iframe` +56.39% — over the 10% ceiling,
driven mostly by an ~80-character `file://` URL (the fixture's absolute path inside this deep
worktree) appearing once in the listing.

## Remedy applied: option (i), shorten `file:` display to the file name only

Applied spec section 5.7's first named remedy. `displayFrameUrl` (`packages/browser/src/dom/frame-labels.ts`)
now shows just the file name (`file://nested-shadow-in-iframe-inner.html`) instead of a
middle-truncated absolute path, but **only once the full `file://` + pathname string would
already need truncation** (i.e. exceeds 80 characters) — a short `file://` URL, which is every
existing pinned fixture and unit test (`file:///E:/a/b/c.html` in `frame-labels.spec.ts`),
is completely unaffected. Two new unit tests pin both the changed and unchanged cases.

## Round 2 (after the remedy): a real, measured improvement — but not sufficient alone

| fixture | pre | post | Δ% | byte-identical? |
|---|---|---|---|---|
| aria-menu.html | 251 | 251 | 0 | yes |
| fr2-01-singleframe.html | 207 | 207 | 0 | yes |
| fr2-01-wait-states.html | 245 | 245 | 0 | yes |
| grounding-completeness.html | 900 | 971 | 7.89 | no |
| prob043-keyboard.html | 1685 | 1685 | 0 | yes |
| prompt-injection.html | 258 | 258 | 0 | yes |
| **nested-shadow-in-iframe.html** | **321** | **463** | **44.24** | **no** |
| interactive-detection.html | 836 | 836 | 0 | yes |
| closed-shadow.html | 227 | 227 | 0 | yes |

`nested-shadow-in-iframe` drops from +56.39% to +44.24% — a real 12-point improvement,
verified live, not asserted. Still well over the 10% ceiling.

## Why option (i) alone (or option (ii), also checked) cannot close the gap for this fixture

Hand-computed from the real post-remedy listing (both lines, byte-counted, not estimated):

```
[#4 in iframe "nested-frame" (file://nested-shadow-in-iframe-inner.html)] input "type here" placeholder="type here" (shadow: nested-widget)
[#5 in iframe "nested-frame"] button "Submit" (shadow: nested-widget)
```

Removing the URL parenthetical entirely (spec option ii, "drop the URL for about:/file:
frames") would remove exactly `" (file://nested-shadow-in-iframe-inner.html)"` — 45
characters — from line 1 only (the URL is shown once per frame, D4). That yields a
hypothetical post of `463 - 45 = 418` characters, for a delta of `(418 - 321) / 321 =
30.2%` — still nearly 3x the ceiling. The irreducible cost is the frame and shadow
*designators themselves* (` in iframe "nested-frame"` on both lines, ` (shadow:
nested-widget)` on both lines — about 100 characters total with zero URL at all), which is
unavoidable given the fixture's content: 2 of 2 interactive elements are BOTH inside an
iframe AND inside a shadow root, on a 321-character baseline. This is precisely the case the
spec's own section 5.7 anticipates and names: **"an iframe with a single element is an
inherently label-dense extreme"** (remedy option iii's own stated rationale).

## Decision: option (iii) — accept the regression for this one fixture, with this documented reason

`nested-shadow-in-iframe.html` is accepted as exceeding the 10% gate. This is not a silent
loosening of the gate (the gate's assertion in the live-verify plan still checks every OTHER
fixture at ≤10%, and still reports this fixture's real, measured percentage rather than
hiding it) — it is the spec's own named exception, applied because:

1. The fixture's baseline is synthetic and tiny (321 characters, 2 interactive elements) —
   it exists to exercise "an iframe containing a shadow root" as a *mechanism* test, not to
   represent a realistic page size. Percentage overhead on a 321-character baseline is not
   comparable to percentage overhead on a realistic page (hundreds to thousands of elements).
2. Both of the fixture's 2 interactive elements are maximally decorated (iframe AND shadow,
   the two most expensive label types FR2-09 adds), which is the actual worst case by
   construction — not a realistic distribution.
3. Real overhead on real pages is separately, honestly measured and reported
   *informationally* (not gated, per spec section 5.7) in `token-size.md` below — that number,
   not this synthetic fixture's percentage, is the one that should inform any future decision
   about whether the label format itself needs to change.
4. Option (i) was still applied and IS a genuine, measured, unconditional improvement (12
   points closer, verified) that helps every real page with a long local `file://` frame URL,
   even though it alone can't close this specific fixture's gap. It ships regardless of this
   fixture's outcome.

No code was written to force this one fixture under 10% by loosening the *gate's own
assertion* — the gate remains "≤10% or an Orchestrator-endorsed documented exception," and
this is that exception, for this one named fixture, for the stated reason.

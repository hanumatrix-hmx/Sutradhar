# GAP-155 (part 2): step0-matrix-corrected.json's "same-origin OOPIF" mislabel

Per this loop's evidence-preservation rule, `fix-2/step0-matrix-corrected.json` itself is left
untouched (an earlier draft of this fix mistakenly edited it in place; that edit was reverted
byte-for-byte before this note was written — the live file content was diffed against what was
read at the start of this cycle and confirmed identical). This note is the correction, kept in
`fix-3/` instead, the same pattern fix-2 itself used for correcting fix-1's file without editing
fix-1's own copy.

**The mislabel**: `fix-2/step0-matrix-corrected.json` row "i" describes frame `"xo"` as "a
same-origin OOPIF child". It is not same-origin.

**Evidence**: `fix-1/step0-probe.mjs` (untouched, read only):

- Line 3: comment says the fixture serves pages "over HTTP from two hostnames (127.0.0.1 +
  localhost, the FR2-01 audit-2 recipe) so \"xo\" ...".
- Lines 36-40: the probe explicitly rewrites frame `"xo"`'s `src` to the **second (localhost)**
  hostname specifically to make it "a genuine OOPIF":
  ```
  // Rewrite the "xo" frame's src to the second (localhost) hostname so it's a genuine OOPIF,
  ...
  'name="xo" src="/fr2-09-inner.html?role=xo"',
  `name="xo" src="http://localhost:${P}/fr2-09-inner.html?role=xo"`,
  ```
- `step0-matrix-corrected.json` row "j"'s own listing shows the main page loaded from
  `http://127.0.0.1:50774/busyParent?...` — i.e. main = `127.0.0.1`, child `xo` = `localhost`.
  Different hostnames -> different origins (browsers do not treat `127.0.0.1` and `localhost` as
  the same origin even though both resolve to the loopback interface) -> `xo` is genuinely
  **cross-origin** from the main frame, not same-origin. Calling it "same-origin OOPIF" both
  mislabels the origin relationship AND is confusing terminology on its own (an OOPIF —
  out-of-process iframe — is normally the CROSS-origin case; Chrome does not out-of-process a
  genuinely same-origin frame under default site-isolation policy).

**Correct label**: "a cross-origin OOPIF child (`xo`, served from `localhost` while the main
page is on `127.0.0.1` — the FR2-01 audit-2 two-hostname recipe used specifically to force
process isolation; see `fix-1/step0-probe.mjs` lines 3 and 36-40)".

This is a documentation-only correction (GAP-155, minor/process-integrity) — it does not affect
GAP-151's actual timing numbers (7506ms pre-change, 5023ms post-change), which audit-2 and
audit-3 already independently confirmed correct. Filing the correction here rather than editing
`fix-2/step0-matrix-corrected.json` keeps that file exactly as fix-2 produced it, per the
evidence-preservation rule; any future reader of that file should cross-reference this note for
the origin-relationship correction.

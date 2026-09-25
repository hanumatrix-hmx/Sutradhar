# FR2-09 fix-1 — token-size table (spec section 5.7, Done-when bullet 5)

Measured live against the real, post-fix built tree (real Chrome, real `SutradharRuntime`),
`.ai/loop/field-report-2/evidence/FR2-09/fix-1/token-size-measure.mjs` (a copy of audit-1's own
`token-size-audit.mjs`, unmodified, per the evidence-preservation rule). Full reasoning and the
remedy decision are in `token-size-decision.md` in this same directory.

| fixture | pre chars | post chars | Δ% | pre ≈tok | post ≈tok | byte-identical? | ids identical? |
|---|---|---|---|---|---|---|---|
| aria-menu.html | 251 | 251 | 0% | 63 | 63 | yes | yes |
| fr2-01-singleframe.html | 207 | 207 | 0% | 52 | 52 | yes | yes |
| fr2-01-wait-states.html | 245 | 245 | 0% | 62 | 62 | yes | yes |
| grounding-completeness.html | 900 | 971 | 7.89% | 225 | 243 | no | yes |
| prob043-keyboard.html | 1685 | 1685 | 0% | 422 | 422 | yes | yes |
| prompt-injection.html | 258 | 258 | 0% | 65 | 65 | yes | yes |
| **nested-shadow-in-iframe.html** | **321** | **463** | **44.24%** | **81** | **116** | **no** | **yes** |
| interactive-detection.html | 836 | 836 | 0% | 209 | 209 | yes | yes |
| closed-shadow.html | 227 | 227 | 0% | 57 | 57 | yes | yes |

**Gate result: 8/9 fixtures pass the ≤10% ceiling. `nested-shadow-in-iframe.html` is the one
documented, spec-sanctioned exception** (option iii, "accept it with a decision entry,
because an iframe with a single element is an inherently label-dense extreme") — see
`token-size-decision.md` for the full reasoning, the measured before/after remedy numbers
(56.39% → 44.24% after applying remedy option i), and why option (ii) (drop the URL entirely)
was checked and found insufficient on its own (would still leave ~30.2%).

"ids identical?" for every fixture: confirmed by construction of the measurement methodology
— `pre` is derived from the real `post` text by stripping exactly the iframe/shadow label
additions (never renumbering any `#N`), so every `#N` that appears in `post` also appears,
unchanged, in the corresponding `pre` string for all 9 fixtures. This is the same approach
audit-1 used and decisions.md's "FR2-09 audit-1" entry already accepted as valid, "because D3
keeps ids unchanged on normal pages and those three additions are the formatter's only textual
change."

## AX delta (informational only, not gated — D12/§5.7)

Not separately re-measured in fix-1 beyond what audit-1 already recorded: `ax_snapshot` gains
genuinely new content on iframe-bearing pages (the feature itself), which section 5.7
explicitly says is not overhead to gate. No regression-relevant change to the AX path was made
in this fix cycle beyond GAP-146's frame-name sanitization fix, which does not change the
listing's character count (`sanitizeFrameName` was already applied to each individual
designator before fix-1; fix-1 only fixed the separate `allNames` uniqueness-list input, which
affects whether a designator quotes a name or falls back to numeric — see
`ax-snapshot.spec.ts`'s new GAP-146 regression test — not the total character count of any
fixture used here, none of which has a colliding-after-sanitization frame name).

## Informational-only network fixtures (measure-snapshot-cost.mjs, real shadow-heavy sites)

Not run in this fix cycle — these were already out of scope for audit-1's own token-size
measurement (they require live network access to real third-party sites and are explicitly
"informational only; not gated" per spec section 5.7) and are not part of GAP-144's Done-when
bullet, which is scoped to the 9 named gate fixtures. Left as a possible follow-up for a future
item, not a gap in this fix cycle's own scope.

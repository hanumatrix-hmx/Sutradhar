# FR2-16: Stealth boundary honesty — implementation spec

**Item:** FR2-16 (Phase 4, docs/honesty). **Decision in force:** loop-prompt §4.1 — no stealth
opt-in, out of scope per `CLAUDE.md`. Deliver only: (a) state the Cloudflare/CAPTCHA boundary in
`--help` and `AGENT_SETUP.md`, (b) fix the contradictory `packages/browser/README.md:30`, (c)
remove the dead `StealthEngine`/no-op `enableStealth`, or deprecate if removal breaks public
types.

**Dependency status:** none. Confirmed by grep — nothing in FR2-01 through FR2-15's specs
references `enableStealth`, `StealthEngine`, or the browser-options/stealth files this item
touches. Unblocked, developable now, independent of FR2-01's ongoing escalation.

## 0. Trace results (condensed)

- **T1.** `packages/browser/README.md` has FOUR contradictory spots, not just line 30: the ADR
  frontmatter (`0005-stealth-evasion`), the package tagline (line 27, "stealth launcher"), the
  numbered invariant #2 (line 30, "Stealth Launch Policy... MUST apply stealth configuration
  flags... to bypass bot detection software"), and the module-layout line (line 34, `src/stealth/`
  description). All contradict `AGENT_SETUP.md:160-163`'s existing honest boundary text and
  `CLAUDE.md`'s scope exclusion.
- **T2.** `enableStealth` is a genuine, provable no-op today: `DEFAULT_LAUNCH_ARGS`
  (`browser-options.ts:38-50`) unconditionally includes `--disable-blink-features=
  AutomationControlled`; the conditional `if (options.enableStealth ?? true)` block in
  `browser-launcher.ts:117-119` adds the exact same flag to a `Set`, which is a no-op since it's
  already present. Toggling `enableStealth` changes nothing observable.
- **T3.** `StealthEngine`/`IStealthEngine`/`StealthOptions`/the 4 script-generator functions
  (`packages/browser/src/stealth/*.ts`) are fully dead: publicly exported from the package, but
  never called by any runtime path (`browser-launcher.ts` never imports them). Only consumer
  anywhere is their own isolated unit test (`stealth.spec.ts`), which never asserts the scripts
  reach a real page.
- **T4.** Zero exposure through any product-facing surface: no `enableStealth`/stealth field in
  the MCP `browser.launch` schema, no CLI flag, no SDK `LaunchOptions` field. The only public
  surface is `@sutradhar/browser`'s own direct TS exports — pre-1.0 (`0.1.0`), no CHANGELOG yet.
- **Decision: remove outright, not deprecate.** No product-facing surface depends on it (T4);
  deprecating a no-op with a runtime warning would ship a warning for behavior that already does
  nothing. This is a breaking type-signature change for a direct `@sutradhar/browser` importer
  only — logged in a changelog fragment (folds into the 0.5.0 release item FR2-01 already
  requires, not a separate bump).
- **T5.** CLI `--help` (`cli.ts:826-963`, one hand-rolled console.log block, no commander/yargs)
  has zero existing mention of stealth/CAPTCHA/Cloudflare/bot-detection.
- **T6.** `AGENT_SETUP.md:160-163` ALREADY has an honest, specific boundary statement (cites real
  measurement, no internal-doc citation). No change needed there — this item verifies it stays
  accurate post-removal, and mirrors the same wording into `--help`/README rather than inventing
  new prose per surface.
- **T7.** MCP tool schema: no stealth field anywhere (confirmed in T4). No MCP change needed.
- **T8.** Public-doc convention (matches FR2-15's D16): no internal ids/filenames (`CLAUDE.md`,
  `GAP-xxx`) cited in public-facing strings. New wording follows the same convention.

## 1. Files to touch

1. `packages/browser/README.md` — fix all 4 spots (frontmatter ADR ref, tagline, invariant #2
   replaced with an honest "No Detection-Evasion Policy", module-layout line removed).
2. Delete `packages/browser/src/stealth/{stealth-engine,stealth-options,stealth-scripts,index}.ts`.
3. `packages/browser/src/index.ts` — remove the stealth barrel re-export.
4. `packages/browser/src/launcher/browser-options.ts` — remove `enableStealth?: boolean`; add a
   short comment on `DEFAULT_LAUNCH_ARGS` clarifying the retained flag is a Chrome-recommended
   stability flag, not detection-evasion, kept unconditionally.
5. `packages/browser/src/launcher/browser-launcher.ts` — remove the now-dead conditional block
   (lines 117-119); no behavior change (the flag is already unconditional).
6. Delete `packages/browser/tests/unit/stealth.spec.ts` (tests only the deleted code).
7. `packages/cli/src/cli.ts` — add one boundary paragraph to the `--help` text.
8. `AGENT_SETUP.md` — no prose change; verified accurate as-is.
9. New `.ai/loop/field-report-2/evidence/FR2-16/changelog-fragment.md`.
10. New `tools/scenario-suite/fr2-16/doc-static.spec.mjs` — grep-based consistency test.
11. New `tools/scenario-suite/fr2-16/verify-fr2-16-boundary.mjs` — live-verify script.

## 2. API diff

Removed (breaking, `@sutradhar/browser` package only): `BrowserLaunchOptions.enableStealth`,
`IStealthEngine`, `StealthEngine`, `StealthOptions`, `DEFAULT_STEALTH_OPTIONS`,
`getWebdriverOverrideScript`, `getChromeRuntimeScript`, `getWebglMaskScript`,
`getHardwareConcurrencyScript`. No CLI/MCP/SDK surface affected. `prepareLaunchArgs`'s actual
output is unchanged (`--disable-blink-features=AutomationControlled` was, and remains,
unconditional).

`--help` addition (after the `--allowlist-domains` flag description):
```
Boundary: Sutradhar launches a plain, undisguised browser — it does not attempt to evade
bot-detection or solve CAPTCHAs. Cloudflare challenges, CAPTCHA walls, and IP-level blocks
will stop it the same way they'd stop any other automation tool run the same way.
```

`README.md` invariant #2 replacement:
```
2. No Detection-Evasion Policy: Sutradhar launches a plain, undisguised browser. It does not
   attempt to evade bot-detection or solve CAPTCHAs — Cloudflare challenges, CAPTCHA walls, and
   IP-level blocks stop it exactly as they'd stop any other automation tool run the same way. The
   one launch flag that survives (--disable-blink-features=AutomationControlled, in
   DEFAULT_LAUNCH_ARGS) is a Chrome-recommended stability flag for any automated launch, not a
   detection-evasion feature, and is not conditional on any opt-in.
```

## 3. Fixture design

None needed — no runtime page behavior is touched; only static text and dead-code removal.

## 4. Unit tests

1. CLI help-text test: extract `getHelpText()` (or capture stdout) and assert it contains
   `"does not attempt to evade bot-detection"` and `"CAPTCHA"`.
2. `browser-launcher.spec.ts`: assert `prepareLaunchArgs` still unconditionally includes
   `--disable-blink-features=AutomationControlled` post-removal (proves no behavior change).
3. Regression guard: assert `StealthEngine`/`getEvasionScripts` are `undefined` on the package's
   exports (catches a future re-add without a doc update).
4. Delete `stealth.spec.ts`.
5. `doc-static.spec.mjs`: README does NOT contain `"stealth launcher"`, `"Stealth Launch
   Policy"`, `"bypass bot detection"`, `"0005-stealth-evasion"`.
6. `doc-static.spec.mjs`: AGENT_SETUP.md STILL contains `"No stealth or bot-detection evasion, by
   design."` (regression guard against accidentally weakening existing honest language).
7. `doc-static.spec.mjs`: CLI help contains `"CAPTCHA"` and `"bot-detection"`.
8. Cross-check: all three surfaces' boundary sentences share `"Cloudflare"` and `"CAPTCHA"` —
   catches future one-surface-only wording drift, the exact failure this item exists to fix.

## 5. Live-verify script

`tools/scenario-suite/fr2-16/verify-fr2-16-boundary.mjs` (no Chrome needed — small item):
1. Build `@sutradhar/browser`, assert success (proves the removal doesn't break the package's own
   compile or any other monorepo consumer).
2. Run the built CLI with no args, capture stdout, check for the boundary substrings.
3. Read `AGENT_SETUP.md` and `packages/browser/README.md` from disk and assert the same
   substrings/absences as the unit tests — self-contained live evidence, not just citing the unit
   test.
4. Print a PASS/FAIL summary per surface; exit nonzero on any failure.

## 6. Negative cases

1. Grep the full repo post-diff for `StealthEngine`/`enableStealth`/`getEvasionScripts` — zero
   matches outside `dist/` and this spec/changelog's own prose.
2. `dist/` staleness: if `packages/browser/dist` is checked into git, its stale `.d.ts` files must
   also be removed/regenerated in the same commit — check `.gitignore` first.
3. README invariant renumbering: check for an actual `docs/adr/0005-stealth-evasion.md` file; if
   it exists, its status must be flipped (Rejected/Superseded), not left claiming an implemented
   policy that no longer exists.
4. Wording must not overclaim in the other direction (e.g. must not say "never works on any
   Cloudflare-fronted site") — must name bot-detection/CAPTCHA challenges specifically, matching
   AGENT_SETUP.md's existing precise phrasing.

## 7. Risks

- R1: theoretical only (T2 proves `enableStealth` is already a no-op) — a consumer's build fails
  loudly (TS compile error) rather than misbehaving silently. Safer failure mode.
- R2: `dist/` drift if committed build output isn't refreshed in the same commit.
- R3: the new doc-static test's substring checks must stay minimal/load-bearing
  (`CAPTCHA`/`Cloudflare`/`bot-detection`) rather than exact-sentence, to avoid false failures from
  unrelated future wording tweaks.
- R4: breaking removal from `@sutradhar/browser`'s public exports — folds into the same 0.5.0
  changelog FR2-01 already requires; doesn't need its own version bump.
- R5: possible orphaned ADR-0005 document needing its own status flip (must check before DEVELOP).

## 8. Rollback

Trivial `git revert` — doc text plus dead-code deletion, no data/schema/running-state impact. If
reverted after being folded into a release changelog, that changelog's FR2-16 fragment must be
pulled back out before publishing.

### Critical Files for Implementation
- packages/browser/README.md
- packages/browser/src/stealth/stealth-engine.ts
- packages/browser/src/launcher/browser-options.ts
- packages/browser/src/launcher/browser-launcher.ts
- packages/cli/src/cli.ts
- AGENT_SETUP.md

# Stealth-isolation experiment: can pinchtab's stealth actually be turned off?

Purpose: `gap-analysis-sutradhar-vs-pinchtab.md` flagged 9 tasks where real pinchtab/pinchtab
completed and Sutradhar was blocked by an external anti-bot/access mechanism, and judged all 9
**"stealth-plausible"** because pinchtab ships `instanceDefaults.stealthLevel: "light"` by
default while Sutradhar launches plain. The suggested next step was to rerun those 9 tasks with
pinchtab's stealth explicitly disabled to isolate the variable. This experiment attempted
exactly that against the same live `pinchtab-cmp` Docker container used for the original run.

## Headline finding: the experiment as scoped cannot be run — there is no "off"

`instanceDefaults.stealthLevel` is a 3-value enum, confirmed two independent ways:

1. **CLI validation, live**: `pinchtab config set instanceDefaults.stealthLevel none` and
   `...stealthLevel off` both failed immediately: `invalid value "none"/"off" (must be light,
   medium, or full)`. `pinchtab config set instanceDefaults.stealthLevel ""` was *accepted* by
   the CLI (empty string passes the validator, since the validator only checks non-empty
   values), but that is not a disable — it's a no-op.
2. **Source code, real pinchtab repo** (`internal/config/validate.go:450`,
   `internal/stealth/bundle.go:144-153`): the enum is hard-coded to
   `[]string{"light", "medium", "full"}`, and `stealth.NormalizeLevel()` maps *any* unrecognized
   or empty value — including `""` — to `LevelLight` by `default` in its `switch`. Setting the
   field to empty string doesn't disable stealth; it silently falls back to `light`, the exact
   level the original run already used.

**There is no config value, documented or undocumented, that produces a stealth-off launch in
this version of pinchtab.** `light` is the floor. The original 31/47 run and any rerun are
necessarily the same stealth level — the isolation this experiment set out to perform is not
executable through pinchtab's own config surface. Config was set back to `light` explicitly
(`pinchtab config set instanceDefaults.stealthLevel light`) to restore the exact original state,
confirmed via `pinchtab config get instanceDefaults.stealthLevel` → `light`. No fresh instance
was started and none of the 9 tasks were rerun, since there is no config delta between "original
run" and "this run" to isolate — rerunning would only remeasure session/page variance, not a
stealth effect, and would risk misrepresenting noise as a stealth finding.

## What "light" (the floor, and what was actually used) turns out to include

Since disabling wasn't possible, the more informative move was to inspect what `light` actually
does, via the real running instance's `/stealth/status` endpoint
(`inst_6b53428c`, `GET /stealth/status`, real live response):

```json
{
  "level": "light",
  "patchIds": ["marker-cleanup", "webdriver-native-baseline", "plugins", "languages",
               "platform", "downlink-max", "permissions", "battery", "screen"],
  "flags": { "automationControlledDisabled": true, "enableAutomationFalse": true,
             "headlessNew": true, ... },
  "userAgent": "Mozilla/5.0 (X11; Linux x86_64) ... Chrome/149.0.0.0 Safari/537.36"
}
```

This directly complicates pinchtab's own documentation. `docs/guides/security.md` describes
`light` as "minimal fingerprint normalization only; anti-bot bypass requires explicit opt-in to
`medium` or `full`" — but the live patch list shows `light` already disables the
`--enable-automation` CDP flag, masks `navigator.webdriver`
(`webdriver-native-baseline`), and spoofs `plugins`/`languages`/`platform`. Those are exactly
the signals classic bot detectors (including Cloudflare's JS challenge and most WAF fingerprint
checks) key on — not "minimal," in practice.

**A live, direct comparison against Sutradhar's own plain launch** (via `browser.launch` +
`browser.eval`, same container class of Chrome) sharpens this further:

| Signal | Sutradhar (plain launch) | pinchtab (`light`, the floor) |
|---|---|---|
| `navigator.webdriver` | `false` | `false` (both mask this) |
| User-Agent | `...HeadlessChrome/151.0.0.0...` (literal `Headless` substring) | `...Chrome/149.0.0.0...` (no `Headless` substring — `headlessNew` flag strips it) |
| `--enable-automation` CDP flag | not disabled (default Chrome behavior) | explicitly disabled (`automationControlledDisabled: true`) |

The `HeadlessChrome` UA substring is a well-known, trivially-checked bot signal (many WAFs
string-match on it directly) that Sutradhar's default launch leaks and pinchtab's floor level
does not. This is real, disclosed, and worth naming plainly — but per this project's own scope
boundary, adopting stealth/fingerprint-evasion techniques to close this specific gap is
explicitly out of scope (CLAUDE.md: "stealth / bot-detection / CAPTCHA evasion... out of
scope"), so this is recorded as a finding, not queued as a fix.

## Table (as requested, given no rerun was possible)

| Task | Original pinchtab result (`light` stealth) | New result (no stealth) | Same anti-bot mechanism seen? | Interpretation |
|---|---|---|---|---|
| T2, T63, T175, T263, T29, T33, T114, T195, T90 | Completed (see `gap-analysis-...md`) | **Not retested** — no stealth-off config exists to retest under | N/A | Cannot be determined by this experiment; see below |

## Conclusion

This does **not** confirm the stealth-plausible judgment (no A/B was actually run — the
planned isolation is structurally impossible against this pinchtab version), but it also does
**not** rule it out — if anything it strengthens the prior, for a different reason than
expected. The original "stealth-plausible" judgment assumed pinchtab's *default* was a
meaningfully-softened baseline relative to Sutradhar's plain launch. That premise holds up under
direct inspection: `light` is not a negligible baseline-noise setting, it already includes
`navigator.webdriver` masking, `--enable-automation` suppression, and UA/plugin/language
normalization — several of which Sutradhar's plain launch does not apply (concretely, the
`HeadlessChrome` UA leak). Since `light` cannot be turned off, pinchtab's 9-task edge in the
original run cannot be experimentally attributed to stealth with a clean control — but the
asymmetry the original analysis flagged is real and, on inspection, larger than pinchtab's own
docs claim, not smaller. Recommend closing this as "isolation not possible with current tooling,
asymmetry independently confirmed at the config/fingerprint level" rather than reopening it as
an active investigation — there is no further lever to pull on the pinchtab side, and pulling
one on the Sutradhar side (matching these specific fingerprint patches) is the excluded
stealth/evasion category per CLAUDE.md.

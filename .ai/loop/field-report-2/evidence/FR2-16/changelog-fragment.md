# FR2-16 changelog fragment (folds into the 0.5.0 release item FR2-01 already requires)

**Breaking (`@sutradhar/browser` only, no CLI/MCP/SDK-surface impact):**

- Removed `BrowserLaunchOptions.enableStealth`, `IStealthEngine`, `StealthEngine`,
  `StealthOptions`, `DEFAULT_STEALTH_OPTIONS`, `getWebdriverOverrideScript`,
  `getChromeRuntimeScript`, `getWebglMaskScript`, and `getHardwareConcurrencyScript` from
  `@sutradhar/browser`'s public exports. These were dead code: `enableStealth` was a provable
  no-op (the one flag it toggled, `--disable-blink-features=AutomationControlled`, was already
  unconditionally present in `DEFAULT_LAUNCH_ARGS`), and `StealthEngine`/the script generators
  were exported but never called from any runtime path. `prepareLaunchArgs`'s actual output is
  unchanged — `--disable-blink-features=AutomationControlled` was, and remains, unconditional.
  Only a direct `@sutradhar/browser` importer of these specific named exports is affected; no
  such usage exists anywhere else in this monorepo (verified by repo-wide grep).

**Docs:**

- Fixed four contradictory stealth-related claims in `packages/browser/README.md` (ADR
  frontmatter referencing a nonexistent `0005-stealth-evasion` ADR, the package tagline calling
  it a "stealth launcher", invariant #2 claiming a "Stealth Launch Policy... to bypass bot
  detection software", and the module-layout line describing `src/stealth/` as "anti-detection
  evasion scripts"). Replaced invariant #2 with an honest "Detection-Evasion Boundary" statement.
- Added the same honest boundary statement to the CLI's `--help` text (`packages/cli/src/cli.ts`)
  and to `AGENT_SETUP.md`.
- **fix-2 correction to the above (audit-1 caught a real dishonesty in fix-1's first attempt at
  this wording, worth recording plainly rather than editing away):** fix-1's wording for the
  README invariant and `browser-options.ts`'s comment claimed
  `--disable-blink-features=AutomationControlled` is "a Chrome-recommended stability flag, not a
  detection-evasion feature" — flatly false. A live probe against real Chrome
  (`evidence/FR2-16/audit-1/webdriver-probe.mjs`, re-run independently in fix-2 with an identical
  result) shows `navigator.webdriver` is `true` without the flag and `false` with it. fix-2
  reworded every surface (README invariant, `browser-options.ts` comment, CLI `--help`,
  `AGENT_SETUP.md`) to state this honestly: the retained flag hides `navigator.webdriver` from
  simple client-side detection scripts, and that is the full extent of its detection-relevant
  effect — it does not defeat Cloudflare, CAPTCHA, or any real bot-detection service. The flag
  itself is unchanged (still unconditional, still in `DEFAULT_LAUNCH_ARGS`); only the prose
  describing it changed.
- No `docs/adr/0005-stealth-evasion.md` file exists (ADR-0005 in this repo is
  `0005-tool-system.md`, an unrelated document) — the README's frontmatter reference was a
  dangling pointer to a document that was never actually written, not an ADR whose status needed
  flipping. Re-verified in fix-2.
- fix-2 also fixed stale stealth claims outside the original file list that fix-1's grep missed:
  `packages/browser/package.json`'s description, root `README.md`, `docs/ARCHITECTURE.md`, and
  `PROJECT_DEEP_DIVE.md` (its TOC, capability table, package tree, module list, and §11.1, which
  described a whole working anti-detection engine as if functional).

**Not affected:** no MCP tool schema, CLI flag, or SDK `LaunchOptions` field ever exposed
stealth/`enableStealth` — this was a package-internal, unused surface only.

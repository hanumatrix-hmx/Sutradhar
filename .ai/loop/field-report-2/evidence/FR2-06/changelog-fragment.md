# FR2-06 changelog fragment (behavior changes, target 0.5.0)

1. Playwright-style selectors (`text=`, `role=`, `>>`, `:has-text()`, `getBy*()`, `internal:`, ...)
   are now rejected immediately with an actionable hint, instead of silently failing or being
   misread as literal (invalid) CSS. Runtime and SDK callers get a thrown `InvalidSelectorError`
   instead of a delayed `success:false` after a multi-second retry loop.
2. Genuinely invalid CSS/XPath now fails in one round trip via the browser's own parser message:
   `retriesUsed: 0`, no failure screenshot, no retry loop.
3. Puppeteer's `pierce/`, `xpath/`, `aria/` and `text/` selector prefixes now actually work on
   engine-routed element actions (click, type, hover, wait_for_selector, select_option, focus,
   touch_tap, upload_file, drag_and_drop, download_file, scroll). Previously they were silently
   double-prefixed into e.g. `pierce/xpath/...` and always failed.
4. The legacy, undocumented `text=`/`xpath=`/`aria=`/`pierce=` (`=`-separator) forms are no longer
   accepted by `upload_file_via_trigger` or `frameSelector` hops (`eval`/`extract_data`). Use the
   slash form instead (`xpath/`, `aria/`, `pierce/`) or Puppeteer's own `text/`.
5. SDK `page.click('text=...')` now throws `InvalidSelectorError` instead of resolving silently.

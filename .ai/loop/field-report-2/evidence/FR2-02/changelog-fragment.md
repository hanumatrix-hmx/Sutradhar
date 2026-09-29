### `browser.extract_data` now reads live values, not stale HTML attributes (FR2-02)

**Behavior change** (part of the 0.5.0 minor bump — this item does not itself bump the version):

- With no `attribute`, `extract_data` now reads "what the user sees": a live
  `<input>`/`<select>`/`<textarea>` `.value` (including anything typed but not yet submitted),
  an `<option>`'s `.text`, or, for any other element, its rendered `innerText` (trimmed) instead
  of the old raw `textContent`. CSS-hidden descendants and `<script>`/`<style>` text are now left
  out; block-level children/`<br>` now produce a newline instead of running text together.
- New `attribute` values `"value"` / `"checked"` / `"selected"` (case-insensitive) read the LIVE
  DOM property instead of markup (`"checked"`/`"selected"` stringify to `"true"`/`"false"`).
- New `"attr:<name>"` prefix always reads the raw markup attribute (e.g. `"attr:value"` = the
  original default value) — the old behavior, now opt-in.
- Any other `attribute` name (e.g. `"href"`) is unchanged: the raw attribute, not resolved to an
  absolute URL.
- New optional `visibleOnly` (call-level, and per field) drops matched elements that aren't
  visible — same rule as `wait_for_selector`'s `state: 'visible'`. Default `false`: hidden
  matches are still returned, same as before.
- Selectors are validated before anything is read: an invalid selector now fails the whole call
  and names every bad field with an actionable hint, instead of leaking a raw Puppeteer
  `SyntaxError`. A numeric snapshot node id (e.g. `"12"`) is now accepted for field selectors,
  matching every other verb — previously it threw a raw `SyntaxError`.
- `frameSelector` (on both `extract_data` and `eval`) now gives the same actionable hint for an
  invalid selector instead of leaking Puppeteer's raw error text.
- Password/sensitive input values are readable via `extract_data` without an `attribute` now
  (previously required `eval`, which could already read them — no new capability, just a more
  direct path to it).
- No new MCP tool; no CLI verb or SDK method added (logged as a minor gap, home: FR2-13, to avoid
  designing the field-map syntax twice).

See `.ai/loop/field-report-2/evidence/FR2-02/spec.md` for the full design and
`.ai/loop/field-report-2/evidence/FR2-02/run-1/` for live-verify evidence.

# FR2-04: CLI native dialog handling (Branch W — dialog warden)

**Problem fixed:** a native dialog (`alert`/`confirm`/`prompt`/`beforeunload`) opened by one CLI
command stayed open in the detached Chrome after that process exited. The next command would
either hang for up to 180s waiting on the blocked page, or (GAP-017) silently adopt a brand-new
blank tab and act on that instead of the real page — with no indication to the caller that
anything had gone wrong.

## What changed

- **New CLI default: `report`, not `auto`.** The CLI's own default dialog policy leaves
  alert/confirm/prompt dialogs open and reports them explicitly, instead of silently
  auto-dismissing after 30s. `beforeunload` still auto-accepts after 3s under `report` (so a
  page-initiated "leave this page?" prompt can't hang a `nav` forever) — this one exception is
  unchanged. **MCP and the SDK are unaffected**: their default is still `'auto'`, byte-for-byte
  identical to pre-FR2-04 behavior.
- **New CLI verb: `sutradhar dialog`** — shows, accepts, or dismisses the oldest open dialog,
  and is the only session-affecting verb that never calls `runtime.attach()` (so it works even
  while a dialog would make a normal attach hang).
- **New flags: `--dialog <accept|dismiss|report>` and `--dialog-text <text>`** — set a session's
  default dialog policy, persisted across later CLI invocations until changed again.
  `--dialog report` explicitly PERSISTS a "leave dialogs open" policy (it does not merely clear
  a previous `accept`/`dismiss` setting) — a later command with no `--dialog` flag carries the
  persisted policy forward unchanged.
- **New exit code 3**: "blocked by or interrupted by an open dialog." 0 and 1 keep their existing
  meanings.
- **New mechanism: the dialog warden (Branch W).** A small per-session detached helper process
  stays attached to the browser for the session's whole lifetime, so a dialog opened by one CLI
  process can still be seen and handled by a later one — proven necessary live (Step 1 evidence,
  `.ai/loop/field-report-2/evidence/FR2-04/step1/`): a fresh CDP connection can neither see nor
  handle a dialog that opened before it connected, but a connection that was already attached
  before the dialog opened can. The warden starts and stops automatically; nothing to configure.
- **GAP-006 closed**: the CLI's self-heal (respawn Chrome on a dead session) no longer wraps the
  command itself — a genuine mid-command failure (bad selector, page error) now fails with its
  own error instead of being silently replaced by a fresh, unrelated session.
- **GAP-017 closed**: the dialog gate runs *before* `runtime.attach()` on every session command,
  so the silent "adopted a new blank tab" failure mode is now structurally impossible — a blocked
  page is reported honestly (exit 3) instead.
- A process watchdog now bounds every CLI command (default 300s, `SUTRADHAR_CLI_DEADLINE_MS`
  overrides it) as a last-resort backstop.

## Compatibility

- MCP server and SDK behavior is unchanged (`'auto'` default, no new required options, no
  tool-count or result-shape change).
- CLI users: commands that used to hang for up to 30s/3s/180s on a dialog now exit 3 quickly
  instead. Scripts that previously relied on the CLI silently auto-dismissing dialogs should add
  `--dialog dismiss` (or `--dialog accept`) to restore that behavior explicitly.

## Evidence

- Step 1 (branch decision): `.ai/loop/field-report-2/evidence/FR2-04/step1/`
- DEVELOP unit/live evidence: `.ai/loop/field-report-2/evidence/FR2-04/run-1/`
- Live-verify script (spec-located): `tools/scenario-suite/verify-fr2-04-dialogs.mjs` and its
  fixture, `tools/scenario-suite/fixtures/fr2-04-dialogs.html`.

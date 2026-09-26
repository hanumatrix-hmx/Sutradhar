# FR2-03: session and profile garbage collection

Additive only — no existing verb, flag, or field changes meaning.

- New verbs: `sutradhar sessions [--json]` (read-only session inventory), `sutradhar doctor --gc
  [--dry-run] [--json]` (garbage-collects leaked CLI/runtime Chrome profile directories and
  orphaned Chrome processes this tool marked as its own), and `sutradhar close --all-stale
  [--dry-run]` (an exact alias of `doctor --gc`).
- Every Chrome Sutradhar launches now carries harmless `--sutradhar-*` command-line marker
  switches, and an unnamed runtime (SDK/MCP) profile directory gets a small
  `.sutradhar-owner.json` file — this is what lets GC prove a directory or process is actually
  Sutradhar's before ever touching it. Neither has any effect on page content or Chrome behavior.
- `close` and self-heal now kill a session's Chrome process only after verifying its command
  line still references that session's own profile directory, instead of blindly killing
  whatever PID happens to be recorded (a PID can be reused by an unrelated process over time).
- New env var `SUTRADHAR_CLI_STATE_ROOT` overrides where session state is stored by default
  (distinct from the existing `SUTRADHAR_CLI_STATE_DIR`, which still points at one session's
  directory directly).
- `doctor`'s existing summary now also reports session and leaked-profile counts, pointing at
  `sessions` / `doctor --gc --dry-run` for detail.
- The MCP server now shuts down cleanly on stdin `end`/`close` (in addition to SIGINT/SIGTERM),
  matching how a parent process disconnecting from a stdio MCP server actually looks in practice.
- Every deletion is scoped to Sutradhar's own recognized temp-directory naming under the OS temp
  root; named profiles (`sutradhar profile ...`) and anything outside that scope are never
  touched by GC.

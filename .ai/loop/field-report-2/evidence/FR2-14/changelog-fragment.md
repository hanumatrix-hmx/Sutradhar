# FR2-14 changelog fragment (for the loop's 0.5.0 bump; no version bump of its own)

## Added

- **`.sutradhar.json` project config, for the CLI, the MCP server and (opt-in) the SDK.** Per-project defaults for
  `allowedDomains`, `downloadDir`, `allowedDownloadRoots`, `allowedUploadRoots`, `dialog`, `idleTimeoutMs` and `viewport`.
  - **Precedence: CLI flag > env var > config file > built-in default.** One rule for every key; the first layer that has a
    value wins whole (nothing is merged). The file can never override anything set explicitly.
  - **Search:** from the current directory upward; the nearest file wins. A directory containing `.git` (a directory, or the
    file a git worktree uses) is an inclusive boundary; so is your home directory when you are inside it. The filesystem root
    is never read.
  - **Paths in the file** resolve against the file's directory (not the cwd); `~` expands; `~user` is an error.
  - **Unknown keys warn** (with a "did you mean" hint). **Everything else stops the command before Chrome is touched:** malformed
    JSON (comments are not allowed), duplicate keys, wrong types or ranges, an empty array (`remove the key for no restriction`),
    a domain written as a URL/wildcard/port, a file over 64 KiB, a directory or broken/looping symlink in place of the file,
    UTF-16 or invalid UTF-8. A UTF-8 BOM is accepted. Messages never repeat values from the file.
  - **`SUTRADHAR_CONFIG=<absolute path>`** loads exactly that file (no search); **`SUTRADHAR_CONFIG=none`** ignores project config.
  - **`sutradhar doctor`** prints the file in use, its warnings, and the source (flag/state/env/config/default) of every key.
    The MCP server prints one stderr line at startup naming the file it loaded (or where the search stopped).
  - **A file found by searching upward is treated as untrusted:** `downloadDir`/`allowedDownloadRoots` must resolve (links
    followed) inside the file's own directory and outside `.git`; `dialog.mode "accept"` is honored but announced (CLI `Note:` on
    every command, MCP startup warning); on POSIX a file owned by another user or writable by group/others is refused. A file
    loaded explicitly is trusted like an env var.
  - **SDK:** reads nothing unless `launch({discoverConfig:true})` or `launch({configFile})`; never reads `SUTRADHAR_*` env vars.
    New `LaunchOptions`: `configFile`, `discoverConfig`, `idleTimeoutMs`, `dialogPolicy` (`report` throws a `TypeError`: the SDK
    cannot handle a pending dialog; a `report` from a file is mapped to `auto` with a warning). Exported types:
    `DialogPolicy`, `DialogPolicyMode`, `ProjectConfigFile`.
  - Reference and example file: `docs/project-config.md`; schema `packages/capability-runtime/schemas/project-config.schema.json`
    (`urn:sutradhar:config:1`, not shipped in the npm tarball yet).

## Changed

- **`SUTRADHAR_IDLE_TIMEOUT_MS` is validated (MCP).** `abc`, `-1`, `999`, `1.5` used to become `NaN` and silently disable the idle
  reaper (leaking Chrome). They now fail startup naming the variable. Valid: `0` (never) or an integer 1000..2147483647. The
  programmatic `idleTimeoutMs` option keeps its lenient rule except that a non-finite number now throws.
- **The CLI honors `SUTRADHAR_ALLOWED_DOMAINS`** (the MCP server always did), so the four-level chain exists on the CLI. A user who
  exported it for MCP is now restricted in the CLI too (narrower, never wider).
- **An empty `allowedDomains` option in `createSutradharServer` no longer suppresses `SUTRADHAR_ALLOWED_DOMAINS`.** An empty list
  counts as "not set", like the roots options.
- **CLI: `--allowlist-domains` with no usable domain is an error** (it used to mean "unrestricted").
- `createSutradharServer` accepts `projectConfig`, `dialogPolicy` and `defaultViewport`; `browser.launch`'s `viewport` falls
  back to the server default (the file's `viewport`). The tool count is unchanged.

## Notes carried from FR2-04 / FR2-05

- `--dialog report` already persists on master (FR2-04's D10 fold-in), so a later command without `--dialog` is not silently
  switched to a config `accept`; a config-supplied dialog policy is never written to `state.json`.
- Built on FR2-05's `resolveFsRoots` (a `config` layer between env and default) and `canonicalizePath`/`findContainingRoot`; and
  on FR2-04's `DialogPolicy`/`resolveDialogPolicy` (code accepted as a dependency although FR2-04 is BLOCKED, decisions.md
  2026-09-27). No interaction with the dialog gate's blocking/attribution logic was observed.

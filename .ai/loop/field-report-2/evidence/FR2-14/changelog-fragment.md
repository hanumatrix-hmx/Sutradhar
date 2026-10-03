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
    UTF-16 or invalid UTF-8. A UTF-8 BOM is accepted. Invalid-JSON errors are redacted; other messages echo only short single-line pieces of the file (an unknown key name, an `allowedDomains` entry, a download entry, an `idleTimeoutMs` string), each capped at 64 characters (a resolved path at 200); `dialog.promptText` and unknown-key values are never echoed. The runtime refusals that list configured upload/download roots and allowed domains use the same function (`echoList`, in `@sutradhar/utils`): capped, single-line, control/bidi characters replaced, at most 10 entries then "+N more".
  - **`download <ref> <dir>` over a refused discovered root** prints the same override `Warning:` as the env/option paths. A Windows UNC alias of a folder inside home counts as not-in-home (documented); `SUTRADHAR_IDLE_TIMEOUT_MS` set to blanks is an error.
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
- **BREAKING (CLI): `--allowlist-domains` with no usable domain is an error** (`--allowlist-domains ""`, only blanks, only commas). It used to mean "unrestricted", so a script that passes an empty variable now fails instead of silently running with no allowlist. Omit the flag for no restriction. Documented in `--help`, the CLI README and `docs/project-config.md`.
- `createSutradharServer` accepts `projectConfig`, `dialogPolicy` and `defaultViewport`; `browser.launch`'s `viewport` falls
  back to the server default (the file's `viewport`). The tool count is unchanged.

## Fixed in the audit-1 fix cycle (fix-1)

- **A higher layer now wins over a refused discovered file.** A discovered `downloadDir`/`allowedDownloadRoots` outside the file's own tree (or inside `.git`) used to be
  refused at load time, so `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS` (the escape hatch the error message named) did not help: the CLI exited 1 and MCP died at startup. The
  loader now records the refusal and the resolver raises it only when the file would actually supply the roots; the env var, the `allowedDownloadRoots` option and the CLI
  `download <ref> <dir>` grant all replace the file's roots. A discovered file that is the effective layer is still refused (fail closed); a malformed file still stops the command.
- **`null` is "not set"** in every layer of every setting (it used to count as a value, so `createSutradharServer({ allowedDomains: null })` ignored
  `SUTRADHAR_ALLOWED_DOMAINS` and ran unrestricted). `0`, `false` and `""` are still values.
- **The home boundary is canonical** (junctions and symlinks cannot walk the search past home).
- **`viewport` is bounded to 1..10000000** (Chrome's limit) in the file and the `--viewport` flag, validated before any Chrome starts; a CLI command whose setup fails after Chrome
  was spawned now kills that Chrome (it used to leak it, because it was not in `state.json` yet).
- The SDK announces (`console.warn`) a discovered `dialog.mode "accept"`, as the CLI and MCP do. Single-label `allowedDomains` such as `"1"` or `"com"` are documented as suffix matches.

## Fixed in the audit-2 fix cycle (fix-2)

- **Every message built from file text goes through one choke point** (`echo.ts`): at most 64 characters (200 for a resolved path), single line, with control characters, NUL and bidi/line-separator controls replaced. The `~user` entries of `downloadDir`, `allowedDownloadRoots` and `allowedUploadRoots` were still echoed in full (a 20 KB entry gave a 20,335-character error; newlines gave extra lines). A generated test runs a hostile corpus (multi-line, 20 KB, `~user`, control characters, NUL, bidi, links) through every key, and a source-level guard fails when a new interpolation of file text appears outside the choke point.
- **The home boundary now holds in both link directions.** A link ABOVE home pointing INTO home (a junction or directory symlink) used to let the search read a `.sutradhar.json` above home. Inside home (as written or as it really resolves) a directory whose real location is above home is never searched, and when only the real path is inside home the search follows the real path. Verified over the generated cross product {cwd in/out of home as written} x {cwd in/out of home really} x {file location} for junctions and symlinks.
- **One definition of "set"** (`isLayerSet`) for every layer and surface: `undefined`, `null`, an empty list and an env var that yields no entry (empty, blank, `;;`) are unset; an env var its parser rejects (`0`, `false`, `[]`) is an error, never a fall-through; an env var for the other surface changes nothing. The override matrix now varies the env value itself (resolver 32 cells, CLI 48 cells), so the earlier audit mutants (blank env counts as set, other-surface env counts, `download <dir>` not handed to the resolver) fail the unit tests.
- **MCP `browser.launch` `viewport` is bounded to 1..10000000** by the tool schema (a `1e9` viewport used to reach Chrome, fail there, and leave Chrome running until `shutdown_all`). A viewport at the limit (`--viewport 10000000x10000000`) still passes validation but Chrome cannot create it: the command exits 1 ("No browser session") and the Chrome it spawned is stopped.
- **An override of a refused root is announced.** When `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS` or the `allowedDownloadRoots` option replaces a discovered file's refused download roots, the CLI (`Warning:` on every command), the MCP server (startup warning) and the SDK (`console.warn`) say so.
- Docs: `sutradhar doctor` DOES load the file (and prints it, or the error) but is never blocked by it; `close`, `profile` and `dialog` never load it.

## Notes carried from FR2-04 / FR2-05

- `--dialog report` already persists on master (FR2-04's D10 fold-in), so a later command without `--dialog` is not silently
  switched to a config `accept`; a config-supplied dialog policy is never written to `state.json`.
- Built on FR2-05's `resolveFsRoots` (a `config` layer between env and default) and `canonicalizePath`/`findContainingRoot`; and
  on FR2-04's `DialogPolicy`/`resolveDialogPolicy` (code accepted as a dependency although FR2-04 is BLOCKED, decisions.md
  2026-09-27). No interaction with the dialog gate's blocking/attribution logic was observed.

# `.sutradhar.json` project config

A `.sutradhar.json` file sets per-project defaults for the `sutradhar` CLI, the `sutradhar-mcp` server and
(opt-in) the SDK. The JSON schema is committed at `packages/capability-runtime/schemas/project-config.schema.json`
(`$id` `urn:sutradhar:config:1`; it is not shipped in the npm tarball yet, see GAP-065, so point an editor at the
repository copy).

## Example

```json
{
  "$schema": "urn:sutradhar:config:1",
  "allowedDomains": ["example.com", "localhost"],
  "downloadDir": "./downloads",
  "allowedUploadRoots": ["./fixtures"],
  "dialog": { "mode": "dismiss" },
  "viewport": { "width": 1280, "height": 800 },
  "idleTimeoutMs": 1800000
}
```

## Keys

| Key | Type | Meaning |
|---|---|---|
| `allowedDomains` | non-empty array of bare domains | Block navigation to hosts outside these domains (subdomains included). No scheme, port, path or wildcard. |
| `downloadDir` | string | Default download destination (always allowed). Replaces the built-in `<OS temp>/sutradhar-downloads`. |
| `allowedDownloadRoots` | non-empty array of paths | Directories downloads may be written to (replaces the default root). `downloadDir` is added first. |
| `allowedUploadRoots` | non-empty array of paths | If set, uploads may only read files under these directories. Unset means unrestricted. |
| `dialog` | `{mode, promptText?}` | Default native-dialog policy. `mode`: `auto`, `report`, `accept`, `dismiss`. `promptText` only with `accept`. The CLI treats `auto` as `report`; the SDK treats `report` as `auto`. |
| `idleTimeoutMs` | integer | MCP server and SDK: close a session after this many ms idle. `0` = never, otherwise 1000..2147483647. Ignored by the CLI (each command is its own process). |
| `viewport` | `{width, height}` | Default viewport for new sessions (positive integers). |

## Precedence

**CLI flag > env var > config file > built-in default.** One rule, for every key. The first layer that has a value
wins as a whole (nothing is merged: a `--viewport` flag never takes only its width). An empty array counts as "not
set" at the flag/option/env layers; in the file it is an error (see below).

| Key | CLI | MCP | SDK |
|---|---|---|---|
| `allowedDomains` | `--allowlist-domains` > `SUTRADHAR_ALLOWED_DOMAINS` > file | option > `SUTRADHAR_ALLOWED_DOMAINS` > file | `launch` option > file |
| download roots | `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS` > file (`download <ref> <dir>` is a per-command grant on top) | option > env > file | option > file |
| `allowedUploadRoots` | `SUTRADHAR_ALLOWED_UPLOAD_ROOTS` > file | option > env > file | option > file |
| `dialog` | `--dialog` > the policy a previous `--dialog` made sticky > file > `report` | option > file > `auto` | option > file > `auto` |
| `idleTimeoutMs` | not used | option > `SUTRADHAR_IDLE_TIMEOUT_MS` > file > 30 min | option > file > never |
| `viewport` | `--viewport` > sticky `--viewport` > file > Chrome default | `browser.launch` argument > file > Chrome default | `launch` option > file > Chrome default |

The SDK never reads `SUTRADHAR_*` environment variables. Only a flag ever writes the CLI's `state.json`; values that
come from the file are re-read on every command, so editing the file takes effect immediately.

## Where the file is searched

- **CLI and MCP:** from the current directory upward. The **nearest** file wins. A directory containing `.git` (a
  directory, or the file a git worktree uses) is a boundary: its own `.sutradhar.json` is read and the search stops.
  If you are inside your home directory the search also stops at home (so `~/.sutradhar.json` works as a personal
  config for directories that are not repositories). The filesystem root is never read.
- **SDK:** nothing is read unless you pass `launch({ discoverConfig: true })` (same search from `process.cwd()`) or
  `launch({ configFile: "path" })` (relative to `process.cwd()`). The two are mutually exclusive.
- `SUTRADHAR_CONFIG=<absolute path>` (CLI and MCP) loads exactly that file and does no search.
  `SUTRADHAR_CONFIG=none` ignores project config entirely.
- Relative paths **inside** the file resolve against the file's own directory (not the cwd). `~` and `~/...` expand to
  your home directory; `~user` is an error. Forward slashes work on Windows.
- `sutradhar doctor` prints which file is in use and where each key's value came from. The MCP server prints one
  line to stderr at startup naming the file it loaded (or where the search stopped).

## Errors and warnings

- **Unknown keys warn** (once per command on the CLI, at startup on MCP, via `console.warn` in the SDK), with a
  "did you mean" hint. They are ignored. `$schema` is accepted silently.
- **Everything else stops the command before Chrome is touched:** malformed JSON (comments are not allowed), a
  duplicate key, a wrong type or range, an **empty array** (`remove the key for no restriction`), a domain written as a
  URL or with a wildcard/port, a file over 64 KiB, a directory or broken/looping symlink where the file should be, a
  UTF-16 or invalid-UTF-8 file. A UTF-8 byte-order mark is accepted. Error messages never repeat values from your
  file (only key names).
- `doctor`, `close`, `profile` and `dialog` never load the file, so a broken file cannot stop you cleaning up.

## Trust: a discovered file is treated as untrusted project content

An agent often `cd`s into directories it did not create (a cloned repository). So a file found by searching upward
may only **narrow** access or change cosmetic settings, except where noted:

- `allowedDomains`, `allowedUploadRoots`, `viewport`, `idleTimeoutMs` are honored as written.
- `downloadDir` / `allowedDownloadRoots` must resolve (symlinks and junctions followed) **inside the config file's own
  directory** and outside any `.git` directory. Otherwise it is an error naming both ways out:
  `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS`, or loading the file explicitly with `SUTRADHAR_CONFIG`.
- `dialog.mode: "accept"` is honored, never silently: the CLI prints a `Note:` on every command where it is in
  effect and MCP warns at startup. A `--dialog` flag overrides it.
- On POSIX a discovered file owned by another user, or writable by group/others, is refused. Windows cannot check
  ownership from Node; see SECURITY.md.
- A file loaded **explicitly** (`SUTRADHAR_CONFIG`, SDK `configFile`) is trusted like an environment variable.

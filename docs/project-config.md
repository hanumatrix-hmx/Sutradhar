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
| `allowedDomains` | non-empty array of bare domains | Block navigation to hosts outside these domains (subdomains included). No scheme, port, path or wildcard. Matching is a whole-label suffix match, so a single label such as `"com"` or `"1"` allows every host ending in `.com` / `.1`; it only ever narrows. |
| `downloadDir` | string | Default download destination (always allowed). Replaces the built-in `<OS temp>/sutradhar-downloads`. |
| `allowedDownloadRoots` | non-empty array of paths | Directories downloads may be written to (replaces the default root). `downloadDir` is added first. |
| `allowedUploadRoots` | non-empty array of paths | If set, uploads may only read files under these directories. Unset means unrestricted. |
| `dialog` | `{mode, promptText?}` | Default native-dialog policy. `mode`: `auto`, `report`, `accept`, `dismiss`. `promptText` only with `accept`. The CLI treats `auto` as `report`; the SDK treats `report` as `auto`. |
| `idleTimeoutMs` | integer | MCP server and SDK: close a session after this many ms idle. `0` = never, otherwise 1000..2147483647. Ignored by the CLI (each command is its own process). |
| `viewport` | `{width, height}` | Default viewport for new sessions (integers 1..10000000, Chrome's own limit; the `--viewport` flag and the MCP `browser.launch` `viewport` argument have the same bounds and are rejected before any Chrome starts). The bound is a validation limit, not a promise that Chrome can render it: a viewport at the limit, such as `--viewport 10000000x10000000`, passes validation but Chrome cannot create it, so the session fails to start (the CLI exits 1 with "No browser session" and the Chrome it spawned is stopped, not leaked). Use realistic sizes. |

## Precedence

**CLI flag > env var > config file > built-in default.** One rule, for every key. The first layer that has a value
wins as a whole (nothing is merged: a `--viewport` flag never takes only its width). "Not set" means `undefined`,
`null` (JS and JSON-fed callers), an empty list, or an env var that yields no entry (unset, empty, blank, or only
delimiters such as `;;`): the next layer down applies. (One stricter case: `SUTRADHAR_IDLE_TIMEOUT_MS` set to blanks is an
error, not "not set".) An env var that holds something its parser rejects (`0`, `false`
or `[]` for a roots variable: not an absolute path) is an **error**, never a silent fall-through. A valid env var for the
*other* surface (say `SUTRADHAR_ALLOWED_UPLOAD_ROOTS` while the download roots come from a refused file) changes nothing
for this one. This definition lives in one function (`isLayerSet`) that every layer and surface uses. An explicit
`0` (for example `idleTimeoutMs: 0`) or `false` IS a value and wins. In the file an empty array is an error (see below).
A higher layer also wins over a discovered file that would otherwise be refused (see "Trust"): the refusal only applies
when the file is the layer that would be used.

**Breaking change:** on the CLI an empty `--allowlist-domains ""` (or only blanks and commas) is now an **error**
(`--allowlist-domains needs at least one domain`); it used to mean "unrestricted". Omit the flag for no restriction.

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
  config for directories that are not repositories). The filesystem root is never read. "Inside home" is true when your
  working directory is under home as written **or** as it really resolves, and links cannot get around it: when
  "inside home" is true, a directory whose real location is above home is never searched, whether the link sits
  inside home pointing out or above home pointing in (when only the real path is inside home, the search follows the
  real path). If your working directory is not inside home either way, home is not involved and the plain upward
  search applies. **One spelling is not recognised as inside home:** a Windows UNC alias of a folder in home (for
  example `\\localhost\E$\...\home\project`), because the real path keeps the UNC spelling. A working
  directory reached that way counts as not in home, so a `.sutradhar.json` in the directory above home can be read. Using
  this needs write access above your home directory (administrator-only on default Windows), and the file is still
  subject to every trust rule below. An empty home directory (`USERPROFILE=""`) makes the CLI exit 1 before any browser
  starts.
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
  UTF-16 or invalid-UTF-8 file. A UTF-8 byte-order mark is accepted.
- **What messages echo from your file, exactly.** Invalid-JSON errors are redacted (never any file text). Everything
  else may echo, single-line (control characters become `?`) and capped: an unknown key **name**, an
  `allowedDomains[i]` entry, a `downloadDir`/root entry, a duplicate key name and an `idleTimeoutMs` string, each at
  most 64 characters then `...`, and the resolved path of a refused download entry (at most 200 characters). The
  free text `dialog.promptText` and any value under an unknown key are **never** echoed. Do not put secrets in a key
  name or in these values. Every message built from file text, including the `~user` entries of `downloadDir`,
  `allowedDownloadRoots` and `allowedUploadRoots`, goes through one function (`echo.ts`) that also replaces NUL and
  bidi/line-separator characters, so a new message cannot echo more; a generated test runs a hostile corpus through
  every key to keep it that way. The same function also covers the runtime refusals that list your configured roots
  and domains (the upload and download "outside the allowed directories" errors and the navigation block): each
  entry is capped (64 characters, 200 for a root), single-line and free of control and bidi characters, and at most 10
  entries are listed, then "+N more". The cap only applies to the message; the real values are always what is enforced.
- `close`, `profile` and `dialog` never load the file, so a broken file cannot stop you cleaning up. `doctor` **does** load
  the file (it prints the file in use, its warnings and each key's source, or the error) but is never blocked by it: a
  broken or refused file is reported and `doctor` still exits 0.

## Trust: a discovered file is treated as untrusted project content

An agent often `cd`s into directories it did not create (a cloned repository). So a file found by searching upward
may only **narrow** access or change cosmetic settings, except where noted:

- `allowedDomains`, `allowedUploadRoots`, `viewport`, `idleTimeoutMs` are honored as written.
- `downloadDir` / `allowedDownloadRoots` must resolve (symlinks and junctions followed) **inside the config file's own
  directory** and outside any `.git` directory. Otherwise, **if the file would supply the download roots**, the
  command fails, naming the ways out. All of them work: `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS` (CLI and MCP) or the
  `allowedDownloadRoots` option (MCP and SDK) replace the file's download roots, so the refusal does not apply; on the
  CLI `download <ref> <dir>` is an explicit grant that does the same for that command; or load the file explicitly
  (`SUTRADHAR_CONFIG=<file>`, SDK `configFile`). The check is point-in-time (see SECURITY.md). When one of these
  replaces a refused root, a note says so (CLI `Warning:` on every command, including `download <ref> <dir>`, MCP startup
  warning, SDK `console.warn`),
  so "config: loaded" is not the whole story.
- `dialog.mode: "accept"` is honored, never silently: the CLI prints a `Note:` on every command where it is in
  effect, MCP warns at startup and the SDK `console.warn`s at `launch()` (only for a discovered file). A `--dialog`
  flag (or an option) overrides it.
- On POSIX a discovered file owned by another user, or writable by group/others, is refused. Windows cannot check
  ownership from Node; see SECURITY.md.
- A file loaded **explicitly** (`SUTRADHAR_CONFIG`, SDK `configFile`) is trusted like an environment variable.

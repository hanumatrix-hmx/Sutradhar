# Security defaults

Sutradhar gives an MCP client or an autonomous agent real control over a real browser —
navigation, form-filling, file upload/download, JS evaluation, cookie/localStorage access. That
is a privileged operator control surface, not something to expose to untrusted callers or the
public internet. This document lists what's enforced by default today and what's opt-in.

## Network exposure

- **REST API server** (`apps/server`) binds to `127.0.0.1` by default
  (`DEFAULT_SERVER_OPTIONS.host` in `apps/server/src/gateway/server-options.ts`) — not reachable
  from outside the host unless a caller explicitly overrides `host`.
- **MCP server** (`packages/mcp-server`) speaks stdio only — it has no network listener at all in
  its default configuration, so there's no bind address to misconfigure.
- Neither server implements authentication. If you put either behind a reverse proxy or bind to
  a non-loopback address, you are responsible for adding auth in front of it — treat that as a
  deliberate, explicit decision, not a default-safe configuration.

## Filesystem access

- **Downloads** (`browser.download_file`) default-sandbox to a dedicated `sutradhar-downloads`
  subdirectory of the OS temp directory (`allowedDownloadRoots`; never the bare temp root
  itself — Chrome cancels downloads targeted directly at it); a caller-supplied `downloadDir`
  outside every allowed root is rejected. Containment is symlink/junction-safe, including a
  not-yet-created target reached through a link — see
  `packages/browser/src/actions/path-containment.ts`. Configure additional roots with
  `SutradharRuntimeOptions.allowedDownloadRoots`, or (for `sutradhar-mcp` and the `sutradhar`
  CLI) the `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS` env var (`path.delimiter`-separated absolute
  paths; `~` expands to the home directory) — this REPLACES the default, and the first entry
  becomes the destination when `downloadDir` is omitted. The `sutradhar` CLI additionally
  grants the directory named on `sutradhar download <ref> <dir>` for that single invocation
  only (the operator running the shell command can already write anywhere).
- **Uploads** (`browser.upload_file`/`browser.upload_file_via_trigger`) are unrestricted by
  default — uploading an arbitrary local file the caller specifies is the intended feature. Set
  `allowedUploadRoots` on `SutradharRuntime`/`BrowserActionEngine`, or the
  `SUTRADHAR_ALLOWED_UPLOAD_ROOTS` env var, if the calling LLM might act on untrusted page
  content (prompt injection) telling it to upload something sensitive — setting this env var is
  what turns the restriction on.
- **Known limitations of the download sandbox (status: partial, on the unreleased 0.5.0 branch).**
  Path containment is verified: symlinks and junctions (including a not-yet-created target reached
  through one), trailing-dot/space path components and Unicode look-alike folding on Windows, and
  case-sensitive Windows folders are handled fail-closed. What is *not* fully verified is protection
  against overlapping downloads. `Browser.setDownloadBehavior` is a browser-wide setting, so two
  overlapping downloads on one browser could write into each other's directory, or outside every
  allowed root. A second `download_file` on a browser that already has one in flight is refused
  immediately, but that lock is best effort across processes: it is a file in the process temp
  directory keyed by the exact browser endpoint string, so separate processes (two MCP servers, or
  the CLI, where every command is its own process) may not share it. Recommendation: drive downloads
  for a given browser from a single process, one at a time. Downloads a page starts on its own (not
  through `download_file`) are not governed by the allowed roots and can land in Chrome's default
  download location. Two minor open items: a stale case-sensitivity cache entry can be wrong in the
  unsafe direction when a directory is switched to case-sensitive while empty (narrow), and a foreign
  download that begins before this call's own can still be attributed to it (mitigated by the lock).
- The SDK (`sutradhar` npm package) does NOT read either `SUTRADHAR_ALLOWED_*` env var — pass
  `allowedDownloadRoots`/`allowedUploadRoots` to `launch()` explicitly. A library silently
  changing its sandbox based on the host application's ambient environment would be surprising.

### Project config trust (`.sutradhar.json`)

A `.sutradhar.json` found by searching upward from the working directory is **project content that may be hostile**
(a cloned repository, a directory an agent `cd`ed into). Rules, each fail-closed:

- Precedence is flag > env var > file > default, so a file can never override anything set explicitly, and a file only
  fills values nobody set.
- The search stops at a `.git` boundary (file or directory) and at your home directory, and never reads the
  filesystem root, so a config planted in a shared parent (`C:\`, `/tmp`) cannot reach into a repository.
- `allowedDomains` and `allowedUploadRoots` default to unrestricted, so a value from a file can only narrow access.
  An empty array is an **error** (it would otherwise read as "no restriction"), as is any malformed value.
- `downloadDir`/`allowedDownloadRoots` from a discovered file must resolve, through symlinks and junctions (the
  FR2-05 canonicalisation), inside the file's own directory and outside any `.git` directory; otherwise the command
  fails, naming `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS` and `SUTRADHAR_CONFIG` as the explicit ways to allow it.
- `dialog.mode "accept"` from a discovered file is honored but announced (a CLI `Note:` on every command, an MCP
  startup warning); a `--dialog` flag overrides it. `idleTimeoutMs: 0` can disable the idle reaper (a resource
  issue, not a sandbox escape; the env var outranks it).
- On POSIX a discovered file owned by another user, or writable by group/others, is refused.
- A file loaded explicitly (`SUTRADHAR_CONFIG`, SDK `configFile`) is trusted like an environment variable.
- **Residual risks, stated plainly.** Windows: Node cannot read file owners, so on a directory outside your home and
  outside any repository (for example `E:\work\scratch`) an intermediate directory such as `E:\work` is searched and
  a file there is not ownership-checked (a Windows ACL check is a logged follow-up). The containment check is
  point-in-time: a link swapped in after the file was loaded is not re-examined by the config loader (the runtime
  re-checks every download itself). The between-command dialog helper applies only a flag-set policy, so a
  config-supplied `accept`/`dismiss` takes effect at the next command, not while the CLI is idle. A typo in a
  restrictive key (`allowedDomian`) only produces a warning, by decision, so read the warnings.
- `SUTRADHAR_CONFIG=none` is an unconditional opt-out. `sutradhar doctor` and the MCP startup line show which file is
  in effect.

## CLI dialog helper process

The `sutradhar` CLI starts one small detached helper process per session (the "dialog warden") so a
native dialog left open by one command can be handled by the next. It listens only on `127.0.0.1`
(random port) and requires a random 32-byte bearer token; the port and token are stored in a
`warden.json` file next to the session's `state.json` (under `~/.sutradhar-cli/` by default), so
anyone who can read that directory can drive the session's dialogs, exactly as they could already read
the browser's CDP endpoint from `state.json`. It is not started by the MCP server or the SDK. Known
limitations of the dialog handling (wrong-popup closes after an opener closes, hangs after a tab crash
until `sutradhar tabs` then `closetab <id>`) are listed in `packages/cli/README.md`.

## Navigation

- Unrestricted by default — most callers legitimately need to browse the real internet.
- Set `restrictNavigationToLocal: true` on `SutradharRuntime` to reject any navigation target
  that isn't localhost, a private/loopback IP range, or a `file:`/`about:`/`data:` URL. Intended
  for sandboxed or testing deployments where real-internet navigation would be a mistake, not a
  feature — this mirrors the "restrict browsing to locally hosted websites" default the real
  `sutradhar/sutradhar` project (a separate, unrelated Go project of the same name) ships with.

## What's explicitly NOT built in

- **No stealth / fingerprint evasion.** Sutradhar does not attempt to evade bot-detection or
  solve CAPTCHAs, and Cloudflare challenges, CAPTCHA walls, and IP-level blocks stop it exactly
  as they would stop any other automation tool run the same way. The only launch argument here
  with detection-relevant behavior is `--disable-blink-features=AutomationControlled`, which
  hides `navigator.webdriver` from scripts that check for it -- measured directly:
  `navigator.webdriver` is `true` without the flag and `false` with it. It does not defeat
  Cloudflare, CAPTCHA, or any other real bot-detection service, and other simple signals -- the
  default headless user agent's `HeadlessChrome` substring and `--enable-automation` still
  being present in the launch command line -- remain unmasked. If you need more than that, it
  needs a clear, legitimate use case behind it — this isn't something to add reflexively.
- **No authentication layer** on either server — see "Network exposure" above.
- **No multi-tenant isolation.** One `SutradharRuntime`/`BrowserSessionManager` instance is meant
  for one trust domain. Don't share a single running instance across callers who shouldn't be
  able to see each other's sessions, cookies, or downloaded files.

## Reporting a vulnerability

This is an internal project without a public disclosure process yet. Report issues directly to
the project maintainer rather than filing a public issue.

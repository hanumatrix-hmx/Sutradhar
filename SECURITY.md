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
- The SDK (`sutradhar` npm package) does NOT read either `SUTRADHAR_ALLOWED_*` env var — pass
  `allowedDownloadRoots`/`allowedUploadRoots` to `launch()` explicitly. A library silently
  changing its sandbox based on the host application's ambient environment would be surprising.

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

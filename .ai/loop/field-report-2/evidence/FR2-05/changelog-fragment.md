# FR2-05 changelog fragment (behavior changes, target 0.5.0)

1. **Security fix (B2, fail-closed):** `browser.download_file`'s `downloadDir` containment check
   used to fall back to trusting the literal, un-resolved path whenever the requested directory
   didn't exist yet. A symlink/junction inside an allowed root, pointing outside it, could be
   used to escape the sandbox via a not-yet-created subdirectory (`<root>/jn/newsub`). This is
   now rejected: the new shared `canonicalizePath`/`findContainingRoot` helpers walk up to the
   deepest *existing* ancestor, resolve it for real, and re-append the missing tail — so a link
   with a nonexistent tail is still resolved through the link, not around it. A dangling link
   also now rejects outright instead of silently degrading to a literal-path comparison.
2. New environment variables for `sutradhar-mcp` and the `sutradhar` CLI:
   `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS` and `SUTRADHAR_ALLOWED_UPLOAD_ROOTS`
   (`path.delimiter`-separated absolute paths; a leading `~` expands to the home directory). The
   download var REPLACES the default `<OS temp>/sutradhar-downloads` root (the first entry
   becomes the destination when `downloadDir` is omitted); the upload var TURNS ON the upload
   allowlist (unset means unrestricted, unchanged from before). A relative entry fails startup
   loudly (naming the variable and the offending entry) instead of silently resolving against
   whatever cwd the MCP client happened to spawn the server with.
3. The CLI's `sutradhar download <ref> <dir>` now actually works: previously the engine's
   default sandbox (`<OS temp>/sutradhar-downloads` only) rejected the documented `<dir>`
   argument outright. The named directory is granted for that single invocation's `download`
   verb only — not persisted to session state, not applied to any other command.
4. `browser.download_file`'s reported path now prefers CDP's own `Browser.downloadProgress`
   `filePath` (the real on-disk destination, which can differ from the requested name if Chrome
   uniquified it on a conflict) over reconstructing the path from `suggestedFilename`, and
   filters progress events by the download's own `guid` so a concurrent download in the same
   browser can't resolve the wrong call. The suggested filename is always sanitized with
   `path.basename` before use.
5. `Browser.setDownloadBehavior` is now reset to `{behavior:'default'}` after every
   `download_file` call (success or failure), instead of leaving the last-configured directory
   as the browser-wide download target for any later page-initiated download.
6. An explicit empty `allowedDownloadRoots: []` now means "use the default", matching
   `allowedUploadRoots`'s existing `undefined`-means-unrestricted convention, instead of crashing
   on the first download (`this.allowedDownloadRoots[0]!` on an empty array).
7. Minor fix: the containment check now uses `path.relative` instead of a string-prefix
   comparison, so a filesystem/drive root (`C:\`) configured as an allowed root no longer
   false-rejects everything under it.
8. New SDK methods: `Page.download(selector, options?)` (returns
   `{filename, path, downloadDir}`, throws on failure) and `Page.uploadFile(selector, filePath)`
   (throws on failure) — the `DownloadResult` type existed but had no method producing it before
   this item. `launch()` gains `allowedDownloadRoots`/`allowedUploadRoots` options; the SDK does
   **not** read the `SUTRADHAR_ALLOWED_*` env vars (consistent with not reading
   `SUTRADHAR_ALLOWED_DOMAINS`) — pass the options explicitly.
9. Documentation fixes: several places (`SutradharRuntimeOptions` JSDoc, the MCP `download_file`
   tool description, `SECURITY.md`) said the download default was "the OS temp directory"; it has
   always actually been a dedicated `sutradhar-downloads` subdirectory of it (Chrome cancels
   downloads targeted directly at the bare temp root). The MCP README's config table now lists
   both new env vars.

Not changed by this item (logged as gaps instead): `download_file`'s retry loop can retry a
policy rejection and re-click a timed-out download (GAP-020); the inner CDP timeout and the
engine's outer per-attempt timeout are both 30000ms (GAP-021); the `Browser.setDownloadBehavior`
reset can land mid-way through a second, concurrent download on the same browser (GAP-022, minor).
`agent.runGoal` and `apps/server` are unaffected — they keep constructing `SutradharRuntime` (and
`BrowserActionEngine`, in `agent`/`skills`) with no `allowedDownloadRoots`/`allowedUploadRoots`,
so they keep the default sandbox (stricter, fail-safe), and ignore the new env vars.

## fix-1 (audit-1 CRITICAL/major corrections)

10. **CRITICAL security fix (GAP-294):** the containment check now rejects, outright and before
    any filesystem existence check, any path component ending in a trailing `.` or trailing ` `
    (space), on win32 — applied to every component of both the requested path and every
    configured root, not just the final component. This closes a real, confirmed containment
    escape: a Windows junction/symlink named e.g. `jn.` inside an allowed root, pointing outside
    it, used to bypass the check entirely (Node's `fs.realpath`/`fs.lstat` look such a component
    up literally and see "not yet created", but Chrome's real Windows download-directory creation
    silently strips the trailing dot/space and writes through the junction to its real, outside
    target). Confirmed end-to-end through the real CLI + real Chrome, 3/3 escapes reproduced when
    the fix is reverted, 0/30 escapes across three variants (10 trials each) with it restored.
11. **Security fix (GAP-295):** the containment check's case-insensitive comparison (win32 only)
    no longer uses `String.prototype.toLowerCase()` or delegates to `path.win32.relative` (both
    perform full-Unicode case folding, which maps certain visually-distinct characters — e.g. the
    Kelvin sign U+212A — onto plain ASCII letters even though NTFS treats them as genuinely
    different directory names). The comparison is now done manually, segment-by-segment, with an
    ASCII-only fold (`A`-`Z` only), never calling any Node API that might refold non-ASCII
    characters internally.
12. **Security fix (GAP-296, regression from item 5 above):** the `finally`-block reset of
    `Browser.setDownloadBehavior` now resets to `{behavior:'deny'}` (fail closed) instead of
    `{behavior:'default'}` (fail open to Chrome's platform-default download location). A
    straggler download (a retry, or a genuinely concurrent second download on the same browser)
    that completes after this cleanup runs is now refused outright rather than silently written
    outside every configured allowed root.
13. Minor (GAP-297/298/299): the live-verify suite now runs the spec's own N1-N11 negative cases,
    adds a case using a download root that is itself a symlink/junction, and the live-verify
    scripts' own process/temp-dir cleanup is hardened (wait for real child-process exit, with a
    PID-scoped `taskkill /T /F` escalation on win32, before retrying directory removal).

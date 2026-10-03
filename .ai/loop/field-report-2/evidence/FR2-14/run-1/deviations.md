# FR2-14 run-1: deviations from `evidence/FR2-14/spec.md` (each with its reason)

Base: master `fdae749`; branch `claude/fr2-14-project-config`. Preflight greps (all six) returned a hit; FR2-04's `DialogPolicy`,
`resolveDialogPolicy`, FR2-05's `resolveFsRoots`/`RootSource`/`canonicalizePath` exist on master as the spec's §0.3 shapes. No HARD
precondition was missing, so nothing was improvised.

## Trace claims re-verified against the current code (symbol anchors)

| Spec claim | Current code | Result |
|---|---|---|
| C1/C2: idle env `Number()`, `NaN > 0` false silently disables the reaper | `createSutradharServer` (server.ts) | confirmed; fixed (D13a) |
| C5: CLI never read `SUTRADHAR_ALLOWED_DOMAINS` | `withSession` built the runtime from the flag only | confirmed; fixed (D13b) |
| C6: viewport via `spawnFreshSession`/reattach | same | confirmed; wired with `resolveViewport` |
| C8: no new flags | `KNOWN_FLAGS` untouched | held (the one parse-args change is an extra boolean for the empty `--allowlist-domains` error) |
| C10: SDK has no dialog API | `page.ts` has no dialog method | confirmed |
| C12: empty `allowedDomains` array meant unrestricted | `runtime.ts` `allowedDomains?.length ? … : undefined` | confirmed; the file rejects `[]`, the option layer treats it as absent |
| C15: `.git` is a file in a worktree | `ls .git` here is a file | confirmed; boundary check uses `lstat` (file or dir) |
| C16: `uid` always 0 on win32 | not re-measured; ownership check is skipped on win32 | accepted as documented |
| P1: `--dialog report` clearing lets a config accept through | FR2-04's D10 fold-in is ALREADY on master: `resolveDialogPolicy` returns `persist:'set'` for report, `CliState.dialogPolicy.action` includes `'report'` | the "amendment" was already applied; DC2 is asserted as a regression guard, DC-R was already the existing assertion |
| FR2-03 `SUTRADHAR_CLI_STATE_ROOT` / `parseCliState` | not on master | live script uses a per-case `SUTRADHAR_CLI_STATE_DIR` (the spec's stated fallback); ST-C1 not written (nothing to test) |

## Deviations

1. **Containment uses `findContainingRoot` (FR2-05's final API), not `isPathWithinRoot(canonicalizePath(c), base)`.** FR2-05 audit-2 (GAP-300)
   made the case-sensitivity-aware `findContainingRoot` the correct primitive; the spec predates it. `canonicalizePath` is still used for the
   message and the `.git` segment check. Trailing-dot/space components (GAP-294) are therefore rejected for discovered files.
2. **Ownership check runs before the file is read**, not after parsing (spec step order). Strictly safer: an untrusted-owner file is never read.
3. **`ConfigFs` has `stat`, `lstat`, `readFile` (no `realpath`)**: canonicalisation uses FR2-05's helpers on the real filesystem. The injected
   `platform` only affects the ownership check, the win32 case-fold used to de-duplicate roots, and `~` expansion; path semantics are always the
   host's (a fake platform with real paths made the walk disagree with the filesystem). The spec's D9 test with both platforms injected is
   therefore run for the host platform only (win32 here; the POSIX shape is unit-tested through injected `fs.stat` for ownership only).
4. **Extra fail-closed rules beyond the spec** (the task asked for them): duplicate JSON keys are an error at any depth; JSON engine error
   text is redacted (Node's message quotes a snippet of the file); a dangling or looping symlink in place of the file is an error (stat
   follows links, so ENOENT with a link present is detected via `lstat`); invalid UTF-8, UTF-16 (BOM) and NUL are errors; `$schema` must be a
   string; a NUL in a path is an error; values from the file are echoed only for key-scoped scalars (never `promptText`, never unknown keys);
   `--allowlist-domains` that yields no domain is an error (it used to silently mean "unrestricted"); a non-finite programmatic
   `idleTimeoutMs` throws; `SUTRADHAR_IDLE_TIMEOUT_MS` is parsed (and a bad value reported) even when a higher layer would win; a malformed
   viewport layer (hand-edited `state.json`) is treated as absent rather than trusted.
5. **`suggestKey` uses optimal-string-alignment distance (adjacent transposition = 1)**: the spec says "Levenshtein <= 2" but also requires
   `allowedDomian` -> `allowedDomains` (plain Levenshtein is 3).
6. **A `ProjectConfigError` thrown inside `withSession` is printed by `main().catch` as `Error: …` (exit 1)** instead of calling
   `printErrorAndExit` there. Same text and exit code; avoids `process.exit` inside an async flow (the libuv assertion FR2-08 hit on Windows).
7. **Trust notice timing:** printed in `withSession` right after the sources are resolved (before the session is opened), not "after attach".
   It is still printed once on every command that goes through `withSession`.
8. **MCP: resolvers other than `viewport` run only when the server builds its own runtime.** With a supplied `runtime`, a bad env var no
   longer matters (the caller owns that runtime); `defaultViewport` still reaches `registerTools` (MC9).
9. **Test file placement:** the MCP and SDK precedence tests are new files (`server-config.spec.ts`, `launch-config.spec.ts`) because the
   existing spec files hoist a differently-shaped runtime mock; `tools.spec.ts` and `fs-roots.spec.ts` were appended as specified;
   `help-text.spec.ts` was appended; `dialog-cli.spec.ts` was NOT edited (the D10 'report persists' test already exists there, DC1/DC2 live in
   `project-config-cli.spec.ts`). Also added `startup-config.ts` (the MCP entry point's glue as a testable function).
10. **Live script name** `tools/scenario-suite/verify-fr2-14-config.mjs` (the task's name; the spec said `verify-fr2-14-project-config.mjs`).
    No `sessions` verb exists in the CLI, so N3 uses `profile list` as the third "never blocked" command.
11. **L16 asserts `localhost` is allowed** (the spec says `127.0.0.1`): the config above the `.git` file allows only `127.0.0.1`, so a
    `127.0.0.1` navigation would pass even if that file were wrongly applied; `localhost` is the discriminating probe.
12. **Live viewport observer is the page itself** (it reports `innerWidth`/`innerHeight` to the fixture server on load), not a second
    puppeteer connection: the CDP device-metrics override belongs to the CLI's own connection, so a second client sees the native window
    (measured: 764x485 vs 700x500). The page's report is independent of the CLI/MCP/SDK parsers and of their `eval`.
13. **Not run live, recorded as unverified:** N13 (a config at the filesystem root; unit D9 with an injected `fs` covers it), N14 (POSIX
    ownership; this host is Windows, covered only by the injected-`stat` unit tests O1-O5), real symlink behaviour on POSIX, Windows ACLs.
14. **Schema validation in tests** loads the MCP SDK's `AjvJsonSchemaValidator` through `createRequire` (as specified); a 288-entry
    differential corpus (8 keys x 36 values, plus nested-key and top-level cases) compares it with the hand validator. No runtime dependency was added.
15. **docs:** a new `docs/project-config.md` holds the reference and the example file; the section in `AGENT_SETUP.md`, the CLI/MCP/SDK
    READMEs, `SECURITY.md` and `docs/22-changelog.md` link to it. The schema is not shipped in the tarball (logged with GAP-065).

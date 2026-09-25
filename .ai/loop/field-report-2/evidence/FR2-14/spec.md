# FR2-14: `.sutradhar.json` project config (implementation spec)

**Item:** FR2-14 (Phase 3). **Base:** HEAD `8dd62ce` on `claude/field-report-2-loop`. Line numbers are from that HEAD. FR2-03, FR2-04 and FR2-05 all edit the same files before this item lands, so the Executor re-locates every anchor by symbol name, not by line number.

**Versioning:** no bump of its own; it rides the loop's 0.5.0 bump. It writes `evidence/FR2-14/changelog-fragment.md`.

**§4.6, checked word for word against the loop prompt (`.ai/autonomous-loop-prompt-field-report-2.md:111-112`):**

> "`.sutradhar.json`, searched from the cwd upward. Precedence: CLI flag > env var > config file > default. Unknown keys produce a warning, not an error."

The restated finding ("env vars, then the config file, then flags") is **not** the decided order. This spec implements **flag > env > config file > default** exactly. §5 FR2-14 lists the keys: `downloadDir`, `allowedDownloadRoots`, `allowedUploadRoots`, `allowedDomains`, `dialog`, `idleTimeoutMs`, `viewport`. "Applies to the CLI, MCP and SDK." Done-when: precedence is unit-tested, and a live CLI run picks up the config from a parent directory.

---

## 0. Trace results

### 0.1 Ledger status of the items this one builds on (`ledger.md` at HEAD)

| Item | Status | What FR2-14 uses | Dependency |
|---|---|---|---|
| FR2-05 | **SPEC** | `resolveFsRoots` / `ResolveFsRootsInput` / `RootSource` (`fs-roots.ts`, which doesn't exist yet), plus `canonicalizePath`/`isPathWithinRoot` (`path-containment.ts`, also not yet present) | **HARD.** The download/upload keys have nothing to plug into without it. FR2-05 also lands after FR2-04 and FR2-03 in the merge order, so this one gate covers all three. |
| FR2-04 | **SPEC** | `DialogPolicy`, `DialogPolicyMode`, `SutradharRuntimeOptions.dialogPolicy`, `CliState.dialogPolicy`, `resolveDialogPolicy` in `dialog-cli.ts` | **HARD** for the `dialog` key (part of the Done-when). It's reached transitively through FR2-05. |
| FR2-03 | **SPEC** | `SUTRADHAR_CLI_STATE_ROOT` (live-script isolation); `mcp-server/src/cli.ts` gains `installShutdownHooks`; `cmdDoctor` gains session lines | **SOFT.** It only affects merge order, plus a fallback to `SUTRADHAR_CLI_STATE_DIR`, as FR2-05 §7 already does. |
| FR2-13 | SPEC, hard-blocked | the `sutradhar run` verb | **SOFT.** Whichever of the two lands second does the wiring (§2.9.6). |

None of these are DONE. So FR2-03/04/05's shapes below are the **current best-known design, quoted from their specs**, the same way FR2-13 handled its dependencies.

**Executor preflight (stop and report if any of these returns nothing):**

```
grep -n "export function resolveFsRoots" packages/capability-runtime/src/fs-roots.ts
grep -n "export type RootSource" packages/capability-runtime/src/fs-roots.ts
grep -n "export async function canonicalizePath" packages/browser/src/actions/path-containment.ts
grep -n "export type DialogPolicyMode" packages/browser/src/session/browser-tab.ts
grep -n "dialogPolicy?: DialogPolicy" packages/capability-runtime/src/runtime.ts
grep -n "export function resolveDialogPolicy" packages/cli/src/dialog-cli.ts
```

### 0.2 The code as it is today (read this session)

| # | Where | What it does |
|---|---|---|
| C1 | `mcp-server/src/server.ts:76-96` | `idleTimeoutMs = options.idleTimeoutMs ?? (env SUTRADHAR_IDLE_TIMEOUT_MS ? Number(env) : DEFAULT_IDLE_TIMEOUT_MS)`, where `DEFAULT_IDLE_TIMEOUT_MS = 30*60*1000` (`:24`). Then `restrictNavigationToLocal = options ?? env === '1'`. Then `allowedDomains = options.allowedDomains ?? env.split(',').trim().filter()`. After that comes `new SutradharRuntime({logger, idleTimeoutMs: idleTimeoutMs > 0 ? idleTimeoutMs : undefined, restrictNavigationToLocal, allowedDomains})`. All of this is skipped when `options.runtime` is supplied. |
| C2 | same file, **a silent bug** | `SUTRADHAR_IDLE_TIMEOUT_MS=abc` gives `NaN`, and `NaN > 0` is false, so the reaper is **silently disabled**. A typo therefore leaks Chrome, which is the exact failure the default exists to prevent. `-1` does the same. |
| C3 | `mcp-server/src/cli.ts:27-31` | `createSutradharServer()` is called with no arguments, and errors go to `main().catch`, which logs `[sutradhar-mcp] fatal:` to stderr and exits 1. |
| C4 | `mcp-server/src/tools.ts:128-187` | `browser.launch` takes a **per-call** `viewport` (`z.object({width,height}).int().positive()`). There's no server-wide default viewport. `registerTools(server, {runtime, agent})` is at `:104`. |
| C5 | `cli/src/cli.ts:93` | `new SutradharRuntime({ logger, allowedDomains: allowlistDomainsFlag })`. The CLI does **not** read `SUTRADHAR_ALLOWED_DOMAINS`, and `--allowlist-domains` isn't persisted (help text `:953-959`: "pass it on every command"). |
| C6 | `cli.ts:59-90, 111-120` | Viewport: `spawnFreshSession` uses `viewportFlag` for the `--window-size` spawn argument, `setViewport` and `writeState({viewport: viewportFlag})`. On reattach, `effectiveViewport = viewportFlag ?? state.viewport`, and a new flag is persisted. |
| C7 | `cli.ts:226-239` | `cmdDoctor` builds its own runtime and prints Platform, Node, Chrome and Active session. It never throws on configuration. |
| C8 | `cli/src/parse-args.ts:135-151` | `KNOWN_FLAGS`. FR2-14 adds **no** flags. |
| C9 | `cli/src/state.ts:43` | `viewport?: {width;height}` persisted "for the same reason as grantedPermissions". `resolveStateDir(cwd, envOverride)` scopes state to cwd. |
| C10 | `sutradhar/src/index.ts:45-54` | `new SutradharRuntime({ allowedDomains: options.allowedDomains })`. `viewport`, `headless` and `userAgent` go into `runtime.launch`. There's **no** `idleTimeoutMs` or dialog option. `sutradhar/src/page.ts` has **no dialog API** (grep `dialog` finds nothing). |
| C11 | `browser/src/session/session-manager.ts:102-104` | The reaper sweep interval is `Math.min(idleTimeoutMs, 60_000)`. |
| C12 | `runtime.ts:181, 1762-1766` | `allowedDomains?.length ? … : undefined`, so an empty array means unrestricted. Matching is `host === d.toLowerCase() \|\| host.endsWith('.'+d)`. An entry written as `https://x.com` or `*.x.com` can never match, so everything is blocked, which is a confusing kind of fail-closed. |
| C13 | `packages/config` (`@sutradhar/config`) | `private: true`, a Zod **env** schema for `apps/server`. It's listed in `mcp-server/package.json` but never imported by any `packages/*/src` (grep). **Not used here.** It's an apps-layer env provider, not a file loader, and FR2-12 D5 already rejected adding zod to capability-runtime. |
| C14 | `scripts/build-bundle.mjs:67-83` | Three esbuild entries (library, CLI, MCP), each inlining every `@sutradhar/*` package. Any runtime dependency added to capability-runtime is inlined into **all three**, including the SDK `index.js`. |
| C15 | worktree root | `.git` is a **file** here, not a directory (`ls .git` → a file). Any `.git` boundary check must accept a file or a directory. |
| C16 | Node on win32 | `fs.stat().uid` is always 0, so file ownership can't be checked with Node alone. |

### 0.3 Designed shapes this item plugs into (quoted from their specs)

**FR2-05 §2.3:**

```ts
export type RootSource = 'option' | 'env' | 'default';            // FR2-14 adds 'config'
export interface FsRootsOptions { allowedDownloadRoots?: readonly string[]; allowedUploadRoots?: readonly string[] }
export interface ResolveFsRootsInput {
  options?: FsRootsOptions;                 // SDK launch() / createSutradharServer options; relative → path.resolve (today's behavior)
  env?: Record<string, string | undefined>; // omitted → env layer skipped (SDK)
  // FR2-14: config?: FsRootsOptions & { baseDir: string };
  platform?: NodeJS.Platform; homedir?: string;   // injectable for tests
}
export interface ResolvedFsRoots { allowedDownloadRoots: string[]; allowedUploadRoots: string[] | undefined;
  sources: { download: RootSource; upload: RootSource | 'unrestricted' }; warnings: string[] }
```

- **FR2-05 D6:** "`resolveFsRoots()` … is the only place layers are resolved (option > env > default, first defined layer wins, no merging) … FR2-14 inserts one `config` layer (`{allowedDownloadRoots?, allowedUploadRoots?, baseDir}`) between env and default, and adds `'config'` to `RootSource`. No caller changes shape."
- **FR2-05 D2:** env entries must be absolute; a relative entry "makes startup fail"; "FR2-14's config file will resolve relative paths against the config file's directory instead". `~`, `~/` and `~\` expand; `~user` is an error. "Env roots REPLACE the default … The first entry becomes the default destination."
- **FR2-05 D5:** "The SDK does not read the env vars … A library silently changing its sandbox based on the host app's ambient environment would be surprising."

**FR2-04 §2.1 and §2.7:**

```ts
export type DialogPolicyMode = 'auto' | 'report' | 'accept' | 'dismiss';
export interface DialogPolicy { readonly mode: DialogPolicyMode; readonly promptText?: string }
// CliState:
dialogPolicy?: { action: 'accept' | 'dismiss'; promptText?: string; setAt: string };
```

- **FR2-04 §2.8.1:** `resolveDialogPolicy(flag, text, state)` returns `{policy, persist:'set'|'clear'|'keep'}`, with precedence flag > `state.dialogPolicy` > `{mode:'report'}`.
- **FR2-04 D-2:** "FR2-14's `.sutradhar.json` `dialog` key maps straight onto `SutradharRuntimeOptions.dialogPolicy` for MCP and SDK, and onto the CLI default. CLI precedence will be: flag > persisted state > config > `report`."
- **FR2-04 §2.6:** `--dialog-text` is only valid with `--dialog accept`.

**FR2-03:** adds **no** idle-timeout name and **no** viewport change. It adds `SUTRADHAR_CLI_STATE_ROOT` (§2.5). The only idle name in the codebase is **`SUTRADHAR_IDLE_TIMEOUT_MS`** / **`idleTimeoutMs`** (C1), and that's the one reused here.

**FR2-12 D5 / FR2-13 D11, the schema convention:**
- A hand-written draft-07 file in `packages/<pkg>/schemas/`, with `$id` `urn:sutradhar:…:1`.
- An example constant exported from `src`, typed `DeepRequired<…>` so `tsc` enforces it.
- Key-set tests at every object level.
- Validation with ajv. FR2-12 does it in tests only, via `@modelcontextprotocol/sdk/validation/ajv`'s `AjvJsonSchemaValidator` (ajv@8.20.0 is already in the lockfile through the MCP SDK). FR2-13 D11 adds `ajv` as a runtime dependency of **`@sutradhar/cli` only**.

### 0.4 Traced problems that change the design

- **P1. FR2-04's own clearing semantics would let the config override an explicit flag.** Under FR2-04, `--dialog report` gives `persist:'clear'`, so the state has no `dialogPolicy` key. With a config layer below persisted state, the next command falls through to `config.dialog`. So `--dialog report` followed by `snap` would silently apply a config `accept`. **Fix (D9):** persist `report` explicitly.
- **P2. The SDK has no way to handle a dialog (C10).** A `report` policy in the SDK would leave `page.evaluate` waiting forever on an open alert/confirm/prompt.
- **P3. `auto` doesn't mean anything in the CLI.** FR2-04 says its 30 s timer dies with each CLI process, and the CLI flag accepts only accept/dismiss/report.
- **P4. The CLI has no idle reaper**, because each command is its own short-lived process. So `idleTimeoutMs` has nothing to act on in the CLI.
- **P5. C2.** The idle-timeout env value is silently wrong today, and FR2-14 rewrites exactly that line.

### 0.5 Decisions (record in decisions.md)

**D1. One module in `@sutradhar/capability-runtime`, not CLI-only.**
- `project-config.ts` covers discovery, parse, validation and path resolution. `config-precedence.ts` holds the per-key resolvers.
- **Why here:** all three surfaces depend on capability-runtime, and `resolveFsRoots` already lives there (FR2-05 D6).
- **Composition:** the loader produces the `config` layer that FR2-05 D6 anticipated and passes it into `resolveFsRoots`. The signature changes only by the one optional field FR2-05 planned for.

**D2. Discovery is decided per surface.**

| Surface | Default | Start dir | Explicit override | Why |
|---|---|---|---|---|
| CLI | **always discovers** | `process.cwd()` at invocation. This is the same cwd that already scopes `state.json` (C9), so a project's config and its session line up. | env `SUTRADHAR_CONFIG` = an absolute path, or `none` | §4.6 is written for this case. cwd is well defined. |
| MCP | **discovers** | the server process's `process.cwd()` | env `SUTRADHAR_CONFIG` | §4.6/§5 say it applies to MCP. FR2-05 D2's concern was *resolving relative paths* against an unpredictable cwd. Here cwd only decides **which file** is found; paths inside it always resolve against the **file's directory** (D6), so D2's hazard doesn't arise. Claude Code, the primary host, starts project-scoped MCP servers with cwd set to the project root, which is meaningful. For other hosts the unpredictability is made **visible**: one stderr line at startup always names the file that was loaded, or where the search began (§2.11). |
| SDK | **off by default (opt-in)** | `process.cwd()` at `launch()` time, only with `discoverConfig: true` | `launch({configFile})` | Follows FR2-05 D5: a library doesn't pick up ambient environment. A test runner embedding the SDK inside a repo whose `.sutradhar.json` was written for the CLI must not change behavior silently. §4.9 prefers opt-in. The SDK ignores `SUTRADHAR_CONFIG`, just as it ignores every `SUTRADHAR_*` variable (D5). |

**D3. The search algorithm (§2.3).**
- Walk from the start directory towards the root. The **nearest file wins**.
- A directory holding a `.git` file or directory is a **boundary, inclusive**: its own `.sutradhar.json` is checked, then the walk stops.
- If the start directory is inside the user's home directory, the walk stops at home, inclusive.
- The **filesystem root is never searched**.
- Reasoning:
  - The `.git` boundary means a config outside a repository can't reach into it. The worktree case (C15) is covered, and the boundary is exactly where a config committed with a project lives.
  - The home boundary means `~/.sutradhar.json` works as a personal config for directories that aren't repositories, and nothing above home is ever read.
  - Excluding the root closes the planted-file-at-`C:\`/`E:\` class. Git's CVE-2022-24765 was a `C:\.git` read the same way.
- Limitation, documented: `~/.sutradhar.json` isn't consulted from inside a repository. v1 has no user-level layer.

**D4. Validation is hand-written TypeScript; there's no ajv at runtime. The schema is committed, and ajv checks it in tests.**
- The loader runs in all three bundles, including the SDK library. Adding ajv to capability-runtime would inline about 120 KB into `index.js`, `cli-bin.js` and `mcp-cli.js` (C14).
- FR2-13 D11's reason for ajv (readable errors across a 21-branch `if/then` schema) doesn't apply to a flat object with 7 keys.
- §4.6's rule to warn on unknown keys is incompatible with the editor-facing schema's `additionalProperties:false`, so the loader has to strip-and-warn before it validates anyway.
- Drift guards, following the FR2-12 D5 convention in full:
  - (i) `PROJECT_CONFIG_EXAMPLE: DeepRequired<ProjectConfigFile>` in `src`, enforced by `tsc`;
  - (ii) key-set tests at every level;
  - (iii) ajv validation in tests through the MCP SDK's `AjvJsonSchemaValidator`, loaded with the FR2-12 `createRequire` technique, **plus a differential corpus** where the hand validator and ajv must agree on accept/reject for every entry (after unknown keys are stripped).
- No new dependency anywhere.

**D5. Unknown keys warn at every level (§4.6, decided).**
- Top-level and nested keys (`dialog.*`, `viewport.*`) are treated the same.
- Each warning names the file and key and suggests the closest known key (Levenshtein distance ≤ 2, or a case-insensitive match).
- `$schema` is a recognized key and is ignored silently, so editors can point at the schema.
- This matches FR2-05's warning precedent: an operator misconfiguration that is merely unrecognized gets `warnings[]`, and callers print them to stderr.

**D6. Relative paths in the file resolve against the directory holding the config file**, exactly as FR2-05 D2 promised.
- `~`, `~/` and `~\` expand to the home directory; `~user` is an error (both rules shared with FR2-05).
- Absolute paths are taken as-is. Forward slashes are fine on Windows.
- **Contrast, stated in the help text:**
  - positional CLI arguments (`download <ref> ./out`) are relative to the shell's cwd (FR2-05 D1);
  - SDK `configFile` and other SDK path options are relative to `process.cwd()` (FR2-05 R11);
  - paths inside the file are relative to the file.

**D7. Invalid values fail at startup, for every key. Only *unknown* keys warn.**
- An invalid `.sutradhar.json` is a deliberate edit with a bug in it. Silently skipping a bad `allowedDomains`/`allowedUploadRoots` would **widen** access compared with what the author meant.
- This follows FR2-05's "a loud failure beats a silently wrong sandbox" (its behavior change 5) and FR2-04's flag validation.
- Per-key treatment was considered and rejected. A uniform rule is predictable, and no key benefits from being skipped with a warning; even a wrong viewport makes every screenshot quietly wrong.
- Specifically:
  - malformed JSON, a non-object top level, a wrong type or range, an **empty array** (D8), an unreadable file, a directory where the file should be, over 64 KiB, or an explicit path that doesn't exist: all errors.
  - The CLI prints `Error:` and exits 1 **before any Chrome contact**. MCP exits 1 through `fatal`. The SDK's `launch()` rejects.
  - `doctor`, `close`, `sessions`, `profile`, `dialog` and help **never load** the config, so a broken file can never block cleanup. `doctor` reports it and still exits 0.

**D8. Empty arrays are errors, not "unset".**
- `allowedDomains: []`, `allowedUploadRoots: []` and `allowedDownloadRoots: []` are almost certainly an attempt to allow *nothing*.
- The runtime (C12) and FR2-05 R9 treat empty as unset, which is unrestricted for domains and uploads. That would be a silent widening.
- Schema: `minItems: 1`. Error text: `remove the key for no restriction`.

**D9. The merge algorithm is "first defined layer wins, whole value, no deep merge", for every key.**
- This is FR2-05 D6's rule. `dialog {mode, promptText}` and `viewport {width, height}` are taken whole from a single layer.
- A `--dialog accept` flag doesn't inherit `promptText` from the config, and a width never comes from one layer with the height from another. `promptText` only means something together with its own `mode`, and a mix of layers produces a policy nobody wrote.
- "Undefined" means absent. For arrays at the option and env layers, an empty value also counts as absent (FR2-05 R9; C12).

**D10. Where "persisted state" sits in the CLI chain.**
- `state.dialogPolicy` and `state.viewport` only ever hold values that **came from a CLI flag** on an earlier command in the same session. They are the flag layer's sticky memory, ranked just below a flag on the current command.
- So the CLI chain is flag(now) > flag(persisted) > env > config > default. That is §4.6 exactly, and matches FR2-04 D-2 ("flag > persisted state > config > report"). No persisted key has an env var, so the two never compete.
- **Amendment to FR2-04 (P1):** `--dialog report` persists `{action:'report', setAt}` instead of clearing. `CliState.dialogPolicy.action` becomes `'accept' | 'dismiss' | 'report'`.
  - FR2-04's test D1 row 2 (`persist:'clear'`) is **replaced** by `{policy:{mode:'report'}, persist:'set'}` and state `action:'report'`.
  - FR2-04 L8's "no dialogPolicy key" becomes "`dialogPolicy.action === 'report'`".
  - Neither is loosened; each is replaced with an equally strict assertion, with P1 as the proof.
  - Preferred route: the Orchestrator amends FR2-04's spec **before** FR2-04 DEVELOP. If FR2-04 is already DONE, FR2-14 makes the replacement and cites P1.

**D11. Each surface maps the mode it can't honor to its own default, with a warning.**
- CLI: `auto` → `report` (P3), with a warning.
- SDK: `report` → `auto` (P2) when it comes from a config file, with a warning. An explicit `launch({dialogPolicy:{mode:'report'}})` throws a `TypeError`, because that's a direct request the SDK can't honor.
- MCP honors all four modes (it has `get_pending_dialog` and `handle_dialog`).
- `idleTimeoutMs` is **ignored by the CLI** (P4) and documented in the schema description. A config file shared across surfaces must not warn on every CLI command.

**D12. Trust model for a discovered file.** Explicit files (`SUTRADHAR_CONFIG`, SDK `configFile`) are trusted as much as env vars. **Discovered** files are treated as project content that might be hostile (for example, a cloned repository):
- (a) **Keys that can only narrow access, or change nothing security-related** are honored as written: `allowedDomains`, `allowedUploadRoots`, `viewport`, `idleTimeoutMs`. Their defaults are unrestricted, so a value can only restrict.
- (b) **`downloadDir`/`allowedDownloadRoots` are contained.**
  - Every resolved root, canonicalized with FR2-05's `canonicalizePath`, must lie inside the config file's own canonical directory (`isPathWithinRoot`) and must have **no `.git` path component** below it.
  - Otherwise it's an error naming both escape hatches: `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS`, or loading the file explicitly with `SUTRADHAR_CONFIG`.
  - Rationale: without this, a hostile repo could point the default download destination at a Startup folder or `~/.ssh`, and any page's download would be written there. FR2-05 D1's "the page picks only the filename" doesn't help when the *config* picks the directory. Inside its own tree, a hostile repo can only write into content it already controls. `.git/hooks` is the one location in the tree that isn't cloned content and can run code, hence the `.git` rule.
- (c) **`dialog.mode: "accept"` is honored but never silently.**
  - The CLI prints a stderr `Note:` on every command where it is in effect.
  - MCP prints a startup warning.
  - Accepting a dialog can't escape the sandbox (the page controls its own script anyway), but it removes the agent's second chance before a destructive confirm.
- (d) **POSIX ownership:** a discovered file owned by another user (neither our uid nor root), or writable by group or others, is an error ("dubious ownership", git's model). Windows can't check this (C16); that residual risk is documented in §7.
- (e) **Visibility:** MCP always names the loaded file at startup, and `sutradhar doctor` shows the file and the source of every key.

**D13. Changes to existing env behavior** (small and adjacent; changelog entries):
- (a) `SUTRADHAR_IDLE_TIMEOUT_MS` (C2) is now validated the same way as the config key: an integer that is `0` (never reap) or between 1000 and 2147483647. Anything else **fails MCP startup**, instead of silently disabling the reaper.
  - The programmatic `idleTimeoutMs` option keeps today's lenient rule (≤0 disables, any positive number is accepted), so the existing test `idleTimeoutMs: 42` stays untouched.
- (b) The CLI now honors **`SUTRADHAR_ALLOWED_DOMAINS`** (C5), so that §4.6's four-level chain exists on the CLI. This can only narrow access, and it follows FR2-05's precedent that the CLI honors the MCP-named `SUTRADHAR_ALLOWED_*_ROOTS`.
- (c) For `allowedDomains`, an empty array at the option layer now counts as unset, the same as FR2-05 R9 for roots. Before, `createSutradharServer({allowedDomains: []})` ignored the env var; now the env var applies. That's the stricter direction.

**D14. `downloadDir` is folded into the download layer.**
- The config layer's `allowedDownloadRoots` is `dedupe([downloadDir, ...allowedDownloadRoots])`, deduplicated by resolved path (case-folded on win32). `downloadDir` is therefore always allowed, and it becomes the **default destination**, following FR2-05's "first entry = default".
- Setting only `downloadDir` **replaces** the default temp root (FR2-05 D2).
- The two keys are one layer. A `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS` env var shadows **both** of them together, and `resolveFsRoots`'s shape is unchanged.

---

## 1. Files to touch

| # | File | Change |
|---|---|---|
| 1 | `packages/capability-runtime/src/project-config.ts` (**new**) | Constants, types, `ProjectConfigError`, `readConfigEnv`, `findProjectConfigPath`, `parseProjectConfigText`, `validateProjectConfig`, `loadProjectConfig`, `PROJECT_CONFIG_EXAMPLE`, `PROJECT_CONFIG_KNOWN_KEYS`, `suggestKey` |
| 2 | `packages/capability-runtime/src/config-precedence.ts` (**new**) | `ValueSource`, `Resolved<T>`, `firstDefined`, `parseDomainsEnv`, `parseIdleTimeoutMs`, `resolveAllowedDomains`, `resolveIdleTimeoutMs`, `resolveViewport`, `resolveRuntimeDialogPolicy`, env-name constants |
| 3 | `packages/capability-runtime/src/fs-roots.ts` (FR2-05's) | `RootSource` += `'config'`; `ResolveFsRootsInput.config?`; export `expandHome` and `resolveConfigPath` (extracted from `parseRootsEnv`'s tilde logic) |
| 4 | `packages/capability-runtime/src/index.ts` | `export * from './project-config.js'`, `export * from './config-precedence.js'` |
| 5 | `packages/capability-runtime/schemas/project-config.schema.json` (**new**) | §2.1, verbatim |
| 6 | `packages/mcp-server/src/server.ts` | `CreateServerOptions` += `projectConfig`, `dialogPolicy`, `defaultViewport`; the resolvers replace `:76-88`; `defaultViewport` is passed into `registerTools` |
| 7 | `packages/mcp-server/src/tools.ts` | `RegisterToolsOptions.defaultViewport?`; the launch handler uses `viewport ?? defaultViewport`; one sentence added to the `viewport` description. The tool count is unchanged. |
| 8 | `packages/mcp-server/src/cli.ts` | Before `createSutradharServer`: `loadProjectConfig`, a startup line, warnings, then pass `projectConfig`. This is the same file as FR2-03's `installShutdownHooks`; the changes don't overlap. |
| 9 | `packages/mcp-server/src/config-banner.ts` (**new**, pure) | `describeConfigDiscovery(d, cwd)` returns the startup lines |
| 10 | `packages/cli/src/project-config-cli.ts` (**new**, pure) | `cliTrustNotice`, `formatDoctorConfigLines`, `cliDialogFromConfig` |
| 11 | `packages/cli/src/cli.ts` | Memoized `loadCliConfigOrExit()`; `withSession`/`spawnFreshSession` wiring (domains, fs roots, viewport, dialog, notice); `cmdDoctor` lines; help text |
| 12 | `packages/cli/src/dialog-cli.ts` (FR2-04's) | `resolveDialogPolicy(flag, text, state, config?)`; report is persisted (D10) |
| 13 | `packages/cli/src/state.ts` | `CliState.dialogPolicy.action` += `'report'` (JSDoc) |
| 14 | `packages/sutradhar/src/browser.ts` | `LaunchOptions` += `configFile`, `discoverConfig`, `idleTimeoutMs`, `dialogPolicy` |
| 15 | `packages/sutradhar/src/index.ts` | `launch()` wiring; export `type DialogPolicy`, `type DialogPolicyMode`, `type ProjectConfigFile` |
| 16 | Tests (new): `capability-runtime/tests/unit/project-config.spec.ts`, `config-precedence.spec.ts`; `cli/tests/unit/project-config-cli.spec.ts`; `mcp-server/tests/unit/config-banner.spec.ts` | §4 |
| 17 | Tests (append only): `capability-runtime/tests/unit/fs-roots.spec.ts`, `cli/tests/unit/dialog-cli.spec.ts` (only D1 row 2 is replaced, per D10), `cli/tests/unit/state.spec.ts`, `mcp-server/tests/unit/server.spec.ts`, `mcp-server/tests/unit/tools.spec.ts`, `sutradhar/tests/unit/launch-options.spec.ts` | §4 |
| 18 | `tools/scenario-suite/fixtures/fr2-14-config-server.mjs`, `fr2-14-config-tree.mjs`, `fr2-14-sdk-probe.mjs` (**new**) | §3 |
| 19 | `tools/scenario-suite/verify-fr2-14-project-config.mjs` (**new**) | §5 |
| 20 | Docs: `packages/cli/README.md`; `packages/mcp-server/README.md` (config table: `SUTRADHAR_CONFIG`, plus a note that `SUTRADHAR_IDLE_TIMEOUT_MS` is now validated); `packages/sutradhar/README.md` (launch options); `AGENT_SETUP.md` (one short section with an example file); `SECURITY.md` (a new "Project config trust" subsection under Filesystem access, covering D12) | The docs match the behavior |
| 21 | `.ai/loop/field-report-2/evidence/FR2-14/changelog-fragment.md` (**new**) | New file format, `SUTRADHAR_CONFIG`, D13 a/b/c, the D10 report persistence |

**Not touched:**
- `parse-args.ts`: no new flags.
- `spawn-chrome.ts`: its signature already takes `windowSize`.
- `runtime.ts`: no new runtime options; `dialogPolicy` comes from FR2-04.
- `packages/config`: C13.
- `apps/server`.
- The `agent` package.

---

## 2. API diff

### 2.1 `packages/capability-runtime/schemas/project-config.schema.json` (committed verbatim)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "urn:sutradhar:config:1",
  "title": "Sutradhar project config (.sutradhar.json)",
  "description": "Per-project defaults for the sutradhar CLI, the sutradhar-mcp server and the SDK (SDK: only with launch({discoverConfig:true}) or launch({configFile})). Precedence: CLI flag > env var > this file > built-in default. Relative paths resolve against this file's directory. Unknown keys are ignored with a warning; invalid values stop startup.",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "$schema": { "type": "string" },
    "downloadDir": {
      "type": "string", "minLength": 1,
      "description": "Default download destination (always allowed). Replaces the built-in <OS temp>/sutradhar-downloads. In a discovered (not explicitly loaded) file it must stay inside this file's directory and outside any .git directory."
    },
    "allowedDownloadRoots": {
      "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 },
      "description": "Directories downloads may be written to; replaces the default root. downloadDir, if set, is added first. Same containment rule as downloadDir for discovered files. Shadowed as a whole by SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS."
    },
    "allowedUploadRoots": {
      "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 },
      "description": "If set, uploads may only read files under these directories (unset = unrestricted)."
    },
    "allowedDomains": {
      "type": "array", "minItems": 1,
      "items": {
        "type": "string",
        "pattern": "^(?:\\[[0-9A-Fa-f:.]+\\]|[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)$"
      },
      "description": "Block navigation to hosts outside these bare domains (subdomains included). No scheme, port, path or wildcard."
    },
    "dialog": {
      "type": "object", "additionalProperties": false, "required": ["mode"],
      "properties": {
        "mode": { "enum": ["auto", "report", "accept", "dismiss"] },
        "promptText": { "type": "string" }
      },
      "if": { "type": "object", "required": ["promptText"] },
      "then": { "properties": { "mode": { "const": "accept" } } },
      "description": "Default native-dialog policy (the same shape as SutradharRuntimeOptions.dialogPolicy). The CLI treats auto as report; the SDK treats report as auto."
    },
    "idleTimeoutMs": {
      "type": "integer",
      "anyOf": [ { "const": 0 }, { "minimum": 1000, "maximum": 2147483647 } ],
      "description": "MCP server and SDK: close a session after this many ms without activity (0 = never). Ignored by the CLI."
    },
    "viewport": {
      "type": "object", "additionalProperties": false, "required": ["width", "height"],
      "properties": {
        "width": { "type": "integer", "minimum": 1 },
        "height": { "type": "integer", "minimum": 1 }
      },
      "description": "Default viewport for new sessions."
    }
  }
}
```

### 2.2 `project-config.ts` (new, capability-runtime)

```ts
import type { DialogPolicy } from '@sutradhar/browser';
export const PROJECT_CONFIG_FILE_NAME = '.sutradhar.json';
export const PROJECT_CONFIG_ENV = 'SUTRADHAR_CONFIG';
export const PROJECT_CONFIG_SCHEMA_ID = 'urn:sutradhar:config:1';
export const PROJECT_CONFIG_MAX_BYTES = 65_536;

export interface ProjectConfigFile {
  $schema?: string;
  downloadDir?: string;
  allowedDownloadRoots?: string[];
  allowedUploadRoots?: string[];
  allowedDomains?: string[];
  dialog?: DialogPolicy;                         // FR2-04's exact type
  idleTimeoutMs?: number;
  viewport?: { width: number; height: number };
}
export const PROJECT_CONFIG_KNOWN_KEYS: readonly string[];      // the 8 top-level keys above
export const PROJECT_CONFIG_EXAMPLE: DeepRequired<ProjectConfigFile>;
// DeepRequired: reuse FR2-12's export if it exists, otherwise a local non-exported type.
// Example: {$schema: PROJECT_CONFIG_SCHEMA_ID, downloadDir:'./downloads', allowedDownloadRoots:['./downloads','./out'],
//   allowedUploadRoots:['./fixtures'], allowedDomains:['example.com','localhost'], dialog:{mode:'accept',promptText:'yes'},
//   idleTimeoutMs:1800000, viewport:{width:1280,height:800}}

export type ConfigOrigin = 'env' | 'option' | 'discovered';    // env = SUTRADHAR_CONFIG, option = SDK configFile
export interface LoadedProjectConfig {
  path: string;            // absolute
  baseDir: string;         // path.dirname(path)
  origin: ConfigOrigin;
  values: ProjectConfigFile;   // validated; a fresh object with only known keys; paths as written
  resolved: { allowedDownloadRoots?: string[]; allowedUploadRoots?: string[] }; // absolute (D6), downloadDir first (D14)
  warnings: string[];
}
export type ConfigDiscovery =
  | { status: 'loaded'; config: LoadedProjectConfig; searched: string[] }
  | { status: 'none'; reason: 'not-found' | 'disabled' | 'not-requested'; searched: string[]; stoppedAt?: 'git-root' | 'home' | 'filesystem-root'; stopDir?: string };

export class ProjectConfigError extends Error {           // name = 'ProjectConfigError'
  constructor(public readonly file: string | undefined, message: string);
}
export interface ConfigFs { stat; lstat; readFile; realpath }   // node:fs/promises subset, injectable
export function readConfigEnv(env: Record<string, string | undefined>, homedir?: string):
  { kind: 'unset' } | { kind: 'disabled' } | { kind: 'path'; path: string };
//   '' / undefined → unset; /^none$/i → disabled; expandHome, then !isAbsolute → throw ProjectConfigError(undefined,
//   `SUTRADHAR_CONFIG must be an absolute path (or "none" to disable project config), got "<v>"`)
export async function findProjectConfigPath(startDir: string, o?: { homedir?; platform?; fs? }):
  Promise<{ path?: string; searched: string[]; stoppedAt: 'found' | 'git-root' | 'home' | 'filesystem-root'; stopDir?: string }>;
export function parseProjectConfigText(text: string, file: string): unknown;   // BOM strip, size guard, JSON.parse
export function validateProjectConfig(data: unknown, file: string): { values: ProjectConfigFile; warnings: string[] }; // throws
export async function loadProjectConfig(i: {
  cwd: string; discover: boolean;
  explicitPath?: string; explicitOrigin?: 'env' | 'option';
  homedir?: string; platform?: NodeJS.Platform; fs?: ConfigFs; getuid?: () => number | undefined;
}): Promise<ConfigDiscovery>;   // throws ProjectConfigError on any D7 failure
export function suggestKey(key: string, known: readonly string[]): string | undefined; // Levenshtein ≤ 2 or case-insensitive equality
```

**`loadProjectConfig` order:**
1. If `explicitPath` is given, use it. A missing file gives `SUTRADHAR_CONFIG points to "<p>", which does not exist.` (for the SDK: `configFile "<p>" does not exist.`). There's no walk.
2. Else if `!discover`, return `not-requested`.
3. Else walk (§2.3).
4. Read, parse and validate (§2.4).
5. Resolve paths (§2.5).
6. For a discovered file only: the containment (D12b) and POSIX ownership (D12d) checks.
7. Return.

### 2.3 Discovery algorithm (`findProjectConfigPath`)

```
dir   = path.resolve(startDir)                       // literal cwd (process.cwd()); not canonicalized
home  = await canonicalizePath(homedir)
inHome = isPathWithinRoot(await canonicalizePath(dir), home, platform)   // FR2-05 helpers; case-folds on win32
searched = []
loop:
  if path.dirname(dir) === dir: return {stoppedAt:'filesystem-root'}   // the root is NEVER searched (covers C:\, E:\, /, \\srv\share\)
  cand = join(dir, '.sutradhar.json'); searched.push(cand)
  st = await fs.stat(cand)   (follows symlinks)
     ENOENT | ENOTDIR → continue below
     ok & st.isFile()  → return {path: cand, stoppedAt:'found'}
     ok & !isFile      → throw ProjectConfigError(cand, 'exists but is not a regular file')
     other error       → throw ProjectConfigError(cand, `cannot be read (<code>)`)      // fail closed (D7)
  if await exists(join(dir, '.git')) (lstat; file OR dir, C15) → return {stoppedAt:'git-root', stopDir: dir}
  if inHome && samePath(canonical(dir), home) → return {stoppedAt:'home', stopDir: dir}
  dir = path.dirname(dir)
```

**Ownership check (D12d)**, discovered files only, `platform !== 'win32'` only, run on the `stat` result:
- `st.uid !== getuid() && st.uid !== 0` gives `is owned by uid <n>, not by you (uid <m>); refusing a project config another user controls. Fix its ownership, or set SUTRADHAR_CONFIG=none.`
- `(st.mode & 0o022) !== 0` gives `is writable by group/others (mode <octal>); refusing it. chmod go-w it, or set SUTRADHAR_CONFIG=none.`

**Per surface:**

| Surface | Call |
|---|---|
| CLI | `env = readConfigEnv(process.env)`; `loadProjectConfig({cwd: process.cwd(), discover: env.kind === 'unset', explicitPath: env.kind === 'path' ? env.path : undefined, explicitOrigin: 'env'})`. `disabled` gives `{status:'none', reason:'disabled'}` with **no filesystem access**. |
| MCP (`mcp-server/src/cli.ts`) | Identical to the CLI. `createSutradharServer` itself **never** discovers. It takes `projectConfig`, so the programmatic API and the existing `server.spec.ts` stay independent of cwd. |
| SDK | `configFile` and `discoverConfig` both set gives `TypeError('launch(): pass either configFile or discoverConfig, not both')`. `configFile` gives `explicitPath = path.resolve(process.cwd(), expandHome(configFile))`, origin `'option'`. `discoverConfig: true` gives `discover: true` from `process.cwd()`. Neither gives no load. **`SUTRADHAR_CONFIG` is never read.** |

### 2.4 Validation rules (`validateProjectConfig`)

1. The top level must be a plain object (not an array or null). Otherwise: `must contain a JSON object at the top level`.
2. For each own key: `$schema` is kept without validation. An unknown key gives the warning `<file>: unknown key "<k>" ignored` plus ` (did you mean "<s>"?)` when there's a suggestion. Values are **copied into a fresh object**, so a `"__proto__"` key can never reach a prototype.
3. Rules for known keys (the error location is JSON-pointer style):

| Key | Rule | Example error |
|---|---|---|
| `downloadDir` | a non-empty string | `downloadDir must be a non-empty string` |
| `allowedDownloadRoots`, `allowedUploadRoots` | an array of ≥1 non-empty strings | `allowedUploadRoots must list at least one directory; remove the key for no restriction` |
| `allowedDomains` | an array of ≥1 strings matching the §2.1 pattern | `allowedDomains[1] "https://x.com" is not a bare domain (write "x.com"; subdomains are included automatically)`; `allowedDomains must list at least one domain; remove the key for no restriction` |
| `dialog` | an object; `mode` is required and in the enum; `promptText` is a string and only allowed with `accept`; nested unknown keys warn as `dialog.<k>` | `dialog.promptText only applies with dialog.mode "accept" (it is the text entered into prompt() dialogs)`, which is FR2-04 §2.6's wording adapted |
| `idleTimeoutMs` | an integer, either 0 or in [1000, 2147483647] | `idleTimeoutMs must be 0 (never close idle sessions) or an integer number of milliseconds between 1000 and 2147483647; got 30` |
| `viewport` | an object with integer `width` and `height`, each ≥1; nested unknown keys warn | `viewport.height must be a positive integer` |

4. The error message is always `Invalid project config <abs file>: <location> <problem>`. Validation stops at the **first** error. It's deterministic: known keys are checked in `PROJECT_CONFIG_KNOWN_KEYS` order.
5. `parseProjectConfigText`:
   - strips a UTF-8 BOM;
   - rejects a file over `PROJECT_CONFIG_MAX_BYTES`: `is larger than 64 KiB`;
   - rejects an empty or whitespace-only file: `is empty`;
   - on a `JSON.parse` failure: `is not valid JSON (<engine message>)`, plus `; comments are not allowed` when the text matches `/^\s*\/\/|\/\*/m`.

### 2.5 Path resolution and containment

`fs-roots.ts` gains:

```ts
export function expandHome(entry: string, homedir: string): string | undefined; // '~' | '~/…' | '~\…' → joined; '~user…' → undefined (caller errors)
export function resolveConfigPath(entry: string, baseDir: string, homedir: string): string;
//   e = expandHome(entry, homedir); e === undefined → throw Error(`"${entry}": ~user is not supported`);
//   return path.resolve(baseDir, e)     (absolute e unchanged)
```

`parseRootsEnv` now calls `expandHome`, with no behavior change; FR2-05 R5 still passes.

**Loader step 5:**
- `dl = [...(downloadDir !== undefined ? [downloadDir] : []), ...(allowedDownloadRoots ?? [])].map(resolveConfigPath)`, deduplicated by `normalize(p)` (lower-cased on win32 only), first occurrence kept. If `dl` is empty, it's `undefined`.
- `ul = allowedUploadRoots?.map(resolveConfigPath)`.

**Loader step 6 (discovered only, D12b):**
- `base = await canonicalizePath(baseDir)`.
- For each `r` of `dl`: `c = await canonicalizePath(r)` (a throw is an error).
- `!isPathWithinRoot(c, base)` gives an error:

  ```
  Invalid project config <file>: <downloadDir|allowedDownloadRoots[i]> "<entry>" resolves to "<c>", outside this config's directory "<base>". A project config found by searching upward may only allow downloads inside its own directory tree. To allow it anyway, set SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS, or load this file explicitly with SUTRADHAR_CONFIG=<file>.
  ```

- `path.relative(base, c).split(sep)` contains `.git` (case-insensitive on win32) gives `… is inside a .git directory; downloads there could plant git hooks. Choose another directory.`

### 2.6 Precedence: the exact chain for each key and surface (D9 first-defined, D10, D11)

```ts
// config-precedence.ts
export type ValueSource = 'flag' | 'state' | 'option' | 'env' | 'config' | 'default';
export interface Resolved<T> { value: T; source: ValueSource }
export function firstDefined<T>(layers: ReadonlyArray<readonly [ValueSource, T | undefined]>, fallback: Resolved<T>): Resolved<T>;
//   returns the first layer whose value !== undefined AND (not an array OR length > 0); otherwise the fallback. Whole value, never merged.
export const ALLOWED_DOMAINS_ENV = 'SUTRADHAR_ALLOWED_DOMAINS';
export const IDLE_TIMEOUT_ENV = 'SUTRADHAR_IDLE_TIMEOUT_MS';
export function parseDomainsEnv(raw: string | undefined): string[] | undefined;   // today's comma/trim/filter; empty → undefined
export function parseIdleTimeoutMs(name: string, raw: string | undefined): number | undefined;
//   undefined/'' → undefined; /^\d+$/ and (0 or 1000..2147483647) → number; else throw
//   Error(`${name} must be 0 (never close idle sessions) or an integer between 1000 and 2147483647 (milliseconds); got "${raw}"`)
export function resolveAllowedDomains(i: { flag?: readonly string[]; option?: readonly string[]; env?: Record<string,string|undefined>; config?: LoadedProjectConfig }): Resolved<readonly string[] | undefined>;
export function resolveIdleTimeoutMs(i: { option?: number; env?: Record<string,string|undefined>; config?: LoadedProjectConfig; fallback: number | undefined }): Resolved<number | undefined>;
//   An option ≤ 0 gives value undefined (disabled) with source 'option', preserving the existing test. env/config 0 gives undefined too.
export function resolveViewport(i: { flag?; state?; option?; config? }): Resolved<{width:number;height:number} | undefined>;
export function resolveRuntimeDialogPolicy(i: { option?: DialogPolicy; config?: LoadedProjectConfig; surface: 'mcp' | 'sdk' }):
  { value: DialogPolicy | undefined; source: ValueSource; warnings: string[] };   // sdk: config report → {mode:'auto'} + a warning (D11)
```

**The table the §4 tests enforce, listed highest precedence first:**

| Key | CLI | MCP | SDK |
|---|---|---|---|
| `allowedDomains` | `--allowlist-domains` > `SUTRADHAR_ALLOWED_DOMAINS` (new, D13b) > config > none | option > env > config > none | `launch` option > config > none |
| `downloadDir` + `allowedDownloadRoots` (one layer, D14) | env > config > `<tmp>/sutradhar-downloads`. The `download <ref> <dir>` per-command grant is appended **after** resolution (FR2-05 D1); it's a grant, not a layer. | option > env > config > default | option > config > default |
| `allowedUploadRoots` | env > config > unrestricted | option > env > config > unrestricted | option > config > unrestricted |
| `dialog` | `--dialog`(now) > `state.dialogPolicy` (sticky flag) > config (`auto`→`report` + warning) > `{mode:'report'}` | option `dialogPolicy` > config > runtime default `auto` | option `dialogPolicy` (`report` throws) > config (`report`→`auto` + warning) > `auto` |
| `idleTimeoutMs` | ignored (P4) | option > `SUTRADHAR_IDLE_TIMEOUT_MS` > config > 1 800 000 | option > config > none |
| `viewport` | `--viewport`(now) > `state.viewport` (sticky flag) > config > Chrome default | `browser.launch` call argument > option `defaultViewport` > config > Chrome default | `launch` option > config > Chrome default |

Keys with no env var (`dialog`, `viewport`) skip that layer. No new env vars are invented (§4.9).

### 2.7 `resolveFsRoots` diff (FR2-05's module)

```ts
// BEFORE  export type RootSource = 'option' | 'env' | 'default';
// AFTER   export type RootSource = 'option' | 'env' | 'config' | 'default';
// ResolveFsRootsInput +=  config?: FsRootsOptions & { baseDir: string };
// Download: first of [options.allowedDownloadRoots (non-empty), env, config.allowedDownloadRoots (non-empty), default].
// Upload:   first of [options, env, config.allowedUploadRoots], otherwise unrestricted.
// Config entries: resolveConfigPath(entry, config.baseDir, homedir). This is idempotent for the loader's already-absolute paths.
```

Nothing else changes: no warnings for shadowing, and the options layer's relative-to-cwd behavior (R11) is unchanged.

### 2.8 MCP wiring

**`server.ts`:**

```ts
// CreateServerOptions +=
projectConfig?: LoadedProjectConfig;   // JSDoc: from loadProjectConfig; lowest layer below options and env. Ignored for runtime construction if `runtime` is supplied.
dialogPolicy?: DialogPolicy;           // JSDoc: default native-dialog policy for sessions (FR2-04). Unset = 'auto'.
defaultViewport?: { width: number; height: number };   // JSDoc: used by browser.launch when the call gives no viewport.

// createSutradharServer, replacing :76-88:
const cfg = options.projectConfig;
const idle = resolveIdleTimeoutMs({ option: options.idleTimeoutMs, env: process.env, config: cfg, fallback: DEFAULT_IDLE_TIMEOUT_MS }); // may throw (D13a)
const domains = resolveAllowedDomains({ option: options.allowedDomains, env: process.env, config: cfg });
const dialog = resolveRuntimeDialogPolicy({ option: options.dialogPolicy, config: cfg, surface: 'mcp' });
const viewport = resolveViewport({ option: options.defaultViewport, config: cfg });
const fsRoots = resolveFsRoots({ options: {…FR2-05}, env: process.env,
  config: cfg && { ...cfg.resolved, baseDir: cfg.baseDir } });
// `restrictNavigationToLocal` is unchanged.
// new SutradharRuntime({ logger, idleTimeoutMs: idle.value, restrictNavigationToLocal, allowedDomains: domains.value,
//   allowedDownloadRoots: fsRoots.allowedDownloadRoots, allowedUploadRoots: fsRoots.allowedUploadRoots, dialogPolicy: dialog.value })
registerTools(server, { runtime, agent, defaultViewport: viewport.value });   // applies even when `runtime` is supplied (tool level)
```

**`tools.ts`:**
- `RegisterToolsOptions.defaultViewport?`.
- Launch handler: `const vp = viewport ?? options.defaultViewport;` with the existing `launch:` condition applied to `vp`.
- The `viewport` description gains: `' When omitted, the server default from .sutradhar.json "viewport" (if any) is used.'`

**`cli.ts` `main()`**, before `createSutradharServer`:

```ts
const env = readConfigEnv(process.env);
const discovery = await loadProjectConfig({ cwd: process.cwd(), discover: env.kind === 'unset',
  explicitPath: env.kind === 'path' ? env.path : undefined, explicitOrigin: 'env' });   // throws → fatal, exit 1
for (const line of describeConfigDiscovery(discovery, process.cwd())) console.error(line);   // stderr ONLY (FR2-05 B11)
const { server, runtime } = await createSutradharServer({
  projectConfig: discovery.status === 'loaded' ? discovery.config : undefined });
```

`env.kind === 'disabled'` gives `{status:'none', reason:'disabled'}` without calling the loader.

### 2.9 CLI wiring

1. **`loadCliConfigOrExit(): Promise<LoadedProjectConfig | undefined>`** is memoized for the process.
   - `readConfigEnv` plus `loadProjectConfig`.
   - On `ProjectConfigError`, `printErrorAndExit(e.message)`.
   - It prints each warning as `Warning: <w>` on stderr.
   - It's called as the **first statement of `withSession`**, before FR2-05's `resolveFsRoots` and FR2-04's gate (the gate needs the effective policy).
   - It's never called by `doctor` (which has its own non-fatal path), `close`, `sessions`, `profile`, `dialog`, help or `__dialog-warden` (D7).
2. **Runtime options:**
   - `allowedDomains: resolveAllowedDomains({flag: allowlistDomainsFlag, env: process.env, config: cfg}).value`
   - `resolveFsRoots({env: process.env, config: cfg && {...cfg.resolved, baseDir: cfg.baseDir}})`
   - `dialogPolicy` from item 4.
3. **Viewport:**
   - `spawnFreshSession(runtime, cfg)`: `vp = viewportFlag ?? cfg?.values.viewport`. This feeds `spawnDetachedChrome(…, vp)` and `setViewport(vp)`. `writeState({… viewport: viewportFlag})` still persists **only the flag** (D10), so later config edits keep taking effect.
   - Reattach: `effectiveViewport = viewportFlag ?? state.viewport ?? cfg?.values.viewport`.
4. **Dialog:** FR2-04's `resolveDialogPolicy(dialogFlag, dialogTextFlag, state, cliDialogFromConfig(cfg))`:
   - `cliDialogFromConfig` maps `auto` to `{mode:'report'}` and emits the warning `<file>: dialog.mode "auto" is not supported by the CLI (each command is a separate process); using "report"`.
   - Precedence: flag, persisting `set` for **every** mode including report (D10); else `state.dialogPolicy`, `keep`; else config, `keep`; else `{mode:'report'}`, `keep`.
5. **Trust notice (D12c):** `cliTrustNotice(cfg, {downloadSource, dialogSource, dialogMode})`.
   - When `cfg.origin === 'discovered'` and (`downloadSource === 'config'` or (`dialogSource === 'config'` and `dialogMode === 'accept'`)), print exactly one line to stderr:

     ```
     Note: using <downloadDir/allowedDownloadRoots | dialog.mode "accept" — whichever apply, joined with ", "> from project config <file>. Set SUTRADHAR_CONFIG=none to ignore it.
     ```

   - This runs after attach, once per command.
6. **`sutradhar run` (FR2-13), whichever lands second:**
   - `run` applies the **security keys only**: `allowedDomains` (flag > env > config) and fs roots.
   - Scenario `browser.viewport`, dialog and idle stay governed by FR2-13 D18 (reproducible runs).
   - A config error in `run` exits **2** with FR2-13's infrastructure-error path, never through `printErrorAndExit` (FR2-13 T8).
7. **`cmdDoctor`** appends the following. It never changes the exit code, and a `ProjectConfigError` is caught.

   ```
   Config:          <file> (discovered) | (SUTRADHAR_CONFIG) | none (searched <n> directories upward from <cwd>; stopped at <git root|home|filesystem root> <dir>) | disabled (SUTRADHAR_CONFIG=none) | INVALID: <message>
   Config warning:  <w>                                 (one line per warning)
   Config sources:  allowedDomains=<src>, downloadRoots=<src>, uploadRoots=<src|unrestricted>, dialog=<src>, viewport=<src|default>
   ```

   - `Config sources` is computed without a session: the doctor command's own flags, env, `readState()` for the sticky layers, and the config.
   - `idleTimeoutMs` isn't listed, because the CLI doesn't use it.
8. **Help text:**
   - A new paragraph after FR2-05's `Environment:` block:

     ```
     Project config:
       .sutradhar.json in this directory or the nearest parent (stopping at the git root or your home
       directory) sets defaults: allowedDomains, downloadDir, allowedDownloadRoots, allowedUploadRoots,
       dialog, viewport. Flags > env vars > the file > built-in defaults. Paths in the file are relative
       to the file. SUTRADHAR_CONFIG=<absolute path> loads one file explicitly; SUTRADHAR_CONFIG=none
       ignores project config. "sutradhar doctor" shows which file is in use.
     ```

   - The `--allowlist-domains` help text gains: `(or set allowedDomains in .sutradhar.json / SUTRADHAR_ALLOWED_DOMAINS to apply it to every command)`.

### 2.10 SDK wiring

```ts
// LaunchOptions +=
configFile?: string;        // Load this .sutradhar.json (relative to process.cwd()). Explicitly loaded: no containment/ownership checks.
discoverConfig?: boolean;   // Search upward from process.cwd() like the CLI. Default false: the SDK reads no config unless asked.
idleTimeoutMs?: number;     // Close the browser session after this many ms idle. Unset = never (unchanged).
dialogPolicy?: DialogPolicy;// 'auto' (default) | 'accept' | 'dismiss'. 'report' throws: the SDK has no dialog-handling API yet.
// launch():
if (options.dialogPolicy?.mode === 'report') throw new TypeError('launch(): dialogPolicy mode "report" is not supported by the SDK (there is no way to handle a pending dialog from a Page yet); use "auto", "accept" or "dismiss"');
const discovery = await loadProjectConfig({ cwd: process.cwd(), discover: options.discoverConfig === true,
  explicitPath: options.configFile !== undefined ? path.resolve(process.cwd(), options.configFile) : undefined, explicitOrigin: 'option' });
// warnings → console.warn(`[sutradhar] ${w}`)
// runtime: allowedDomains = resolveAllowedDomains({option, config}); fs roots = resolveFsRoots({options, config}) (no env);
//   idleTimeoutMs = resolveIdleTimeoutMs({option, config, fallback: undefined}); dialogPolicy = resolveRuntimeDialogPolicy({option, config, surface:'sdk'})
// runtime.launch viewport = resolveViewport({option: options.viewport, config}).value
```

### 2.11 Exact output strings

- **MCP startup** (stderr, exactly one line, plus any warnings):
  - `[sutradhar-mcp] config: loaded <file> (found by searching upward from <cwd>)`
  - `[sutradhar-mcp] config: loaded <file> (SUTRADHAR_CONFIG)`
  - `[sutradhar-mcp] config: none found (searched upward from <cwd>, stopped at <reason> <dir>); set SUTRADHAR_CONFIG to an absolute path to load one explicitly`
  - `[sutradhar-mcp] config: disabled (SUTRADHAR_CONFIG=none)`
- **MCP warnings:** `[sutradhar-mcp] warning: <w>`. A discovered config whose `dialog.mode` is `accept` adds `[sutradhar-mcp] warning: <file> sets dialog.mode "accept": native alert/confirm/prompt dialogs will be accepted automatically.`
- **CLI:** `Warning: <w>`; `Error: <ProjectConfigError message>` with exit 1; `Note: …` (§2.9.5).
- **SDK:** `console.warn('[sutradhar] <w>')`; errors are thrown `ProjectConfigError`s.

---

## 3. Fixtures

### 3.1 `tools/scenario-suite/fixtures/fr2-14-config-server.mjs`

`startConfigServer()` returns `{ port, url(host, caseId), served, close }`. It calls `listen(0)` with **no host**, so it's dual-stack and reachable as both `localhost` and `127.0.0.1`; preflight L0 proves this.

- `GET /page?n=<nonce>` returns: title `fr2-14 <n>`; `<a id="dl" href="/file?n=<n>">`; `<input type=file id=f>` with a change listener writing `name:size` into `#out`; `<button id=confirm>` whose click records the `confirm('fr2-14 '+n)` result into `localStorage['fr2-14:'+n]` and `#log`.
- `GET /file?n=` returns 64 KiB of random bytes with `Content-Disposition: attachment; filename="fr2-14-<n>.bin"`, and pushes `{n, size, sha256}` onto `served` (the independent ground truth, as in FR2-05 §3).
- Per-case uniqueness goes in the query string (the decisions.md gotcha).

### 3.2 `fixtures/fr2-14-config-tree.mjs`

`buildTree(R, port)` creates the following and returns every path:

```
R/proj/.git/                       (empty dir: boundary)
R/proj/.sutradhar.json             {"$schema":"urn:sutradhar:config:1","allowedDomains":["localhost"],"downloadDir":"./dl",
                                    "allowedUploadRoots":["./up"],"viewport":{"width":700,"height":500},
                                    "dialog":{"mode":"dismiss"},"idleTimeoutMs":4000,"allowedDomian":["x.com"]}
R/proj/a/b/c/                      (the nested cwd)
R/proj/up/ok.txt   R/elsewhere/x.txt
R/proj0/.git/                      (repo with no config: the default layer)
R/outer/.sutradhar.json            {"allowedDomains":["127.0.0.1"]}
R/outer/repo/.git                  (a FILE containing "gitdir: x": the worktree form, C15)
R/outer/repo/sub/                  (cwd: must NOT load R/outer's file)
R/bad-empty/.git/  + .sutradhar.json {"allowedDomains":[]}
R/bad-json/.git/   + .sutradhar.json {"viewport": {"width": 1,}}
R/escape/.git/     + .sutradhar.json {"downloadDir":"../outside"}
R/hooks/.git/      + .sutradhar.json {"downloadDir":".git/hooks"}
R/auto/.git/       + .sutradhar.json {"dialog":{"mode":"auto"}}
R/fakehome/.sutradhar.json {"viewport":{"width":640,"height":480}}   R/fakehome/p/q/
R/.sutradhar.json  {"viewport":{"width":1,"height":1}}              (above the fake home: must never be read)
R/nohome/p/q/                      (the fake home without its file, for the home-boundary negative)
```

### 3.3 `fixtures/fr2-14-sdk-probe.mjs <mode>`

This runs as a child with `cwd` set by the harness. It imports the worktree's `packages/sutradhar/dist/index.js`, runs one scenario named by `<mode>`, and prints one JSON line: `{mode, innerWidth, navResults, downloadPath, error}`. Modes:
- `plain`: `launch()`
- `discover`: `{discoverConfig:true}`
- `discover-override`: plus `viewport:{390,844}` and `allowedDomains:['127.0.0.1']`
- `explicit <abs>`: `{configFile}`
- `both`: both options, which must throw

It always closes its browser in `finally`.

---

## 4. Unit tests

All additive except the one FR2-04 row replaced under D10. **No existing assertion is loosened.** The existing `server.spec.ts` idle, restrict and domains tests must pass unmodified; they run on FR2-05's `importOriginal` mock factory.

### 4.1 `capability-runtime/tests/unit/project-config.spec.ts`

Real fs under `mkdtemp(os.tmpdir())`, removed in `afterAll`. `homedir`, `platform`, `fs` and `getuid` are injected where noted.

**Validation**
- **V1:** `validateProjectConfig(PROJECT_CONFIG_EXAMPLE,'f')` gives `values` deep-equal to the example and `warnings` `[]`.
- **V2:** each key's wrong type throws a `ProjectConfigError` whose message starts with `Invalid project config f: <key>`. Cases: `downloadDir:5`, `downloadDir:''`, `allowedUploadRoots:'x'`, `allowedDomains:[1]`, `dialog:'accept'`, `viewport:[1,2]`.
- **V3 (D8):** `[]` for each of the 3 array keys throws a message containing `at least one` and `remove the key for no restriction`.
- **V4 (domains):**
  - accepts `example.com`, `a.b.example.co.uk`, `localhost`, `127.0.0.1`, `[::1]`, `EXAMPLE.com`;
  - rejects `https://x.com` (message contains `write "x.com"`), `x.com/p`, `*.x.com`, `x.com:8080`, `''`, `' x.com'`, `.x.com`, `-x.com`.
- **V5 (dialog):**
  - `{mode:'nope'}` throws; `{}` throws `mode`;
  - `{mode:'dismiss',promptText:'x'}` throws the exact `dialog.promptText only applies …` string;
  - `{mode:'accept',promptText:''}` is ok;
  - `{mode:'report', foo:1}` gives the warning `f: unknown key "dialog.foo" ignored`, and `values.dialog` deep-equals `{mode:'report'}`.
- **V6 (idle):** `0` and `1000` and `2147483647` are ok; `999`, `-1`, `1.5`, `'5000'` and `2147483648` all throw the exact §2.4 text.
- **V7 (viewport):** `{width:0,height:1}`, `{width:1.5,height:1}` and `{width:1}` throw; `{width:1,height:1,depth:2}` gives a warning `viewport.depth`.
- **V8:**
  - `{allowedDomian:['x.com']}` gives the warning `f: unknown key "allowedDomian" ignored (did you mean "allowedDomains"?)`, and `values` is `{}`;
  - `{zzzzqqq:1}` gives a warning with no `did you mean`;
  - `{AllowedDomains:[…]}` suggests `allowedDomains` (case).
- **V9:** `{$schema:'anything'}` gives no warnings.
- **V10:** `JSON.parse('{"__proto__":{"polluted":1},"viewport":{"width":2,"height":3}}')` gives a warning naming `__proto__`; `({}).polluted === undefined`; `Object.getPrototypeOf(values) === Object.prototype`.
- **V11:** a top level of `[]`, `null`, `"x"` or `3` throws `must contain a JSON object`.
- **V12:** `Object.keys(values)` is always a subset of `PROJECT_CONFIG_KNOWN_KEYS`.

**Parse**
- **PR1:** a BOM followed by `{}` parses.
- **PR2:** `{"a":}` throws a message containing the file path and `is not valid JSON`.
- **PR3:** 65 537 bytes throws `larger than 64 KiB`.
- **PR4:** `''` and `'  \n'` throw `is empty`.
- **PR5:** `// c\n{}` throws `comments are not allowed`.

**Discovery** (real temp trees; `homedir` injected to be a temp dir `H`)
- **D1:** cwd = the dir containing the file: found; `searched.length === 1`.
- **D2:** a file 3 levels up: found; `searched` lists nearest first, with exactly 4 entries.
- **D3:** files at levels 1 and 3: the level-1 file wins.
- **D4:** `X/.sutradhar.json` + `X/repo/.git/` + cwd `X/repo/sub`: not found, `stoppedAt:'git-root'`, `stopDir === X/repo`.
- **D5:** the same with `.git` as a **file**: the same result (C15).
- **D6:** a config inside the boundary dir itself (`X/repo/.sutradhar.json`): found.
- **D7:** cwd `H/p/q`:
  - a file at `H` is found;
  - with no file at `H` and a file at `dirname(H)`: not found, `stoppedAt:'home'`.
- **D8:** a cwd outside `H` walks upward past the level where home would be. A file at a non-root ancestor is found.
- **D9 (injected fs):** a `stat` that reports a file at the filesystem root (`C:\` on win32, `/` on posix, both platforms injected): never probed, since `stat` is never called with a root-level candidate, and the result is `filesystem-root`.
- **D10:** a **directory** named `.sutradhar.json` throws `is not a regular file`.
- **D11 (injected fs):** `stat` rejecting with EACCES throws `cannot be read (EACCES)`.
- **D12 (injected fs):** the candidate is a symlink to a file. `stat` follows it, and the target path is loaded.

**Ownership** (injected: `platform:'linux'`, `fs.stat` → `{uid, mode}`, `getuid` → 1000)
- **O1:** uid 1001 throws `owned by uid 1001`.
- **O2:** uid 0: ok.
- **O3:** mode `0o100666` throws `writable by group/others`.
- **O4:** `platform:'win32'` with uid 1001: ok (no check, C16).
- **O5:** the same file loaded through `explicitPath` with uid 1001: ok.

**Env** (`readConfigEnv` + `loadProjectConfig`)
- **E1:** `undefined` and `''` give `unset`.
- **E2:** `none` and `NONE` give `disabled`. `loadProjectConfig` isn't called for disabled; a surface-level test uses an fs spy and sees 0 calls.
- **E3:** `rel.json` throws a message containing `SUTRADHAR_CONFIG` and `absolute`.
- **E4:** `~/c.json` gives `path.join(home,'c.json')`.
- **E5:** an absolute path that doesn't exist throws `does not exist`.
- **E6:** an explicit path loads with `origin:'env'`, even when a nearer discovered file exists, and `searched` is `[]`.

**Paths** (D6, D14)
- **RP1:** a discovered file at `X` with `downloadDir:'./dl'` and cwd `X/a/b` gives `resolved.allowedDownloadRoots[0] === join(X,'dl')`, **not** `X/a/b/dl`.
- **RP2:** `'~/dl'` gives `join(home,'dl')`; `'~bob/x'` throws `~user is not supported`.
- **RP3:** an absolute path is unchanged.
- **RP4:** `downloadDir:'./dl'` + `allowedDownloadRoots:['./x','./dl']` gives `[X/dl, X/x]` (downloadDir first, deduplicated). On win32, `./DL` vs `./dl` is also deduplicated.
- **RP5:** `downloadDir:'sub/dir'` (forward slashes) on win32 resolves to `X\sub\dir`.

**Containment** (D12b; discovered unless noted)
- **CT1:** `downloadDir:'../out'` throws a message containing `outside this config's directory`, `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS` and `SUTRADHAR_CONFIG=`.
- **CT2:** `allowedDownloadRoots:[<abs elsewhere>]` throws `allowedDownloadRoots[0]`.
- **CT3:** `./dl` is ok.
- **CT4:** `.git/hooks` throws `inside a .git directory`; on win32, `.GIT/hooks` does too.
- **CT5:** `X/jn` is a junction (win32) or symlink (posix) pointing outside `X`, and `downloadDir:'./jn/new'` throws "outside" (canonicalization via FR2-05's `canonicalizePath`).
- **CT6:** CT1's file loaded with `explicitOrigin:'env'` succeeds, with `resolved[0] === resolve(X,'../out')`.
- **CT7:** `allowedUploadRoots:['../anything']` in a discovered file is ok (a narrowing-only key).

**Schema drift** (FR2-12 D5 convention)
- **S1:** the schema JSON parses; `$schema` is draft-07; `$id === PROJECT_CONFIG_SCHEMA_ID`.
- **S2:** `Object.keys(schema.properties).sort()` equals `Object.keys(PROJECT_CONFIG_EXAMPLE).sort()` and equals `[...PROJECT_CONFIG_KNOWN_KEYS].sort()`.
- **S3:** `schema.properties.dialog.properties` keys equal `Object.keys(EXAMPLE.dialog)`; `required` is `['mode']`. The same for `viewport`, with `required ['width','height']`.
- **S4:** `AjvJsonSchemaValidator` (loaded with `createRequire(join(repoRoot,'packages/mcp-server/package.json'))('@modelcontextprotocol/sdk/validation/ajv')`) accepts `PROJECT_CONFIG_EXAMPLE`.
- **S5 (differential):** a corpus of ≥ 35 entries covering every V-case input. For each entry `x`, `stripUnknown(x)` is accepted by the hand validator **if and only if** ajv accepts it. Separately, ajv **rejects** every raw entry that has an unknown key: the schema is strict for editors, and the loader is lenient only on unknown keys (D5).

### 4.2 `capability-runtime/tests/unit/config-precedence.spec.ts` (the precedence proofs)

- **PG1, `firstDefined`, exhaustive:** 4 layers `[flag, env, config, default]` with values `'F','E','C'` and fallback `'D'`. For all 8 subsets of {F, E, C} present, the result equals the highest-precedence present layer, and `source` names it. That's 8 assertions, and together they establish **flag > env > config > default** directly.
- **PG2:** an empty array at any layer counts as absent: `[['flag',[]],['env',['e']]]` gives `['e']`/`'env'`.
- **PD (allowedDomains):**
  - (a) flag `['f.com']` + env `'e.com'` + config `['c.com']` → `['f.com']`, `flag`;
  - (b) env + config → `['e.com']`, `env`;
  - (c) config only → `['c.com']`, `config`;
  - (d) none → `undefined`, `default`;
  - (e) env `' , '` counts as unset, so config applies;
  - (f) option `[]` + env `e.com` → env (D13c);
  - (g) MCP form: `option` beats env.
- **PI (idle):**
  - option 42 > env 5000 > config 4000 > fallback: each is dropped in turn and the next layer wins;
  - option 0 → `undefined`, source `option` (it beats env 5000);
  - env `'0'` + config 4000 → `undefined`, `env`;
  - config 0 → `undefined`, `config`;
  - env `'abc'`, `'-1'`, `'999'` and `'1.5'` throw the exact `parseIdleTimeoutMs` message naming `SUTRADHAR_IDLE_TIMEOUT_MS`;
  - fallback `undefined` (SDK) + nothing → `undefined`.
- **PV (viewport):**
  - flag > state > option > config > undefined, each layer present alone and in pairs;
  - **PV-W (whole object):** flag `{w:390,h:844}` + config `{w:700,h:500}` → exactly `{390,844}`, never mixed.
- **PDL (runtime dialog):**
  - option `{accept}` beats config `{dismiss}`;
  - config `{mode:'accept',promptText:'x'}` + option `{mode:'accept'}` → `{mode:'accept'}` **without** a `promptText` (D9);
  - mcp + config report → report, no warning;
  - sdk + config report → `{mode:'auto'}` plus one warning containing `report` and `auto`;
  - no layers → `undefined`.

### 4.3 `capability-runtime/tests/unit/fs-roots.spec.ts` (appended to FR2-05's; R1-R11 are untouched)

- **FC1:** config `{allowedDownloadRoots:[X/dl], baseDir:X}` alone → `[X/dl]`, `sources.download === 'config'` (the config **replaces** the default).
- **FC2:** env download `/e` + config → `['/e']`, `env`. The config is shadowed entirely: `downloadDir` isn't appended (D14).
- **FC3:** option + env + config → option.
- **FC4:** neither → `[defaultDownloadRoot()]`, `default`.
- **FC5:** upload config alone → the list, `config`; upload env + config → env; none → `undefined`, `unrestricted`.
- **FC6:** a relative config entry `'rel'` with baseDir `B` → `join(B,'rel')`. Compare R11, where an option `'rel'` goes to `process.cwd()`. Both are asserted in the same test.
- **FC7:** `expandHome` extraction: `parseRootsEnv` R5 cases still pass byte-for-byte (rerun), and `resolveConfigPath('~bob/x',…)` throws.

### 4.4 `cli/tests/unit/project-config-cli.spec.ts` (new) and `dialog-cli.spec.ts` (FR2-04's; appended, with the one D10 replacement)

- **CC1:** `cliDialogFromConfig` with `{mode:'auto'}` → `{mode:'report'}` plus the exact §2.9.4 warning; `accept` and `dismiss` pass through; `undefined` → `undefined`.
- **CC2:** `cliTrustNotice`:
  - discovered + downloadSource `config` → the exact `Note: using downloadDir/allowedDownloadRoots from project config <f>. Set SUTRADHAR_CONFIG=none to ignore it.`;
  - with dialog accept from config as well → both, joined with `, `;
  - origin `env` → `undefined`;
  - downloadSource `env` → `undefined`;
  - dialog `dismiss` from config → `undefined`.
- **CC3:** `formatDoctorConfigLines` for each of the 5 `Config:` forms (§2.9.7), exact strings; warnings are one line each; the `Config sources:` line uses the exact key order.
- **DC1 (4-level CLI dialog precedence, via `resolveDialogPolicy(flag,text,state,config)`):**
  - (a) flag `dismiss` + state `accept` + config `{accept}` → dismiss, `set`;
  - (b) state `accept` + config `{dismiss}` → accept, `keep`;
  - (c) config `{dismiss}` only → dismiss, `keep`;
  - (d) nothing → `{mode:'report'}`, `keep`.
- **DC2 (the P1 regression):** `('report', undefined, {dialogPolicy:{action:'accept'}}, {mode:'accept'})` → `{policy:{mode:'report'}, persist:'set'}`. The state to persist has `action:'report'`. Then, feeding that state back with **no flag** and config `{mode:'accept'}` → `{mode:'report'}`, `keep`: the flag's report sticks over the config.
- **DC-R (replaces FR2-04 D1 row 2, per D10):** `('report',undefined,{dialogPolicy:{action:'accept'}})` → `{policy:{mode:'report'}, persist:'set'}`, where it used to be `'clear'`.
- **ST-C1 (state.spec):** FR2-03's `parseCliState` on `{"sessionId":"s","wsEndpoint":"ws://x","dialogPolicy":{"action":"report","setAt":"2026-01-01T00:00:00Z"}}` round-trips `action:'report'`.

### 4.5 `mcp-server/tests/unit/server.spec.ts` (append; a new describe with `beforeEach` deleting `SUTRADHAR_ALLOWED_DOMAINS`, `SUTRADHAR_IDLE_TIMEOUT_MS` and both `SUTRADHAR_ALLOWED_*_ROOTS`)

`cfg(values)` builds a `LoadedProjectConfig` with `origin:'discovered'` and absolute `resolved` paths.

- **MC1:** `projectConfig: cfg({allowedDomains:['c.com']})` → runtime `allowedDomains` equals `['c.com']`.
- **MC2:** env `e.com` + config → `['e.com']`.
- **MC3:** option `['o.com']` + env + config → `['o.com']`.
- **MC4:** `cfg({idleTimeoutMs:4000})` → `idleTimeoutMs === 4000`; with env `'0'` as well → `undefined`; option 42 + env + config → 42.
- **MC5:** env `'abc'` → `createSutradharServer` rejects `/SUTRADHAR_IDLE_TIMEOUT_MS must be 0/`, and the runtime mock gets 0 calls (C2 fix).
- **MC6:** `cfg({dialog:{mode:'report'}})` → `dialogPolicy` deep-equals `{mode:'report'}`; option `{mode:'dismiss'}` overrides; no config and no option → `dialogPolicy === undefined` (FR2-04 R3 guard).
- **MC7:** config roots → runtime `allowedDownloadRoots` equals `cfg.resolved.allowedDownloadRoots`; env roots override them.
- **MC8:** no `projectConfig` → the constructor options deep-equal what the pre-FR2-14 path produced for the same env. The **existing** default/env/option tests still pass unmodified.
- **MC9:** `runtime` supplied + `projectConfig` → the runtime mock gets 0 calls, and `registerTools` still receives `defaultViewport` (spy on `registerTools` through a module mock of `./tools.js`).

### 4.6 `mcp-server/tests/unit/tools.spec.ts` (append; tool-count test unchanged)

- **TL1:** `registerTools(server,{runtime, defaultViewport:{width:700,height:500}})`; `browser.launch {}` → `runtime.launch` is called with `launch` deep-equal to `{headless:undefined, userAgent:undefined, viewport:{width:700,height:500}}`.
- **TL2:** a call with `viewport:{390,844}` → 390×844 (the call argument beats the default).
- **TL3:** no default and no argument → `launch: undefined`, today's exact shape.
- **TL4:** the `viewport` description contains `.sutradhar.json`.

### 4.7 `mcp-server/tests/unit/config-banner.spec.ts` (new)

- **CB1-CB4:** `describeConfigDiscovery` returns the 4 exact §2.11 strings, one per status.
- **CB5:** a discovered config with `dialog.mode:'accept'` adds the exact accept warning line.
- **CB6:** warnings are prefixed with `[sutradhar-mcp] warning: `.

### 4.8 `sutradhar/tests/unit/launch-options.spec.ts` (appended to FR2-05's; `process.chdir(tmp)` restored in `finally`; env restored in `afterEach`)

- **SC1 (opt-in):** tmp holds `.sutradhar.json {"allowedDomains":["c.com"],"viewport":{"width":700,"height":500}}` plus `.git/`. Plain `launch()` → the constructor options have `allowedDomains === undefined`, and `runtime.launch`'s argument has no viewport.
- **SC2:** `launch({discoverConfig:true})` → `['c.com']` and viewport 700×500.
- **SC3:** `launch({discoverConfig:true, allowedDomains:['o.com'], viewport:{width:1,height:2}})` → the options win.
- **SC4:** `launch({configFile:'sub/cfg.json'})` → loads `join(process.cwd(),'sub/cfg.json')`.
- **SC5:** both options → rejects `TypeError` `/either configFile or discoverConfig/`.
- **SC6:** `process.env.SUTRADHAR_CONFIG='none'` and `SUTRADHAR_ALLOWED_DOMAINS='e.com'` + `discoverConfig:true` → `['c.com']`. The SDK ignores both env vars (FR2-05 D5).
- **SC7:** config `dialog {mode:'report'}` + discover → a `console.warn` spy is called once with `[sutradhar]` and `auto`, and `dialogPolicy` is `{mode:'auto'}`.
- **SC8:** option `dialogPolicy:{mode:'report'}` → rejects `TypeError` `/not supported by the SDK/`, before any runtime is constructed.
- **SC9:** config `idleTimeoutMs:4000` + discover → the constructor gets `idleTimeoutMs: 4000`; with no config, `undefined` (unchanged).

---

## 5. Live-verify script: `tools/scenario-suite/verify-fr2-14-project-config.mjs`

**Prerequisite:** `pnpm build`. The script drives only the worktree's dist: `packages/cli/dist/cli.js`, `packages/mcp-server/dist/cli.js` (over stdio, reusing the FR2-01/FR2-05 MCP client helper) and `packages/sutradhar/dist/index.js` (through the probe child).

**Isolation:**
- `R = mkdtemp(tmp,'fr2-14-')`, then `buildTree(R, port)`.
- Child env: `{...process.env, TEMP/TMP/TMPDIR: R/temp, SUTRADHAR_CLI_STATE_ROOT: R/state-root}`, with **all** of `SUTRADHAR_CONFIG`, `SUTRADHAR_ALLOWED_DOMAINS`, `SUTRADHAR_ALLOWED_*_ROOTS` and `SUTRADHAR_IDLE_TIMEOUT_MS` deleted unless a case sets them. If FR2-03 isn't merged, `SUTRADHAR_CLI_STATE_DIR` is set per cwd instead.

**Outputs:** `evidence/FR2-14/live-cases.jsonl` (`{id, surface, argv, cwd, envDelta, stdout, stderr, code, observed, pass}`) and `live-summary.json`. The script exits 1 on any failure.

**Waits:** every "within N s" is a polled condition with a deadline; there are no fixed sleeps.

**Independent checks:**
- viewport: through `eval "innerWidth+'x'+innerHeight"`;
- downloads: `served` sha256 plus a realpath containment check;
- dialog outcome: the page's own `localStorage` record, read after the page is unblocked (FR2-04 observer rules);
- navigation blocking: exit code, the `allowedDomains` error text, **and** the observer's page-target URL, which must not change on a blocked navigation.

| id | Surface / cwd | Steps | Assertions |
|---|---|---|---|
| **L0** preflight | CLI, `R/proj0` | `nav http://localhost:P/page?n=L0`, then `nav http://127.0.0.1:P/page?n=L0b`, then `doctor` | both navs exit 0 (dual-stack fixture works; default layer = no restriction); doctor `Config:` is `none (searched 1 directories upward from R/proj0; stopped at git root R/proj0)`; `close` |
| **L1** discovery from a nested cwd **(Done-when)** | CLI, `R/proj/a/b/c` | `doctor` | `Config:          R/proj/.sutradhar.json (discovered)`; a `Config warning:` line contains `unknown key "allowedDomian"` and `did you mean "allowedDomains"`; `Config sources:` contains `allowedDomains=config, downloadRoots=config, uploadRoots=config, dialog=config, viewport=config`; exit 0 |
| **L2** config layer wins over default (domains) | same cwd | `nav http://127.0.0.1:P/page?n=L2` | exit 1; stderr contains `allowedDomains is configured` and `(localhost)`; stderr contains `Warning: R/proj/.sutradhar.json: unknown key "allowedDomian"`; observer URL unchanged (fresh session: `about:blank`) |
| **L3** | same | `nav http://localhost:P/page?n=L3` | exit 0 |
| **L4** env > config | same, env `SUTRADHAR_ALLOWED_DOMAINS=127.0.0.1` | `nav 127.0.0.1…?n=L4a`, then `nav localhost…?n=L4b` | L4a exit 0; L4b exit 1 with `(127.0.0.1)` |
| **L5** flag > env > config | same, env as L4 | `nav localhost…?n=L5a --allowlist-domains localhost`, then `nav 127.0.0.1…?n=L5b --allowlist-domains localhost` | L5a exit 0; L5b exit 1 |
| **L6** viewport: config > default | same | (session from L3) `eval "innerWidth+'x'+innerHeight"` | stdout `700x500` |
| **L7** viewport: flag > config, and it sticks | same | `close`; `nav localhost…?n=L7 --viewport 390x844`; `eval …`; `eval …` (no flag) | both `390x844` |
| **L8** config edits apply without a flag | cwd `R/proj0`, after writing `R/proj0/.sutradhar.json {"viewport":{"width":800,"height":600}}` | `nav localhost…?n=L8`; `eval …`; then rewrite the file to 820×620; `eval …` | `800x600`, then `820x620` (the config is re-read each command; no sticky flag). Remove the file and `close`. |
| **L9** downloadDir relative to the **config file**, not cwd | cwd `R/proj/a/b/c` | `nav localhost…?n=L9`; `download "#dl"` | exit 0; the reported path is inside `R/proj/dl`; `check(served)` passes; `R/proj/a/b/c/dl` does **not** exist; stderr contains `Note: using downloadDir/allowedDownloadRoots from project config R/proj/.sutradhar.json` |
| **L10** env > config (download) | same, env `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS=R/envdl` | `download "#dl"` | lands in `R/envdl`; no `Note:` line |
| **L11** per-command grant (relative to cwd, FR2-05 D1) | same | `download "#dl" ./here` | lands in `R/proj/a/b/c/here` |
| **L12** upload roots | same | `upload "#f" R/elsewhere/x.txt`; `upload "#f" R/proj/up/ok.txt`; then with env `SUTRADHAR_ALLOWED_UPLOAD_ROOTS=R/elsewhere` repeat the first | 1st: exit 1 `outside the allowed upload directories`; 2nd: exit 0 and `#out` equals `ok.txt:<size>`; 3rd: exit 0 |
| **L13** dialog: config dismiss | same | `click "#confirm"` | stdout `dialogHandled: {"type":"confirm",…,"action":"dismiss",…,"by":"policy"}`; record `false` |
| **L14** dialog: flag > config, and report sticks (P1) | same | `click "#confirm" --dialog accept`; `click "#confirm"` (no flag); `snap --dialog report`; `click "#confirm"` | 1st and 2nd: accept, record `true` (the sticky flag beats config dismiss); after `--dialog report`, `state.dialogPolicy.action === 'report'`; the last click prints `dialogPending:` (config dismiss did **not** apply); then `dialog dismiss` and `close` |
| **L15** auto maps to report on the CLI | cwd `R/auto` | `nav localhost…`; `click "#confirm"` | stderr `dialog.mode "auto" is not supported by the CLI`; stdout `dialogPending:`; `dialog dismiss`; `close` |
| **L16** .git FILE boundary | cwd `R/outer/repo/sub` | `doctor`; `nav 127.0.0.1…` | `Config: none (… stopped at git root R/outer/repo)`; nav exit 0 (`R/outer`'s allowlist not applied) |
| **L17** home boundary (no Chrome) | cwd `R/fakehome/p/q`, env `USERPROFILE`/`HOME=R/fakehome` | `doctor` | `Config: R/fakehome/.sutradhar.json (discovered)` |
| **L18** above home never read | cwd `R/nohome/p/q`, env `USERPROFILE`/`HOME=R/nohome` | `doctor` | `Config: none (… stopped at home R/nohome)`; `R/.sutradhar.json` is not loaded |
| **L19** disable | cwd `R/proj/a/b/c`, env `SUTRADHAR_CONFIG=none` | `doctor`; `nav 127.0.0.1…?n=L19` | `Config: disabled (SUTRADHAR_CONFIG=none)`; nav exit 0 |
| **L20** explicit | cwd `R/proj0`, env `SUTRADHAR_CONFIG=R/outer/.sutradhar.json` | `nav localhost…` | exit 1 (blocked; only `127.0.0.1` allowed) |
| **L21** SDK | probe children: cwd `R/proj/a/b/c` | modes `plain`, `discover`, `discover-override`, `explicit R/outer/.sutradhar.json`, `both` | plain: `innerWidth` is the Chrome default (≠700) and 127.0.0.1 nav ok; discover: 700, 127.0.0.1 throws `allowedDomains`, and `page.download('#dl')` lands in `R/proj/dl`; discover-override: 390, 127.0.0.1 ok; explicit: localhost throws; both: `error` matches `either configFile or discoverConfig` |
| **L22** MCP discovery + all layers | MCP spawned with cwd `R/proj/a/b/c` | stderr at startup; `browser.launch {}`; `eval innerWidth`; `navigate 127.0.0.1`; `download_file #dl`; then **no calls** and poll a `browser.list_tabs {sessionId}` every 500 ms for up to 15 s | stderr `[sutradhar-mcp] config: loaded R/proj/.sutradhar.json (found by searching upward from R/proj/a/b/c)` and a `warning:` line for `allowedDomian`; `700`; navigate error contains `allowedDomains`; `output.downloadedPath` is in `R/proj/dl`; list_tabs fails with `No browser session` within 15 s (idle 4000 from config) and the observer sees that session's Chrome gone |
| **L23** MCP env > config, call argument > config | MCP, same cwd, env `SUTRADHAR_ALLOWED_DOMAINS=127.0.0.1`, `SUTRADHAR_IDLE_TIMEOUT_MS=0` | `launch {viewport:{width:390,height:844}}`; `navigate 127.0.0.1`; wait 10 s (a not-yet race: list_tabs must keep succeeding) | 390; nav ok; session **not** reaped |
| **L24** MCP none found | MCP, cwd `R/proj0` | startup | `config: none found (searched upward from R/proj0, stopped at git root R/proj0)…` |
| **L25** cleanup | all cwds | `close` in each; MCP `shutdown_all` + stdin end; `rm R` with retry | 0 processes whose command line contains `realpath(R)`; 0 new `sutradhar-cli-*` dirs in `R/temp` |

---

## 6. Negative cases (all asserted live in §5's harness as extra rows `N*`, plus the unit coverage noted)

| # | Input | Expected |
|---|---|---|
| N1 | cwd `R/bad-empty`: `nav localhost…` | exit 1; stderr `Error: Invalid project config R/bad-empty/.sutradhar.json: allowedDomains must list at least one domain; remove the key for no restriction`; **no Chrome**: no state file, no new `sutradhar-cli-*` dir, observer process count unchanged (V3) |
| N2 | cwd `R/bad-json`: `snap` | exit 1; `is not valid JSON`; no Chrome (PR2) |
| N3 | cwd `R/bad-json`: `doctor`, then `close`, then `sessions` | all exit 0; doctor `Config:          INVALID: …not valid JSON…` (D7: a broken file never blocks cleanup) |
| N4 | cwd `R/escape`: `nav localhost…` | exit 1, containment error naming both escape hatches; `R/outside` not created (CT1) |
| N5 | the N4 file loaded with `SUTRADHAR_CONFIG=R/escape/.sutradhar.json`: `nav`, then `download "#dl"` | exit 0; file lands in `R/outside` (the explicit load is trusted, CT6) |
| N6 | cwd `R/hooks` | exit 1, `inside a .git directory`; `R/hooks/.git/hooks` has no new file (CT4) |
| N7 | `SUTRADHAR_CONFIG=rel.json` | CLI exit 1 and MCP exit 1 within 10 s, both naming `SUTRADHAR_CONFIG` and `absolute` (E3) |
| N8 | `SUTRADHAR_CONFIG=R/missing.json` | exit 1, `does not exist` (E5) |
| N9 | MCP with cwd `R/bad-empty` | the process exits 1 within 10 s; stderr contains `[sutradhar-mcp] fatal:` and the file path |
| N10 | MCP env `SUTRADHAR_IDLE_TIMEOUT_MS=abc` (no config) | exits 1 within 10 s (the C2 fix, MC5) |
| N11 | A config `"idleTimeoutMs": 30` | error mentioning `between 1000 and 2147483647` (V6) |
| N12 | `{"__proto__":{"allowedDomains":["x"]}}` | a warning only; not blocked (V10) |
| N13 | cwd is a drive or filesystem root holding a `.sutradhar.json` (unit D9 with injected fs; live only if `R` can be `subst`-mapped, which is optional and skipped with a recorded reason otherwise) | never read |
| N14 | POSIX-only (Auditor, on a POSIX host): a `chmod 666` config | error `writable by group/others` (O3) |
| N15 | The config file is replaced **mid-session** by a stricter one | the next CLI command applies it (a per-command read); a running MCP server keeps its startup values, which is documented |

---

## 7. Risks

### 7.1 Security: auto-discovery is itself an attack surface (handled as a first-class risk)

**Threat A: a hostile repository.** A cloned repo, or a directory an agent `cd`s into, contains a `.sutradhar.json`, and the agent runs `sutradhar …` or starts an MCP server there. What each key can do when the file comes from discovery:

| Key | Worst case if honored as written | Mitigation |
|---|---|---|
| `allowedDomains`, `allowedUploadRoots` | Only **narrows** access (their defaults are unrestricted): DoS at most | D8 prevents the silent-widening misreading of `[]` |
| `downloadDir` / `allowedDownloadRoots` | **Widening.** Aimed at a Startup folder, `~/.ssh` or a shell rc directory, any page's download would be written there: persistence or code execution | **D12b containment**, enforced with FR2-05's symlink-safe `canonicalizePath`: roots must stay inside the repo and outside `.git`. The worst remaining case is a write into the attacker's own repo content. `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS` (env > config) always beats it. |
| `dialog.mode: accept` | Removes the confirm() second chance before destructive clicks | Honored, but a stderr `Note:` appears on **every** CLI command where it's in effect, plus an MCP startup warning (D12c). A `--dialog` flag or persisted flag overrides it. |
| `idleTimeoutMs` | `0` disables the MCP reaper (a Chrome leak); a small value reaps sessions early | The range rule (0 or ≥1000); the env var outranks it; it's a resource issue, not a trust issue |
| `viewport` | Cosmetic | none needed |

**Threat B: a planted file in a shared ancestor** (`/tmp/.sutradhar.json`, `E:\.sutradhar.json`, another user's parent directory):
- The filesystem root is never read (D3).
- The `.git` boundary insulates repositories.
- The home boundary means nothing above home is read.
- On POSIX, files owned by someone else or writable by group/others are refused (D12d).
- **Residual risk, Windows only:** for a cwd outside home and outside any repo (for example `E:\work\scratch`), an intermediate directory like `E:\work` is searched, and Node can't check the owner (C16). Exploiting it needs a local account with write access to that exact parent directory. At worst, D12's key-level rules still hold (downloads contained, dialog accept announced). This is documented in `SECURITY.md`; a Windows ACL check via `icacls` is logged as a follow-up gap, not built.

**Threat C: the "never guess" property.**
- There is exactly one file, the nearest. The walk is deterministic.
- The effective file is always discoverable: `doctor` on the CLI, a startup line on MCP.
- `SUTRADHAR_CONFIG=none` is an unconditional way to opt out.
- Precedence guarantees that flags and env vars an operator set explicitly are never overridden by a file.

**Threat D: unknown keys.** A typo in a *restrictive* key (`allowedDomain`) means the restriction silently isn't there. §4.6 decides this is a warning, not an error, and that isn't reopened. Mitigation: every warning is printed on every CLI command and at MCP startup, with a did-you-mean hint that catches exactly this typo class (V8, L2).

### 7.2 Other risks

- **R1. FR2-04 amendment (D10).** One FR2-04 test row and one live assertion are replaced. Old CLIs read `action:'report'` from new states. Because FR2-04 maps `action` to `mode`, that works; it's the same release anyway.
- **R2. Changed behaviors (D13):**
  - an invalid `SUTRADHAR_IDLE_TIMEOUT_MS` now fails MCP startup;
  - the CLI now honors `SUTRADHAR_ALLOWED_DOMAINS` (a user who set it for MCP in their shell will now be restricted in the CLI too: stricter, and listed in the changelog);
  - `allowedDomains: []` as a programmatic option no longer suppresses the env var.
- **R3. Tests that implicitly depend on cwd.** `createSutradharServer` doesn't discover (§2.8), and the SDK is opt-in. The only callers that discover are the two process entry points. CLI scenario-suite drivers run from temp cwds; the phase gate confirms `run-cli.mjs` sees no stray config. A repo-root `.sutradhar.json` added later would affect `run-cli.mjs` runs started from the repo; `doctor` makes that visible.
- **R4. Performance.** Per CLI command: up to about 10 `stat` calls plus two `canonicalizePath` calls. That's under 5 ms, measured in L1 (record `ms`) and well inside noise.
- **R5. Merge touchpoints:**
  - `cli.ts` `withSession`: FR2-03 (release), FR2-04 (gate, `session-flow`), FR2-05 (roots first). FR2-14 inserts `loadCliConfigOrExit()` **before** FR2-05's resolver.
  - `mcp-server/src/cli.ts`: FR2-03's shutdown hooks come after `server.connect`; FR2-14's changes come before `createSutradharServer`.
  - `cmdDoctor`: FR2-03's session lines come first, then FR2-14's config lines.
  - Help text: an append-only paragraph.
  - FR2-13 `run`: §2.9.6.
  - FR2-10's registration wrapper doesn't touch `browser.launch`'s schema, which FR2-10 D6 explicitly leaves alone.
- **R6. The schema isn't shipped in the tarball** (the same issue as GAP-065). Editors can't resolve `$schema` from npm. Log it as a follow-up gap together with GAP-065.
- **R7. New gaps to log:**
  - GAP-new-a (minor): no Windows owner/ACL check for discovered configs.
  - GAP-new-b (minor): no user-level config layer inside repositories (`~/.sutradhar.json` is only reached from directories that aren't repositories).
  - GAP-new-c (minor): `restrictNavigationToLocal`, `headless` and `userAgent` aren't config keys in v1 (they get the unknown-key warning).
  - GAP-new-d (minor): the schema isn't shipped (R6).

---

## 8. Rollback

- `git revert <FR2-14 commit>`.
- **Persisted state:** `CliState.dialogPolicy.action === 'report'` entries written in the meantime are read by the reverted FR2-04 code as mode `report`, the same outcome. No other state or file format is persisted by this item. `.sutradhar.json` files users created are simply ignored again.
- **Partial rollbacks:**
  - If discovery causes trouble on MCP (R3), make `mcp-server/src/cli.ts` pass `discover:false` (a one-line change). MCP then honors only `SUTRADHAR_CONFIG`.
  - If a D13 env change breaks a real user, revert that single resolver call (`resolveIdleTimeoutMs` back to the lenient `Number()`, or drop `env` from the CLI's `resolveAllowedDomains` call). The config layer is independent of both.
  - **Never roll back D12's containment or ownership checks alone.** That would reopen threat A/B. Fix them forward instead.
- After a revert: append a decisions.md entry, reset the ledger row, and drop the changelog fragment.

---

### Critical Files for Implementation
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\capability-runtime\src\project-config.ts (new; lives next to FR2-05's `fs-roots.ts`, which it extends)
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\cli\src\cli.ts
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\mcp-server\src\server.ts
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\mcp-server\src\cli.ts
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\sutradhar\src\index.ts
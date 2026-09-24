# FR2-05: download directory and upload roots, implementation spec

**Item:** FR2-05 (Phase 1). **Base:** HEAD `6ccc26f` on `claude/field-report-2-loop`. Line numbers are at that HEAD. FR2-01 is still in FIX(1), and FR2-02/03/04 merge before this item (order FR2-01 → FR2-03 → FR2-04 → FR2-05), so the Executor re-locates each anchor by symbol name, not by line.
**Versioning:** no version bump. The item writes `evidence/FR2-05/changelog-fragment.md`, which is additive except for one fail-closed security fix (B2).

---

## 0. Trace results

Everything below was confirmed by reading the code at HEAD unless marked *to confirm live*.

| # | Finding | Evidence |
|---|---|---|
| B1 | The finding is confirmed. The engine defaults `allowedDownloadRoots` to `[path.join(os.tmpdir(), 'sutradhar-downloads')]`. Nothing wires the option in: the CLI (`cli.ts:93`, `new SutradharRuntime({ logger, allowedDomains })`), the MCP server (`server.ts:75-96`, which only parses idle, restrict-local and domains) and the SDK (`sutradhar/src/index.ts:45`, `allowedDomains` only) all omit it. `cmdDownload` (`cli.ts:674-686`) passes `path.resolve(dir)` into a runtime that only allows the temp root, so `sutradhar download <ref> ./out` is always rejected. | `browser-action-engine.ts:153-156`, `:201-217` |
| B2 | **The containment check is not correct. There is a symlink/junction escape.** `resolveDownloadDir` (`:201-217`) runs `realpath(resolved).catch(() => resolved)`. When the requested dir **does not exist yet**, the check falls back to the literal string. So `<root>\jn\newsub`, where `jn` is a junction or symlink inside the root pointing elsewhere, passes the prefix check, and `resolved` goes to `Browser.setDownloadBehavior` (`:883-887`). Chrome then creates `newsub` *through* the link, outside the root. The JSDoc at `:196-200` says a nonexistent target "fails loudly downstream". That is false: CDP creates missing directories (`:124-125` says so itself). **Fixed in this item.** *To confirm live:* the Executor runs negative case N7 against the **pre-change** build first and saves that output as `evidence/FR2-05/prefix-baseline-N7.json`. | engine `:188-217` |
| B3 | A root that doesn't exist yet also falls back to its literal form (`:206`). If the root spelling differs from the canonical form of an existing child (8.3 short names, macOS `/var` → `/private/var`), that's a false reject. On this machine `os.tmpdir()` is `E:\AI-Cache\tmp` and already canonical, so it isn't live here, but it is on default Windows setups where `TEMP` holds an 8.3 path. Fixed by the same change. | `:206` |
| B4 | `isPathWithinRoot` (`:38-41`) uses `c.startsWith(r + path.sep)`. The separator boundary means the prefix trick (`C:\out` vs `C:\out-evil`) is handled correctly, and `..` is normalised by `path.resolve`, so traversal is handled too. Win32 case-folding is correct. Bug: a drive or filesystem root as the allowed root (`C:\`) becomes `C:\\`, which rejects everything under it. This is a minor false reject, fixed with a `path.relative`-based check. | `:38-41` |
| B5 | `runtime.ts:1366-1389` duplicates the upload check with a **case-sensitive** comparison (`:1381`). That differs from the engine's win32 case-folding. In practice it's harmless: the file must exist, so `realpath` canonicalises it. It's still copy drift, and it is replaced by the shared helper. | runtime `:1372-1389` |
| B6 | The reported path is `path.join(downloadDir, suggestedFilename)` (`:905-906`). Two problems: it ignores CDP's `Browser.downloadProgress.filePath` (experimental, exists in `devtools-protocol@0.0.1653615` `protocol.d.ts:5057-5062`), and it doesn't filter events by `guid`. If Chrome uniquifies the name on a conflict, or another download in the same browser completes first, the reported path is wrong. *To confirm live* with case L4. The item fixes it by preferring `filePath`, filtering by the guid seen in `downloadWillBegin`, using `path.basename` on the suggested name, and asserting the path stays inside `downloadDir`. | `:890-921` |
| B7 | `Browser.setDownloadBehavior {allow, downloadPath}` is **never reset** (`:922-930` only detaches). So a destination granted for one action stays Chrome's target for later page-initiated downloads. That conflicts with "don't persist" for the CLI auto-allow. Fixed by resetting to `{behavior:'default'}` in `finally`. | `:922-930` |
| B8 | The docs are wrong in four places. `runtime.ts:86-88` and `runtime.ts:809` say "OS temp directory". `tools.ts:894` says "Defaults to the OS temp directory." `SECURITY.md:21-24` says "default-sandbox to the OS temp directory". The real default is `<os.tmpdir()>/sutradhar-downloads`. The MCP README config table (`README.md:178-185`) lists none of the security env vars. | |
| B9 | **The SDK has no download or upload method at all.** `page.ts` has goto, snapshot, click, type, waitForSelector, press, scroll, screenshot, evaluate, cookies, storage state, viewport, bringToFront and close. `Browser` holds `runtime` privately. A `launch({allowedDownloadRoots})` passthrough would therefore be a dead option. `DownloadResult` (`capability-runtime/src/types.ts:128-133`) is defined, exported and never used. | |
| B10 | Out of scope, logged as a gap. `download_file` runs through the generic retry loop (`maxRetries ?? 2`, `:253`), and `runtime.downloadFile` doesn't override it. A policy rejection is retried 3 times (about 1.5 s of backoff plus a failure screenshot). A download that times out is **re-clicked**, which can produce duplicate files. The inner and outer timeouts are both 30000 ms (`runtime.ts:819`, engine `:252`, `:889`), the same race class FR2-01 hit. Log as GAP-020 (retry) and GAP-021 (equal timeouts), both minor. | |
| B11 | MCP stdout is JSON-RPC, and `ConsoleLogTransport` sends `info` to `console.log`, which is stdout (`observability/src/logger/console-transport.ts:21`). Any startup message FR2-05 adds **must** go to stderr (`console.error`). | |
| B12 | Other engine constructors use the defaults: `agent/src/core/agent-loop.ts:116`, `agent/src/kernel/runtime-services.ts:67`, `agent/src/recovery/recovery-engine.ts:44` and `browser/src/skills/browser-skills-library.ts:16`. So `agent.runGoal` keeps the default temp-root sandbox and ignores the env roots. That fails safe (stricter); it's documented, not changed. `apps/server` constructs `new SutradharRuntime()` in three places; it's unchanged and still uses the default. | |

### 0.1 Decisions (to record in decisions.md)

**D1. Security model.**
- **Why the allowlist exists.** It stops an agent whose only filesystem-write capability is `browser.download_file`, and who may be steered by a hostile page, from writing into arbitrary directories.
- **MCP keeps it.** The agent chooses `downloadDir`, so that value stays restricted to the configured roots: option > env > default. No MCP input can widen them.
- **Why the CLI destination is safe to auto-allow.** The directory in `sutradhar download <ref> <dir>` was typed by whoever runs the shell command. That principal can already write anywhere with `cp`, `curl` or `>`, so the allowlist gives no protection against it, and refusing the documented argument only breaks the CLI.
- **The page cannot choose the destination.** It can only influence the *filename*. That's handled by Chrome's own name sanitising plus the B6 `basename` and containment assertion, proved by negative case N9.
- **An MCP-only agent can't reach the CLI path.** The CLI is only reachable by something that has a shell.
- **Scope of the CLI grant.** Exactly one directory, `path.resolve(process.cwd(), dir)`, is appended to that single CLI process's runtime roots, for the `download` verb only. It is not written to `CliState` and not passed to any other verb. B7's reset means Chrome doesn't keep writing there after the command either.

**D2. Env var format.**
- Entries are separated by `path.delimiter`: `;` on win32, `:` on POSIX. Windows paths contain `:`, and commas are legal in file names on every OS, so the comma convention of `SUTRADHAR_ALLOWED_DOMAINS` can't be reused. `path.delimiter` is the `PATH` convention users already know.
- Entries are trimmed, and empty entries are dropped. An empty or all-delimiter value counts as **unset**.
- **Only absolute entries are accepted**, after tilde expansion. A relative entry makes startup fail with an error naming the variable and the entry. The MCP server's cwd is whatever the client happens to spawn it with, so resolving against it would be a silent trap. FR2-14's config file will resolve relative paths against the config file's directory instead.
- Tilde: a leading `~` alone, or `~/` or `~\`, expands to `os.homedir()`, because MCP JSON configs aren't shell-expanded. `~user` is not supported and is treated as relative, which is an error.
- Nonexistent directories are **not created** at startup. For downloads, CDP creates the target on first use. For uploads, a nonexistent root simply matches nothing.
- An entry containing `,` triggers one stderr warning that the separator is `path.delimiter`. The entry is kept as-is.
- **Env roots REPLACE the default.** This mirrors the existing `SutradharRuntimeOptions.allowedDownloadRoots` semantics (`?? default`, engine `:153`) and least privilege. The **first** entry becomes the default destination when `downloadDir` is omitted. To keep the temp default, list it explicitly.
- Don't make the bare OS temp root the first entry. Chrome cancels downloads targeted there (engine comment `:120-124`); this is documented, not changed.

**D3. Containment.** One shared helper, `canonicalizePath`, runs `realpath` on the deepest *existing* ancestor and re-appends the missing tail.
- If a component along the walk exists as a link (`lstat` succeeds) but `realpath` gives ENOENT, it's a dangling link, and the check **rejects** it.
- Any other `realpath` error (EACCES, ELOOP, …) also rejects (fail closed).
- Both the candidate and every root are canonicalised. A root that can't be canonicalised is skipped.
- `isPathWithinRoot` is based on `path.relative` and uses `path.win32`/`path.posix` according to an injectable platform. It case-folds on win32 only, rejects a result that is absolute (other drive, `\\?\` device path), `..`, or starts with `..<sep>`, and allows `''`.
- The value **sent to CDP stays `resolved`**, not the canonical form. That keeps existing test `browser-action-engine.spec.ts:1689-1714` green (on macOS `/tmp` would canonicalise to `/private/tmp`).
- Residual TOCTOU (a local process swapping a directory for a link between the check and Chrome's write) is out of scope. The threat is a hostile page, not a local attacker with write access. This is documented.

**D4. Uploads.** `SUTRADHAR_ALLOWED_UPLOAD_ROOTS` **turns the upload allowlist on**; unset means unrestricted, as today. This is an opt-in restriction, and README, SECURITY.md and the tool descriptions say so explicitly. It applies to `upload_file` and `upload_file_via_trigger`. The CLI honours it too, and does **not** auto-allow a CLI-named upload file: the operator opted in to enforcement, and the auto-allow exists only because the *download* sandbox is on by default and blocked the documented CLI argument.

**D5. SDK.**
- `launch()` gains `allowedDownloadRoots` and `allowedUploadRoots` (a passthrough).
- Because of B9, add `Page.download(selector, {downloadDir?})` returning `{filename, path, downloadDir}`, and `Page.uploadFile(selector, filePath)`. Both **throw** on failure, matching FR2-01's D3 for `waitForSelector`. Without them the options are dead.
- The SDK **does not read the env vars**, following the precedent that it doesn't read `SUTRADHAR_ALLOWED_DOMAINS`. A library silently changing its sandbox based on the host app's ambient environment would be surprising. Env vars are operator configuration for the `sutradhar-mcp` and `sutradhar` processes.

**D6. One option source.** `resolveFsRoots()` in `@sutradhar/capability-runtime` is the only place layers are resolved (option > env > default, first defined layer wins, no merging), and the MCP server, CLI and SDK all call it. FR2-14 inserts one `config` layer (`{allowedDownloadRoots?, allowedUploadRoots?, baseDir}`) between env and default, and adds `'config'` to `RootSource`. No caller changes shape. The CLI's per-command directory is appended *after* resolution; it's a per-invocation grant, not a root setting.

**D7. Path reporting.**
- The engine returns `outputData {downloadedFilename, downloadedPath, downloadDir}`, all absolute, and prefers CDP `filePath` (B6).
- MCP returns the whole `ActionResult` as JSON, so the path is at `output.downloadedPath`. The tool description says so.
- The CLI prints `Downloaded "<name>" to <absolute path>`, with the path passed through `path.resolve`.
- The SDK returns `{filename, path, downloadDir}`, reusing the `DownloadResult` type.

---

## 1. Files

| # | File | Change |
|---|---|---|
| 1 | `packages/browser/src/actions/path-containment.ts` (new) | `isPathWithinRoot`, `canonicalizePath`, `findContainingRoot`, `DEFAULT_DOWNLOAD_ROOT_DIRNAME`, `defaultDownloadRoot()` |
| 2 | `packages/browser/src/actions/index.ts` | `export * from './path-containment.js'` |
| 3 | `packages/browser/src/actions/browser-action-engine.ts` | Remove the local `isPathWithinRoot` (`:25-41`) and import it. The constructor default uses `defaultDownloadRoot()`. `assertUploadPathAllowed` (`:165-184`) and `resolveDownloadDir` (`:201-217`) use `findContainingRoot`. The `download_file` case (`:870-931`) gets guid filtering, `filePath`, `basename`, the containment assertion and the `finally` reset. Error text is updated. |
| 4 | `packages/capability-runtime/src/fs-roots.ts` (new) | `parseRootsEnv`, `resolveFsRoots`, env-name constants, `RootSource` |
| 5 | `packages/capability-runtime/src/index.ts` | `export * from './fs-roots.js'`; re-export `defaultDownloadRoot` from `@sutradhar/browser` |
| 6 | `packages/capability-runtime/src/runtime.ts` | JSDoc `:84-98` and `:807-810`. `assertUploadPathAllowed` (`:1372-1389`) delegates to `findContainingRoot`. The `realpath` import (`:30`) goes if it becomes unused. |
| 7 | `packages/mcp-server/src/server.ts` | `CreateServerOptions` gets the two fields. `createSutradharServer` calls `resolveFsRoots` and prints warnings to stderr. |
| 8 | `packages/mcp-server/src/tools.ts` | `ERROR_HINTS` (`:58`, plus an upload entry); descriptions for `download_file` (`:887-896`), `upload_file` (`:808-815`) and `upload_file_via_trigger` (`:1432-1442`) |
| 9 | `packages/cli/src/download-roots.ts` (new) | Pure `cliDownloadGrant(configured, explicitDir, cwd)` and `assertDownloadDirUsable(dir)` |
| 10 | `packages/cli/src/cli.ts` | `withSession` gains optional `opts`, resolves roots, and spreads them into the runtime options. `cmdDownload` changes. Help text: the `download` line (`:886`) and a new `Environment:` paragraph after `:948`. |
| 11 | `packages/sutradhar/src/browser.ts` | `LaunchOptions` gets two fields (after `:39`) |
| 12 | `packages/sutradhar/src/index.ts` | `launch()` (`:45`) uses `resolveFsRoots({options})`; export `DownloadResult` and `PageDownloadOptions` |
| 13 | `packages/sutradhar/src/page.ts` | `Page.download` and `Page.uploadFile` |
| 14 | Tests (new): `browser/tests/unit/path-containment.spec.ts`, `capability-runtime/tests/unit/fs-roots.spec.ts`, `cli/tests/unit/download-roots.spec.ts`, `sutradhar/tests/unit/launch-options.spec.ts` | §4 |
| 15 | Tests (append only): `browser/tests/unit/browser-action-engine.spec.ts`, `capability-runtime/tests/unit/runtime.spec.ts`, `mcp-server/tests/unit/server.spec.ts` (the mock factory changes, see §4.5), `mcp-server/tests/unit/tools.spec.ts`, `sutradhar/tests/unit/api.spec.ts` | §4 |
| 16 | `tools/scenario-suite/fixtures/fr2-05-download-server.mjs` (new) | §3 |
| 17 | `tools/scenario-suite/verify-fr2-05-download-roots.mjs` (new) | §5 |
| 18 | Docs: `SECURITY.md:19-28`; `packages/mcp-server/README.md` (`:61` row and the config table `:178-185`); `packages/cli/README.md:73,84` plus an env note; `packages/sutradhar/README.md` (launch options table near `:109`, and the Page table); `AGENT_SETUP.md` and `packages/sutradhar/AGENT_SETUP.md` (they are identical; one sentence under the CLI section `:111`) | Docs match behavior |
| 19 | `.ai/loop/field-report-2/evidence/FR2-05/changelog-fragment.md` (new) | New env vars, SDK methods and options, CLI auto-allow, B2 fail-closed fix, B7 reset |

**Not touched:**
- `parse-args.ts`: there are no new flags.
- `state.ts`: nothing is persisted.
- `spawn-chrome.ts` and `mcp-server/src/cli.ts`: a throw from `createSutradharServer` already reaches `main().catch` → `fatal` → exit 1.
- The `agent` package (B12).
- `apps/server`.

---

## 2. API / CLI / env diff

### 2.1 `path-containment.ts` (new, `@sutradhar/browser`)
```ts
export const DEFAULT_DOWNLOAD_ROOT_DIRNAME = 'sutradhar-downloads';
export function defaultDownloadRoot(): string;          // path.join(os.tmpdir(), DEFAULT_DOWNLOAD_ROOT_DIRNAME), evaluated at call time
export function isPathWithinRoot(candidate: string, root: string, platform: NodeJS.Platform = process.platform): boolean;
//   p = win32 ? path.win32 : path.posix; case-fold both on win32 only; rel = p.relative(r, c);
//   rel === '' → true; p.isAbsolute(rel) → false; rel === '..' || rel.startsWith('..' + p.sep) → false; else true
export async function canonicalizePath(p: string): Promise<string>;
//   abs = path.resolve(p); walk up: realpath(cur) ok → join(real, ...tail);
//   ENOENT/ENOTDIR → if (await lstat(cur) succeeds) throw new Error(`broken symlink/junction at "${cur}"`); else push basename, cur = dirname;
//   other errors → rethrow; reached the fs root without success → return abs
export async function findContainingRoot(candidate: string, roots: readonly string[]): Promise<string | undefined>;
//   c = await canonicalizePath(candidate) (throws propagate); for each root: r = await canonicalizePath(root).catch(() => undefined); skip undefined; isPathWithinRoot(c, r) → return root
```

### 2.2 Engine
```ts
// BEFORE :153  (allowedDownloadRoots ?? [path.join(os.tmpdir(), 'sutradhar-downloads')]).map(r => path.resolve(r))
// AFTER        (allowedDownloadRoots?.length ? allowedDownloadRoots : [defaultDownloadRoot()]).map(r => path.resolve(r))
//   (an explicit [] used to crash at `this.allowedDownloadRoots[0]!`; it now means the default)

// resolveDownloadDir AFTER:
const resolved = requested ? path.resolve(requested) : this.allowedDownloadRoots[0]!;
let hit: string | undefined; let why = '';
try { hit = await findContainingRoot(resolved, this.allowedDownloadRoots); } catch (e) { why = `: ${(e as Error).message}`; }
if (hit) return resolved;                              // CDP still gets `resolved` (D3)
throw new Error(`downloadDir "${requested ?? resolved}" is outside the allowed download directories ` +
  `(${this.allowedDownloadRoots.join(', ')})${why}. Pass a path under one of these, or configure more roots ` +
  `(SutradharRuntimeOptions.allowedDownloadRoots; SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS for the sutradhar-mcp server and CLI).`);
// assertUploadPathAllowed: the same, via findContainingRoot; the message keeps "is outside the allowed upload directories"
```

`download_file` case, after the change:

```ts
let beganGuid: string | undefined;
onWillBegin = (evt: { guid: string; suggestedFilename: string }) => { beganGuid ??= evt.guid; suggestedFilename = evt.suggestedFilename; };
onProgress = (evt: { state: string; guid: string; filePath?: string }) => {
  if (beganGuid !== undefined && evt.guid !== beganGuid) return;      // another download in the same browser
  ... completed: const name = path.basename(suggestedFilename ?? evt.guid);
               const full = evt.filePath ? path.resolve(evt.filePath) : path.join(downloadDir, name);
               resolve({ filename: path.basename(full), path: full });
};
// after `await downloadPromise`: if (!isPathWithinRoot(path.resolve(downloaded.path), path.resolve(downloadDir)) && !(await findContainingRoot(downloaded.path, [downloadDir])))
//   throw new Error(`Download reported a file outside the download directory "${downloadDir}": ${downloaded.path}`);
// finally: await client.send('Browser.setDownloadBehavior', { behavior: 'default' }).catch(() => {}); await client.detach().catch(() => {});
```

The output keys are unchanged: `{ downloadedFilename, downloadedPath, downloadDir }`.

### 2.3 `fs-roots.ts` (new, `@sutradhar/capability-runtime`)
```ts
export const DOWNLOAD_ROOTS_ENV = 'SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS';
export const UPLOAD_ROOTS_ENV = 'SUTRADHAR_ALLOWED_UPLOAD_ROOTS';
export type RootSource = 'option' | 'env' | 'default';            // FR2-14 adds 'config'
export interface FsRootsOptions { allowedDownloadRoots?: readonly string[]; allowedUploadRoots?: readonly string[] }
export interface ResolveFsRootsInput {
  options?: FsRootsOptions;                 // SDK launch() / createSutradharServer options; relative → path.resolve (today's behavior)
  env?: Record<string, string | undefined>; // omitted → env layer skipped (SDK)
  // FR2-14: config?: FsRootsOptions & { baseDir: string };
  platform?: NodeJS.Platform; homedir?: string;   // injectable for tests
}
export interface ResolvedFsRoots {
  allowedDownloadRoots: string[];           // never empty; the default is [defaultDownloadRoot()]
  allowedUploadRoots: string[] | undefined; // undefined = unrestricted
  sources: { download: RootSource; upload: RootSource | 'unrestricted' };
  warnings: string[];
}
export function parseRootsEnv(name: string, raw: string | undefined, platform?: NodeJS.Platform, homedir?: string): { roots: string[] | undefined; warnings: string[] };
//   splits on (platform==='win32' ? ';' : ':'); throws Error(`${name}: entry "${e}" must be an absolute path (entries are separated by "${delim}")`)
export function resolveFsRoots(input: ResolveFsRootsInput): ResolvedFsRoots;   // an empty options array counts as unset
```

### 2.4 MCP `server.ts`
```ts
// CreateServerOptions += 
allowedDownloadRoots?: readonly string[];  // JSDoc: also SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS (path.delimiter-separated, absolute, ~ ok); REPLACES the default <tmp>/sutradhar-downloads; first = default destination; ignored if `runtime` is supplied
allowedUploadRoots?: readonly string[];    // JSDoc: also SUTRADHAR_ALLOWED_UPLOAD_ROOTS; setting it TURNS ON the upload allowlist (unset = unrestricted)
// createSutradharServer, before `const runtime`, only when !options.runtime:
const fsRoots = resolveFsRoots({ options: { allowedDownloadRoots: options.allowedDownloadRoots, allowedUploadRoots: options.allowedUploadRoots }, env: process.env });
for (const w of fsRoots.warnings) console.error(`[sutradhar-mcp] warning: ${w}`);   // stderr only (B11)
new SutradharRuntime({ ..., allowedDownloadRoots: fsRoots.allowedDownloadRoots, allowedUploadRoots: fsRoots.allowedUploadRoots })
```

A `throw` from `resolveFsRoots` propagates, so the server prints `[sutradhar-mcp] fatal: Error: SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: entry "out" must be an absolute path …` and exits 1.

### 2.5 MCP `tools.ts`
- Hint at `:58`: `'Pass a downloadDir under one of the listed roots, or omit it to use the first (default) root. Only the server operator can add roots (SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS).'`
- New hint: `['outside the allowed upload directories', 'Uploads are restricted by the server operator (SUTRADHAR_ALLOWED_UPLOAD_ROOTS); use a file under one of the listed directories.']`
- `download_file` description: `'Click an element that triggers a file download and wait for it to finish on disk. Returns output.downloadedPath (absolute path of the saved file). The destination must be inside an allowed download root; anything else is rejected.'`
- `downloadDir` description: `'Destination directory. Must resolve (symlinks/junctions followed) inside an allowed root. Defaults to the first allowed root: <OS temp>/sutradhar-downloads unless the operator set SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS.'`
- `filePath` description, on both upload tools: `'Absolute path to the local file to upload. Unrestricted unless the operator set SUTRADHAR_ALLOWED_UPLOAD_ROOTS, in which case it must be under one of those directories.'`
- The tool count is unchanged.

### 2.6 CLI
```ts
// download-roots.ts (new)
export function cliDownloadGrant(configured: readonly string[], explicitDir: string | undefined, cwd: string):
  { roots: string[]; downloadDir: string | undefined };
//   explicitDir ? { roots: [...configured, path.resolve(cwd, explicitDir)], downloadDir: path.resolve(cwd, explicitDir) } : { roots: [...configured], downloadDir: undefined }
export async function assertDownloadDirUsable(dir: string): Promise<void>; // stat ok && !isDirectory() → throw `"${dir}" exists and is not a directory`; ENOENT → ok

// cli.ts
async function withSession<T>(fn, opts?: { extraDownloadRoots?: readonly string[] }): Promise<T>
//   first statement (FR2-04: before the dialog gate):
//   let fsRoots; try { fsRoots = resolveFsRoots({ env: process.env }); } catch (e) { printErrorAndExit((e as Error).message); }
//   for (const w of fsRoots.warnings) console.error(`Warning: ${w}`);
//   runtime options literal gains:
//     allowedDownloadRoots: [...fsRoots.allowedDownloadRoots, ...(opts?.extraDownloadRoots ?? [])],
//     allowedUploadRoots: fsRoots.allowedUploadRoots,
// cmdDownload AFTER:
const grant = cliDownloadGrant(resolvedConfiguredRootsPlaceholder /* resolved inside withSession */, downloadDir, process.cwd());
```

Simplest concrete form: `cmdDownload` computes `dir = downloadDir ? path.resolve(downloadDir) : undefined`, runs `if (dir) await assertDownloadDirUsable(dir)` (on a throw it calls `printErrorAndExit`), then:

```ts
await withSession(async (runtime, sid) => { … runtime.downloadFile(sid, ref!, dir) … }, { extraDownloadRoots: dir ? [dir] : [] })
```

On success it prints `Downloaded "${output.downloadedFilename}" to ${path.resolve(output.downloadedPath)}`. The failure text is unchanged.

`cliDownloadGrant` is the tested pure form of exactly that computation; `cmdDownload` must use it.

**Help text:**
- `download <ref> [dir]  Click an element that triggers a download; print the saved file's absolute path. [dir] (relative to the current directory) is always allowed for this command; without it the file goes to the first allowed download root.`
- A new paragraph after the state paragraph:

```
Environment:
  SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS  Directories downloads may go to, separated by ";" on Windows or ":" elsewhere; absolute paths or ~.
                                     Replaces the default <temp>/sutradhar-downloads; the first entry is the default destination.
  SUTRADHAR_ALLOWED_UPLOAD_ROOTS    If set, "upload" may only read files under these directories (off by default).
```

### 2.7 SDK
```ts
// LaunchOptions +=
allowedDownloadRoots?: readonly string[]; // JSDoc: dirs page.download() may write to; replaces the default <tmp>/sutradhar-downloads; first = default destination. The SDK does NOT read SUTRADHAR_ALLOWED_* env vars.
allowedUploadRoots?: readonly string[];   // JSDoc: if set, page.uploadFile() may only read files under these (unset = unrestricted)
// index.ts :45
const fsRoots = resolveFsRoots({ options: { allowedDownloadRoots: options.allowedDownloadRoots, allowedUploadRoots: options.allowedUploadRoots } });
const runtime = new SutradharRuntime({ allowedDomains: options.allowedDomains, allowedDownloadRoots: fsRoots.allowedDownloadRoots, allowedUploadRoots: fsRoots.allowedUploadRoots });
// page.ts
export interface PageDownloadOptions { downloadDir?: string }
public async download(selector: string, options?: PageDownloadOptions): Promise<DownloadResult>
//   r = await runtime.downloadFile(sessionId, selector, options?.downloadDir, tabId); if (!r.success) throw new Error(r.error ?? `download("${selector}") failed`);
//   return { filename: String(o.downloadedFilename), path: String(o.downloadedPath), downloadDir: String(o.downloadDir) }
public async uploadFile(selector: string, filePath: string): Promise<void>   // runtime.uploadFile(..., path.resolve(filePath), tabId); throws on !success
```

---

## 3. Fixture: `tools/scenario-suite/fixtures/fr2-05-download-server.mjs`

The module exports `startDownloadServer(): Promise<{ origin, pageUrl(caseId, opts), served, close() }>`, bound to `127.0.0.1:0`.

- **`GET /page?case=<id>&name=<fname>`** returns HTML containing:
  - `<a id="dl" href="/file?case=<id>&name=<enc fname>">download</a>`
  - `<a id="dl-evil" href="/file?case=<id>&name=..%2F..%2Fevil-<id>.txt">evil</a>`
  - `<input type="file" id="f">` and `<button id="pick" onclick="document.getElementById('f').click()">pick</button>`
  - `<div id="out"></div>`, plus a `change` listener on `#f` that writes `name:size` into `#out`.

  Per-case uniqueness goes **only in the query string** (the FR2-01 gotcha).
- **`GET /file?case=<id>&name=<fname>`** builds a body of `fr2-05 case=<id> req=<n>\n` plus `crypto.randomBytes(65536)`, so every request is unique, including repeats of the same case. It sets these headers:
  - `Content-Type: application/octet-stream`
  - `Content-Length`
  - `Content-Disposition: attachment; filename="<fname as given>"`
  - `Cache-Control: no-store`

  It pushes `{caseId, req:n, name, size, sha256}` onto `served`.
- `served` is the independent ground truth. The verify script never trusts the tool's report for content.

---

## 4. Unit tests

Everything here is additive. No existing assertion is changed. The four existing `download_file` tests (`browser-action-engine.spec.ts:1680-1830`) and the upload tests (`:381-445`) must pass **unmodified**.

### 4.1 `browser/tests/unit/path-containment.spec.ts` (new; real fs under `mkdtemp(os.tmpdir())`, removed in `afterAll`)
- **PC1 (win32, platform injected):**
  - `('C:\\out\\a','C:\\out')` → true
  - `('C:\\out','C:\\out')` → true
  - `('C:\\out-evil','C:\\out')` → false
  - `('C:\\OUT\\a','c:\\out')` → true
  - `('D:\\out\\a','C:\\out')` → false
  - `('C:\\x','C:\\')` → true
  - `('\\\\?\\C:\\out\\a','C:\\out')` → false
  - `('C:\\out\\..foo','C:\\out')` → true
  - `('C:\\x','C:\\out')` → false
- **PC2 (posix):**
  - `('/out/a','/out')` → true
  - `('/out-evil','/out')` → false
  - `('/OUT/a','/out')` → false
  - `('/etc','/')` → true
  - `('/','/out')` → false
- **PC3:** `canonicalizePath(join(tmp,'nope','deeper'))` === `join(realpathSync.native(tmp),'nope','deeper')`.
- **PC4:** create `root/jn` → `outside` (`'junction'` on win32, `'dir'` symlink on POSIX). `canonicalizePath(join(root,'jn','newsub'))` === `join(realpathSync.native(outside),'newsub')`.
- **PC5:** a dangling link `root/dj` (target created, linked, then removed). `canonicalizePath(join(root,'dj','sub'))` rejects with `/broken symlink\/junction/`.
- **PC6:**
  - `findContainingRoot(join(root,'a'), [root])` === root
  - `findContainingRoot(join(root,'jn','x'), [root])` → undefined
  - `findContainingRoot(x, ['<root>-missing', root])` still returns root, because unresolvable roots are skipped
- **PC7:** `defaultDownloadRoot()` === `path.join(os.tmpdir(),'sutradhar-downloads')`.

### 4.2 `browser-action-engine.spec.ts` (append inside the `download_file` describe, reusing `mockCdpClient`, `mockHandle` and `singleFramePage`)
- **E1:** root is a real temp dir containing a junction or symlink `jn` → outside, and `downloadDir = root/jn/newsub`.
  - `success` false
  - `error` contains `'outside the allowed download directories'`
  - the `createCDPSession` mock has **not** been called
  - `existsSync(outside/newsub)` false
- **E2:** `downloadDir = root + '-evil'` → rejected with the same substring.
- **E3:** `downloadDir = join(root,'..','x')` → rejected.
- **E4:** events `willBegin {guid:'g1', suggestedFilename:'r.pdf'}` then `progress {guid:'g1', state:'completed', filePath: join(dir,'r (1).pdf')}` → `downloadedPath === join(dir,'r (1).pdf')` and `downloadedFilename === 'r (1).pdf'`.
- **E5:** `willBegin g1 a.pdf`, then `progress {guid:'g2', state:'completed'}`, then after 50 ms the promise is still pending (race it against a 20 ms timer), then `progress {guid:'g1', state:'completed'}` → `downloadedFilename === 'a.pdf'`.
- **E6:** `suggestedFilename: '../../evil.txt'` with no `filePath` → `downloadedPath === join(dir,'evil.txt')`.
- **E7:** `filePath: '/elsewhere/x.bin'` (outside `dir`) → `success` false, `error` contains `'outside the download directory'`.
- **E8:**
  - after success, `client.send` has been called with `('Browser.setDownloadBehavior', {behavior:'default'})`
  - its `invocationCallOrder` is lower than `client.detach`'s
  - the same holds after a `canceled` failure
- **E9:** `upload_file` with `filePath = root/jn/secret.txt` (the real file lives in `outside`) and `allowedUploadRoots [root]` → `error` contains `'outside the allowed upload directories'`.
- **E10:** `new BrowserActionEngine(u,u,u,[])` with no `downloadDir`. Events complete → success, and `setDownloadBehavior` has `downloadPath === defaultDownloadRoot()`. This covers the old crash on an empty array.

### 4.3 `capability-runtime/tests/unit/fs-roots.spec.ts` (new)
- **R1:** `parseRootsEnv(N,'C:\\a;D:\\b','win32')` → `['C:\\a','D:\\b']`.
- **R2:** `('/a:/b','linux')` → `['/a','/b']`.
- **R3:** `(' /a : :/b ','linux')` → `['/a','/b']`.
- **R4:** `('out','linux')` throws. The message contains the var name, `"out"` and `absolute`.
- **R5:**
  - `('~','linux','/h')` → `['/h']`
  - `('~/dl','linux','/h')` → `['/h/dl']`
  - `('~bob/x','linux','/h')` throws
- **R6:** `''`, `undefined` and `(';;','win32')` all give `roots: undefined`.
- **R7:** `('/a,/b','linux')` → roots `['/a,/b']`, and `warnings[0]` contains `'":"'`.
- **R8:** precedence.
  - options `['/o']` plus env download `/e` → `['/o']`, source `option`
  - env only → `['/e']`, source `env`
  - neither → `[defaultDownloadRoot()]`, source `default`
  - upload unset → `undefined`, source `unrestricted`
- **R9:** options `{allowedDownloadRoots: []}` plus env `/e` → `['/e']`.
- **R10:** with `env` omitted, even when `process.env[DOWNLOAD_ROOTS_ENV]='/e'` → source `default`.
- **R11:** relative options entries are resolved against `process.cwd()`, which is today's behavior.

### 4.4 `capability-runtime/tests/unit/runtime.spec.ts` (append)
- **RT1:** `new SutradharRuntime({allowedUploadRoots:[root]})`. `(runtime as any).assertUploadPathAllowed(join(root,'jn','secret.txt'))` rejects with `'outside the allowed upload directories'`.
- **RT2:** the same for `join(root,'ok.txt')`, which resolves.
- **RT3 (win32 only):** a root passed as `root.toUpperCase()` still accepts `join(root,'ok.txt')`. This is the regression for B5.

### 4.5 `mcp-server/tests/unit/server.spec.ts`
**Required harness change, stated explicitly:** the factory at `:18-20` becomes

```ts
vi.mock('@sutradhar/capability-runtime', async (importOriginal) => ({ ...(await importOriginal<object>()), SutradharRuntime: capabilityRuntimeMock.SutradharRuntimeMock }))
```

so that the real `resolveFsRoots` exists. Without it, every existing test in the file would break once `server.ts` imports the resolver. It adds real exports; no assertion is touched.

A new describe `fs roots wiring` whose `beforeEach` deletes both env vars. The paths are built from `os.tmpdir()` and joined with `path.delimiter`.
- **MS1:** no env → `allowedDownloadRoots` toEqual `[join(tmpdir,'sutradhar-downloads')]`, and `allowedUploadRoots` is undefined.
- **MS2:** download env with two absolute dirs → toEqual those, in that order.
- **MS3:** upload env → `allowedUploadRoots` toEqual the list.
- **MS4:** an explicit `allowedDownloadRoots` option beats env.
- **MS5:** env `'relative-dir'` → `createSutradharServer` rejects with `/SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS.*absolute/`, and the runtime mock has not been called.
- **MS6:** `runtime` supplied plus env `'relative-dir'` → resolves without throwing.

### 4.6 `mcp-server/tests/unit/tools.spec.ts` (append)
- **T1:** `downloadFile` is mocked to resolve `{success:false, error:'downloadDir "X" is outside the allowed download directories (Y). …'}`. `parsed.error` contains `'Hint:'` and `'SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS'`.
- **T2:** `uploadFile` resolves the upload-outside error, and the hint contains `'SUTRADHAR_ALLOWED_UPLOAD_ROOTS'`.
- **T3:** the `browser.download_file` description plus the `downloadDir` description (read through the same captured config the existing description test uses) do not contain `'Defaults to the OS temp directory'`, and do contain `'sutradhar-downloads'` and `'downloadedPath'`.
- The tool-count test is unchanged.

### 4.7 `cli/tests/unit/download-roots.spec.ts` (new)
- **CL1:** `cliDownloadGrant(['/c'],'./out','/w')` → `{roots:['/c', path.resolve('/w','out')], downloadDir: path.resolve('/w','out')}`.
- **CL2:** with `undefined` → `{roots:['/c'], downloadDir:undefined}`.
- **CL3:** the input array isn't mutated (`Object.freeze` input).
- **CL4:** `assertDownloadDirUsable` on an existing file rejects `/not a directory/`; it resolves on a nonexistent path and on an existing directory.

### 4.8 SDK
**`api.spec.ts` (append), against a stub runtime:**
- **SD1:** `download('#dl',{downloadDir:'/x'})` calls `downloadFile('sess-1','#dl','/x','tab-1')` and returns `{filename:'a.txt', path:'/x/a.txt', downloadDir:'/x'}`.
- **SD2:** `success:false, error:'E'` → rejects with `'E'`.
- **SD3:** `uploadFile('#f','rel.txt')` calls `uploadFile('sess-1','#f', path.resolve('rel.txt'),'tab-1')`; `success:false` → rejects.

**`launch-options.spec.ts` (new):** mock `@sutradhar/capability-runtime` with `importOriginal` and a `SutradharRuntime` whose `launch` resolves `{hasRealBrowser:true, sessionId:'s'}`.
- **SL1:** `launch({allowedDownloadRoots:['/d'], allowedUploadRoots:['/u']})` → the constructor options match `{allowedDownloadRoots:[path.resolve('/d')], allowedUploadRoots:[path.resolve('/u')]}`.
- **SL2:** with `process.env.SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS` set and no options → `allowedDownloadRoots` toEqual `[defaultDownloadRoot()]`.
- Restore the env and close the browsers in `afterEach`.

---

## 5. Live-verify script: `tools/scenario-suite/verify-fr2-05-download-roots.mjs`

Drives the worktree dist only:
- `packages/cli/dist/cli.js`
- `packages/mcp-server/dist/cli.js` (over stdio, reusing the FR2-01 script's MCP client helper)
- `packages/sutradhar/dist/index.js`

**Setup.**
- `R = mkdtemp(os.tmpdir()/fr2-05-)`.
- Child env for every spawn is `{...process.env, TEMP:R/temp, TMP:R/temp, TMPDIR:R/temp, SUTRADHAR_CLI_STATE_ROOT:R/state-root}`, with both `SUTRADHAR_ALLOWED_*` **deleted** unless a case sets them. FR2-03 provides `STATE_ROOT`. The script process sets the same `TEMP`/`TMP`/`TMPDIR` on itself before importing the SDK.
- Start the fixture server.
- **`check(file, served)`** is the independent check:
  - `fs.stat(file).size === served.size`
  - `sha256(readFile(file)) === served.sha256`
  - the file is inside the expected dir, compared via `realpathSync.native` and case-folded on win32
  - `served` is the last entry for that case
- Every case records `{id, pass, detail}`. Output goes to `evidence/FR2-05/live-verify.json`, and the process exits non-zero if any case fails.

**CLI** (cwd `R/work`, created before the run):

| id | steps | assert |
|---|---|---|
| L1 relative | `nav <page?case=L1&name=l1-<nonce>.bin>` → `download "#dl" ./out` | exit 0. stdout matches `/^Downloaded "(.+)" to (.+)$/m`. The captured path is absolute and equals `R/work/out/<name>`. `check()` passes. `readdir(R/work/out)` equals `[<name>]` exactly. |
| L2 absolute | `download "#dl" <R/abs-dl>` (doesn't exist beforehand; outside temp) | the same, in `R/abs-dl` |
| L3 no dir | `download "#dl"` | lands in `R/temp/sutradhar-downloads`; `check()` passes |
| L4 same name twice | `nav ?case=L4&name=same.bin` → `download "#dl" ./out4` twice | both exit 0. The second reported path passes `check()` against the **second** served entry. If Chrome uniquified the name, the reported path is the uniquified file (the B6 proof). |
| L5 not persisted | after L1, `download "#dl" <R/other>` | fails with `outside the allowed download directories`? **No, `R/other` is the explicit dir, so it succeeds.** What L5 really asserts: a following `download "#dl"` with **no** dir, in a new process, lands in the default root and **not** in `./out`. That proves the grant didn't carry over through CLI state. |
| L6 env honoured by CLI | `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS=R/cli-env`, `download "#dl"` | lands in `R/cli-env` |
| L7 not a directory | `download "#dl" ./afile` where `afile` is a real file | exit 1; `not a directory`; the file's contents are unchanged |
| L8 | `close` | exit 0 |

**MCP A** (env `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS = R/allowA + delimiter + R/allowB`):

| id | call | assert |
|---|---|---|
| M1 | `download_file {downloadDir: R/allowB/sub}` | `success` true; `output.downloadedPath` is inside `R/allowB/sub`; `check()` passes |
| M2 | no `downloadDir` | lands in `R/allowA` (the env **replaced** the default, and the first entry is the destination) |
| M3 outside | `downloadDir: R/outside` | `success` false. `error` contains `outside the allowed download directories`, `R/allowA`, and `Hint:` … `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS`. `existsSync(R/outside)` is false. **No** `served` entry for M3, because the check runs before the click. |
| M4 old default | `downloadDir: R/temp/sutradhar-downloads/x` | rejected |

**MCP B, uploads** (env `SUTRADHAR_ALLOWED_UPLOAD_ROOTS=R/up`):
- M5: `upload_file #f R/up/a.txt` succeeds, and `eval` of `#out` equals `a.txt:<size>`.
- M6: `R/elsewhere/b.txt` → `error` contains `outside the allowed upload directories` plus a hint.
- M7: `upload_file_via_trigger #pick R/elsewhere/b.txt` → `isError` with the same text.

**MCP C, no env (default preserved):**
- M8: no `downloadDir` → `R/temp/sutradhar-downloads`, `check()` passes.
- M9: `downloadDir: R/abs` → rejected.
- M10: upload of `R/elsewhere/b.txt` → success (unrestricted by default).

**MCP D, bad env:** `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS=out`. The process exits 1 within 10 s, and stderr contains `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS` and `absolute`.

**SDK:**
- S1: `launch({allowedDownloadRoots:[R/sdk], allowedUploadRoots:[R/up]})` → `goto page?case=S1`.
  - `page.download('#dl')` → `path` is inside `R/sdk`, and `check()` passes.
  - `page.download('#dl',{downloadDir:R/outside})` rejects with `/outside the allowed download directories/`.
  - `page.uploadFile('#f', R/elsewhere/b.txt)` rejects with `/outside the allowed upload directories/`.
  - `page.uploadFile('#f', R/up/a.txt)` resolves.
  - `close`.
- S2: with `process.env.SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS=R/envroot` set, `launch()` with no options → `download('#dl')` lands in `R/temp/sutradhar-downloads`, and `R/envroot` doesn't exist.

**Cleanup (always, in `finally`):**
- CLI `close`.
- MCP `browser.shutdown_all`, then end stdin and kill after 10 s.
- SDK `close()`.
- `server.close()`.
- Unlink every junction/symlink **first**, then `rm(R,{recursive:true})` with the FR2-01 `rmWithRetry`.
- List processes (`Get-CimInstance Win32_Process` on win32, `ps -eo pid,args` on POSIX) and assert no command line contains `R`. Record the count in the evidence, where it must be 0.

---

## 6. Negative cases (all live via MCP A, plus unit coverage)

| # | Input | Expected |
|---|---|---|
| N1 | Traversal `R/allowA/../outside` | rejected |
| N2 | Prefix `R/allowA-evil` (the dir exists) | rejected |
| N3 | Case variant `R/ALLOWA/sub` | win32: allowed. POSIX: rejected (case-sensitive). |
| N4 | Relative `downloadDir: 'x'` | resolved against the MCP server's cwd, which is outside the roots, so rejected |
| N5 | Device path `\\?\<R/allowA>\sub` (win32 only) | rejected (fail closed), with no crash |
| N6 | Junction/symlink that *exists*: `R/allowA/jn` → `R/outside2` | rejected (existing behavior, kept) |
| N7 | **Escape through a link with a nonexistent tail:** `R/allowA/jn/newsub` | rejected, and `R/outside2/newsub` doesn't exist. Run it **also against the pre-change build** and save that as evidence of B2. |
| N8 | Dangling junction `R/allowA/dj/sub` | rejected with the `broken symlink/junction` detail |
| N9 | Hostile filename: click `#dl-evil` (`filename="../../evil-<id>.txt"`) into `R/allowB` | the file lands directly inside `R/allowB`; no `evil-*` exists in `R` or `R/..`; the reported path equals the actual file |
| N10 | Upload through a link: `R/up/jn/secret.txt` (the real file is in `R/outside3`) | rejected |
| N11 | CLI: an MCP env var must not widen the CLI beyond its own grant. `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS=R/x` with `download "#dl" ./out` | succeeds into `./out`, and `R/x` is not created |

---

## 7. Risks and callers

**Callers of the changed APIs:**
- `resolveDownloadDir` and `assertUploadPathAllowed`: engine only.
- `runtime.assertUploadPathAllowed`: `uploadFileViaTrigger` only.
- `SutradharRuntimeOptions`: the CLI (5 constructions; only `withSession`'s changes), MCP, the SDK, and `apps/server` (×3, unchanged, so default).
- `BrowserActionEngine` constructors in `agent` and `skills` use the defaults. That is stricter and fail-safe (B12), and documented.
- `run-cli.mjs:505` UC-08 downloads into `<tmp>/sutradhar-downloads/cli-uc08-*`, which is still allowed.

**Behavior changes:**
1. **B2 fix.** A `downloadDir` that reaches outside through a link is now rejected. Anyone relying on that was relying on a sandbox escape.
2. An explicit `[]` roots option means the default instead of a crash.
3. `setDownloadBehavior` is reset to `default` after every `download_file`. Page-initiated downloads outside the tool revert to Chrome's own default, which was the state before the first `download_file`.
   - Concurrency risk: two tabs of one browser running `download_file` at the same time already race on the browser-wide `downloadPath` today. The reset can now also land mid-way through the other download. This is documented; serialising downloads per browser is left for later and logged as a minor gap.
4. The reported path may now be CDP's `filePath`, which can differ from the old `join(dir, suggestedFilename)` on a name conflict. That's the point of B6.
5. The MCP server now **fails to start** on an invalid `SUTRADHAR_ALLOWED_*` value. That's deliberate: a loud failure beats a silently wrong sandbox.

**Merge touchpoints with FR2-03 and FR2-04:**
- `cli.ts` `withSession`. FR2-03 rewrites the self-heal to `releaseSessionResources`. FR2-04 extracts it into `session-flow.ts` and builds `new SutradharRuntime({ logger, allowedDomains, dialogPolicy })` in `cli.ts`. FR2-05 adds the optional `opts` parameter to the **`cli.ts` wrapper**, puts the env resolution first (before FR2-04's gate), and adds two keys to that same literal. `withSessionFlow`'s deps are untouched.
- `cmdDownload` is a guarded verb (FR2-04 §2.10, 250 ms grace), so it's unaffected.
- The FR2-04 watchdog (300 s) is well above the download timeout (30 s).
- Help text: FR2-01 (`--state`), FR2-03 (`sessions`, `--gc`) and FR2-04 (`dialog`, exit codes) all edit the same block. FR2-05 edits only the `download` line and appends the `Environment:` paragraph after the state paragraph; any conflict is textual.
- `parse-args.ts` and `state.ts`: **no FR2-05 edits.** `CliState` must not gain root fields (D1).
- FR2-03's GC regexes (`^sutradhar-cli-\d{10,}…`, `^puppeteer_dev_chrome_profile-…`) don't match `sutradhar-downloads`. The auditor confirms GC never touches the download root.
- The live script relies on FR2-03's `SUTRADHAR_CLI_STATE_ROOT`. If FR2-03 isn't merged yet, it falls back to `SUTRADHAR_CLI_STATE_DIR=R/state`, which exists at HEAD.
- `runtime.ts`: FR2-02 (`extractData`) and FR2-04 (`dialogPolicy` option at `:73`) use adjacent hunks; FR2-05's are at `:84-98`, `:807-810` and `:1372-1389`.
- `tools.ts` `ERROR_HINTS`: FR2-01 added entries at `:45-49`. FR2-05 edits `:58` and appends one entry after it.

**Other risks:**
- `filePath` is experimental CDP ("not guaranteed to be set"), so the `join` fallback stays.
- Junction creation needs no admin rights on Windows, but a POSIX symlink test on Windows would need developer mode. Tests use `'junction'` on win32.
- `realpath` cost: at most a few syscalls per download.
- Also log in gaps.md:
  - B10 as GAP-020 (retry of policy errors and re-clicked timed-out downloads) and GAP-021 (equal inner and outer timeouts)
  - the concurrent-download reset race as GAP-022, minor

---

## 8. Rollback

- Revert the FR2-05 commit. Every change is contained in the files in §1. There are no persisted-state changes, so `state.json` needs no migration and older CLIs are unaffected.
- **If only B7's reset misbehaves on some Chrome** (for example, `behavior:'default'` rejected), delete the single `send` in `finally`; it's already `.catch`ed.
- **If the B6 guid filter drops a real completion** (Chrome sending a progress event with a different guid form), remove the filter line and keep `filePath`/`basename`.
- **Never roll back B2 alone.** If `canonicalizePath` causes false rejects, fix it forward. Reverting reopens the escape.
- Documentation reverts with the commit. The changelog fragment is deleted.

### Critical Files for Implementation
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\browser\src\actions\browser-action-engine.ts`
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\capability-runtime\src\runtime.ts`
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\mcp-server\src\server.ts`
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\cli\src\cli.ts`
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\sutradhar\src\page.ts`
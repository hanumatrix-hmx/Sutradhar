# Sutradhar Development Setup

## Prerequisites

- Node.js >= 18.0.0 (repo `engines` says 18; CI runs on 20)
- pnpm >= 9.0.0 (`packageManager` pins `pnpm@9.1.0` — use that, never npm or yarn)
- Git
- **Chrome or Edge installed** — Sutradhar drives a real system browser via Puppeteer, not a
  bundled/downloaded one. If auto-detection fails, set `CHROME_PATH`.

No database, Docker, or other local services are required. This is a pure TypeScript
monorepo; the only external dependency at runtime is a real Chrome/Edge binary, plus an LLM
provider (Ollama or OpenRouter) if you're exercising `agent.runGoal`.

## Quick start

```bash
git clone <repository-url>
cd PinchTab   # repo directory name; the product itself is branded Sutradhar

pnpm install

# Optional — only needed for agent.runGoal or the dashboard's LLM-backed features
cp .env.example .env

pnpm build       # build every package, in dependency order (via Turborepo)
pnpm test        # run every package's test suite
```

## Available commands

Root `package.json` has exactly six scripts, each delegating to Turborepo, which runs the
same-named script in every package that defines it (in dependency order, cached):

```bash
pnpm build       # turbo run build     — tsc in each package
pnpm lint        # turbo run lint      — eslint in each package
pnpm typecheck   # turbo run typecheck — tsc --noEmit in each package
pnpm test        # turbo run test      — vitest run --globals in each package
pnpm dev         # turbo run dev       — persistent, uncached; each package's own watch mode
pnpm clean       # turbo run clean     — rimraf dist in each package
```

There is no `pnpm dev:frontend`/`db:migrate`/`docker:*`/`tauri:*` — those commands don't
exist in this repo. To scope any of the above to one package:

```bash
pnpm --filter @sutradhar/browser test
pnpm --filter @sutradhar/mcp-server build
```

Note: `apps/server`'s own `dev` script is `tsc -w` (type-check/compile in watch mode only —
it doesn't start the HTTP listener). To actually run the gateway locally, build it and start
the compiled entry point directly:

```bash
pnpm --filter @sutradhar/server build
node apps/server/dist/index.js
```

`apps/frontend`'s dev server (Vite) proxies API calls to `http://localhost:8081` by default
(`VITE_API_BASE_URL`/`PORT` override it) — that's `apps/server`, not a separate hosted
backend.

## Environment variables

See `.env.example` at the repo root — it's short and accurate. The real variables:

```bash
# LLM provider for agent.runGoal (pick one; Ollama is the zero-config default)
OPENROUTER_API_KEY=sk-or-v1-...          # cloud, if set takes precedence over Ollama
SUTRADHAR_MODEL=qwen3.5:9b                # Ollama tag, or OpenRouter model id
SUTRADHAR_LLM_BASE=http://localhost:4000/v1   # any OpenAI-compatible endpoint instead
SUTRADHAR_LLM_KEY=

# Browser
CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe   # if auto-detect fails

# apps/server
PORT=8081
```

There is no `DATABASE_URL`, `REDIS_URL`, `QDRANT_URL`, or `NEXTAUTH_*` — this project doesn't
use any of those.

## Project structure

```
PinchTab/
├── .github/workflows/ci.yml   # install → typecheck → build → test, on push to master/main + every PR
├── docs/                       # This documentation
├── packages/                    # Libraries — see docs/ARCHITECTURE.md for the full graph
│   ├── contracts, utils, config, observability, events, dev-runtime  (foundational)
│   ├── capability, browser, capability-runtime, llm, memory, storage
│   ├── agent, workflow
│   └── mcp-server, sutradhar, sdk, cli, frontend    (integration surfaces)
├── apps/
│   ├── server/                 # REST API gateway for the frontend dashboard
│   └── extension/              # Plain browser extension, outside the pnpm workspace
├── tools/                       # Standalone comparison/benchmark harnesses (not published packages)
├── scripts/
├── turbo.json                   # Turborepo task graph
├── pnpm-workspace.yaml
├── tsconfig.base.json / tsconfig.json
├── vitest.config.ts
├── .env.example
└── package.json                 # 6 scripts: build/lint/typecheck/test/dev/clean
```

## TypeScript, linting, formatting

Every package has its own `tsconfig.json`, `tsc --noEmit` for `typecheck`, and its own
`eslint src/ --ext .ts` for `lint` — there's no shared `@sutradhar/configs` package; each
package's config is self-contained. Formatting is Prettier, driven from the root
devDependency (no per-package Prettier config to look for).

## Git hooks

There's no `.husky/` directory in this repo — no pre-commit/pre-push hooks are configured.
CI (`.github/workflows/ci.yml`) is the enforcement point: install, typecheck, build, test, on
every push to `master`/`main` and every pull request.

## Testing

Every package uses **Vitest** (`vitest run --globals`) for unit/integration tests — there is
no separate E2E test tier or Playwright test suite in this repo (Puppeteer is the runtime
browser-automation dependency, not a test framework here). Run the full suite with `pnpm
test`, or scope it: `pnpm --filter @sutradhar/browser test`.

For live verification beyond what a test suite can check (actually driving a real browser
through Sutradhar's own tools against a real page) — see `CLAUDE.md`'s standing verification
standard: typechecking and unit tests are necessary but not sufficient on their own.

## Troubleshooting

### Chrome/Edge not found

`BrowserLauncher` doesn't throw when no real executable is found — it silently falls back to
a no-op mock browser instance (logged at `info` level as `executablePath: "mock"`), so
real-looking calls will start returning empty/no-op results instead of a clear error. If
browser actions aren't doing anything, check the launch log line first. Set `CHROME_PATH` to
your browser's executable, or install Chrome/Edge — see
`packages/browser/src/launcher/browser-launcher.ts`'s `findExecutablePath` for the full list
of paths checked automatically per platform.

### Port conflicts

`apps/frontend`'s dev server defaults to port 3000 (`VITE_PORT`/`PORT` override it);
`apps/server` defaults to 8081 (`PORT`). If 3000 is already in use by something else on your
machine, pass `--port <N> --strictPort` to the frontend's dev command rather than assuming
3000 is free.

### TypeScript errors after a pull

```bash
pnpm clean && pnpm install && pnpm typecheck
```

### pnpm issues

```bash
pnpm store prune
rm -rf node_modules packages/*/node_modules apps/*/node_modules
pnpm install
```

### MCP session looks stale after a rebuild

If you rebuild `mcp-server` or any package it depends on, an already-connected MCP client
session keeps running the old code in memory until it's reconnected/restarted — a client
reconnect and a process restart are different things. See
`.ai/browsing-capability-loop.md` for more on this recurring gotcha.

## Useful links

- [Turborepo Docs](https://turbo.build/repo/docs)
- [pnpm Workspaces](https://pnpm.io/workspaces)
- [Vitest Docs](https://vitest.dev/guide/)
- [Puppeteer Docs](https://pptr.dev/)
- [Model Context Protocol](https://modelcontextprotocol.io)

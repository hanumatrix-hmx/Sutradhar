# PinchTab — Complete Technical Deep Dive & System Documentation

> **Auto-generated architectural reference.** This document consolidates the technical architecture, end-to-end workflows, data flow, and user lifecycles of the entire PinchTab codebase into a single source of truth.
>
> **Project**: PinchTab — Enterprise AI Browser Runtime Platform
> **Repository type**: Turborepo + pnpm-workspace hexagonal monorepo
> **Language**: TypeScript 5.4 (strict) | **Runtime**: Node.js ≥ 18 (ESM)
> **Generated**: 2026-07-30
> **Scope**: `apps/`, `packages/`, runtime behavior, data flow, and multi-user lifecycles.

---

## Table of Contents

1. [Project Summary & Honest Status](#1-project-summary--honest-status)
2. [Repository Layout & Bounded Contexts](#2-repository-layout--bounded-contexts)
3. [Technology Stack (Actual vs. Documented)](#3-technology-stack-actual-vs-documented)
4. [Package-by-Package Technical Reference](#4-package-by-package-technical-reference)
5. [Server Application — Gateway, Routes & Services](#5-server-application--gateway-routes--services)
6. [Frontend Application — Pages, Runtime & State](#6-frontend-application--pages-runtime--state)
7. [End-to-End Workflow Diagrams](#7-end-to-end-workflow-diagrams)
8. [Data Flow Diagrams](#8-data-flow-diagrams)
9. [User Lifecycle — End to End (Multiple Users)](#9-user-lifecycle--end-to-end-multiple-users)
10. [Concurrency, Memory & Persistence Model](#10-concurrency-memory--persistence-model)
11. [Security, Stealth & Policy](#11-security-stealth--policy)
12. [Evaluation & Validation Evidence](#12-evaluation--validation-evidence)
13. [Known Gaps, Stubs & Technical Debt](#13-known-gaps-stubs--technical-debt)
14. [Build, Test & Run Reference](#14-build-test--run-reference)

---

## 1. Project Summary & Honest Status

### What PinchTab is (intended)

PinchTab is an **enterprise-grade AI Browser Runtime Platform**: autonomous AI agents drive real browsers (Chromium) to complete natural-language goals — searching, navigating, filling forms, downloading, extracting data — while persisting multi-tier memory, emitting observability traces, and exposing a real-time web inspector.

### What PinchTab is (actual code state)

A **cleanly architected scaffold** with substantial working subsystems but **significant stubbed I/O**. The honest characterization:

| Subsystem | Maturity | Reality |
|---|---|---|
| Monorepo tooling, TS strict, lint, prettier | ✅ Complete | 24 packages + 2 apps build clean (`tsc --noEmit` = 0 errors) |
| Contracts / DTOs / branded types / errors | ✅ Complete | Canonical, frozen, well-typed |
| Browser engine (Puppeteer-core + real Chrome) | ✅ **Functional** | Real `puppeteer.launch()`, real screenshots, real navigation |
| Browser semantic DOM / page understanding | ✅ Functional | Real `page.evaluate()`, confidence-scored candidates |
| Stealth engine | ✅ Functional | 4 injected scripts + launch flags |
| Agent reasoning loop | ⚠️ **Heuristic, not LLM-driven** | Deterministic plan/act/verify/reflect/recover; `ILlmProvider` is wired but **never invoked** in the hot path |
| LLM adapters (OpenRouter / Ollama) | ⚠️ Stubbed | Return canned completions; no real `fetch` to providers |
| Memory (4-tier + episodic) | ⚠️ In-memory maps | `Map`-backed; cosine similarity works; no SQLite/Redis/Qdrant backing |
| Storage (SQLite client) | ⚠️ Stubbed | `query()` returns `[]`; real persistence is in-memory `Map` |
| HTTP server | ✅ Functional | Hand-rolled `node:http` (NOT Fastify despite docs) |
| REST API (16 endpoints) | ✅ Functional | Real routing, CORS, body parsing |
| Frontend (React SPA) | ✅ Functional UI / ⚠️ partial backend wiring | Embedded browser viewport streams real screenshots; action & workflow engines built but **not wired into UI** |
| Workflow engine (backend `@pinchtab/workflow`) | ⚠️ Linear only | `parallel`/`condition` node types declared but runner only follows `nextNodes[0]` |
| Eval framework (102-task benchmark) | ✅ Functional | Runs real goals, records results to `.pinchtab-eval/` |
| Real-world validation (16 live tasks) | ✅ Functional | Live URLs hit; narrative evidence partly hardcoded |

### Key contradiction to resolve

The **documentation suite** (`docs/`) and **AI state files** (`.ai/project-state.md`) claim **"100% complete, v1.0 GA, GO FOR RELEASE, zero debt."** The **actual code** shows an LLM-dormant agent, stubbed LLM/storage adapters, in-memory persistence, and several orphaned/unwired subsystems. This document reflects the **actual code**, not the marketing state. Treat `docs/00–23` as the *target architecture* and this file as the *current reality*.

---

## 2. Repository Layout & Bounded Contexts

```
PinchTab/
├── apps/
│   ├── server/                 # node:http API server (REST) + eval framework
│   └── (web/  ← documented but not present as a built app; frontend lives in packages/frontend)
├── packages/                   # 24 decoupled packages (7 bounded contexts)
│   ├── contracts/              # 🟢 Shared kernel: branded IDs, DTOs, errors, events
│   ├── capability/             # 🟢 Capability matrices & matching engine
│   ├── utils/                  # 🟢 Mutex, Semaphore, RateLimiter, retry, crypto, formatters
│   ├── config/                 # 🟢 Zod env schema, config provider, secret masker
│   ├── observability/          # 🟢 Logger, metrics, tracing, devtools inspector, studio
│   ├── events/                 # 🟢 Typed EventBus + InMemoryEventStore
│   ├── agent/                  # 🟡 AgentCore, kernel, planner, executor, evidence, recovery
│   ├── browser/                # 🟢 Puppeteer launcher, sessions, actions, DOM, stealth
│   ├── llm/                    # 🟡 ILlmProvider + OpenRouter/Ollama adapters (stubbed)
│   ├── memory/                 # 🟡 5-tier memory + episodic engine (in-memory)
│   ├── workflow/               # 🟡 DAG graph + linear runner
│   ├── storage/                # 🟡 SqliteClient (stub) + LocalFileStorage (real)
│   ├── sdk/                    # 🟡 Plugin system (signature verification = stub)
│   ├── dev-runtime/            # 🟡 @hanumatrix/dev-runtime port allocator (off-grid namespace)
│   └── frontend/               # 🟢 React SPA (the actual UI)
├── docs/                       # Target architecture docs (00–23 + 6 ADRs)
├── .ai/                        # AI operational state (over-optimistic)
├── .pinchtab-eval/             # Eval results + real-world evidence JSON
├── .pinchtab-storage/          # Runtime artifacts (downloads, summaries)
├── acceptance_artifacts/       # System acceptance test outputs
└── PROJECT_CONSTITUTION.md     # Supreme governance law
```

### The 7 Bounded Contexts (per `.ai/architecture-rules.md`)

| ID | Context | Packages | Rule |
|----|---------|----------|------|
| CTX-001 | Foundational | contracts, capability, utils, config, observability, events | Must NOT import from CTX-002..007 |
| CTX-002 | Core Domain | agent, browser, llm, memory, knowledge, prompt, workflow | Depend only on CTX-001 interfaces |
| CTX-003 | Governance | policy | (not yet implemented as a package) |
| CTX-004 | Infrastructure | tools, storage, queue, registry, plugin | (tools/queue/registry/policy/knowledge/prompt not present) |
| CTX-005 | Orchestration | orchestrator, runtime | (not present as packages; orchestration lives in `agent/`) |
| CTX-006 | Presentation | ui, sdk | |
| CTX-007 | Application | apps/server, apps/web | Must not run raw DB queries |

> **Note**: Several documented packages (`knowledge`, `prompt`, `policy`, `tools`, `queue`, `registry`, `plugin` as separate package, `orchestrator`, `runtime`, `ui`) **do not exist as actual directories**. The functionality they describe is either absent, absorbed into other packages, or only described in ADRs. The actual deliverable packages are those listed above.

### Dependency direction (strict, unidirectional, downward)

```
apps/server, packages/frontend          (CTX-007 / CTX-006 — top consumers)
        │
        ▼
packages/agent, packages/workflow       (CTX-002 — domain orchestration)
        │
        ▼
packages/browser, packages/llm,
packages/memory, packages/storage       (CTX-002/004 — providers)
        │
        ▼
packages/events, packages/observability,
packages/capability, packages/config,
packages/utils                          (CTX-001 — foundational)
        │
        ▼
packages/contracts                      (shared kernel — bottom)
```

**Invariant**: A lower package may never import from a higher one. Third-party SDKs (Puppeteer, future OpenRouter/Ollama HTTP) are encapsulated *only* inside provider adapters.

---

## 3. Technology Stack (Actual vs. Documented)

| Layer | Documented (docs/04-tech-stack.md) | Actual (from package.json files) |
|---|---|---|
| Build orchestrator | Turborepo v2 | ✅ `turbo@2.10.0` |
| Package manager | pnpm ≥ 8 | ✅ `pnpm@9.1.0` |
| Language | TypeScript 5.4 strict | ✅ `typescript@5.4.2`, all strict flags |
| Test runner | Vitest | ✅ `vitest@^1.4.0` |
| HTTP server | **Fastify** | ❌ **Hand-rolled `node:http`** (`@pinchtab/server` has zero web-framework deps) |
| Frontend | Next.js + Tailwind + shadcn/ui | ❌ **Vite + React 18.2 + custom CSS** (no Next.js, no Tailwind) |
| Browser automation | PinchTab + CDP + Playwright | ❌ **Puppeteer-core ^22.6** (real system Chrome) — no Playwright |
| LLM | OpenRouter / Ollama / OpenAI / Anthropic | ⚠️ Adapters exist for OpenRouter + Ollama but **stubbed** (no real HTTP) |
| DB | Drizzle/SQLite + PostgreSQL + Redis | ❌ **In-memory `Map`**; `SqliteClient` returns `[]` |
| Vector store | Qdrant / SQLite-vector | ⚠️ Pure-TS `cosineSimilarity` over in-memory arrays |
| Observability | Pino + OTel + Prometheus | ⚠️ Custom `StructuredLogger` + custom `Tracer`/`Span` + custom metrics |

**Takeaway**: The codebase has **diverged from its documented stack** in three big ways — no Fastify (custom HTTP), no Next.js (Vite+React), no real DB (in-memory). The hexagonal *structure* is honored; the *technology* is lighter/prototype-grade.

---

## 4. Package-by-Package Technical Reference

### 4.1 `@pinchtab/contracts` — The Shared Kernel

The foundation every other package depends on. Zero internal deps.

- **Branded IDs** (`shared/brand.ts`, `shared/identifiers.ts`): 15 nominal types via `Brand<T, B>` — `SessionId`, `AgentId`, `TabId`, `GoalId`, `TaskId`, `StepId`, `EventId`, `CorrelationId`, `ModelId`, `MemoryId`, `WorkflowId`, `PluginId`, etc. Each has a `createXxx(s: string)` caster. Branded types prevent accidental cross-assignment (a `TabId` is not assignable to a `SessionId`).
- **DTOs** (`dto/`): `AgentGoalDto` (status `pending|planning|executing|verifying|completed|failed`), `AgentStepDto`, `BrowserTabDto`, `BrowserSessionDto`, `BrowserElementDto`, `BrowserSnapshotDto`, `BrowserActionDto`, `CompletionRequestDto`/`CompletionResponseDto`/`StreamChunkDto`, `MemoryRecordDto`/`MemorySearchQueryDto`.
- **Errors** (`errors/`): `BaseDomainError` (abstract, with `code`/`statusCode`/`toJSON()`). 9 concrete errors: `NotFoundError`(404), `ValidationError`(400), `ProviderError`(502), `PolicyViolationError`(403), `TimeoutError`(504), `SessionClosedError`(410), `CapabilityMismatchError`(422), `ConflictError`(409), `InternalServerError`(500).
- **Events** (`events/`): `IDomainEvent<TType,TPayload>` with `id`/`timestamp`/`version`/`correlationId?`/`causationId?`. `createDomainEvent()` factory (id `evt_<ts>_<rand7>`, protocol version `1.0.0`). **11 typed event topics** in `DomainEventMap` across Browser/Agent/LLM/Tool domains (e.g. `browser:session:created`, `agent:goal:started`, `agent:state:changed`, `llm:stream:chunk`).
- **Requests/Responses** (`requests/`, `responses/`): `createSuccessResponse<T>(data)` → `{success:true, data, timestamp}`; `createErrorResponse(...)` → `{success:false, error:{code,message,statusCode,...}}`.

### 4.2 `@pinchtab/utils` — Concurrency, Crypto, Formatters, Ports

- **`async/`**: 
  - `Mutex` (non-blocking, token-passing queue, `runExclusive<T>()`).
  - `Semaphore` (permit-based, same pattern).
  - `RateLimiter` (token bucket: `tokensPerInterval`/`intervalMs`, `tryRemoveToken`/`removeToken` busy-waiting 50ms).
  - `retryWithBackoff<T>()` (`maxRetries`, exponential backoff with ±20% jitter, `shouldRetry` predicate).
- **`crypto/`**: `hashString` (sha256), `generateUuid` (v4), `generateRandomToken(byteLength=32→hex)`, **AES-256-GCM** `encryptSecret`/`decryptSecret` (64-hex-char key, 12-byte IV, auth tag).
- **`formatters/`**: `cleanHtmlDom` (strips scripts/styles/comments/SVG paths/inline styles), `sanitizePromptText` (strips control chars + zero-width Unicode — **prompt-injection defense**), `estimateTokenCount` (`ceil(len/4)`), `truncateToTokenLimit`.
- **`network/`**: `PortResolver` (static `isPortAvailable`, `findAvailablePort`, `getEnvironmentEndpoints`).
- **`runtime/`**: `EnvValidator` (port range/duplicate detection), `HanumatrixDevRuntime` port allocator with a hardcoded `HANUMATRIX_PORT_REGISTRY` (PinchTab=5173/3000/3001, MitSu, Supamatrix, etc.).

### 4.3 `@pinchtab/config` — Environment & Secrets

- **`schema/env-schema.ts`** (Zod): `MasterEnvSchema` merging Server (`NODE_ENV`/`PORT` default 3000/`HOST`/`LOG_LEVEL`), OpenRouter (`PINCHTAB_OPENROUTER_API_KEY?`, base URL), Ollama (`PINCHTAB_OLLAMA_HOST` default `http://localhost:11434`, `PINCHTAB_OLLAMA_DEFAULT_MODEL` default `llama3`), PinchTab (`PINCHTAB_SERVER_URL`), Storage (`DATABASE_URL`/`REDIS_URL`/`QDRANT_URL`).
- **`provider/config-provider.ts`**: `EnvConfigSource` reads `process.env`; `ConfigurationProvider.getAppConfig()` merges sources in order, runs `safeParse`, **fails fast** with formatted Zod errors, caches result.
- **`provider/secret-masker.ts`**: `maskSecret()` — keeps first/last 4 chars, masks middle with ≥6 `*`.

### 4.4 `@pinchtab/observability` — Logging, Metrics, Tracing, Inspector, Studio

Five subsystems:

- **Logger**: `LogLevel` (trace→fatal), `StructuredLogger` with pluggable `ILogTransport` (default `ConsoleLogTransport` JSON output). Supports `child(context, correlationId?)` for correlation propagation.
- **Metrics**: `Counter`/`Gauge`/`Histogram` primitives + `MetricsCollector` registry/factory.
- **Tracing**: `Span` (OTel-shaped: `setAttribute`, `end()`, `getDurationMs()`) + `Tracer` (per-trace span collection).
- **DevTools Inspector** (`devtools/`): `ExecutionInspector` holds mutable snapshots — `GoalInspection`, `PlannerInspection`, `TaskGraphNodeView[]`, `PageInspection`, `SemanticCandidateView`, `DecisionInspection`, `RecoveryInspection`, `MemoryInspection`, `RuntimeServiceInspection`, a `TimelineStageNode[]`. `generateFullExport()` produces a `FullTraceExport` (fills defaults for unset fields). `TraceExporter.exportToJson/importFromJson`.
- **Studio** (`studio/`): engineering/eval tooling — `StudioEngine` (replay frames, memory graph view, perf profile), `FailureLab.runChaosExperiment()`, `DecisionDiffer.compareTraces()`, `DatasetRecorder.recordDataset()`.

> ⚠️ **Minor bug**: `packages/observability/src/studio/index.ts:8` re-exports `./failure-lab.ts` instead of `./failure-lab.js` — breaks ESM build/tooling expectations.

### 4.5 `@pinchtab/events` — Typed Event Bus + Store

- **`bus/event-bus.ts`**: `EventBus` implements `IEventBus<DomainEventMap>`. Two registries: per-type `Map<string, Set<EventHandler>>` and wildcard `Set`. `publish()` → `createDomainEvent()` → `publishEvent()` → fans out to type handlers **and** wildcard handlers **concurrently** via `Promise.all`, each wrapped in `invokeHandlerSafely` (a failing handler is caught, logged, and **does not abort siblings**). `subscribe()` returns a `SubscriptionToken.unsubscribe()`. `getSubscriberCount()`.
- **`store/event-store.ts`**: `InMemoryEventStore` — ring buffer (`maxCapacity=10000`, evicts oldest). `append()`, `getEvents({type?,correlationId?,causationId?,fromTimestamp?,toTimestamp?,limit?})`, `getEventsByCorrelationId()`.

### 4.6 `@pinchtab/browser` — Real Browser Engine (Puppeteer)

**The most functionally complete package.** Uses **`puppeteer-core@^22.6`** with a real system Chrome/Edge/Chromium (resolved via `CHROME_PATH` or hardcoded candidate paths for Win/Linux/macOS).

- **`launcher/`**: `BrowserLauncher.launch(options)` → `puppeteer.launch({executablePath, headless:true, args})`. Default args include `--disable-blink-features=AutomationControlled`, `--no-sandbox`, `--window-size=1280,800`. **Degrades gracefully**: if no executable or launch fails, returns a *mock* `PuppeteerBrowserInstance` (never throws).
- **`session/`**: 3-tier `SessionManager → BrowserSession → BrowserTab` mirroring Browser→Page. `BrowserSessionManager.createSession({isIncognito?, initialUrl?})` always launches a browser instance. Tab IDs `tab_<sess>_<n>`, session IDs `sess_<ts>_<n>`.
- **`actions/`**: `BrowserActionEngine` — **19 action types** (`navigate`, `click`, `click_by_text`, `click_by_role`, `type`, `type_by_label`, `press_key`, `scroll`, `wait`, `wait_for_selector`, `select_option`, `hover`, `focus`, `open_new_tab`, `close_tab`, `switch_tab`, `take_screenshot`, `download_file`, `upload_file`). Retry (default `maxRetries=2`) + timeout (default 15000ms via `Promise.race`) wrapper around real Puppeteer calls.
- **`dom/`**: `DOMSemanticEngine.buildGraph(tab)` runs real `page.evaluate()` scraping `a,button,input,select,textarea,[role],h1,h2,h3,p` (first 150 elements), computing confidence per node. `SemanticElementGraph` provides confidence-scored candidate matching (`findCandidatesByText`, `findCandidateByRole`, `findInputByLabel`).
- **`page/`**: `PageUnderstandingEngine.analyzePage(graph)` classifies page type (`Authentication|Search|Dashboard|Documentation|Repository|Article|News|Shopping|Checkout|Settings|Forms|Unknown`) via URL/title heuristics, identifies regions, primary action.
- **`snapshot/`**: `SnapshotGenerator` + `SemanticTreeBuilder` produce `BrowserSnapshotDto` with a text-rendered `semanticTree` for the LLM context window.
- **`stealth/`**: `StealthEngine.getEvasionScripts()` returns 4 scripts (webdriver override, chrome.runtime mock, WebGL vendor/renderer spoofing, hardware concurrency/platform/languages) for `evaluateOnNewDocument`.
- **`skills/`**: `BrowserSkillsLibrary` — composable high-level skills: `searchGoogle`, `login`, `fillForm`, `extractLinks`, `extractEmails`, `acceptCookies`, `dismissPopup`, `captureScreenshot`.
- **`verifier/`**: `ExecutionVerifier.verifyAction(tab, prevUrl, actionResult, spec)` — post-action validation (URL change, expected substring), returns `VerificationResultDto` with confidence.

### 4.7 `@pinchtab/llm` — LLM Provider Gateway (STUBBED)

- **`gateway/llm-provider.ts`**: `ILlmProvider` — `providerId`, `capabilities: CapabilityMatrix`, `generateCompletion(CompletionRequestDto)`, `generateStream(...) → AsyncIterable<StreamChunkDto>`.
- **`gateway/openrouter-adapter.ts`**: `OpenRouterAdapter` — rate-limited (60/min), wrapped in `retryWithBackoff`. **Stubbed**: returns canned `CompletionResponseDto`, **never calls fetch**. Declares capabilities: streaming/tool_calling/vision/reasoning = supported.
- **`local/ollama-adapter.ts`**: `OllamaAdapter` — host default `http://localhost:11434`, model default `llama3`. `checkHealth()` always returns `true`; `listLocalModels()` returns stub `llama3`/`mistral`. **Stubbed completion**.

> **Critical**: `ILlmProvider` is wired into `AgentCore` and `GoalPlanner` but **never invoked** in the reasoning loop. The agent runs heuristically today.

### 4.8 `@pinchtab/memory` — Multi-Tier Memory (In-Memory)

Two parallel abstractions:

- **Generic tiers** (`store/`, `tiers/`): `MemoryTier = 'working'|'short_term'|'episodic'|'semantic'|'procedural'`. `BaseMemoryStore` (Mutex-guarded `Map`, substring search, score 1.0). `EpisodicMemoryStore` (newest-first sort). `SemanticMemoryStore` (**cosine similarity** over embeddings, else text fallback). `MultiTierMemoryManager.searchMultiTier()` fans out in parallel across all tiers, sorts by score desc.
- **Episodic engine** (`episodic/`): `EpisodicMemoryManager` for structured agent execution episodes — `createEpisode(goal, pageType, taskGraphId)`, `recordAction/Evidence/Recovery`, `finalizeEpisode(outcome, duration)` with **automated lesson extraction** (success→strategy+resilience lessons; failure→avoid-repeating lesson). `queryEpisodes({pageType?, goal?, outcome?})`.

### 4.9 `@pinchtab/agent` — The Agent Reasoning Engine

See [§5.5](#55-the-agent-reasoning-loop) for the full loop. Highlights:

- **`AgentCore`**: facade implementing `IAgentCore` — `executeGoal(goalText): Promise<AgentGoalDto>`.
- **`AgentStateMachine`**: 8 states (`idle|planning|executing|verifying|reflecting|completed|failed|paused`), validated transitions, emits `agent:state:changed`.
- **`RuntimeKernel`**: topological-order service container managing 7 services (`PlannerService`, `MemoryService`, `BrowserService`, `RecoveryService`, `TaskGraphService`, `DecisionService`, `PageUnderstandingService`).
- **`GoalPlanner`**: produces a deterministic **3-node linear TaskGraph** (Navigate & Inspect → Execute Semantic Actions → Verify & Store). LLM-ready but heuristic.
- **`TaskGraph`**: DAG with cycle detection, priority scheduling, per-node retries (`maxRetries`).
- **`DecisionEvidenceEngine`**: transparent additive confidence scorecard (8 positive factors, 4 penalties) → recommendation `EXECUTE|VERIFY_FIRST|COLLECT_MORE_INFORMATION|RECOVER|REPLAN|REJECT`.
- **`StepExecutor` + `ReflectionEngine`**: dispatches browser actions; detects stuck loops (same action+observation ≥3 times).
- **`RecoveryEngine`**: 7 `FailureReason` → strategy mapping (`element_disappeared`→CandidateFallbackRanking, `popup_blocking`→DismissPopupSkill, `navigation_timeout`→PageRefreshRetry, `browser_crash`→escalate).

### 4.10 `@pinchtab/workflow` — DAG Workflow Runner (Linear)

- **`graph/`**: `WorkflowGraph` (frozen node map) with `validate()` (non-empty, one `start`, ≥1 `end`, no dangling edges). Node types: `start|task|condition|parallel|end`.
- **`runner/workflow-runner.ts`**: `WorkflowRunner.runWorkflow(graph, initialInputs)` walks from start, delegates `task` nodes to `agentCore.executeGoal(name)`, follows **only `nextNodes[0]`** — so `parallel`/`condition` branching is **unimplemented**.

### 4.11 `@pinchtab/storage` — Persistence

- **`db/sqlite-client.ts`**: `SqliteClient(dbPath=':memory:')` — **STUB**: `query()` returns `[]`, `execute()` returns `{rowsAffected:1}`. No real `better-sqlite3`.
- **`db/session-repository.ts`** & **`event-repository.ts`**: accept an `ISqliteClient` (unused) but persist to private Mutex-guarded `Map`/array.
- **`file/local-file-storage.ts`**: `LocalFileStorage` — **the one genuinely functional persistence adapter**. Real `node:fs/promises`, base dir `.pinchtab-storage`, with **path-traversal protection** (`resolvePath` rejects keys escaping baseDir).

### 4.12 `@pinchtab/sdk` — Plugin System (Stubs)

- 11 `PluginType`s, 6 `PluginLifecycleState`s, `PluginManifest` + `PluginManifestValidator` (shallow — doesn't validate permissions/deps/signature).
- `PluginManager` — full install→initialize→enable→upgrade→uninstall lifecycle with dependency resolution.
- `PluginSandbox` — permission-set assertion only (no process isolation).
- `MarketplaceRegistry.verifySignature()` — **stub**: checks `signature` starts with literal `'sig_valid_'`.

### 4.13 `@hanumatrix/dev-runtime` — Port Allocator (Off-Grid)

A generic, product-agnostic library under a **different namespace** (`@hanumatrix/*`, not `@pinchtab/*`). Port allocation, service registry, liveness checks, ASCII startup banner. Health-checker heuristic: "port occupied" = "service running" (no HTTP probe). Violates the documented namespace convention.

---

## 5. Server Application — Gateway, Routes & Services

`apps/server` — `@pinchtab/server`, ESM, default runtime port **8081**.

### 5.1 Bootstrap & Composition Root

```
src/runtime/runtime.ts (main() entrypoint)
        │ constructs
        ▼
src/runtime/bootstrap.ts → PinchTabRuntime { container }
        │
        ▼
src/runtime/dependency-container.ts → DependencyContainer (single composition root)
   Wires in 5 phases:
     1. Foundational: ConfigProvider, StructuredLogger, EventBus (+ '*' subscriber → EventRepository)
     2. Storage:      LocalFileStorage, SqliteClient(':memory:'), SessionRepository, EventRepository
     3. Domain:       BrowserLauncher, BrowserSessionManager, MultiTierMemoryManager,
                      OpenRouterAdapter + OllamaAdapter (BOTH instantiated; only OpenRouter wired to AgentCore),
                      AgentCore, WorkflowRunner
     4. App services: SessionAppService, AgentAppService, WorkflowAppService,
                      MemoryAppService, StorageAppService
     5. Gateway:      port = process.env.PORT || '8081', host '127.0.0.1'
                      → ServerApp → registerAllRoutes(router, services)
```

- **`PinchTabRuntime.start()`** → banner → `serverApp.start()` → logs `Server initialized on http://127.0.0.1:8081`.
- **`stop()`** → `serverApp.stop()` → `sessionManager.closeAllSessions()` → `sqliteClient.close()`.
- **SIGINT** → `runtime.stop()` + `process.exit(0)`.

### 5.2 Gateway Layer (`src/gateway/`)

- **`server-app.ts` — `ServerApp`**: the real HTTP server. Creates `http.createServer`. Per request: sets 3 CORS headers (`Access-Control-Allow-Origin: *`), `OPTIONS`→204, reads body chunks, `JSON.parse` (ignores non-JSON), builds `ApiRequest{body,url,method,headers}`, dispatches via `router.dispatch(...)`. Always responds `application/json`. **`EADDRINUSE` fallback**: if port busy, re-listens on ephemeral port `0`.
- **`api-router.ts` — `ApiRouter` + `MockApiResponse`**: `HttpMethod` (GET/POST/PUT/DELETE), `RouteHandler = (req,res)=>Promise<void>`. `dispatch()` matches method first, then `matchRoute` (splits on `/`, extracts `:param` into `req.params`). **First-match-wins**. Unmatched → 404. ⚠️ Query strings are **not parsed** into `req.query`.
- **`server-options.ts`**: `DEFAULT_SERVER_OPTIONS = {port:8080, host:'127.0.0.1'}` (note: container overrides to 8081).
- **`static-handler.ts`**: `GET /` serves `console/developer-console.html` (or inline fallback).

### 5.3 Complete REST API (16 endpoints)

All paths versioned `/api/v1/*`. Controllers are thin: validate body → delegate to an app service → return a DTO.

| Method | Path | Handler Service | Body / Purpose |
|--------|------|-----------------|----------------|
| GET | `/` | static | Serve developer console HTML |
| GET | `/health` | — | `{status:'ok', service:'@pinchtab/server', version, timestamp}` |
| POST | `/api/v1/sessions` | SessionAppService | `{isIncognito?, initialUrl?}` → 201 `BrowserSessionDto` |
| GET | `/api/v1/sessions` | SessionAppService | → 200 `BrowserSessionDto[]` |
| GET | `/api/v1/sessions/:id` | SessionAppService | → 200 or 404 |
| DELETE | `/api/v1/sessions/:id` | SessionAppService | → 200 `{success, sessionId}` |
| POST | `/api/v1/agents/goals` | AgentAppService | `{goal}` (400 if missing) → 200 `AgentGoalDto` |
| GET | `/api/v1/agents/status` | AgentAppService | → 200 `{agentId, name, state}` |
| POST | `/api/v1/workflows/run` | WorkflowAppService | `{name?, nodes, initialInputs?}` (400 if no nodes) → 200 result |
| POST | `/api/v1/memory/records` | MemoryAppService | `MemoryRecordDto` (needs `id`+`content`) → 201 |
| POST | `/api/v1/memory/search` | MemoryAppService | `MemorySearchQueryDto` → 200 |
| POST | `/api/v1/storage/files` | StorageAppService | `{key, content}` → 201 `{key, path}` |
| GET | `/api/v1/storage/files` | StorageAppService | → 200 `{files}` |
| POST | `/api/v1/browser/launch` | BrowserSessionManager (direct) | `{sessionId?, initialUrl?}` → `{sessionId, status:'running'}` |
| POST | `/api/v1/browser/shutdown` | BrowserSessionManager | → `{success:true}` |
| POST | `/api/v1/browser/navigate` | BrowserSessionManager | `{sessionId, tabId?, url}` → `{tabId, url, title}` |
| POST | `/api/v1/browser/tabs/create` | BrowserSessionManager | → tab DTO |
| POST | `/api/v1/browser/tabs/close` | BrowserSessionManager | `{tabId}` |
| POST | `/api/v1/browser/tabs/focus` | BrowserSessionManager | `{tabId}` |
| POST | `/api/v1/browser/goback` | BrowserSessionManager | → first tab |
| POST | `/api/v1/browser/goforward` | BrowserSessionManager | → first tab |
| POST | `/api/v1/browser/reload` | BrowserSessionManager | re-navigates to current URL |
| POST | `/api/v1/browser/screenshot` | BrowserSessionManager | **real `tab.page.screenshot`** base64 data URL (1×1 fallback) |
| POST | `/api/v1/browser/eval` | BrowserSessionManager | `{tabId, code}` → `page.evaluate(code)` |
| POST | `/api/v1/browser/cookies` | BrowserSessionManager | **stub** → `{cookies:[]}` |
| POST | `/api/v1/browser/downloads` | BrowserSessionManager | **stub** → `{downloads:[]}` |

### 5.4 Application Services (`src/application/`)

Thin orchestration over a domain subsystem + optional logger, returning `@pinchtab/contracts` DTOs:

- `SessionApplicationService(sessionManager, sessionRepository, logger?)` — `createSession`/`getSession`/`listSessions`/`closeSession`.
- `AgentApplicationService(agentCore, logger?)` — `executeGoal({goal})`, `getStatus()`.
- `WorkflowApplicationService(workflowRunner, logger?)` — `executeWorkflow({name?, nodes, initialInputs?})`.
- `MemoryApplicationService(memoryManager, logger?)` — `storeRecord`, `search`.
- `StorageApplicationService(fileStorage, logger?)` — `storeFile({key, content})`, `listFiles`.

### 5.5 The Agent Reasoning Loop

`AgentCore.executeGoal(goalText)` runs a **structured Plan→Act→Verify→Reflect→Recover** pipeline (closer to plan-and-execute than classic token-by-token ReAct). The LLM is **wired but dormant**; decisions are heuristic today.

```
executeGoal(goalText)
  │
  ├─ kernel.start()                    (topological init of 7 services)
  ├─ state: idle → planning
  ├─ infer targetUrl from goal keywords (github|wikipedia|hacker news|google|regex URL)
  ├─ planner.createTaskGraph(goal)      → 3-node linear DAG
  ├─ episodicMemory.createEpisode(goal, pageType, graphId)
  │
  ├─ state: planning → executing
  ├─ sessionManager.createSession({initialUrl: targetUrl})
  │
  └─ WHILE (!graph.completed && !graph.failed && steps < maxSteps):
       │
       ├─ node = graphEngine.getNextReadyNode(graph)   (highest-priority READY)
       ├─ graphEngine.startNodeExecution(node)
       ├─ episodicMemory.recordAction(...)
       │
       ├─ [if browser session] activeTab = ...
       │   ├─ prevUrl = tab.url
       │   ├─ BrowserSkillsLibrary canned action (searchGoogle | login) by keyword
       │   ├─ semanticGraph = DOMSemanticEngine.buildGraph(tab)
       │   ├─ pageModel = PageUnderstandingEngine.analyzePage(semanticGraph)
       │   └─ candidate = semanticGraph.findCandidatesByText(goalText)
       │
       ├─ decision = DecisionEvidenceEngine.evaluateCandidate(candidate, opts)
       │     confidence ∈ [0,1]; recommendation ∈ {EXECUTE,VERIFY_FIRST,
       │       COLLECT_MORE_INFORMATION,RECOVER,REPLAN,REJECT}
       │
       ├─ IF decision.recommendation ∈ {RECOVER, REJECT}:
       │     recoveryEngine.attemptRecovery('low_confidence', activeTab, goal, decision)
       │
       ├─ verifyResult = verifier.verifyAction(activeTab, prevUrl,
       │                  {success:true}, {candidateConfidence: decision.confidence})
       │
       ├─ reflection = reflectionEngine.evaluateStep(step, history)
       │     isStuck = (same actionName+observation seen ≥2 times before)
       │
       ├─ IF reflection.isStuck || !verifyResult.verified:
       │     recoveryEngine.attemptRecovery('stale_element', ...)   → break loop
       │
       ├─ executor.executeStep(...)       (dispatches REAL browser action + reflection)
       ├─ graphEngine.completeNodeExecution(node)
       └─ push AgentStepDto
  │
  ├─ episodicMemory.finalizeEpisode(episode, 'success', duration)   (+ auto lesson extraction)
  ├─ kernel.stop()
  └─ state: executing → verifying → completed
  → returns AgentGoalDto { status:'completed', steps, ... }
```

**Decision Evidence scoring** (transparent additive scorecard):
- Positives: exact accessible name +0.45, label +0.38, partial text +0.28, role +0.18, visible +0.22, enabled +0.08, primary-CTA match +0.15, prior verify +0.04.
- Penalties: hidden −0.5, disabled −0.3, recovery attempts −min(0.25, n×0.1), ambiguous (>3 alternatives) −0.15.
- Recommendation thresholds: ≥0.88 EXECUTE, ≥0.70 VERIFY_FIRST, ≥0.45 COLLECT_MORE_INFORMATION, else REJECT.

**Recovery strategies** by `FailureReason`: `element_disappeared|selector_invalid|low_confidence` → CandidateFallbackRanking; `popup_blocking` → DismissPopupSkill; `navigation_timeout` → PageRefreshRetry; `stale_element` → RefreshSnapshot; `browser_crash` → escalate (cannot self-heal).

### 5.6 Eval Framework (`src/eval/`)

- **`benchmark-dataset.ts`**: `BENCHMARK_DATASET` — **102 tasks** across 15 categories (Navigation 10, Search 10, Forms 8, Auth 6, Tables 6, InfiniteScroll 5, Downloads 5, Pagination 6, Docs 8, Shopping 6, Dashboards 6, News 8, Knowledge 8, FileUploads 4, MultiStep 6).
- **`evaluation-runner.ts`**: `EvaluationRunner.runAll()` spins up a real `PinchTabRuntime`, dispatches tasks by category (Navigation/Search/Knowledge/News → `agentAppService.executeGoal`; Memory → store+search; Filesystem → storeFile; Workflow → executeWorkflow; else → session create/close), writes `.pinchtab-eval/evaluation-results.json`.
- **`reliability-dashboard.ts`**: aggregates success rates, latency, failure distribution → markdown report.
- **`validation-program-runner.ts`**: returns **synthetic/hardcoded** `ProductionReadinessMetrics` (`goNoGoDecision:'GO'`).
- **`real-world-validation.ts`**: 16 live-website tasks (Wikipedia, Google, GitHub, HN, BBC, MDN, TypeScript docs, forms, tables, downloads, pagination, recovery) → `.pinchtab-eval/real-world-evidence.json`.

> **Orphaned controllers**: `DevToolsController` and `StudioController` are defined but **never instantiated, registered as routes, or exported** — dead code.

---

## 6. Frontend Application — Pages, Runtime & State

`packages/frontend` — `@pinchtab/frontend`, **Vite + React 18.2 + custom CSS** (NOT Next.js). SPA with a hand-rolled state-based router.

### 6.1 Routes & Pages

| Path | Page | Purpose |
|------|------|---------|
| `/` | `HomePage` | Dashboard: 3 stat tiles + recent-sessions grid (max 6) |
| `/sessions` | `SessionsListPage` | Full session manager: search + status filter + archive/delete |
| `/session/:id` | `SessionPage` | Primary workspace: browser viewport + AI Dock (timeline/notes/tasks/downloads) |
| `/downloads` | `DownloadsPage` | Aggregated downloads across all sessions |
| `/settings` | `SettingsPage` | API/WS URLs + agent behaviour flags (persisted to `localStorage`; **unused by runtime**) |

- **Router** (`app/router.tsx`): `RouterProvider` holds `currentPath` in `useState('/')`. ⚠️ **No History/Location/hash integration** — browser back/forward and refresh-to-deep-link do not work (refresh always returns to `/`).
- **App shell** (`app/App.tsx`): `RouterProvider > SessionProvider > ToastProvider`. `Cmd/Ctrl+K` opens command palette. New-Session modal. `[WorkspaceRail 48px] | [flex-1 main]` layout.

### 6.2 State Management (`stores/sessionStore.tsx`)

Central React Context store — the heart of the app:

- **Persistence**: `sessions` array → `localStorage['pinchtab_sessions_v1']` on every change. Hydrates from localStorage or falls back to 4 **sample sessions** (AI IDE Research, FANUC SDK Research, Greaves Portal, RTX 5090 Price Tracking).
- **Per-session browser state**: on `openSession(id)`, serializes the outgoing session's browser snapshot to `pinchtab_browser_snap_<id>` and deserializes the incoming one — browser state is restorable per session.
- **Session lifecycle**: `createSession` (id `sess_<ts>_<rand>`, default URL `https://github.com/pinchtab/pinchtab`, one starter task, "Created new Session" timeline event), `openSession`, `closeSession`, `renameSession`, `archiveSession`, `deleteSession` (calls `browserManager.destroyBrowser(id)`).
- ⚠️ On first mount it **eagerly creates + launches a BrowserSession for `sessions[0]`** even before any session is opened.

### 6.3 Browser Runtime Layer (`runtime/browser/`)

Layered: **Manager → Session → Runtime → Adapter → Transport**, plus a `CapabilityAPI` facade and `EventEmitter`.

```
EmbeddedBrowser.tsx
    │ uses
    ▼
BrowserCapabilityAPI(session)
    │ delegates tab ops to
    ▼
BrowserSession          (authoritative in-memory tab mirror; mutates local state FIRST,
    │                    emits events, then calls adapter best-effort .catch(()=>{}))
    ▼
IBrowserAdapter   ──────┬───── MockBrowserAdapter      (in-memory; 1×1 placeholder PNG)
                         └───── ServerBrowserAdapter   (REST → backend /api/v1/browser/*)
                                       │ uses
                                       ▼
                                HttpBrowserTransport   (POST fetch to baseUrl/endpointPath;
                                                       baseUrl = arg|VITE_API_BASE_URL|
                                                       http://localhost:8081)
```

- **`BrowserManager`** (singleton): `Map<sessionId, BrowserSession>`, `defaultAdapterFactory = () => new ServerBrowserAdapter()`.
- **`EmbeddedBrowser.tsx`**: tab strip, omnibar (back/forward/reload, secure-lock indicator, address form), viewport (`<img>` of screenshot data URL), dev console overlay. **Polls every 1.5s** for screenshot refresh. Subscribes to `TabCreated/Closed/Activated/Navigation*` events.
- ⚠️ **No real WebSocket** — despite a `wsUrl` setting and `IBrowserTransport.on()` plumbing. UI polls; adapters self-emit synthetic events synchronously after each call.
- ⚠️ **Error swallowing**: `HttpBrowserTransport` catches all fetch/network/HTTP errors and returns `{ok:false,...}`; adapters `.catch(()=>{})`. Server failures are **invisible to the UI** (stale local tab state persists).

### 6.4 Action Engine (`runtime/actions/`) — Built but NOT Wired into UI

A complete, tested action system with **17 registered actions** (navigation, interaction, data, file categories), retry/timeout/cancellation, and an `ActionContext` + `ActionExecutor`. Auto-registers via the `index.ts` barrel at import time.

> ⚠️ **Grep confirms**: nothing outside `runtime/actions/` imports this engine. It is exercised only by unit tests. The session's "goal" does not currently drive these actions.

### 6.5 Workflow Engine (`runtime/workflow/`) — Built but NOT Wired into UI

Graph-based orchestrator on top of the action engine: node types `action|condition|loop|parallel|delay|approval|subworkflow`, status `idle|running|paused|completed|failed|cancelled`. `WorkflowExecutor` traverses the graph, handles conditions/parallel/loops/delays, and `approval` nodes pause for **human-in-the-loop** (Tier-3 gate). ⚠️ Also only referenced by unit tests.

---

## 7. End-to-End Workflow Diagrams

### 7.1 HTTP Request Lifecycle (Backend)

```
Client (fetch)
  │
  ▼
http.Server 'request' listener (server-app.ts)
  │  ├─ set CORS headers (Allow-Origin: *)
  │  ├─ IF OPTIONS → res 204
  │  └─ collect body chunks → JSON.parse (ignore failures)
  ▼
ApiRequest { body, url, method, headers }
  │
  ▼
ApiRouter.dispatch(method, url, req, MockApiResponse)
  │  └─ matchRoute: split on '/', extract :param → req.params   (query dropped!)
  ▼
RouteHandler (routes/*.ts)
  │  ├─ validate body → 400 if missing required field
  │  └─ delegate to ApplicationService
  ▼
ApplicationService (application/*.ts)
  │  └─ calls domain subsystem (AgentCore / WorkflowRunner / MemoryManager /
  │     BrowserSessionManager / SessionRepository / LocalFileStorage)
  ▼
returns DTO from @pinchtab/contracts
  │
  ▼
res.status(2xx).json(dto)  →  res.end(JSON.stringify(body))
```

### 7.2 Agent Goal Execution (Backend, ReAct-like Loop)

See [§5.5](#55-the-agent-reasoning-loop) for the full annotated flow. Compact view:

```
POST /api/v1/agents/goals  { goal }
  │
  ▼
AgentAppService.executeGoal → AgentCore.executeGoal(goal)
  │
  ├─ PLAN:    kernel.start → state planning → GoalPlanner.createTaskGraph (3-node DAG)
  ├─ ACT:     state executing → loop over ready nodes
  │             ├─ DOMSemanticEngine.buildGraph (real page.evaluate)
  │             ├─ PageUnderstandingEngine.analyzePage
  │             ├─ DecisionEvidenceEngine.evaluateCandidate → confidence + recommendation
  │             ├─ [if low conf] RecoveryEngine.attemptRecovery
  │             ├─ ExecutionVerifier.verifyAction
  │             ├─ ReflectionEngine.evaluateStep (stuck detection)
  │             └─ StepExecutor.executeStep (real Puppeteer action)
  ├─ VERIFY:  state verifying
  └─ COMPLETE: episodicMemory.finalizeEpisode + lesson extraction → state completed
  → AgentGoalDto { status:'completed', steps[] }
```

### 7.3 Live Browser Screenshot Streaming (Frontend ↔ Backend)

```
React EmbeddedBrowser.tsx
  │  every 1500ms: refreshState()
  ▼
BrowserCapabilityAPI.captureScreenshot()
  │
  ▼
BrowserSession.adapter (ServerBrowserAdapter)
  │
  ▼
HttpBrowserTransport.send('POST /api/v1/browser/screenshot', {sessionId, tabId})
  │  fetch http://localhost:8081/api/v1/browser/screenshot
  ▼
Backend browser-routes.ts → sessionManager.getSession → tab.page.screenshot()
  │  real Puppeteer screenshot (base64 PNG data URL)   [1×1 fallback if no page]
  ▼
{ screenshotData: 'data:image/png;base64,...' }
  │
  ▼
EmbeddedBrowser renders <img src={screenshotData} />
```

### 7.4 Multi-Tier Memory Write & Recall

```
WRITE:  MultiTierMemoryManager.storeRecord(MemoryRecordDto{tier, content, embedding?})
          │
          └─ tierStores[tier].store()  →  Mutex.runExclusive → Map.set(frozen clone)

RECALL (single tier):  tierStores[tier].search(query)
          ├─ working/short_term/procedural: substring match, score 1.0
          ├─ episodic: newest-first sort + substring
          └─ semantic: cosineSimilarity(query.embedding, record.embedding)  [or 0.8 text fallback]

RANK (cross-tier):  MultiTierMemoryManager.searchMultiTier(query)
          ├─ Promise.all over ALL tier stores' search()
          ├─ merge + sort by score desc
          └─ slice(limit ?? 10)

EPISODIC (agent):  EpisodicMemoryManager
          createEpisode → recordAction/Evidence/Recovery → finalizeEpisode (+ lessons)
          queryEpisodes({pageType?, goal?, outcome?})
```

### 7.5 Event Bus Pub/Sub with Correlation

```
Publisher: bus.publish('agent:goal:started', payload, correlationId='corr_<goalId>')
              │
              └─ createDomainEvent(...) → publishEvent(event)
                    │
                    ├─ handlers[event.type]  ──┐
                    └─ wildcardHandlers       ├── Promise.all (CONCURRENT, error-isolated)
                                              │
                    Each handler invoked via invokeHandlerSafely:
                       try { await handler(event) }
                       catch(e) { logger.error(...); /* DOES NOT abort siblings */ }

Auditing: DependencyContainer subscribes '*' → EventRepository.saveEvent(event)
Replay:   InMemoryEventStore.getEventsByCorrelationId('corr_<goalId>')
```

---

## 8. Data Flow Diagrams

### 8.1 Control Flow (Layered Architecture)

```
┌──────────────────────────────────────────────────────────────┐
│ PRESENTATION                                                 │
│  packages/frontend (React SPA)  ───┐                         │
│  apps/server (HTTP + Eval)         │ HTTP /api/v1/*          │
└────────────────────────────────────┼─────────────────────────┘
                                     │ fetch
┌────────────────────────────────────▼─────────────────────────┐
│ DOMAIN ORCHESTRATION                                         │
│  packages/agent   (AgentCore: plan/act/verify/reflect/recover)│
│  packages/workflow (linear DAG runner)                       │
└────────────────────────────────────┬─────────────────────────┘
                                     │ depends on interfaces
┌────────────────────────────────────▼─────────────────────────┐
│ PROVIDERS (CTX-002/004)                                      │
│  packages/browser (Puppeteer)  packages/llm (stubbed)        │
│  packages/memory (in-memory)   packages/storage (Map+FS)     │
└────────────────────────────────────┬─────────────────────────┘
                                     │
┌────────────────────────────────────▼─────────────────────────┐
│ FOUNDATIONAL (CTX-001)                                       │
│  events (EventBus)  observability (Logger/Tracer)            │
│  capability  config  utils                                    │
└────────────────────────────────────┬─────────────────────────┘
                                     │
┌────────────────────────────────────▼─────────────────────────┐
│ KERNEL: packages/contracts (branded IDs, DTOs, errors, events)│
└──────────────────────────────────────────────────────────────┘
```

### 8.2 Request-to-Browser-Action Data Flow

```
{ goal: "Search Wikipedia for Alan Turing" }
   │
   ▼ AgentAppService → AgentCore
keyword inference → targetUrl = https://wikipedia.org
   │
   ▼ sessionManager.createSession({initialUrl})
BrowserLauncher.launch → puppeteer.launch(real Chrome) → newPage
   │
   ▼ tab.navigate(targetUrl) → page.goto(url, {waitUntil:'domcontentloaded'})
DOMSemanticEngine.buildGraph → page.evaluate(scrape 150 elements) → SemanticElementGraph
   │
   ▼ PageUnderstandingEngine.analyzePage → PageModel{pageType:'Article', primaryAction}
DecisionEvidenceEngine.evaluateCandidate(candidate, opts) → confidence 0.92, EXECUTE
   │
   ▼ BrowserActionEngine.executeAction(tab, {actionType:'type', selector, text})
page.type(selector, text) → real keystrokes
   │
   ▼ ExecutionVerifier.verifyAction → verified:true, confidence 0.9
ReflectionEngine.evaluateStep → not stuck → isSuccessful:true
   │
   ▼ episodicMemory.finalizeEpisode('success', duration) + lessons
return AgentGoalDto { status:'completed', steps[] }
```

---

## 9. User Lifecycle — End to End (Multiple Users)

> **Multi-tenancy model**: PinchTab currently has **no authentication, no user accounts, and no tenancy isolation**. The server is a single-tenant local process (host `127.0.0.1:8081`). "Multiple users" below therefore means **multiple concurrent browser sessions / agents**, each identified by a `SessionId`, which is the closest analogue to per-user isolation. The frontend is a single-user SPA whose session list is the user's workspace.

### 9.1 The Session as the Unit of Work

A **Session** (`SessionId`) is the atomic unit of isolation. Each session owns:
- Its own `BrowserSession` → real (or mock) Chromium instance with isolated tabs.
- Its own `EpisodicMemory` episode trace (per goal).
- Its own frontend workspace (tabs, downloads, timeline, notes, tasks) serialized to `localStorage`.

Sessions are created via `POST /api/v1/sessions` or `POST /api/v1/browser/launch`, or on the frontend via `createSession`. IDs are `sess_<timestamp>_<counter>`.

### 9.2 End-to-End Lifecycle of a Single Session

```
┌─ BIRTH ──────────────────────────────────────────────────────┐
│ Frontend: createSession(title, goal)                          │
│   ├─ id = sess_<ts>_<rand>                                     │
│   ├─ default URL https://github.com/pinchtab/pinchtab         │
│   ├─ 1 starter task, "Created new Session" timeline event     │
│   ├─ provision BrowserSession (BrowserManager.getOrCreate)     │
│   ├─ adapter.launch(sessionId, url) → POST /api/v1/browser/launch│
│   └─ persist to localStorage['pinchtab_sessions_v1']           │
│                                                                │
│ Backend (on launch):                                           │
│   ├─ BrowserLauncher.launch → puppeteer.launch(real Chrome)    │
│   ├─ BrowserSessionManager.createSession → BrowserSession       │
│   ├─ initial tab → page.goto(initialUrl)                       │
│   └─ EventBus.publish('browser:session:created')               │
└────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─ ACTIVE USE ──────────────────────────────────────────────────┐
│ A) Manual browsing via EmbeddedBrowser:                       │
│    omnibar → navigateTab → POST /api/v1/browser/navigate      │
│    → real page.goto → tabs/cookies/events update              │
│    screenshot polling 1.5s → real page.screenshot             │
│                                                                │
│ B) Autonomous agent goal:                                      │
│    user submits goal → POST /api/v1/agents/goals              │
│    → AgentCore.executeGoal → ReAct-like loop (§5.5)           │
│    → episodic episode recorded with actions/evidence/recovery │
│                                                                │
│ C) Workflow execution:                                         │
│    POST /api/v1/workflows/run → linear DAG over agent goals   │
│                                                                │
│ D) Background events:                                          │
│    every domain event → EventBus → EventRepository (audit)    │
└────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─ PERSIST / SWITCH ────────────────────────────────────────────┐
│ Frontend openSession(otherId):                                │
│   ├─ serialize current browser snapshot → localStorage        │
│   │     key pinchtab_browser_snap_<outgoingId>                │
│   ├─ deserialize incoming snapshot → BrowserSession           │
│   └─ activeBrowserSession swapped (per-session restorable)    │
│                                                                │
│ State transitions: active ⇄ paused (frontend); backend        │
│ agent state machine idle→planning→executing→...→completed     │
└────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─ DEATH ───────────────────────────────────────────────────────┐
│ DELETE /api/v1/sessions/:id  OR  closeSession(id):            │
│   ├─ BrowserSession.close → close all tabs + IBrowserInstance │
│   ├─ delete from SessionRepository                            │
│   ├─ EventBus.publish('browser:session:closed')               │
│   ├─ frontend: browserManager.destroyBrowser(id)              │
│   └─ remove localStorage browser snapshot                     │
│                                                                │
│ deleteSession(id): also removes session from store + storage  │
│                                                                │
│ Process shutdown (SIGINT): runtime.stop() → closeAllSessions  │
│ → every Chromium closed (no orphaned processes invariant)     │
└────────────────────────────────────────────────────────────────┘
```

### 9.3 Concurrent "Users" (Concurrent Sessions) Model

```
                    ┌───────────────────────────────────┐
                    │   PinchTab Server (single process)│
                    │   http://127.0.0.1:8081           │
                    └───────────────┬───────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
   ┌────▼────┐                ┌─────▼────┐               ┌─────▼────┐
   │ Session │                │ Session  │      ...       │ Session  │
   │ sess_A  │                │ sess_B   │               │ sess_N   │
   │ (User1) │                │ (User2)  │               │ (UserN)  │
   └────┬────┘                └─────┬────┘               └─────┬────┘
        │                           │                           │
   ┌────▼────┐                ┌─────▼────┐               ┌─────▼────┐
   │ Chromium│                │ Chromium │      ...       │ Chromium │
   │ instance│                │ instance │               │ instance │
   │ (real)  │                │ (real)   │               │ (mock if │
   │ 3 tabs  │                │ 1 tab    │               │  no Chr) │
   └─────────┘                └──────────┘               └──────────┘

Shared singletons (NOT isolated per session):
   - EventBus (all events flow through one bus; correlationId ties to goal)
   - MultiTierMemoryManager (records can carry sessionId but share maps)
   - SqliteClient / repositories
   - AgentCore (single agent instance; runs one goal at a time)

Isolated per session:
   - BrowserSession + its Chromium process + tabs
   - EpisodicMemory episode for the active goal
   - Frontend localStorage workspace
```

**Concurrency characteristics**:
- **Browser sessions are isolated** at the process/context level (separate Chromium, separate tabs, optionally incognito context).
- **The AgentCore is a single instance** wired in `DependencyContainer` — it runs **one goal at a time** (no per-session agent pool). Concurrent `/api/v1/agents/goals` calls would serialize/block on the shared agent.
- **Memory is shared** across sessions (in-memory maps); `MemoryRecordDto.sessionId` tags provenance but does not enforce read isolation. A `searchMultiTier` returns matches from all sessions.
- **EventBus is shared**; correlation IDs (`corr_<goalId>`) disambiguate event streams.
- **No auth/rate-limiting per caller** — CORS is open (`*`); any local client can hit any endpoint.

### 9.4 Frontend "Multi-Session" Workspace (Single User, Many Sessions)

The frontend models a **single user managing many sessions** (the workspace metaphor):

```
WorkspaceRail (48px)             Main area
┌────┐ ┌────────────────────────────────────────────────────┐
│ P  │ │  HomePage: stats + recent sessions grid             │
│ 📚 │ │  ┌────────┐ ┌────────┐ ┌────────┐                  │
│ 🔍 │ │  │sess_A  │ │sess_B  │ │sess_C  │  (max 6 shown)   │
│ ⬇️  │ │  │active  │ │paused  │ │complet │                  │
│ •• │ │  │75% ▓▓▓░ │ │40% ▓▓░░│ │100% ▓▓▓│                  │
│ ⚙️  │ │  └────────┘ └────────┘ └────────┘                  │
└────┘ └────────────────────────────────────────────────────┘

Clicking a session → /session/:id → SessionPage:
┌─────────────────────────────────────────────────────────────┐
│ Title [status]  goal…  ▓▓▓░  ⋯(archive)                     │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │ EmbeddedBrowser: live Chromium screenshot viewport  │   │
│  │ [tab1] [tab2] [+]    back/fwd/reload | https://… 🔒 │   │
│  │ [     real base64 PNG screenshot, refresh 1.5s    ] │   │
│  └─────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│ AI Dock (Cmd+Shift+D): [Timeline][Notes][Tasks][Downloads]  │
└─────────────────────────────────────────────────────────────┘
```

**Session status lifecycle** (frontend): `active ⇄ paused → completed → archived` (or deleted). Status drives `Badge` color (active→success, paused→warning, completed→primary, archived→neutral).

---

## 10. Concurrency, Memory & Persistence Model

### 10.1 Concurrency Primitives (`@pinchtab/utils/async`)

| Primitive | Use | Where |
|---|---|---|
| `Mutex` | Serialize access to in-memory stores | every `BaseMemoryStore`, `SqliteClient`, `SessionRepository`, `EventRepository` |
| `Semaphore` | Bounded concurrency | (available, used by futures) |
| `RateLimiter` | Token-bucket throttle | both LLM adapters (OpenRouter 60/min, Ollama 120/min) |
| `retryWithBackoff` | Exponential backoff + jitter | LLM adapter calls |

### 10.2 Memory Hierarchy

| Tier | Class | Backing | Recall | Purpose |
|---|---|---|---|---|
| `working` | `WorkingMemoryStore` | in-memory `Map` | substring | active prompt context |
| `short_term` | `WorkingMemoryStore` | in-memory `Map` | substring | session observations |
| `procedural` | `WorkingMemoryStore` | in-memory `Map` | substring | reusable action scripts |
| `episodic` | `EpisodicMemoryStore` | in-memory `Map` | newest-first + substring | chronological traces |
| `semantic` | `SemanticMemoryStore` | in-memory `Map` | **cosine similarity** | facts/knowledge |
| — (engine) | `EpisodicMemoryManager` | in-memory `Map` | `queryEpisodes` filter | structured agent episodes + lessons |

### 10.3 Persistence Reality

| Store | Documented | Actual |
|---|---|---|
| Relational | SQLite/Drizzle + PostgreSQL | ⚠️ `SqliteClient` returns `[]`; real data in `Map` |
| Cache/PubSub | Redis | ❌ absent (in-process `EventBus`) |
| Vector | Qdrant | ❌ pure-TS `cosineSimilarity` over arrays |
| Files | local FS | ✅ `LocalFileStorage` writes to `.pinchtab-storage/` (real) |
| Event log | durable | ⚠️ `EventRepository` in-memory; `InMemoryEventStore` ring buffer (10k cap) |
| Frontend | localStorage | ✅ `pinchtab_sessions_v1`, `pinchtab_browser_snap_<id>`, `pinchtab_settings_v1`, `pinchtab_theme`, `pinchtab_wf_snap_*` |

**Restart behavior**: All in-memory data (sessions, memory, events) is **lost on process restart**. Only `LocalFileStorage` artifacts (downloads, summaries under `.pinchtab-storage/`) and the frontend's localStorage survive.

---

## 11. Security, Stealth & Policy

### 11.1 Stealth Engine (`@pinchtab/browser/stealth/`)

Layered anti-detection (ADR-0005):
1. **Launch flags**: `--disable-blink-features=AutomationControlled`, `--no-sandbox`, `--disable-infobars`, window size, GPU flags.
2. **Injected scripts** (`evaluateOnNewDocument`):
   - `navigator.webdriver` → `undefined`.
   - `window.chrome` mock (runtime/loadTimes/csi/app).
   - WebGL vendor/renderer spoofed to NVIDIA RTX 3080.
   - `navigator.hardwareConcurrency` (8), `platform` (Win32), `languages` (en-US, en).
   - Default User-Agent: Chrome 122 on Windows 10.

### 11.2 Sandboxing & Policy (Documented vs. Actual)

- **Documented** (`policy` package, ADR-0005): every tool execution passes through `@pinchtab/policy` guardrails; tools run in isolated child processes with 30s timeouts; path bounds; rate limits; approvals.
- **Actual**: the `policy`/`tools` packages **do not exist as directories**. The only real guardrails are:
  - `LocalFileStorage.resolvePath()` — **path-traversal protection** (rejects keys escaping baseDir).
  - `BrowserActionEngine` — per-action timeouts (15s) + retries (2).
  - `utils/formatters/sanitizePromptText` — strips control/zero-width chars.
  - `sdk/PluginSandbox` — permission-set assertion (no process isolation); `MarketplaceRegistry.verifySignature` is a `'sig_valid_'` prefix stub.

### 11.3 Secret Handling

- `@pinchtab/config` loads `PINCHTAB_OPENROUTER_API_KEY` etc. via Zod; `secret-masker` masks for logging.
- ⚠️ CORS is fully open (`Access-Control-Allow-Origin: *`) — acceptable for localhost, risky if exposed.
- ⚠️ **No authentication/authorization** on any endpoint.

### 11.4 Prompt-Injection Surface

- `BrowserActionEngine.click_by_text` **string-interpolates `text` directly into an XPath** — a quote-injection vector.
- Frontend `variableStore.evaluateCondition` uses `new Function('vars', 'return Boolean(<expr>)')` — **arbitrary code execution** if workflows come from untrusted sources.

---

## 12. Evaluation & Validation Evidence

### 12.1 Benchmark Dataset (`.pinchtab-eval/`)

- **102 tasks**, 15 categories (see §5.6).
- `evaluation-results.json` records per-task: `success`, `durationMs`, `planningTimeMs`, `llmLatencyMs`, `memoryLatencyMs`, `actionCount`, `recoveryAttempts`, `timeline[]`.
- Sample: `nav_01` "Open GitHub Homepage" — success, 1923ms, 3 actions, 0 recoveries.

### 12.2 Real-World Validation (`real-world-evidence.json`)

**16 live-website tasks** spanning 9 groups (A–J):

| # | Task | Group |
|---|------|-------|
| 0 | Wikipedia: search Alan Turing, return birth date | Knowledge |
| 1 | Wikipedia: search Ada Lovelace, return occupation | Knowledge |
| 2 | Wikipedia: search OpenAI, summarize first paragraph | Knowledge |
| 3 | Google: search "OpenAI GPT", return first 5 results | Search |
| 4 | Search "Python dataclasses", open docs, summarize | Search |
| 5 | GitHub: search PinchTab, read README, summarize | GitHub |
| 6 | Search Microsoft TypeScript repo, latest release | GitHub |
| 7 | Hacker News: read first article, summarize | News |
| 8 | BBC News: read top headline, summarize | News |
| 9 | MDN: search Fetch API, summarize | Docs |
| 10 | TypeScript docs: explain Generics | Docs |
| 11 | Identify name/email/message fields, fill (stop before submit) | Forms |
| 12 | Read public HTML table: row/column count, first row | Tables |
| 13 | Download public PDF, verify exists, summarize | Downloads |
| 14 | Navigate ≥3 pages, verify transitions | Pagination |
| 15 | Break execution with wrong selector, verify recovery | Recovery |

> ⚠️ Evidence is **partly hardcoded narrative** — only `tab.url`/`tab.title`/element counts are live; screenshots are placeholder `[Image: ...]` strings and LLM prompts/responses are literal strings.

### 12.3 Synthetic Reports

`ValidationProgramRunner` + `LaunchManager` return **hardcoded** `ProductionReadinessMetrics` (`reliability 98.5`, `goNoGoDecision:'GO'`, perf p50 420ms/p95 465ms). These are declarative metadata, **not measured**.

---

## 13. Known Gaps, Stubs & Technical Debt

Aggregated from code-level reading (the `.ai/known-problems.md` claims "None currently active" — contradicted below).

### High Impact

| # | Issue | Location | Impact |
|---|---|---|---|
| H1 | **LLM is dormant** — `ILlmProvider` wired but never called in the agent loop | `packages/agent/src/core/agent-core.ts` | Agent runs heuristically, not via LLM reasoning |
| H2 | **LLM adapters stubbed** — return canned completions, no `fetch` | `packages/llm/src/gateway/openrouter-adapter.ts`, `local/ollama-adapter.ts` | No real model inference |
| H3 | **`SqliteClient` stubbed** — `query()` returns `[]` | `packages/storage/src/db/sqlite-client.ts` | No real relational persistence |
| H4 | **Frontend action & workflow engines not wired** | `packages/frontend/src/runtime/{actions,workflow}` | Session goals don't drive actions; engines tested only |
| H5 | **No WebSocket** despite UI setting + plumbing | `packages/frontend`, `apps/server` | UI polls 1.5s; no live push |
| H6 | **`DevToolsController`/`StudioController` orphaned** | `apps/server/src/controllers/` | Dead code; not routed/exported |

### Medium Impact

| # | Issue | Location |
|---|---|---|
| M1 | `HttpBrowserTransport` swallows all errors (`{ok:false}`) | `frontend/src/runtime/browser/adapters/browserTransport.ts` |
| M2 | Server failures invisible to UI (adapter `.catch(()=>{})`) | `frontend/src/runtime/browser/browserSession.ts` |
| M3 | `BrowserCapabilityAPI.executeJavaScript` calls nonexistent `adapter.executeJavaScript` | `frontend/src/runtime/browser/browserCapabilityAPI.ts:79` |
| M4 | Actions pass literal `'active'` as `tabId` — adapters don't resolve it | `frontend/src/runtime/actions/impl/*` |
| M5 | `WorkflowRunner` only follows `nextNodes[0]` — no parallel/condition branching | `packages/workflow/src/runner/workflow-runner.ts` |
| M6 | `ApiRouter` doesn't parse query strings into `req.query` | `apps/server/src/gateway/api-router.ts` |
| M7 | XPath injection in `click_by_text` | `packages/browser/src/actions/browser-action-engine.ts` |
| M8 | `new Function()` eval in `variableStore.evaluateCondition` | `frontend/src/runtime/workflow/variableStore.ts` |
| M9 | `studio/index.ts` re-exports `.ts` not `.js` (ESM break) | `packages/observability/src/studio/index.ts:8` |
| M10 | `dev-runtime` uses `@hanumatrix/*` namespace (off-grid) | `packages/dev-runtime` |
| M11 | `MarketplaceRegistry.verifySignature` is a `'sig_valid_'` prefix stub | `packages/sdk/src/marketplace/` |
| M12 | `StabilizationBenchmarkSuite` pushes non-`BenchmarkTask` fields | `apps/server/src/eval/` |

### Documentation vs. Reality Drift

| Documented | Reality |
|---|---|
| Fastify server | `node:http` custom |
| Next.js + Tailwind | Vite + React + custom CSS |
| Playwright + CDP | Puppeteer-core |
| Drizzle/SQLite/PostgreSQL/Redis/Qdrant | in-memory `Map` (+ real local FS) |
| `policy`, `tools`, `orchestrator`, `runtime`, `knowledge`, `prompt`, `queue`, `registry`, `plugin`, `ui` packages | not present as directories |
| `.ai/project-state.md`: "100% complete, GO FOR RELEASE, zero debt" | LLM dormant, adapters stubbed, persistence in-memory |

---

## 14. Build, Test & Run Reference

### Commands (root)

```bash
pnpm install          # install all workspace deps
pnpm build            # turbo run build  (tsc per package, dependsOn ^build)
pnpm typecheck        # turbo run typecheck (tsc --noEmit) → 0 errors claimed
pnpm lint             # turbo run lint (--max-warnings 0)
pnpm test             # turbo run test (vitest)
pnpm dev              # turbo run dev (persistent)
pnpm clean            # turbo run clean
```

### Key Ports & Endpoints

| Concern | Value | Source |
|---|---|---|
| Backend HTTP | `http://127.0.0.1:8081` | `dependency-container.ts` (`PORT` env, default `8081`) |
| Gateway constant default | `8080` | `server-options.ts` (overridden by container) |
| Frontend dev server | `http://localhost:3000` (Vite, `VITE_PORT`/`PORT`) | `vite.config.ts` |
| `HttpBrowserTransport` default base | `http://localhost:8081` | `browserTransport.ts` |
| Frontend Settings default (unused) | `http://localhost:3000` / `ws://localhost:3000` | `SettingsPage.tsx` |
| Ollama host | `http://localhost:11434` | `ollama-options.ts` |
| OpenRouter base | `https://openrouter.ai/api/v1` | `openrouter-adapter.ts` |
| PinchTab server URL | `http://localhost:9876` | `config/env-schema.ts` |

> ⚠️ **Port discrepancy**: container forces 8081, gateway default is 8080, frontend Settings default is 3000, transport default is 8081. These are **not consistently connected**.

### Test Status (per `.ai/project-state.md`)

- 59/59 test files passed, 205/205 unit & integration tests passed (claimed).
- ⚠️ Frontend `vitest.config.ts` include globs (`tests/render`, `tests/interaction`, `tests/a11y`) **don't match** actual spec location (`tests/unit/`) — frontend `pnpm test` may run zero tests as configured.

### Runtime Data Directories

| Path | Contents |
|---|---|
| `.pinchtab-storage/` | `LocalFileStorage` artifacts (downloads, summaries) |
| `.pinchtab-eval/` | `evaluation-results.json`, `real-world-evidence.json` |
| `acceptance_artifacts/` | system acceptance test outputs |
| `.turbo/cache/` | Turborepo build cache |

---

## Appendix A — Core Interface Index

| Domain | Interface | Package |
|---|---|---|
| Browser provider | `IBrowserLauncher`, `IBrowserInstance`, `IBrowserSession`, `IBrowserTab`, `IBrowserSessionManager`, `IBrowserActionEngine`, `IDOMSemanticEngine`, `IPageUnderstandingEngine`, `ISnapshotGenerator`, `IStealthEngine` | browser |
| LLM provider | `ILlmProvider` | llm |
| Memory | `IMemoryStore`, `IMultiTierMemoryManager`, `IEpisodicMemoryManager` | memory |
| Storage | `ISqliteClient`, `ISessionRepository`, `IEventRepository`, `IFileStorage` | storage |
| Events | `IEventBus`, `IEventStore` | events |
| Config | `IConfigurationSource`, `IConfigurationProvider` | config |
| Capability | `CapabilityMatrix`, `ICapabilityRegistry` | capability |
| Agent | `IAgentCore`, `IRuntimeService`, `IStepExecutor` | agent |
| Workflow | `IWorkflowGraph`, `IWorkflowRunner` | workflow |
| Observability | `ILogTransport`, `StructuredLogger`, `Tracer`, `MetricsCollector` | observability |

## Appendix B — Key Domain Events (`DomainEventMap`)

| Event Topic | Emitted By |
|---|---|
| `browser:session:created` / `:closed` | `BrowserSessionManager` |
| `browser:page:navigated` | `BrowserSession` / `BrowserActionEngine` |
| `agent:goal:started` | `AgentCore` |
| `agent:state:changed` | `AgentStateMachine` |
| `agent:step:executed` | `StepExecutor` |
| `kernel:service:started` / `:failed` / `:stopped` | `RuntimeKernel` |
| `llm:stream:chunk` | (LLM adapters, stubbed) |
| `tool:execution:completed` | (tools package, absent) |
| `workflow:execution:started` / `:completed` / `:failed` | `WorkflowRunner` |

---

*This document reflects the codebase as of 2026-07-30. It supersedes the over-optimistic `.ai/` state files for implementation reality while treating `docs/00–23` + ADRs as the target architecture.*

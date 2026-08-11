# PinchTab Architecture

## Overview

PinchTab is a browser automation and AI-powered tab management application built as a monorepo with multiple packages.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        PinchTab Monorepo                         │
├─────────────────────────────────────────────────────────────────┤
│  packages/                                                       │
│  ├── frontend/          # Next.js + React + Tailwind + shadcn/ui │
│  ├── backend/           # Fastify + TypeScript API               │
│  ├── desktop/           # Electron/Tauri Desktop App              │
│  ├── core/              # Core domain logic & entities           │
│  ├── shared/            # Shared utilities & types               │
│  ├── providers/         # Provider implementations                │
│  │   ├── llm/           # LLM Provider implementations           │
│  │   ├── browser/       # Browser automation providers           │
│  │   ├── storage/       # Storage providers (local, cloud)       │
│  │   └── memory/        # Memory/Vector storage providers        │
│  ├── types/             # Shared TypeScript types                │
│  ├── utils/             # Shared utilities                       │
│  └── configs/           # Shared configs (tsconfig, eslint, etc) │
└─────────────────────────────────────────────────────────────────┘
```

## Core Principles

1. **Domain-Driven Design** - Core domain logic isolated in `packages/core`
2. **Provider Pattern** - All external integrations via provider interfaces
3. **Type Safety** - Strict TypeScript across all packages
3. **Monorepo** - Managed with pnpm workspaces and Turborepo
4. **Type Safety** - Strict TypeScript, strict ESLint, strict Prettier
5. **Testing** - Vitest for unit/integration, Playwright for E2E

## Package Dependencies

```
frontend  → core, shared, types, providers/*
backend   → core, shared, types, providers/*
desktop   → frontend, backend, core, shared, types
core      → types, shared
shared    → types
providers/* → core, types, shared
types     → (no deps)
utils     → types
configs   → (no deps)
```

## Core Domain Model

```
Session → Tab → Action → Result
   │         │        │
   │         │        └── Screenshot, DOM, Console, Network
   │         └── URL, Title, State, Metadata
   └── ID, User, CreatedAt, Config
```

## Provider Interfaces

Each provider type defines an interface in `packages/core/providers/`:

- `LLMProvider` - LLM completions, embeddings, tools
- `BrowserProvider` - Browser automation (Playwright, CDP, CDP)
- `StorageProvider` - Key-value, blob, structured storage
- `MemoryProvider` - Vector search, embeddings, retrieval

## Communication Patterns

- **Frontend ↔ Backend**: REST API + WebSocket (tRPC planned)
- **Desktop ↔ Backend**: IPC (Electron) or Tauri commands
- **Backend ↔ Providers**: Direct dependency injection
- **Frontend ↔ Providers**: Via backend API only

## Data Flow

```
User Action (Frontend)
    → API Request (Backend)
    → Domain Service (Core)
    → Provider Interface (Core)
    → Provider Implementation (Providers/*)
    → External Service (LLM, Browser, DB)
    → Result → Domain Entity → API Response → Frontend
```

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14, React 18, TypeScript, Tailwind CSS, shadcn/ui |
| Backend | Fastify, TypeScript, tRPC (planned), Prisma (planned) |
| Desktop | Tauri (preferred) / Electron |
| Database | PostgreSQL (prod), SQLite (dev), Redis (cache) |
| Vector DB | Qdrant / Pinecone / pgvector |
| Browser | Playwright, CDP |
| LLM | OpenAI, Anthropic, Ollama, LocalAI |
| Vector DB | Qdrant, Pinecone, pgvector |
| Queue | BullMQ (Redis) |
| Auth | NextAuth.js / Better Auth |
| Monitoring | OpenTelemetry, Grafana, Loki |

## Deployment Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Vercel    │     │  Railway/   │     │   Docker    │
│  (Frontend) │────▶│  Render     │────▶│  (Backend)  │
│             │     │  (Backend)  │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    │  PostgreSQL │
                    │    Redis    │
                    │   Qdrant    │
                    └─────────────┘
```

## Security Considerations

- All API communication over HTTPS/WSS
- API keys encrypted at rest (age/sops)
- Browser automation sandboxed
- Rate limiting on all public APIs
- Audit logging for all actions
- Secrets managed via 1Password/HashiCorp Vault

## Scalability

- Stateless backend (horizontal scaling)
- Redis for session/cache
- BullMQ for job queues
- Qdrant for vector search
- CDN for static assets
- Edge functions for edge compute
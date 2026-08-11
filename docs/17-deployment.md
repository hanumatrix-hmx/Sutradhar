---
Version: 1.0.0
Status: APPROVED
Implementation Ready: YES
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Next Review: 2026-10-28
Review Frequency: Quarterly
Depends on ADRs:
  - 0001-monorepo
References ADRs:
  - 0002-browser-runtime
Related Packages:
  - 'apps/server'
  - 'apps/web'
---

# Deployment Architecture & Containerization

## 1. Environment Configurations

- **Local Standalone**: Fastify server + Next.js dashboard + local SQLite + local Ollama.
- **Enterprise Distributed**: Containerized Fastify API instances + Next.js web instances + PostgreSQL + Redis + Qdrant cluster.

## 2. Containerization Strategy

Multi-stage Dockerfiles isolate build dependencies from runtime containers:

```dockerfile
# Build Stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Runtime Stage
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
CMD ["node", "apps/server/dist/index.js"]
```

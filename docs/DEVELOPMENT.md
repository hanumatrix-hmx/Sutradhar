# PinchTab Development Setup

## Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Git
- Docker & Docker Compose (for local services)
- Git

## Quick Start

```bash
# Clone the repository
git clone <repository-url>
cd PinchTab

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env.local

# Start local services (PostgreSQL, Redis, Qdrant)
docker-compose up -d

# Run database migrations
pnpm db:migrate

# Start development servers
pnpm dev
```

## Available Commands

```bash
# Development
pnpm dev              # Start all dev servers (frontend, backend, desktop)
pnpm dev:frontend     # Frontend only (Next.js)
pnpm dev:backend      # Backend only (Fastify)
pnpm dev:desktop      # Desktop only (Tauri/Electron)

# Building
pnpm build            # Build all packages
pnpm build:frontend
pnpm build:backend
pnpm build:desktop

# Testing
pnpm test             # Run all tests
pnpm test:unit        # Unit tests only
pnpm test:integration # Integration tests only
pnpm test:e2e         # E2E tests (Playwright)
pnpm test:watch       # Watch mode

# Code Quality
pnpm lint             # Lint all packages
pnpm lint:fix         # Auto-fix lint issues
pnpm format           # Format with Prettier
pnpm typecheck        # TypeScript type checking

# Database
pnpm db:migrate       # Run migrations
pnpm db:studio        # Open Prisma Studio
pnpm db:seed          # Seed database
pnpm db:reset         # Reset database

# Docker
pnpm docker:build     # Build all Docker images
pnpm docker:up        # Start all services
pnpm docker:down      # Stop all services
pnpm docker:logs      # View logs

# Desktop
pnpm tauri:dev        # Tauri dev mode
pnpm tauri:build      # Build Tauri app
pnpm electron:dev     # Electron dev mode
pnpm electron:build   # Build Electron app

# Utilities
pnpm clean            # Clean all build artifacts
pnpm changeset        # Create changeset for versioning
pnpm version          # Version packages
pnpm release          # Publish to npm
```

## Environment Variables

See `.env.example` for all required variables. Key variables:

```bash
# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/pinchtab"
REDIS_URL="redis://localhost:6379"

# Vector Database
QDRANT_URL="http://localhost:6333"

# LLM Providers
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY="sk-ant-..."
OLLAMA_BASE_URL="http://localhost:11434"

# Auth
NEXTAUTH_SECRET="..."
NEXTAUTH_URL="http://localhost:3000"

# Browser Automation
PLAYWRIGHT_BROWSERS_PATH="/path/to/browsers"

# Frontend
NEXT_PUBLIC_API_URL="http://localhost:4000"
NEXT_PUBLIC_WS_URL="ws://localhost:4000"
```

## Project Structure

```
PinchTab/
├── .github/workflows/     # GitHub Actions CI/CD
├── .husky/                # Git hooks
├── .vscode/               # VS Code settings
├── docs/                  # Documentation
├── packages/
│   ├── frontend/          # Next.js frontend
│   ├── backend/           # Fastify backend
│   ├── desktop/           # Tauri/Electron app
│   ├── core/              # Core domain logic
│   ├── shared/            # Shared utilities
│   ├── providers/         # Provider implementations
│   ├── types/             # Shared TypeScript types
│   ├── utils/             # Shared utilities
│   └── configs/           # Shared configs
├── docker-compose.yml     # Local services
├── docker-compose.override.yml
├── docker-compose.prod.yml
├── turbo.json             # Turborepo config
├── pnpm-workspace.yaml    # pnpm workspace config
├── package.json           # Root package.json
├── tsconfig.json          # Root TypeScript config
├── .eslintrc.js           # ESLint config
├── .prettierrc            # Prettier config
├── .env.example           # Environment template
├── .gitignore
├── .prettierignore
├── .eslintignore
├── turbo.json             # Turborepo config
└── README.md
```

## Package Manager

This project uses **pnpm** with workspaces. Never use npm or yarn.

```bash
# Add dependency to a package
pnpm --filter @pinchtab/frontend add <package>
pnpm --filter @pinchtab/backend add -D <package>

# Add to all packages
pnpm add -w <package>

# Run command in specific package
pnpm --filter @pinchtab/frontend <command>

# Run command in all packages
pnpm -r <command>
```

## TypeScript Configuration

All packages use strict TypeScript configuration from `packages/configs/tsconfig`:

```json
{
  "extends": "@pinchtab/configs/tsconfig/base.json"
}
```

Package-specific configs extend the base:

```json
{
  "extends": "@pinchtab/configs/tsconfig/nextjs.json"
}
```

## ESLint Configuration

All packages use shared ESLint config from `packages/configs/eslint`:

```json
{
  "extends": ["@pinchtab/configs/eslint/base"],
  "rules": { }
}
```

## Prettier Configuration

Shared Prettier config from `packages/configs/prettier`:

```json
{
  "printWidth": 100,
  "tabWidth": 2,
  "singleQuote": true,
  "trailingComma": "es5",
  "semi": true
}
```

## Git Hooks

Husky hooks configured in `.husky/`:

- `pre-commit`: lint-staged (lint + format staged files)
- `commit-msg`: commitlint (conventional commits)
- `pre-push`: typecheck + test

## IDE Setup (VS Code)

Recommended extensions (in `.vscode/extensions.json`):

- ESLint
- Prettier
- TypeScript Hero
- Tailwind CSS IntelliSense
- Prisma
- Tauri
- Docker

Settings in `.vscode/settings.json`:

- Format on save
- ESLint fix on save
- TypeScript auto-import

## Debugging

### Frontend (Next.js)

```json
// .vscode/launch.json
{
  "type": "next.js",
  "request": "launch",
  "name": "Next.js Debug",
  "port": 9229
}
```

### Backend (Fastify)

```json
{
  "type": "node",
  "request": "launch",
  "name": "Backend Debug",
  "program": "${workspaceFolder}/packages/backend/src/main.ts",
  "outFiles": ["${workspaceFolder}/packages/backend/dist/**/*.js"]
}
```

### Desktop (Tauri)

```json
{
  "type": "node",
  "request": "launch",
  "name": "Tauri Debug",
  "cwd": "${workspaceFolder}/packages/desktop",
  "runtimeExecutable": "pnpm",
  "runtimeArgs": ["tauri:dev"]
}
```

## Database

### Local Development

```bash
# Start PostgreSQL, Redis, Qdrant
docker-compose up -d

# Run migrations
pnpm db:migrate

# Open Prisma Studio
pnpm db:studio
```

### Migrations

```bash
# Create migration
pnpm --filter @pinchtab/backend db:migrate:create <name>

# Apply migrations
pnpm db:migrate

# Reset database
pnpm db:reset
```

## Testing

### Unit Tests (Vitest)

```bash
# Run all unit tests
pnpm test:unit

# Run with coverage
pnpm test:unit -- --coverage

# Watch mode
pnpm test:watch
```

### Integration Tests

```bash
pnpm test:integration
```

### E2E Tests (Playwright)

```bash
# Install browsers
pnpm --filter @pinchtab/frontend exec playwright install

# Run E2E tests
pnpm test:e2e

# UI mode
pnpm test:e2e -- --ui
```

## Building

### Development Build

```bash
pnpm build
```

### Production Build

```bash
pnpm build -- --filter=@pinchtab/frontend --filter=@pinchtab/backend
```

### Desktop Build

```bash
# Tauri
pnpm tauri:build

# Electron
pnpm electron:build
```

## Docker

### Development

```bash
docker-compose up -d
docker-compose logs -f
```

### Production

```bash
docker-compose -f docker-compose.prod.yml up -d
```

## Troubleshooting

### Port Conflicts

Default ports:
- Frontend: 3000
- Backend: 4000
- Backend WS: 4001
- PostgreSQL: 5432
- Redis: 6379
- Qdrant: 6333

Change in `.env.local` if needed.

### Database Connection Issues

```bash
# Check PostgreSQL is running
docker-compose ps

# Check connection
psql $DATABASE_URL -c "SELECT 1"

# Reset database
pnpm db:reset
```

### TypeScript Errors

```bash
# Full type check
pnpm typecheck

# Clear TypeScript cache
pnpm clean && pnpm install && pnpm typecheck
```

### pnpm Issues

```bash
# Clear pnpm store
pnpm store prune

# Reinstall
rm -rf node_modules packages/*/node_modules
pnpm install
```

## Useful Links

- [Turborepo Docs](https://turbo.build/repo/docs)
- [pnpm Workspaces](https://pnpm.io/workspaces)
- [Next.js Docs](https://nextjs.org/docs)
- [Fastify Docs](https://fastify.dev/docs/latest/)
- [Tauri Docs](https://tauri.app/v1/guides/)
- [Playwright Docs](https://playwright.dev/docs/intro)
- [Vitest Docs](https://vitest.dev/guide/)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [shadcn/ui](https://ui.shadcn.com/docs)
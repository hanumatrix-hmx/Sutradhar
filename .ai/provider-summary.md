---
State Category: Generated / Session
Schema Version: 1.0.0
Machine Readable: true
Update Ownership: AI Agent / Automated Pipeline
Last Updated: 2026-07-28
Owner: Principal Software Architect
---

# AI Infrastructure Provider Summary

## Planned & Supported Provider Adapters

### 1. Browser Providers (`packages/browser`)

- **Sutradhar**: Primary browser automation server & WebSocket bridge.
- **CDP (Chrome DevTools Protocol)**: Direct lightweight Chrome protocol client.
- **Playwright**: Local headless browser automation runner.
- **Cloud Remote**: External cloud browser service adapter (e.g. Browserbase).

### 2. LLM Providers (`packages/llm`)

- **OpenRouter**: Cloud LLM API gateway (200+ models).
- **Ollama**: Local LLM inference engine runner.
- **OpenAI**: Direct OpenAI API provider.
- **Anthropic**: Direct Anthropic API provider.

### 3. Persistence & Vector Providers (`packages/storage`, `packages/memory`)

- **SQLite / Drizzle**: Local relational session database.
- **PostgreSQL**: Enterprise relational persistence.
- **Redis**: Multi-node cache and pub/sub event bus.
- **Qdrant**: Vector database for semantic knowledge and procedural skills.

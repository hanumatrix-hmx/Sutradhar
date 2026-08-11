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
  - 0001-monorepo
Related Packages:
  - '@sutradhar/contracts'
---

# Ubiquitous Domain Language & Glossary

## Domain Vocabulary Definitions

- **Agent**: An autonomous entity defined by a profile, goals, capabilities, and execution state.
- **Browser Session**: An isolated incognito browser execution context containing tabs and page states.
- **Cognitive ReAct Loop**: The iterative Reason + Act cognitive execution loop (Observe -> Reason -> Act -> Verify).
- **Capability Matrix**: Standardized feature declaration map used for runtime discovery across LLM models and browser providers.
- **Episodic Memory**: Permanent storage capturing historical agent execution traces and observations.
- **Hexagonal Architecture**: Architectural pattern decoupling core domain logic from external infrastructure via contracts and adapters.
- **Inspector**: The interactive Next.js dashboard used to observe agent reasoning, live browser views, and event streams.
- **Sutradhar**: Primary headless/headed browser control server and protocol.
- **Procedural Memory**: Vector-indexed repository of verified, reusable web action sequences.
- **Semantic Memory**: Vector database storing domain facts and ingested document knowledge.
- **Working Memory**: In-memory ring buffer representing the current active LLM prompt context window.

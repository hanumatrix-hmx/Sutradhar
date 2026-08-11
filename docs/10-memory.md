---
Version: 1.0.0
Status: APPROVED
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Next Review: 2026-10-28
Review Frequency: Quarterly
Related ADRs:
  - 0006-memory
Related Packages:
  - '@sutradhar/memory'
  - '@sutradhar/knowledge'
---

# Multi-Tier Memory Specification

## 1. Overview

Sutradhar implements a 4-tier memory architecture to manage short-term execution buffers alongside long-term semantic knowledge.

## 2. Memory Tiers

| Memory Tier           | Storage Backend           | Scope & Lifecycle   | Purpose                              |
| :-------------------- | :------------------------ | :------------------ | :----------------------------------- |
| **Working Memory**    | In-Memory Ring Buffer     | Single ReAct Step   | Active LLM prompt context window.    |
| **Short-Term Memory** | Relational / Redis        | Active Session      | Recent tool observations & messages. |
| **Episodic Memory**   | Relational DB (SQLite/PG) | Permanent per Agent | Full historical execution traces.    |
| **Semantic Memory**   | Qdrant / Vector Index     | Cross-Agent Global  | Vector-indexed facts and knowledge.  |
| **Procedural Memory** | Vector / Document Store   | Cross-Agent Global  | Verified reusable web action flows.  |

## 3. Hybrid Retrieval Engine

Retrieval combines BM25 sparse keyword matching with dense vector embeddings (OpenAI / local embeddings) reranked by cross-encoder similarity scores.

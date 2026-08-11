---
Number: '0006'
Title: Multi-Tiered Vector & Fact Memory Architecture
Version: 1.0.0
Status: APPROVED
Implementation Ready: YES
Owner: Principal Software Architect
Date: 2026-07-28
Superseded Versions: None
Related Packages:
  - '@sutradhar/memory'
  - '@sutradhar/knowledge'
---

# ADR 0006: Multi-Tiered Vector & Fact Memory Architecture

## 1. Context

AI browser automation workflows range from transient single-step page actions to multi-day research tasks across multiple sessions. A simple in-memory message history buffer is insufficient for long-term task retention or fact retrieval.

## 2. Decision

We decide to implement a **4-Tier Hybrid Memory System**:

1. **Working Memory**: In-memory ring buffer for active prompt context.
2. **Short-Term Memory**: Relational/Redis storage for active session observations.
3. **Episodic Memory**: Relational database (SQLite/PG) capturing permanent agent action traces.
4. **Semantic Memory**: Qdrant / Vector Index storing facts, ingested documents, and procedural web scripts.

Retrieval combines BM25 sparse keyword search with dense vector similarity embeddings.

## 3. Alternatives Considered

- **Option A (Vector Storage Only)**: Storing all message history in a vector database.
  - _Rejected due to poor chronological retrieval, high embedding API costs, and context fragmentation._

## 4. Consequences

### Positive

- High precision retrieval combining exact keyword matches with semantic similarity.
- Efficient context window management via automated working memory compaction.

### Negative

- Requires managing both relational (SQLite/PG) and vector (Qdrant) storage engines.

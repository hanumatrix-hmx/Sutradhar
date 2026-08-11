---
Number: '0002'
Title: Pluggable Browser Runtime & Context Isolation Engine
Version: 1.0.0
Status: APPROVED
Implementation Ready: YES
Owner: Principal Software Architect
Date: 2026-07-28
Superseded Versions: None
Related Packages:
  - '@sutradhar/browser'
  - '@sutradhar/runtime'
---

# ADR 0002: Pluggable Browser Runtime & Context Isolation Engine

## 1. Context

AI browser agents require browser automation capability with support for local Sutradhar instances, direct Chrome DevTools Protocol (CDP), local Playwright sessions, and remote cloud browser providers (e.g. Browserbase).

## 2. Decision

We decide to build a **Pluggable Browser Abstraction Layer** (`@sutradhar/browser`) decoupled from execution lifecycles (`@sutradhar/runtime`).

- All browser interactions occur through pure domain entities (`BrowserSession`, `BrowserTab`, `BrowserSnapshot`).
- Concrete browser implementations (`Sutradhar`, `CDP`, `Playwright`) implement the `IBrowserProvider` contract.
- Each `BrowserSession` runs within an isolated incognito context with dedicated memory limits and automatic teardown hooks.

## 3. Alternatives Considered

- **Option A (Direct Playwright Coupling)**: Tightly coupling agent reasoning loops directly to Playwright API calls.
  - _Rejected due to vendor lock-in, inability to switch to remote cloud browser providers, and high resource consumption._
- **Option B (HTTP Proxy Layer Only)**: Forcing all browser commands through an external HTTP proxy.
  - _Rejected due to latency overhead and loss of real-time WebSocket DOM mutation streams._

## 4. Consequences

### Positive

- Zero vendor lock-in; seamless switching between Sutradhar, CDP, Playwright, or cloud providers.
- DOM snapshot pruning reduces context token usage by up to 90%.

### Negative

- Requires maintaining normalization adapters for each browser provider.

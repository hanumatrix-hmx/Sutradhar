---
Version: 1.0.0
Status: APPROVED
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Next Review: 2026-10-28
Review Frequency: Quarterly
Related ADRs:
  - 0001-monorepo
Related Packages:
  - '@sutradhar/ui'
  - 'apps/web'
---

# UI Guidelines & Web Inspector Design

## 1. Design System Tokens

- **Framework**: Next.js App Router, TailwindCSS, shadcn/ui.
- **Color Palette**: Dark mode by default (`slate-950` background, `emerald-500` active highlights, `amber-500` warning alerts).
- **Typography**: Inter / Outfit for modern, crisp UI readability.

## 2. Inspector Panels

- **Live Canvas View**: Displays real-time browser page screenshots with element highlight overlays.
- **Accessibility & DOM Tree**: Displays semantic accessibility tree nodes and clickable element IDs.
- **Reasoning Stream**: Displays agent CoT (Chain-of-Thought) reasoning steps, tool payloads, and verifier check outputs.

# Sutradhar Frontend Testing Strategy

## Testing Pyramid

### Tier 1 — Design System Contract Tests
- **Environment**: Node (root vitest)
- **Purpose**: Verify component API contracts — names, variants, sizes, prop shapes, threshold values
- **Location**: `packages/frontend/tests/unit/*.spec.ts`
- **Naming**: `*.spec.ts`
- **Does NOT import React** — runs at workspace root where react is unavailable

### Tier 2 — React Rendering Tests
- **Environment**: jsdom (frontend-scoped vitest)
- **Purpose**: Verify DOM output, CSS classes, ARIA attributes, disabled/loading states, variant rendering
- **Location**: `packages/frontend/tests/render/*.spec.tsx`
- **Naming**: `*.spec.tsx`
- **Uses**: `@testing-library/react`

### Tier 3 — Component Interaction Tests
- **Environment**: jsdom (frontend-scoped vitest)
- **Purpose**: Verify click handlers, keyboard navigation, focus management, state transitions
- **Location**: `packages/frontend/tests/interaction/*.spec.tsx`
- **Naming**: `*.spec.tsx`
- **Uses**: `@testing-library/react`, `@testing-library/user-event`

### Tier 4 — Accessibility Tests
- **Environment**: jsdom (frontend-scoped vitest)
- **Purpose**: Verify WAI-ARIA compliance, role attributes, keyboard operability, screen reader labels
- **Location**: `packages/frontend/tests/a11y/*.spec.tsx`
- **Naming**: `*.spec.tsx`
- **Uses**: `@testing-library/react`, `jest-axe` (future)

### Tier 5 — End-to-End Tests
- **Environment**: Browser (Playwright, future)
- **Purpose**: Full user flows across screens
- **Location**: `packages/frontend/tests/e2e/*.spec.ts`
- **Naming**: `*.spec.ts`

## CI Execution Order

1. `tsc --noEmit` (type safety gate)
2. `prettier --check` (style gate)
3. Root `npx vitest run` (Tier 1 + backend/SDK tests)
4. Frontend `npx vitest run --config packages/frontend/vitest.config.ts` (Tier 2-4)
5. E2E (Tier 5, future)

## Coverage Targets

| Tier | Target |
|:-----|:-------|
| Tier 1 | 100% of component API contracts |
| Tier 2 | Every component renders with every variant |
| Tier 3 | Every interactive component has keyboard test |
| Tier 4 | Every component passes axe audit |
| Tier 5 | Critical user flows |

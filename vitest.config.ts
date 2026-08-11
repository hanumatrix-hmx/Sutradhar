import { defineConfig } from 'vitest/config';
import * as path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Some integration tests now drive a REAL browser + LLM (no longer mocked),
    // so they need a higher default per-test timeout than vitest's 5s default.
    testTimeout: 120000,
    hookTimeout: 60000,
    // Exclude the heavy live-stack suites from the DEFAULT `vitest run`. These
    // tests genuinely exercise a real Ollama daemon + Chrome and take minutes;
    // they're for opt-in live validation, not part of the fast unit suite.
    // Run them explicitly with:
    //   vitest run apps/server/tests/benchmark apps/server/tests/integration
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'apps/server/tests/benchmark/**',
      'apps/server/tests/integration/**',
    ],
    alias: {
      '@sutradhar/contracts': path.resolve(__dirname, './packages/contracts/src/index.ts'),
      '@sutradhar/capability': path.resolve(__dirname, './packages/capability/src/index.ts'),
      '@sutradhar/utils': path.resolve(__dirname, './packages/utils/src/index.ts'),
      '@sutradhar/config': path.resolve(__dirname, './packages/config/src/index.ts'),
      '@sutradhar/observability': path.resolve(__dirname, './packages/observability/src/index.ts'),
      '@sutradhar/events': path.resolve(__dirname, './packages/events/src/index.ts'),
      '@sutradhar/browser': path.resolve(__dirname, './packages/browser/src/index.ts'),
      '@sutradhar/llm': path.resolve(__dirname, './packages/llm/src/index.ts'),
      '@sutradhar/memory': path.resolve(__dirname, './packages/memory/src/index.ts'),
      '@sutradhar/agent': path.resolve(__dirname, './packages/agent/src/index.ts'),
      '@sutradhar/workflow': path.resolve(__dirname, './packages/workflow/src/index.ts'),
      '@sutradhar/storage': path.resolve(__dirname, './packages/storage/src/index.ts'),
      '@sutradhar/sdk': path.resolve(__dirname, './packages/sdk/src/index.ts'),
      '@sutradhar/capability-runtime': path.resolve(__dirname, './packages/capability-runtime/src/index.ts'),
      '@sutradhar/mcp-server': path.resolve(__dirname, './packages/mcp-server/src/index.ts'),
      'sutradhar': path.resolve(__dirname, './packages/sutradhar/src/index.ts'),
      '@sutradhar/server': path.resolve(__dirname, './apps/server/src/index.ts'),
    },
  },
});

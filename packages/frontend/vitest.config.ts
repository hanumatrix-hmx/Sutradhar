import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/unit/**/*.spec.{ts,tsx}', 'tests/render/**/*.spec.tsx', 'tests/interaction/**/*.spec.tsx', 'tests/a11y/**/*.spec.tsx'],
    setupFiles: ['./tests/setup.ts'],
  },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const defaultPort = parseInt(process.env.VITE_PORT || process.env.PORT || '3000', 10);
const defaultHost = process.env.HOST || '0.0.0.0';
// The PinchTab backend REST API. In dev, the Vite dev server proxies /api/* to
// it so the frontend can call same-origin endpoints (no CORS friction).
const backendUrl = process.env.VITE_API_BASE_URL || 'http://localhost:8081';

export default defineConfig({
  plugins: [react()],
  server: {
    host: defaultHost,
    port: defaultPort,
    strictPort: false, // Automatic fallback to next available port if occupied
    proxy: {
      // All REST + future WS endpoints live under /api.
      '/api': {
        target: backendUrl,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});

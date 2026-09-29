/**
 * @file packages/frontend/tests/_helpers/live-stack.ts
 * @description Gate for frontend tests that require a live backend.
 *
 * The real ServerBrowserAdapter performs genuine HTTP calls; without a running
 * backend it (correctly) throws. Tests that exercise real transport behavior are
 * gated here so they skip when no backend is available, rather than failing.
 *
 * The live path is OPT-IN: it runs only when SUTRADHAR_FRONTEND_LIVE_BACKEND=1 is set.
 * Probing "is anything answering on localhost:8081" was not a safe signal on its own --
 * in CI, `turbo run test` runs @sutradhar/server's integration tests concurrently, and
 * a server they start (or any unrelated local process on that port) made these tests
 * launch a real browser and exceed vitest's 5 s test timeout. The probe itself is also
 * bounded so a listener that accepts but never answers cannot stall a test.
 */

export const LIVE_BACKEND_ENV = 'SUTRADHAR_FRONTEND_LIVE_BACKEND';
const PROBE_TIMEOUT_MS = 1000;

export async function isBackendReachable(baseUrl = 'http://localhost:8081'): Promise<boolean> {
  if (process.env[LIVE_BACKEND_ENV] !== '1') return false;
  // A plain timer race, not AbortSignal: these tests run under jsdom, whose AbortSignal is
  // rejected by Node's fetch, which would make the probe always report "unreachable".
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS);
  });
  try {
    const probe = fetch(`${baseUrl}/health`, { method: 'GET' }).then(
      (res) => res.ok,
      () => false,
    );
    return await Promise.race([probe, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

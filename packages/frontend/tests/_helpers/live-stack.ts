/**
 * @file packages/frontend/tests/_helpers/live-stack.ts
 * @description Gate for frontend tests that require a live backend.
 *
 * The real ServerBrowserAdapter performs genuine HTTP calls; without a running
 * backend it (correctly) throws. Tests that exercise real transport behavior are
 * gated here so they skip when no backend is available, rather than failing.
 */

export async function isBackendReachable(baseUrl = 'http://localhost:8081'): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * @file apps/server/src/runtime/runtime.ts
 * @description Executable runtime entrypoint for PinchTab platform.
 */

import { PinchTabRuntime } from './bootstrap.js';

export async function main(): Promise<void> {
  const runtime = new PinchTabRuntime();
  await runtime.start();

  // SIGTERM is what container orchestrators (Docker/Kubernetes/systemd/PM2) actually send for
  // graceful shutdown — SIGINT alone only covers a developer hitting Ctrl+C locally.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    runtime
      .stop()
      .catch((err) => console.error(`Error during ${signal} shutdown:`, err))
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (process.argv[1]?.endsWith('runtime.js') || process.argv[1]?.endsWith('runtime.ts')) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Fatal runtime error:', err);
    process.exit(1);
  });
}

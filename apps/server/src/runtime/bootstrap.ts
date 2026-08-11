/**
 * @file apps/server/src/runtime/bootstrap.ts
 * @description PinchTab Runtime Bootstrap lifecycle coordinator for startup and graceful shutdown.
 */

import { DependencyContainer } from './dependency-container.js';
import { loadEnvFile } from './env-loader.js';

// Load .env (if present) before anything reads process.env. Shell-set vars win.
loadEnvFile();

export class PinchTabRuntime {
  public readonly container: DependencyContainer;

  public constructor(container?: DependencyContainer) {
    this.container = container ?? new DependencyContainer();
  }

  public async start(): Promise<void> {
    this.container.logger.info('====================================================');
    this.container.logger.info('           PINCHTAB RUNTIME STARTUP                 ');
    this.container.logger.info('====================================================');

    await this.container.serverApp.start();

    this.container.logger.info(
      `[PinchTabRuntime] Server initialized on http://${this.container.serverApp.host}:${this.container.serverApp.port}`,
    );
    this.container.logger.info('[PinchTabRuntime] System ready for goal execution requests');
  }

  public async stop(): Promise<void> {
    this.container.logger.info('[PinchTabRuntime] Shutting down PinchTab runtime...');
    await this.container.serverApp.stop();
    await this.container.sessionManager.closeAllSessions();
    this.container.sessionManager.dispose();
    await this.container.sqliteClient.close();
    this.container.logger.info('[PinchTabRuntime] Shutdown complete');
  }
}

// Auto-run if executed directly as entrypoint
if (import.meta.url.endsWith('bootstrap.ts') || import.meta.url.endsWith('bootstrap.js')) {
  loadEnvFile(); // ensure env is loaded for direct execution too
  const runtime = new PinchTabRuntime();
  runtime.start().catch((err) => {
    console.error('Fatal startup error:', err);
  });
}

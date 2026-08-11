/**
 * @file apps/server/src/gateway/server-options.ts
 * @description Configuration options and defaults for ServerApp.
 */

import { EventBus } from '@pinchtab/events';
import { StructuredLogger } from '@pinchtab/observability';

export interface ServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly eventBus?: EventBus;
  readonly logger?: StructuredLogger;
}

export const DEFAULT_SERVER_OPTIONS: Required<Pick<ServerOptions, 'port' | 'host'>> = {
  port: 8080,
  host: '127.0.0.1',
};

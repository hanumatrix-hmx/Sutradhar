/**
 * @file apps/server/src/gateway/server-options.ts
 * @description Configuration options and defaults for ServerApp.
 */

import { EventBus } from '@sutradhar/events';
import { StructuredLogger } from '@sutradhar/observability';

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

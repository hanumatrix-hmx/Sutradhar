/**
 * @file packages/observability/src/logger/console-transport.ts
 * @description Standard ConsoleLogTransport outputting formatted structured JSON strings.
 */

import { ILogTransport } from './log-transport.js';
import { LogEntry } from './log-entry.js';

export class ConsoleLogTransport implements ILogTransport {
  public readonly name = 'ConsoleLogTransport';

  public log(entry: LogEntry): void {
    const jsonOutput = JSON.stringify(entry);

    if (entry.level === 'error' || entry.level === 'fatal') {
      console.error(jsonOutput);
    } else if (entry.level === 'warn') {
      console.warn(jsonOutput);
    } else {
      // eslint-disable-next-line no-console
      console.log(jsonOutput);
    }
  }
}

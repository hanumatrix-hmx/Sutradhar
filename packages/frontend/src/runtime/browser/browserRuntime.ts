/**
 * @file packages/frontend/src/runtime/browser/browserRuntime.ts
 * @description Pluggable Browser Runtime execution engine depending strictly on IBrowserAdapter.
 */

import { BrowserStatus } from './browserTypes.js';
import { BrowserEventEmitter } from './browserEvents.js';
import { IBrowserAdapter } from './adapters/browserAdapter.js';
import { ServerBrowserAdapter } from './adapters/serverBrowserAdapter.js';

export class BrowserRuntime {
  private _status: BrowserStatus = 'stopped';
  public readonly events = new BrowserEventEmitter();
  public readonly adapter: IBrowserAdapter;

  public constructor(
    public readonly sessionId: string,
    adapter?: IBrowserAdapter,
  ) {
    this.adapter = adapter || new ServerBrowserAdapter();
    // Forward adapter events to local event emitter
    this.adapter.subscribeEvents(sessionId, (event) => {
      this.events.emit(event.type as any, event.payload);
    });
  }

  public get status(): BrowserStatus {
    return this._status;
  }

  public async launch(initialUrl?: string): Promise<void> {
    if (this._status === 'running') return;

    this._status = 'starting';
    const res = await this.adapter.launch(this.sessionId, initialUrl);
    this._status = res.status;
  }

  public async shutdown(): Promise<void> {
    if (this._status === 'stopped') return;

    await this.adapter.shutdown(this.sessionId);
    this._status = 'stopped';
  }

  public async attach(): Promise<void> {
    if (this._status === 'stopped') {
      await this.launch();
    }
  }

  public async detach(): Promise<void> {
    if (this._status === 'running') {
      this._status = 'detached';
    }
  }

  public async restart(initialUrl?: string): Promise<void> {
    await this.shutdown();
    await this.launch(initialUrl);
  }
}

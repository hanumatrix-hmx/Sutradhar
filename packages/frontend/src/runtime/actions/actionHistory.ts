/**
 * @file packages/frontend/src/runtime/actions/actionHistory.ts
 * @description Persistent session execution history manager.
 */

import { ActionResult } from './actionTypes.js';

export class ActionHistory {
  private readonly history: ActionResult[] = [];

  public constructor(public readonly sessionId: string) {}

  public record(result: ActionResult): void {
    this.history.push(result);
  }

  public getHistory(): readonly ActionResult[] {
    return [...this.history];
  }

  public getSuccessful(): readonly ActionResult[] {
    return this.history.filter((r) => r.success);
  }

  public getFailed(): readonly ActionResult[] {
    return this.history.filter((r) => !r.success);
  }

  public clear(): void {
    this.history.length = 0;
  }
}

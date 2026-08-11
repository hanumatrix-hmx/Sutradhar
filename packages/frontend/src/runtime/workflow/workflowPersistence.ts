/**
 * @file packages/frontend/src/runtime/workflow/workflowPersistence.ts
 * @description WorkflowPersistence and WorkflowHistory for local snapshot storage and replayability.
 */

import { WorkflowSnapshot, WorkflowResult } from './workflowTypes.js';

export class WorkflowHistory {
  private readonly history: WorkflowResult[] = [];

  public record(result: WorkflowResult): void {
    this.history.push(result);
  }

  public getHistory(): readonly WorkflowResult[] {
    return [...this.history];
  }

  public clear(): void {
    this.history.length = 0;
  }
}

export class WorkflowPersistence {
  private static readonly STORAGE_PREFIX = 'pinchtab_wf_snap_';
  private static readonly memoryMap = new Map<string, string>();

  public static saveSnapshot(sessionId: string, snapshot: WorkflowSnapshot): void {
    const key = `${this.STORAGE_PREFIX}${sessionId}_${snapshot.id}`;
    const serialized = JSON.stringify(snapshot);
    this.memoryMap.set(key, serialized);

    try {
      if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
        localStorage.setItem(key, serialized);
      }
    } catch {
      // Ignore storage errors in test env
    }
  }

  public static loadSnapshot(sessionId: string, workflowId: string): WorkflowSnapshot | null {
    const key = `${this.STORAGE_PREFIX}${sessionId}_${workflowId}`;
    try {
      if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
        const item = localStorage.getItem(key);
        if (item) return JSON.parse(item);
      }
    } catch {
      // Fallback to memoryMap
    }

    const memItem = this.memoryMap.get(key);
    return memItem ? JSON.parse(memItem) : null;
  }

  public static clearSnapshot(sessionId: string, workflowId: string): void {
    const key = `${this.STORAGE_PREFIX}${sessionId}_${workflowId}`;
    this.memoryMap.delete(key);

    try {
      if (typeof localStorage !== 'undefined' && typeof localStorage.removeItem === 'function') {
        localStorage.removeItem(key);
      }
    } catch {
      // Ignore
    }
  }
}

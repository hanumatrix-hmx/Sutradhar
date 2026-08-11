/**
 * @file packages/frontend/src/runtime/actions/actionRegistry.ts
 * @description ActionRegistry singleton for dynamic action registration and discovery.
 */

import { BrowserAction } from './browserPageAction.js';
import { ActionMetadata } from './actionTypes.js';

export type ActionFactory = (input: any) => BrowserAction<any, any>;

export interface RegisteredActionInfo {
  type: string;
  metadata: ActionMetadata;
  factory: ActionFactory;
}

export class ActionRegistry {
  private static instance: ActionRegistry;
  private readonly registry = new Map<string, RegisteredActionInfo>();

  private constructor() {}

  public static getInstance(): ActionRegistry {
    if (!ActionRegistry.instance) {
      ActionRegistry.instance = new ActionRegistry();
    }
    return ActionRegistry.instance;
  }

  public register(type: string, factory: ActionFactory, metadata: ActionMetadata): void {
    this.registry.set(type, { type, factory, metadata });
  }

  public lookup(type: string): RegisteredActionInfo | undefined {
    return this.registry.get(type);
  }

  public instantiate(type: string, input: any): BrowserAction<any, any> {
    const entry = this.registry.get(type);
    if (!entry) {
      throw new Error(`Action type "${type}" is not registered in ActionRegistry`);
    }
    return entry.factory(input);
  }

  public discover(category?: ActionMetadata['category']): readonly RegisteredActionInfo[] {
    const entries = Array.from(this.registry.values());
    if (category) {
      return entries.filter((e) => e.metadata.category === category);
    }
    return entries;
  }

  public clear(): void {
    this.registry.clear();
  }
}

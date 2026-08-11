/**
 * @file packages/frontend/src/runtime/workflow/workflowRegistry.ts
 * @description WorkflowRegistry singleton for workflow template registration and discovery.
 */

import { Workflow } from './workflowGraph.js';

export type WorkflowFactory = () => Workflow;

export class WorkflowRegistry {
  private static instance: WorkflowRegistry;
  private readonly registry = new Map<string, { id: string; factory: WorkflowFactory }>();

  private constructor() {}

  public static getInstance(): WorkflowRegistry {
    if (!WorkflowRegistry.instance) {
      WorkflowRegistry.instance = new WorkflowRegistry();
    }
    return WorkflowRegistry.instance;
  }

  public register(id: string, factory: WorkflowFactory): void {
    this.registry.set(id, { id, factory });
  }

  public lookup(id: string): WorkflowFactory | undefined {
    return this.registry.get(id)?.factory;
  }

  public list(): readonly string[] {
    return Array.from(this.registry.keys());
  }

  public clear(): void {
    this.registry.clear();
  }
}

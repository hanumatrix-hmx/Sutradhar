/**
 * @file packages/capability/src/contracts/capability-interfaces.ts
 * @description Standard capability types, requirement schemas, and capability matrix interfaces.
 */

export type CapabilityType =
  | 'streaming'
  | 'tool_calling'
  | 'vision'
  | 'embeddings'
  | 'reasoning'
  | 'browser_automation'
  | 'memory_search'
  | 'ocr'
  | 'speech';

export interface CapabilityRequirement {
  readonly type: CapabilityType;
  readonly minVersion?: string;
  readonly options?: Record<string, unknown>;
}

export interface CapabilityDeclaration {
  readonly type: CapabilityType;
  readonly isSupported: boolean;
  readonly version?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface CapabilityMatrix {
  readonly providerId: string;
  readonly capabilities: readonly CapabilityDeclaration[];
}

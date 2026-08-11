/**
 * @file packages/capability/src/registry/capability-registry.ts
 * @description CapabilityRegistry allowing dynamic registration and discovery of system capabilities.
 */

export type SystemCapabilityCategory =
  | 'Browser'
  | 'Memory'
  | 'Vision'
  | 'Document'
  | 'Filesystem'
  | 'HTTP';

export interface CapabilityDescriptor {
  readonly id: string;
  readonly name: string;
  readonly category: SystemCapabilityCategory;
  readonly description: string;
  readonly version: string;
  readonly enabled: boolean;
}

export interface ICapabilityRegistry {
  registerCapability(descriptor: CapabilityDescriptor): void;
  getCapability(id: string): CapabilityDescriptor | undefined;
  listCapabilities(category?: SystemCapabilityCategory): readonly CapabilityDescriptor[];
}

export class CapabilityRegistry implements ICapabilityRegistry {
  private readonly capabilities = new Map<string, CapabilityDescriptor>();

  public constructor() {
    // Register standard platform default capabilities
    this.registerDefaults();
  }

  public registerCapability(descriptor: CapabilityDescriptor): void {
    this.capabilities.set(descriptor.id, descriptor);
  }

  public getCapability(id: string): CapabilityDescriptor | undefined {
    return this.capabilities.get(id);
  }

  public listCapabilities(category?: SystemCapabilityCategory): readonly CapabilityDescriptor[] {
    const list = Array.from(this.capabilities.values());
    if (!category) return list;
    return list.filter((c) => c.category === category);
  }

  private registerDefaults(): void {
    this.registerCapability({
      id: 'cap_browser_v1',
      name: 'Browser Automation Capability',
      category: 'Browser',
      description: 'Provides 19 browser actions, DOM semantic element graphs, and skills',
      version: '1.0.0',
      enabled: true,
    });

    this.registerCapability({
      id: 'cap_memory_v1',
      name: 'Multi-Tier Vector Memory Capability',
      category: 'Memory',
      description:
        'Provides working, episodic, semantic memory stores and cosine similarity search',
      version: '1.0.0',
      enabled: true,
    });

    this.registerCapability({
      id: 'cap_document_v1',
      name: 'Document Analysis Capability',
      category: 'Document',
      description: 'Provides PDF download and text extraction',
      version: '1.0.0',
      enabled: true,
    });

    this.registerCapability({
      id: 'cap_filesystem_v1',
      name: 'Local Storage Capability',
      category: 'Filesystem',
      description: 'Provides local file artifact storage persistence',
      version: '1.0.0',
      enabled: true,
    });
  }
}

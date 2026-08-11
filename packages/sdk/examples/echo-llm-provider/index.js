// Example Sutradhar plugin: contributes a trivial "echo" LLM provider.
//
// This file is the plugin entrypoint referenced by sutradhar-plugin.json. It default-exports
// a constructor of ISutradharPlugin. On initialize(), it registers an LLM provider into the
// host via the capabilities it receives on its context — that provider is then discoverable
// by the Sutradhar runtime.

const manifest = {
  id: 'echo-llm-provider',
  name: 'Echo LLM Provider',
  version: '0.1.0',
  author: 'Sutradhar',
  description: 'Example plugin that contributes a trivial LLM provider which echoes its prompt.',
  type: 'llm_provider',
  permissions: [],
  dependencies: [],
  runtimeCompatibility: '*',
  entrypoint: 'index.js',
};

export class EchoLlmProviderPlugin {
  constructor() {
    this.manifest = manifest;
    this.state = 'UNINSTALLED';
  }

  async initialize(context) {
    this.context = context;
    // Register the provider into the host. This is the extension point in action:
    // the plugin contributes a capability the runtime can now use.
    context.host?.providers.registerLlmProvider({
      id: 'echo',
      label: 'Echo (example provider)',
      complete: async (prompt) => `[echo] ${prompt}`,
    });
    context.logger.info('echo-llm-provider initialized; registered provider "echo"');
  }

  async enable() {
    this.state = 'ENABLED';
  }

  async disable() {
    this.state = 'DISABLED';
  }

  async unload() {
    this.state = 'UNINSTALLED';
  }
}

export default EchoLlmProviderPlugin;

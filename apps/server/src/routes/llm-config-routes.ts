/**
 * @file apps/server/src/routes/llm-config-routes.ts
 * @description HTTP routes for runtime LLM configuration (Phase 6 honest-settings fix).
 */

import { ApiRouter } from '../gateway/api-router.js';
import { LlmConfigService, LlmRuntimeConfig } from '../application/llm-config-service.js';

export function registerLlmConfigRoutes(
  router: ApiRouter,
  llmConfigService: LlmConfigService,
): void {
  // GET — return current active config (sans API key for security)
  router.get('/api/v1/llm/config', async (_req, res) => {
    const config = llmConfigService.getConfig();
    res.status(200).json({
      providerMode: config.providerMode,
      openrouterModel: config.openrouterModel,
      openrouterBaseUrl: config.openrouterBaseUrl,
      ollamaEndpoint: config.ollamaEndpoint,
      ollamaModel: config.ollamaModel,
      temperature: config.temperature,
      // Deliberately omit openrouterApiKey — never expose secrets
    });
  });

  // POST — update config and rebuild the provider chain
  router.post('/api/v1/llm/config', async (req, res) => {
    const body = req.body as Partial<LlmRuntimeConfig> | undefined;
    if (!body || !body.providerMode) {
      res.status(400).json({ error: 'Missing required field: providerMode' });
      return;
    }

    try {
      const current = llmConfigService.getConfig();
      const newConfig: LlmRuntimeConfig = {
        providerMode: body.providerMode,
        openrouterApiKey: body.openrouterApiKey ?? current.openrouterApiKey,
        openrouterModel: body.openrouterModel ?? current.openrouterModel,
        openrouterBaseUrl: body.openrouterBaseUrl ?? current.openrouterBaseUrl,
        ollamaEndpoint: body.ollamaEndpoint ?? current.ollamaEndpoint,
        ollamaModel: body.ollamaModel ?? current.ollamaModel,
        temperature: body.temperature ?? current.temperature,
      };
      llmConfigService.updateConfig(newConfig);
      res.status(200).json({ ok: true, providerMode: newConfig.providerMode });
    } catch (err) {
      res.status(500).json({
        error: 'Failed to update LLM config',
        message: (err as Error).message,
      });
    }
  });
}

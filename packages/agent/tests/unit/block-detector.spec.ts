/**
 * @file packages/agent/tests/unit/block-detector.spec.ts
 * @description Unit tests for detectBlock — heuristic CAPTCHA/auth-wall detection on a page.
 */

import { detectBlock } from '../../src/core/block-detector.js';
import type { IBrowserTab } from '@pinchtab/browser';

function mockTab(evaluateResult: unknown): IBrowserTab {
  return {
    page: { evaluate: vi.fn().mockResolvedValue(evaluateResult) },
  } as unknown as IBrowserTab;
}

describe('@pinchtab/agent detectBlock', () => {
  it('returns "captcha" when the page evaluate reports a captcha marker', async () => {
    const tab = mockTab('captcha');
    expect(await detectBlock(tab)).toBe('captcha');
  });

  it('returns "auth_wall" when the page evaluate reports a login wall', async () => {
    const tab = mockTab('auth_wall');
    expect(await detectBlock(tab)).toBe('auth_wall');
  });

  it('returns undefined for a normal page', async () => {
    const tab = mockTab(undefined);
    expect(await detectBlock(tab)).toBeUndefined();
  });

  it('returns undefined (not throwing) when the tab has no live page', async () => {
    const tab = { page: undefined } as unknown as IBrowserTab;
    expect(await detectBlock(tab)).toBeUndefined();
  });

  it('returns undefined (not throwing) when page.evaluate itself throws', async () => {
    const tab = {
      page: { evaluate: vi.fn().mockRejectedValue(new Error('context destroyed')) },
    } as unknown as IBrowserTab;
    expect(await detectBlock(tab)).toBeUndefined();
  });
});

/**
 * @file packages/browser/tests/unit/dialog-policy.live.spec.ts
 * @description FR2-04: real headless Chrome tests for BrowserTab's dialog policy — same pattern
 * as launcher.spec.ts's real-browser tests (no mocked Page).
 */
import { BrowserLauncher, BrowserTab } from '../../src/index.js';
import { createTabId } from '@sutradhar/contracts';

describe('@sutradhar/browser BrowserTab dialog policy — real Chrome (FR2-04)', () => {
  it('LV1: accept resolves confirm() with true, quickly', async () => {
    const launcher = new BrowserLauncher();
    const instance = await launcher.launch({ headless: true });
    try {
      const page = await instance.newPage();
      new BrowserTab(createTabId('t1'), 'about:blank', 'title', true, page, undefined, undefined, { mode: 'accept' });
      const t0 = Date.now();
      const result = await page.evaluate("confirm('x')");
      expect(result).toBe(true);
      expect(Date.now() - t0).toBeLessThan(2000);
    } finally {
      await instance.close();
    }
  });

  it('LV2: dismiss resolves confirm() with false', async () => {
    const launcher = new BrowserLauncher();
    const instance = await launcher.launch({ headless: true });
    try {
      const page = await instance.newPage();
      new BrowserTab(createTabId('t1'), 'about:blank', 'title', true, page, undefined, undefined, { mode: 'dismiss' });
      const result = await page.evaluate("confirm('x')");
      expect(result).toBe(false);
    } finally {
      await instance.close();
    }
  });

  it('LV3: accept with promptText overrides the default; no promptText uses the prompt default', async () => {
    const launcher = new BrowserLauncher();
    const instance = await launcher.launch({ headless: true });
    try {
      const page1 = await instance.newPage();
      new BrowserTab(createTabId('t1'), 'about:blank', 'title', true, page1, undefined, undefined, {
        mode: 'accept',
        promptText: 'zz',
      });
      expect(await page1.evaluate("prompt('q','d')")).toBe('zz');

      const page2 = await instance.newPage();
      new BrowserTab(createTabId('t2'), 'about:blank', 'title', true, page2, undefined, undefined, { mode: 'accept' });
      expect(await page2.evaluate("prompt('q','d')")).toBe('d');
    } finally {
      await instance.close();
    }
  });

  it('LV4: report leaves the dialog pending until handleDialog is called', async () => {
    const launcher = new BrowserLauncher();
    const instance = await launcher.launch({ headless: true });
    try {
      const page = await instance.newPage();
      const tab = new BrowserTab(createTabId('t1'), 'about:blank', 'title', true, page, undefined, undefined, {
        mode: 'report',
      });
      const evalPromise = page.evaluate("confirm('x')");
      const delayPromise = new Promise((resolve) => setTimeout(() => resolve('__timeout__'), 1500));
      const raceResult = await Promise.race([evalPromise, delayPromise]);
      expect(raceResult).toBe('__timeout__'); // the evaluate is still pending after 1500ms

      // Wait for the dialog event to actually land (it may take a beat after the delay above).
      let pending;
      for (let i = 0; i < 20 && !pending; i++) {
        pending = tab.getPendingDialog();
        if (!pending) await new Promise((r) => setTimeout(r, 50));
      }
      expect(pending?.dialogType).toBe('confirm');

      await tab.handleDialog('accept');
      const t0 = Date.now();
      const result = await evalPromise;
      expect(result).toBe(true);
      expect(Date.now() - t0).toBeLessThan(2000);
    } finally {
      await instance.close();
    }
  }, 15000);

  it('LV5: tab.targetId is a non-empty string matching the real CDP target id for that page', async () => {
    const launcher = new BrowserLauncher();
    const instance = await launcher.launch({ headless: true });
    try {
      const page = await instance.newPage();
      const tab = new BrowserTab(createTabId('t1'), 'about:blank', 'title', true, page);
      expect(tab.targetId).toBeTruthy();
      expect(typeof tab.targetId).toBe('string');

      const session = await page.target().createCDPSession();
      const { targetInfos } = await session.send('Target.getTargets');
      const match = targetInfos.find((t: { targetId: string }) => t.targetId === tab.targetId);
      expect(match).toBeDefined();
      await session.detach();
    } finally {
      await instance.close();
    }
  });
});

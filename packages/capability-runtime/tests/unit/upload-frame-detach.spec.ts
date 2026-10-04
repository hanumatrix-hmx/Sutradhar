/**
 * @file packages/capability-runtime/tests/unit/upload-frame-detach.spec.ts
 * @description I-047 (PROB-047): `Page.click` delegates to the main frame's `throwIfDetached`-wrapped `click`, a PLAIN
 * function that throws SYNCHRONOUSLY when the frame is detached. In `uploadFileViaTrigger` the click is an element of
 * `Promise.all([page.waitForFileChooser(), page.click(selector)])`, so a synchronous throw escaped before `Promise.all`
 * attached handlers and left `waitForFileChooser()` abandoned (its later rejection is an unhandled rejection).
 */
import { SutradharRuntime } from '../../src/runtime.js';

describe('I-047 uploadFileViaTrigger: synchronous detached-frame throw from page.click', () => {
  it('rejects with the detached error AND leaves no abandoned waitForFileChooser rejection', async () => {
    const detached = new Error("Attempted to use detached Frame 'F1'.");
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const page = {
        // plain (non-async) function, like Puppeteer's throwIfDetached wrapper: throws synchronously
        click: vi.fn(() => { throw detached; }),
        // a pending chooser wait that later REJECTS (as Puppeteer's would on its timeout)
        waitForFileChooser: vi.fn(() => new Promise((_resolve, reject) => setTimeout(() => reject(new Error('chooser timeout')), 10))),
      };
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ session: {} as any, tab: { page, url: 'http://x.test/' } as any });
      vi.spyOn(runtime as any, 'assertUploadPathAllowed').mockResolvedValue(undefined);
      await expect(runtime.uploadFileViaTrigger('s1', '#browse', '/tmp/x.txt')).rejects.toBe(detached);
      expect(page.click).toHaveBeenCalledTimes(1);
      // let the abandoned (if any) chooser rejection fire; generous bound, event order not load-sensitive
      await new Promise((r) => setTimeout(r, 200));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

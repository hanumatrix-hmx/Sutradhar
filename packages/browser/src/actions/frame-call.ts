/**
 * @file packages/browser/src/actions/frame-call.ts
 * @description I-047 (PROB-047): containment for synchronous detached-frame throws.
 *
 * Puppeteer wraps most `Frame` methods (`evaluate`, `$`, `$$eval`, `waitForSelector`, `frameElement`, ...) with
 * `throwIfDetached`, whose wrapper is a PLAIN (non-async) function that `throw`s SYNCHRONOUSLY when the frame is
 * detached (`puppeteer-core/lib/puppeteer/util/decorators.js`). Code written as
 * `frame.waitForSelector(...).catch(() => null)`, `const p = frame.evaluate(...)` outside the `try` meant to cover it,
 * or `bounded(frame.evaluate(...))` therefore never sees the error: the throw happens before there is a promise to
 * attach a handler to. On a page that continuously tears down and recreates iframes this made every action fail with
 * "Attempted to use detached Frame '<id>'" and made `buildGraph` discard the main frame's nodes.
 *
 * {@link frameCall} runs the operation inside an `async` function, so a synchronous throw becomes a rejection, and
 * every existing `.catch()` / `try` / `bounded()` handling then applies unchanged. It adds nothing else: no retry,
 * no substitute frame, no timing.
 */

/**
 * Runs `op(frame)` and returns its result as a promise. Declared `async` on purpose: a synchronous throw from `op`
 * (Puppeteer's `throwIfDetached`) becomes a rejection of the returned promise instead of escaping to the caller.
 */
export async function frameCall<F, T>(frame: F, op: (frame: F) => T | Promise<T>): Promise<T> {
  return op(frame);
}

/** True for Puppeteer's detached-frame error ("Attempted to use detached Frame '<id>'."). */
export function isDetachedFrameError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /Attempted to use detached Frame/i.test(message);
}

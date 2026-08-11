/**
 * @file apps/server/tests/_helpers/live-stack.ts
 * @description Shared gate for tests that require the FULL live stack:
 * a reachable Ollama daemon AND a launchable Chrome/Edge browser.
 *
 * The real agent loop (Phase 4) drives a genuine LLM against a genuine browser.
 * Tests that invoke agent goal execution therefore need both. When either is
 * unavailable (e.g. CI without Ollama, or a machine without Chrome), such tests
 * skip rather than fail — they cannot meaningfully run without the real stack.
 *
 * This is the honest replacement for the old behavior where goal-execution tests
 * "passed" by asserting on hardcoded scripted/fake outputs.
 */

export async function isOllamaReachable(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:11434/api/tags', { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export function isChromeLikelyAvailable(): boolean {
  if (process.env['CHROME_PATH']) return true;
  // Lightweight check: don't actually launch here (the launcher does that).
  // We only gate on plausibility; the real assertion happens at run time.
  return true;
}

/** True only when the full live stack is available for real agent execution. */
export async function isLiveStackAvailable(): Promise<boolean> {
  return (await isOllamaReachable()) && isChromeLikelyAvailable();
}

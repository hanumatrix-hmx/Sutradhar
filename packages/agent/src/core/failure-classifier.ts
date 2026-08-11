/**
 * @file packages/agent/src/core/failure-classifier.ts
 * @description Maps a raw BrowserActionEngine error string onto RecoveryEngine's FailureReason
 * enum, so agent-loop.ts can hand off a failed action to RecoveryEngine.attemptRecovery
 * without RecoveryEngine having to know anything about the action engine's error text.
 */

import { FailureReason } from '../recovery/recovery-engine.js';

/**
 * Best-effort classification from substring matches against known
 * BrowserActionEngine/Puppeteer error phrasings. Defaults to 'low_confidence' — the
 * candidate-fallback recovery path is the safest generic response when the specific
 * cause can't be identified from the error text alone.
 */
export function classifyFailure(errorMessage: string | undefined): FailureReason {
  const msg = (errorMessage ?? '').toLowerCase();

  if (
    msg.includes('occluded') ||
    msg.includes('is occluded') ||
    msg.includes('not clickable') ||
    msg.includes('not an element')
  ) {
    return 'element_disappeared';
  }
  if (msg.includes('stale snapshot') || msg.includes('stale') || msg.includes('detached from document')) {
    return 'stale_element';
  }
  if (msg.includes('no visible element found') || msg.includes('no element found')) {
    return 'selector_invalid';
  }
  if (msg.includes('dialog') || msg.includes('popup') || msg.includes('modal')) {
    return 'popup_blocking';
  }
  if (
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('navigation') ||
    msg.includes('net::err')
  ) {
    return 'navigation_timeout';
  }
  if (
    msg.includes('disconnected') ||
    msg.includes('target closed') ||
    msg.includes('session closed') ||
    msg.includes('crashed') ||
    msg.includes('no live browser page')
  ) {
    return 'browser_crash';
  }
  return 'low_confidence';
}

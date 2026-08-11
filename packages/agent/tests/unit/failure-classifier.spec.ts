/**
 * @file packages/agent/tests/unit/failure-classifier.spec.ts
 * @description Unit tests for classifyFailure — mapping raw BrowserActionEngine error
 * strings onto RecoveryEngine's FailureReason enum.
 */

import { classifyFailure } from '../../src/core/failure-classifier.js';

describe('@sutradhar/agent classifyFailure', () => {
  it('classifies an occlusion error as element_disappeared', () => {
    expect(classifyFailure('Element matching "#btn" is occluded by another element')).toBe(
      'element_disappeared',
    );
  });

  it('classifies a stale-snapshot error as stale_element', () => {
    expect(classifyFailure('Element matching "#btn" is from a stale snapshot')).toBe('stale_element');
  });

  it('classifies a not-found error as selector_invalid', () => {
    expect(classifyFailure('No visible element found for selector: #missing')).toBe('selector_invalid');
  });

  it('classifies a dialog/popup mention as popup_blocking', () => {
    expect(classifyFailure('blocked by a native dialog')).toBe('popup_blocking');
  });

  it('classifies a timeout as navigation_timeout', () => {
    expect(classifyFailure('Action click timed out after 15000ms')).toBe('navigation_timeout');
  });

  it('classifies a disconnected/target-closed error as browser_crash', () => {
    expect(classifyFailure('Protocol error: Target closed')).toBe('browser_crash');
    expect(classifyFailure('Session closed. Most likely the page has been closed.')).toBe('browser_crash');
  });

  it('defaults to low_confidence for an unrecognized error message', () => {
    expect(classifyFailure('something unexpected happened')).toBe('low_confidence');
  });

  it('defaults to low_confidence for undefined/empty input', () => {
    expect(classifyFailure(undefined)).toBe('low_confidence');
    expect(classifyFailure('')).toBe('low_confidence');
  });

  it('classifies a detached-from-document error as stale_element', () => {
    expect(classifyFailure('Node is detached from document')).toBe('stale_element');
  });

  it('classifies a not-clickable error as element_disappeared', () => {
    expect(classifyFailure('Node is either not clickable or not an Element')).toBe('element_disappeared');
  });

  it('classifies a net::ERR_ navigation failure as navigation_timeout', () => {
    expect(classifyFailure('Navigation failed: net::ERR_CONNECTION_REFUSED')).toBe('navigation_timeout');
  });

  it('classifies "no live browser page" as browser_crash', () => {
    expect(classifyFailure('No live browser page for tab tab_1 — cannot execute click.')).toBe('browser_crash');
  });
});

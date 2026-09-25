/**
 * @file packages/capability-runtime/src/extract/extract-data.ts
 * @description Node-side planning and in-page reading logic for
 * {@link import('../runtime.js').SutradharRuntime.extractData}, split out of `runtime.ts` so it's
 * unit-testable without a real browser (FR2-02).
 */

import { normalizeTarget, selectorSyntaxDetail, SELECTOR_SYNTAX_HINT, type ExtractFieldSpec, type ExtractDataOptions } from '../types.js';

/** How a single planned field should be read from each matched element (in-page). */
export type ExtractRead =
  | { kind: 'auto' }
  | { kind: 'live'; prop: 'value' | 'checked' | 'selected' }
  | { kind: 'attr'; name: string };

/** One field, fully resolved on the Node side, ready to hand to {@link extractFieldsInPage}. */
export interface ExtractPlanEntry {
  name: string;
  selector: string;
  read: ExtractRead;
  visibleOnly: boolean;
}

/** Result of running {@link extractFieldsInPage} in the page. */
export type ExtractInPageResult =
  | { ok: true; data: Record<string, string[]> }
  | { ok: false; invalid: Array<{ name: string; selector: string; message: string }> };

/**
 * Resolve each caller-given {@link ExtractFieldSpec} into an {@link ExtractPlanEntry}: normalize
 * the selector (snapshot node id → CSS attribute selector, same as every other verb), resolve
 * `visibleOnly` (field override, else the call-level option, else false), and classify
 * `attribute` into a read strategy. Pure and synchronous — runs entirely on the Node side, before
 * any CDP round-trip, so a malformed `attr:` prefix fails fast without touching the browser.
 */
export function planExtractFields(
  fields: Record<string, ExtractFieldSpec>,
  options?: ExtractDataOptions,
): ExtractPlanEntry[] {
  const plan: ExtractPlanEntry[] = [];
  for (const [name, spec] of Object.entries(fields)) {
    const visibleOnly = spec.visibleOnly ?? options?.visibleOnly ?? false;
    const selector = normalizeTarget(spec.selector);
    const attribute = spec.attribute;
    let read: ExtractRead;
    if (attribute === undefined || attribute === '') {
      read = { kind: 'auto' };
    } else if (attribute.startsWith('attr:')) {
      const attrName = attribute.slice('attr:'.length).trim();
      if (attrName === '') {
        throw new Error(
          `extractData field "${name}": attribute "attr:" needs an attribute name after the prefix, e.g. "attr:value".`,
        );
      }
      read = { kind: 'attr', name: attribute.slice('attr:'.length) };
    } else if (['value', 'checked', 'selected'].includes(attribute.toLowerCase())) {
      read = { kind: 'live', prop: attribute.toLowerCase() as 'value' | 'checked' | 'selected' };
    } else {
      read = { kind: 'attr', name: attribute };
    }
    plan.push({ name, selector, read, visibleOnly });
  }
  return plan;
}

/**
 * Runs entirely inside the page (Puppeteer serializes this function with `toString()`), so it
 * must be fully self-contained: no imports, no module-level constants or outside helpers, no
 * references to anything outside its own body/arguments. Synchronous.
 *
 * Validates every field's selector first (collecting every failure rather than aborting on the
 * first) so a single bad selector never silently drops the fields that came before it in
 * `Object.entries` order — either everything is read, or nothing is, and every bad field is
 * named. Only after every selector parses does it filter (visibleOnly) and read each field.
 */
export function extractFieldsInPage(plan: ExtractPlanEntry[]): ExtractInPageResult {
  function isVisible(el: Element): boolean {
    let target: Element | null = el;
    const localName = (el as unknown as { localName?: string }).localName;
    if (localName === 'option' || localName === 'optgroup') {
      target = (el as unknown as { closest(sel: string): Element | null }).closest('select');
      if (!target) return false;
    }
    const style = getComputedStyle(target as Element);
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    const rect = (target as Element).getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function read(el: Element, how: ExtractRead): string {
    if (how.kind === 'attr') {
      return el.getAttribute(how.name) ?? '';
    }
    if (how.kind === 'live') {
      const v = (el as unknown as Record<string, unknown>)[how.prop];
      if (how.prop === 'value') {
        if (typeof v === 'string') return v;
      } else {
        if (typeof v === 'boolean') return String(v);
      }
      return el.getAttribute(how.prop) ?? '';
    }
    // 'auto'
    const localName = (el as unknown as { localName?: string }).localName;
    if (localName === 'input' || localName === 'select' || localName === 'textarea') {
      return String((el as unknown as { value?: unknown }).value ?? '');
    }
    if (localName === 'option') {
      return (el as unknown as { text?: string }).text ?? '';
    }
    const innerText = (el as unknown as { innerText?: unknown }).innerText;
    if (typeof innerText === 'string') return innerText.trim();
    return (el.textContent ?? '').trim();
  }

  const matches: Element[][] = [];
  const invalid: Array<{ name: string; selector: string; message: string }> = [];
  for (const entry of plan) {
    try {
      matches.push(Array.from(document.querySelectorAll(entry.selector)));
    } catch (e) {
      invalid.push({ name: entry.name, selector: entry.selector, message: String((e as Error)?.message ?? e) });
    }
  }
  if (invalid.length > 0) {
    return { ok: false, invalid };
  }

  const entries: Array<[string, string[]]> = [];
  for (let i = 0; i < plan.length; i++) {
    const entry = plan[i]!;
    const els = entry.visibleOnly ? matches[i]!.filter(isVisible) : matches[i]!;
    entries.push([entry.name, els.map((el) => read(el, entry.read))]);
  }
  // Object.fromEntries defines each key as its own data property directly (unlike incremental
  // `obj[name] = ...` assignment, which for the literal key "__proto__" would instead invoke
  // Object.prototype's inherited __proto__ SETTER and reassign the object's prototype).
  return { ok: true, data: Object.fromEntries(entries) };
}

/**
 * Builds the single error thrown when one or more fields had an invalid selector — one line per
 * invalid field followed by exactly one copy of {@link SELECTOR_SYNTAX_HINT}. A plain `Error`
 * (not renamed to e.g. `SyntaxError`), so callers that check `e.name === 'Error'` see the usual
 * shape, and its message never starts with "SyntaxError" even though the underlying browser
 * message did.
 */
export function invalidExtractSelectorsError(
  invalid: Array<{ name: string; selector: string; message: string }>,
): Error {
  const lines = invalid.map(({ name, selector, message }) => {
    const prefixNote = /^(pierce|xpath|aria|text)\//.test(selector)
      ? " (extractData runs document.querySelectorAll, which does not support Puppeteer's pierce/ xpath/ aria/ text/ prefixes.)"
      : '';
    return `Invalid selector for field "${name}": "${selector}" — ${selectorSyntaxDetail(message)}${prefixNote}`;
  });
  return new Error(`${lines.join('\n')}\n${SELECTOR_SYNTAX_HINT}`);
}

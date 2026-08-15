/**
 * @file packages/browser/src/verifier/execution-verifier.ts
 * @description ExecutionVerifier service validating page mutations, URL transitions, and element presence with confidence integration.
 */

import { IBrowserTab } from '../session/browser-tab.js';
import { ActionResultDto, VerificationSpec, VerificationResultDto } from '../actions/action-types.js';

export type { VerificationSpec, VerificationResultDto };

export class ExecutionVerifier {
  public async verifyAction(
    tab: IBrowserTab,
    previousUrl: string,
    actionResult: ActionResultDto,
    spec: VerificationSpec = {},
  ): Promise<VerificationResultDto> {
    const candidateConfidence = spec.candidateConfidence ?? 0.9;

    if (!actionResult.success) {
      return {
        verified: false,
        urlChanged: false,
        elementFound: false,
        confidence: 0,
        reason: `Action failed: ${actionResult.error ?? 'Unknown error'}`,
      };
    }

    const currentUrl = tab.url;
    const urlChanged = currentUrl !== previousUrl;

    if (spec.shouldUrlChange && !urlChanged) {
      return {
        verified: false,
        urlChanged: false,
        elementFound: false,
        confidence: candidateConfidence * 0.5,
        reason: `Expected URL change from ${previousUrl}, but URL remained ${currentUrl}`,
      };
    }

    if (spec.expectedUrlSubstring && !currentUrl.includes(spec.expectedUrlSubstring)) {
      return {
        verified: false,
        urlChanged,
        elementFound: false,
        confidence: candidateConfidence * 0.4,
        reason: `Current URL ${currentUrl} does not contain expected substring ${spec.expectedUrlSubstring}`,
      };
    }

    if (spec.expectedElementText) {
      const found = await this.pageContainsText(tab, spec.expectedElementText);
      if (!found) {
        return {
          verified: false,
          urlChanged,
          elementFound: false,
          confidence: candidateConfidence * 0.5,
          reason: `Expected text "${spec.expectedElementText}" was not found on the page after the action`,
        };
      }
    }

    // A caller-supplied `candidateConfidence` below this threshold means the action targeted
    // an uncertain candidate (e.g. a fuzzy text match, not an exact snapshot id) — reporting
    // `verified:true` regardless would be self-contradictory ("verified, but not confident it
    // was right"). Downgrade to unverified instead of silently passing a low-confidence match
    // through as a success.
    if (candidateConfidence < LOW_CONFIDENCE_THRESHOLD) {
      return {
        verified: false,
        urlChanged,
        elementFound: true,
        confidence: candidateConfidence,
        reason:
          `Action executed but its target candidate confidence (${candidateConfidence.toFixed(2)}) is below ` +
          `the verification threshold (${LOW_CONFIDENCE_THRESHOLD}) — the targeted element may not have been the intended one.`,
      };
    }

    // Everything above only runs a real check when the CALLER supplied a `verificationSpec` —
    // most callers don't. Reaching here with an empty spec used to fall straight into a
    // confident `verified:true, confidence:0.9` regardless, which was never actually evidence
    // of anything beyond "the action didn't throw" — found live as a genuine false positive
    // (a `type` that silently left a field empty still reported `verified:true` here, before
    // the field-report remediation's Phase 2 fix). Some action types now carry their own
    // built-in post-condition check inside `dispatchAction` itself, independent of any spec:
    // `click`/`click_by_role` verify real delivery (occlusion + delivery-marker check in
    // `verifiedClickOnHandle`); `type`/`type_by_label` verify the typed value actually landed
    // (see `clearAndType`'s read-back). Only those get a confident pass without an explicit
    // spec — `click_by_text` deliberately does NOT (it calls `element.click()` directly,
    // bypassing `verifiedClickOnHandle` entirely — a separate, real gap, logged in
    // `.ai/known-problems.md`, not fixed here to keep this change scoped to the verifier itself).
    const specChecked = !!(spec.shouldUrlChange || spec.expectedUrlSubstring || spec.expectedElementText);
    const selfVerifyingWithoutSpec = SELF_VERIFYING_ACTION_TYPES.has(actionResult.actionType);

    if (!specChecked && !selfVerifyingWithoutSpec) {
      return {
        verified: false,
        urlChanged,
        elementFound: false,
        confidence: candidateConfidence * 0.5,
        reason:
          `'${actionResult.actionType}' completed without throwing, but has no built-in ` +
          'post-condition check and no verificationSpec was provided — nothing about its ' +
          'actual effect on the page was verified. This is not evidence the action failed, ' +
          'only an honest absence of verification.',
      };
    }

    return {
      verified: true,
      urlChanged,
      elementFound: true,
      confidence: candidateConfidence,
      reason: specChecked
        ? `Action execution verified successfully with confidence ${candidateConfidence.toFixed(2)}`
        : `'${actionResult.actionType}' has a built-in post-condition check (verified inside the ` +
          `action itself before it could report success) — confidence ${candidateConfidence.toFixed(2)}`,
    };
  }

  /** Best-effort check that `text` appears somewhere in the page's visible body text —
   *  including text inside open shadow roots, which `document.body.innerText` alone misses
   *  (shadow trees don't participate in the host document's rendered text at all). Uses
   *  `.textContent` rather than `.innerText` — `innerText` is HTMLElement-only and undefined
   *  on a `ShadowRoot`, which is itself a `DocumentFragment`, not an element. */
  private async pageContainsText(tab: IBrowserTab, text: string): Promise<boolean> {
    const page = tab.page;
    if (!page) return false;
    try {
      return await page.evaluate((t) => {
        function collectText(root: ParentNode): string {
          let combined = root.textContent ?? '';
          for (const el of Array.from(root.querySelectorAll('*'))) {
            const shadow = (el as HTMLElement).shadowRoot;
            if (shadow) combined += collectText(shadow);
          }
          return combined;
        }
        return (document.body ? collectText(document.body) : '').includes(t);
      }, text);
    } catch {
      return false;
    }
  }
}

/** Below this, a caller-supplied `candidateConfidence` is too uncertain to call the action
 *  "verified" even though it executed without error. */
const LOW_CONFIDENCE_THRESHOLD = 0.5;

/** Action types whose own `dispatchAction` implementation already checks a real post-condition
 *  before reporting success — see the reasoning in `verifyAction`'s final branch. Keep this in
 *  sync with `browser-action-engine.ts`: if a `case` there is given a genuine post-condition
 *  check, add it here too; if one is removed, remove it here. */
const SELF_VERIFYING_ACTION_TYPES = new Set(['click', 'click_by_role', 'type', 'type_by_label']);

/**
 * @file packages/agent/src/core/block-detector.ts
 * @description Heuristic detection of a CAPTCHA or auth/login wall blocking further progress.
 * Feeds the `session:blocked` event so a human can be looped in — the agent cannot solve
 * either of these on its own and should stop burning its step budget trying.
 */

import type { IBrowserTab } from '@pinchtab/browser';

export type BlockReason = 'captcha' | 'auth_wall';

/**
 * Checks the current page for common CAPTCHA/login-wall signals. Best-effort and
 * conservative — false negatives (missing a real block) are fine, since the loop
 * still has its normal step budget and stuck-loop detection as a backstop. False
 * positives would wrongly abandon a recoverable run, so every check is a fairly
 * specific, well-known marker rather than a broad text match.
 */
export async function detectBlock(tab: IBrowserTab): Promise<BlockReason | undefined> {
  if (!tab.page) return undefined;
  try {
    return (await tab.page.evaluate(() => {
      const html = document.documentElement.outerHTML;

      // Not an exhaustive provider list — best-effort markers for the most common CAPTCHA
      // and bot-mitigation services. Missing one just falls through to the loop's normal
      // step-budget/stuck-loop backstop rather than a false "blocked" report.
      const captchaMarkers = [
        'recaptcha',
        'hcaptcha',
        'cf-turnstile',
        'g-recaptcha',
        'captcha-delivery.com', // DataDome
        'arkoselabs',
        'funcaptcha',
        'geetest',
        'awswaf',
        'aws-waf-token',
        'perimeterx',
        'px-captcha',
        'human-challenge', // PerimeterX/HUMAN rebrand
        'are you a human',
        'verify you are human',
        'i am not a robot',
        'please enable javascript and disable any ad blocker',
      ];
      const lowerHtml = html.toLowerCase();
      if (captchaMarkers.some((m) => lowerHtml.includes(m))) {
        return 'captcha';
      }

      const hasPasswordField = !!document.querySelector('input[type="password"]');
      const bodyText = (document.body?.innerText || '').toLowerCase();
      const authWallMarkers = [
        'sign in to continue',
        'log in to continue',
        'please log in',
        'session expired',
        // A handful of non-English equivalents — best-effort, not exhaustive.
        'inicia sesión para continuar', // Spanish
        'bitte melden sie sich an', // German
        'veuillez vous connecter', // French
      ];
      if (hasPasswordField && authWallMarkers.some((m) => bodyText.includes(m))) {
        return 'auth_wall';
      }

      // OAuth-only login walls (no password field at all — "Continue with Google/Microsoft/
      // Apple/Facebook" as the only way in). Require the page to be short/sparse as well as
      // having an OAuth button, so a random page that happens to embed a "Sign in with
      // Google" widget somewhere in a long page doesn't get misclassified as a full block.
      const oauthButtonPattern = /continue with (google|microsoft|apple|facebook|github)/i;
      const hasOAuthButton = Array.from(document.querySelectorAll<HTMLElement>('button, a')).some((el) =>
        oauthButtonPattern.test(el.innerText || ''),
      );
      if (!hasPasswordField && hasOAuthButton && bodyText.length < 500) {
        return 'auth_wall';
      }

      return undefined;
    })) as BlockReason | undefined;
  } catch {
    return undefined;
  }
}

/**
 * @file packages/cli/tests/unit/selector-args.spec.ts
 * @description FR2-06 unit tests for the CLI's pure, no-session selector pre-validation.
 */
import { validateSelectorArgs, validateFrameChain } from '../../src/selector-args.js';

describe('@sutradhar/cli FR2-06 selector-args', () => {
  describe('validateSelectorArgs', () => {
    it('C1: names the Playwright hint for a bad selector', () => {
      const err = validateSelectorArgs(['text=Submit']);
      expect(err).not.toBeNull();
      expect(err).toContain('Playwright-style');
      expect(err).toContain('clickrole');
    });

    it('C1: returns null for a valid selector, a node id, and an omitted (undefined) arg', () => {
      expect(validateSelectorArgs(['#ok', undefined])).toBeNull();
      expect(validateSelectorArgs(['12'])).toBeNull();
      expect(validateSelectorArgs([undefined])).toBeNull();
    });

    it('I-049: "#5" and "[#5]" are accepted node ids', () => {
      expect(validateSelectorArgs(['#5'])).toBeNull();
      expect(validateSelectorArgs(['[#5]'])).toBeNull();
      expect(validateSelectorArgs(['#5]'])).not.toBeNull();
    });

    it('C1: names the specific bad arg among several', () => {
      const err = validateSelectorArgs(['#ok', 'a >> b']);
      expect(err).toContain('a >> b');
    });
  });

  describe('validateFrameChain', () => {
    it('C2: names the hop and the full chain', () => {
      const err = validateFrameChain('iframe.a::role=x');
      expect(err).toMatch(/Invalid frameSelector "role=x" \(from the full chain "iframe\.a::role=x"\)/);
    });

    it('C2: returns null for undefined and a valid chain', () => {
      expect(validateFrameChain(undefined)).toBeNull();
      expect(validateFrameChain('iframe.a::iframe.b')).toBeNull();
      expect(validateFrameChain('#7::#8')).toBeNull();
      expect(validateFrameChain('[#7]::[#8]')).toBeNull();
    });
  });
});

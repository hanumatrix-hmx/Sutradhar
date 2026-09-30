/**
 * @file packages/cli/tests/unit/verification-output.spec.ts
 * @description FR2-07: the CLI's verification line, exit codes and --json shape (pure functions),
 * plus the help text that documents them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VerificationResultDto } from '@sutradhar/capability-runtime';
import {
  EXIT_EXPECTATION_FAILED,
  exitCodeForResult,
  formatVerificationLine,
  toCliJson,
} from '../../src/verification-output.js';

function v(over: Partial<VerificationResultDto> & { tier?: string; checks?: any[] } = {}): VerificationResultDto {
  const { tier = 'verified', checks = [], ...rest } = over;
  return {
    verified: tier === 'verified',
    urlChanged: false,
    elementFound: tier === 'verified',
    confidence: tier === 'verified' ? 0.9 : tier === 'unverifiable' ? 0.45 : 0.09,
    reason: 'because',
    evidence: { tier: tier as any, checks },
    ...rest,
  } as VerificationResultDto;
}

describe('FR2-07 formatVerificationLine', () => {
  it('O1: exact strings for verified, contradicted, unverifiable and missing', () => {
    expect(formatVerificationLine(v({ reason: 'the value changed' }))).toBe(
      'Verification: verified (confidence 0.90) — the value changed',
    );
    expect(formatVerificationLine(v({ tier: 'contradicted', reason: 'nothing happened' }))).toBe(
      'Verification: NOT verified — contradicted (confidence 0.09) — nothing happened',
    );
    expect(formatVerificationLine(v({ tier: 'unverifiable', reason: 'nothing checkable' }))).toBe(
      'Verification: NOT verified — unverifiable (confidence 0.45) — nothing checkable',
    );
    expect(formatVerificationLine(undefined)).toBe('Verification: none reported');
  });

  it('O1: newlines collapse to spaces and the reason is capped at 400 characters', () => {
    const line = formatVerificationLine(v({ reason: 'line one\nline two\r\nline three' }));
    expect(line).toBe('Verification: verified (confidence 0.90) — line one line two line three');
    expect(line).not.toMatch(/[\r\n]/);
    const long = formatVerificationLine(v({ reason: 'x'.repeat(1000) }));
    const reason = long.split(' — ')[1]!;
    expect(reason.length).toBe(400);
    expect(reason.endsWith('…')).toBe(true);
  });
});

describe('FR2-07 exitCodeForResult', () => {
  const failing = v({ tier: 'contradicted', checks: [{ check: 'expect.text', outcome: 'fail' }] });
  const notRun = v({ tier: 'unverifiable', checks: [{ check: 'expect.text', outcome: 'not-run' }] });
  const passing = v({ checks: [{ check: 'expect.text', outcome: 'pass' }] });
  const builtInBad = v({ tier: 'contradicted', checks: [{ check: 'press_key.effect', outcome: 'fail' }] });

  it('O2: an action failure is 1, even with an expectation', () => {
    expect(exitCodeForResult({ success: false }, false)).toBe(1);
    expect(exitCodeForResult({ success: false, verification: failing }, true)).toBe(1);
  });
  it('O2: a failed OR unevaluable expectation is 4', () => {
    expect(EXIT_EXPECTATION_FAILED).toBe(4);
    expect(exitCodeForResult({ success: true, verification: failing }, true)).toBe(4);
    expect(exitCodeForResult({ success: true, verification: notRun }, true)).toBe(4);
  });
  it('O2: a passing expectation, or a built-in contradiction with no expectation, is 0', () => {
    expect(exitCodeForResult({ success: true, verification: passing }, true)).toBe(0);
    expect(exitCodeForResult({ success: true, verification: builtInBad }, false)).toBe(0);
    // an expectation FLAG was given but only a built-in check failed: still not an expectation failure
    expect(exitCodeForResult({ success: true, verification: builtInBad }, true)).toBe(0);
    expect(exitCodeForResult({ success: true }, false)).toBe(0);
  });
});

describe('FR2-07 toCliJson', () => {
  it('O3: drops failureScreenshot (recording that it did), leaves everything else', () => {
    const out = toCliJson({ success: false, error: 'x', failureScreenshot: 'AAAA', n: 1 }) as Record<string, unknown>;
    expect(out).toEqual({ success: false, error: 'x', n: 1, failureScreenshotOmitted: true });
  });
  it('O3: an absent or undefined screenshot adds no omission marker', () => {
    expect(toCliJson({ success: true })).toEqual({ success: true });
    expect(toCliJson({ success: true, failureScreenshot: undefined })).toEqual({ success: true });
  });
});

describe('FR2-07 CLI help text', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, '..', '..', 'src', 'cli.ts'), 'utf8');
  const start = src.indexOf('console.log(`Sutradhar CLI');
  const help = src.slice(start, src.indexOf('`);', start));

  it('documents the expect flags, the Verification line and exit code 4', () => {
    for (const s of ['--expect-text <t>', '--expect-url <s>', '--expect-url-changed', '--expect-url-unchanged', 'Verification:', 'unverifiable', '4 an --expect-*']) {
      expect(help, s).toContain(s);
    }
  });
});

/**
 * @file packages/cli/tests/unit/state.spec.ts
 * @description Regression coverage for PROB-041: the CLI's session-state directory must be
 * scoped per calling directory by default (so two unrelated projects on the same machine never
 * silently share one browser session), while still resolving to the same path across repeated
 * calls from the same directory (the continuity the whole mechanism exists for). An explicit
 * SUTRADHAR_CLI_STATE_DIR override must always win.
 */
import { resolveStateDir } from '../../src/state.js';

describe('resolveStateDir', () => {
  it('resolves the same path for repeated calls from the same cwd', () => {
    const a = resolveStateDir('/projects/foo', undefined);
    const b = resolveStateDir('/projects/foo', undefined);
    expect(a).toBe(b);
  });

  it('resolves different paths for different cwds', () => {
    const a = resolveStateDir('/projects/foo', undefined);
    const b = resolveStateDir('/projects/bar', undefined);
    expect(a).not.toBe(b);
  });

  it('an explicit env override always wins, regardless of cwd', () => {
    const a = resolveStateDir('/projects/foo', '/custom/state/dir');
    const b = resolveStateDir('/projects/bar', '/custom/state/dir');
    expect(a).toBe(b);
  });

  it('scopes under the home directory by default, not the cwd itself', () => {
    const dir = resolveStateDir('/projects/foo', undefined);
    expect(dir).not.toContain('/projects/foo');
    expect(dir).toContain('.sutradhar-cli');
  });
});

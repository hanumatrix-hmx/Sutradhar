/**
 * @file packages/cli/tests/unit/state.spec.ts
 * @description Regression coverage for PROB-041: the CLI's session-state directory must be
 * scoped per calling directory by default (so two unrelated projects on the same machine never
 * silently share one browser session), while still resolving to the same path across repeated
 * calls from the same directory (the continuity the whole mechanism exists for). An explicit
 * SUTRADHAR_CLI_STATE_DIR override must always win.
 */
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveStateDir, resolveStateRoot, parseCliState, clearStateFileIfUnchanged } from '../../src/state.js';

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

describe('FR2-03: resolveStateRoot', () => {
  it('ST1: undefined envRoot resolves to ~/.sutradhar-cli', () => {
    expect(resolveStateRoot(undefined)).toBe(path.join(os.homedir(), '.sutradhar-cli'));
  });

  it('ST2: an explicit envRoot is resolved with path.resolve', () => {
    expect(resolveStateRoot('/x/y')).toBe(path.resolve('/x/y'));
  });

  it('ST3: resolveStateDir with envRoot is stable and rooted under it', () => {
    const a = resolveStateDir('/p/foo', undefined, '/root');
    const b = resolveStateDir('/p/foo', undefined, '/root');
    expect(a).toBe(b);
    expect(a.startsWith(path.resolve('/root'))).toBe(true);
  });

  it('ST4: SUTRADHAR_CLI_STATE_DIR still wins over envRoot', () => {
    const dir = resolveStateDir('/p/foo', '/explicit/dir', '/root');
    expect(dir).toBe(path.resolve('/explicit/dir'));
  });
});

describe('FR2-03: parseCliState', () => {
  it('ST5: a legacy state (no new fields) parses, with the new fields undefined', () => {
    const parsed = parseCliState('{"sessionId":"s","wsEndpoint":"ws://x","chromePid":5}');
    expect(parsed).toBeDefined();
    expect(parsed!.sessionId).toBe('s');
    expect(parsed!.profileDir).toBeUndefined();
    expect(parsed!.cwd).toBeUndefined();
    expect(parsed!.createdAt).toBeUndefined();
  });

  it.each(['null', '[]', '{}', '{"sessionId":1}'])('ST5: %s gives undefined', (raw) => {
    expect(parseCliState(raw)).toBeUndefined();
  });
});

describe('FR2-03: clearStateFileIfUnchanged', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'fr2-03-st-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('ST6: a matching file is cleared and removed', async () => {
    const file = path.join(dir, 'state.json');
    await writeFile(file, JSON.stringify({ sessionId: 's1', wsEndpoint: 'ws://a' }));
    const result = await clearStateFileIfUnchanged(file, { sessionId: 's1', wsEndpoint: 'ws://a' });
    expect(result).toBe('cleared');
    await expect(readFile(file, 'utf-8')).rejects.toThrow();
  });

  it('ST6: a changed sessionId gives changed-concurrently, file intact', async () => {
    const file = path.join(dir, 'state.json');
    await writeFile(file, JSON.stringify({ sessionId: 's2', wsEndpoint: 'ws://a' }));
    const result = await clearStateFileIfUnchanged(file, { sessionId: 's1', wsEndpoint: 'ws://a' });
    expect(result).toBe('changed-concurrently');
    const raw = await readFile(file, 'utf-8');
    expect(JSON.parse(raw).sessionId).toBe('s2');
  });

  it('ST6: a missing file gives absent', async () => {
    const file = path.join(dir, 'nope.json');
    const result = await clearStateFileIfUnchanged(file, { sessionId: 's1', wsEndpoint: 'ws://a' });
    expect(result).toBe('absent');
  });

  it('ST6: a sibling file (history.jsonl) survives, and so does the dir', async () => {
    const file = path.join(dir, 'state.json');
    await writeFile(file, JSON.stringify({ sessionId: 's1', wsEndpoint: 'ws://a' }));
    await writeFile(path.join(dir, 'history.jsonl'), '{}\n');
    await clearStateFileIfUnchanged(file, { sessionId: 's1', wsEndpoint: 'ws://a' });
    const remaining = await readdir(dir);
    expect(remaining).toEqual(['history.jsonl']);
  });

  it('ST6: with no sibling, the now-empty dir is removed', async () => {
    const file = path.join(dir, 'state.json');
    await writeFile(file, JSON.stringify({ sessionId: 's1', wsEndpoint: 'ws://a' }));
    await clearStateFileIfUnchanged(file, { sessionId: 's1', wsEndpoint: 'ws://a' });
    await expect(readdir(dir)).rejects.toThrow();
  });
});

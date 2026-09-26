/**
 * @file packages/browser/tests/unit/launch-marker.spec.ts
 * @description FR2-03 M1-M5: the Chrome command-line marker Sutradhar stamps on every browser
 * it launches itself, and the small owner-file format used for unnamed runtime temp profiles.
 */
import { buildMarkerArgs, parseMarkerArgs, parseOwnerFile } from '../../src/launcher/launch-marker.js';

describe('buildMarkerArgs / parseMarkerArgs', () => {
  it('M1: cli marker returns exactly 4 args, none containing whitespace or a quote', () => {
    const args = buildMarkerArgs({
      kind: 'cli',
      ownerPid: 123,
      ownerStartMs: 1700000000000,
      stateFile: 'C:\\Users\\John Doe\\.sutradhar-cli\\ab\\state.json',
    });
    expect(args).toHaveLength(4);
    for (const a of args) expect(a).not.toMatch(/[\s"]/);
  });

  it('M2: round trip (argv form)', () => {
    const marker = {
      kind: 'cli' as const,
      ownerPid: 456,
      ownerStartMs: 1700000000001,
      stateFile: 'C:\\Ünï\\state.json',
    };
    const round = parseMarkerArgs(buildMarkerArgs(marker));
    expect(round).toEqual(marker);
  });

  it('M2: round trip (space-joined command-line string form)', () => {
    const marker = { kind: 'cli' as const, ownerPid: 789, ownerStartMs: 1700000000002, stateFile: 'C:\\Ünï\\state.json' };
    const joined = buildMarkerArgs(marker).join(' ');
    expect(parseMarkerArgs(joined)).toEqual(marker);
  });

  it('M3: runtime kind returns 3 args and no --sutradhar-state', () => {
    const args = buildMarkerArgs({ kind: 'runtime', ownerPid: 1, ownerStartMs: 2 });
    expect(args).toHaveLength(3);
    expect(args.some((a) => a.startsWith('--sutradhar-state'))).toBe(false);
    const parsed = parseMarkerArgs(args);
    expect(parsed).toEqual({ kind: 'runtime', ownerPid: 1, ownerStartMs: 2 });
  });

  it('M4: no markers present gives undefined', () => {
    expect(parseMarkerArgs('--headless=new --no-first-run')).toBeUndefined();
  });

  it('M4: a non-integer owner pid gives undefined', () => {
    expect(parseMarkerArgs('--sutradhar-launch=cli --sutradhar-owner-pid=12a --sutradhar-owner-start=1')).toBeUndefined();
  });
});

describe('parseOwnerFile', () => {
  const valid = { v: 1, tool: 'sutradhar', kind: 'runtime', ownerPid: 1, ownerStartMs: 2, createdAt: '2026-01-01T00:00:00.000Z' };

  it('M5: accepts a valid v1 file', () => {
    expect(parseOwnerFile(JSON.stringify(valid))).toEqual(valid);
  });

  it('M5: rejects tool !== "sutradhar"', () => {
    expect(parseOwnerFile(JSON.stringify({ ...valid, tool: 'other' }))).toBeUndefined();
  });

  it('M5: rejects v !== 1', () => {
    expect(parseOwnerFile(JSON.stringify({ ...valid, v: 2 }))).toBeUndefined();
  });

  it('M5: rejects a string ownerPid', () => {
    expect(parseOwnerFile(JSON.stringify({ ...valid, ownerPid: '1' }))).toBeUndefined();
  });

  it('M5: rejects invalid JSON', () => {
    expect(parseOwnerFile('{not json')).toBeUndefined();
  });

  it('M5: rejects an array', () => {
    expect(parseOwnerFile(JSON.stringify([valid]))).toBeUndefined();
  });
});

/**
 * @file packages/cli/tests/unit/warden-control-lock-raceback.spec.ts
 * @description FR2-04 escalation-1, GAP-250 (audit-4's M22): `tryAcquireSpawnLock`'s stale-lock
 * recovery (warden-control.ts) does a rename-then-READ-BACK — it must never assume a successful
 * `rename()` alone proves ownership, because a concurrent challenger's rename could land a moment
 * later and silently replace what we just wrote. `warden-control.spec.ts`'s WC5/WC6 only exercise
 * this indirectly through `ensureWarden`'s spawn path (which converges on one winner via the
 * SPAWNED PROCESS's own `warden.json` write, not via the lock's read-back itself), so a mutation
 * that deletes the read-back (`return true` unconditionally once `rename()` doesn't throw) survives
 * vitest there (confirmed live by audit-4's own mutation run). This file mocks `node:fs/promises`
 * to deterministically simulate exactly that race — a rival's payload appears at the lock path
 * between our rename and our own read-back — kept in its own file because mocking the module here
 * would otherwise break every real-directory test in warden-control.spec.ts.
 */
import path from 'node:path';
import os from 'node:os';

const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

let readFileCalls = 0;
let rivalReadbackPayload: string | undefined;

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readFile: vi.fn(async (p: Parameters<typeof actual.readFile>[0], enc?: Parameters<typeof actual.readFile>[1]) => {
      readFileCalls++;
      // The 2nd readFile call inside tryAcquireSpawnLock's stale-recovery path is specifically the
      // POST-RENAME read-back — substitute a rival's payload there to simulate the race. The 1st
      // call (the staleness check) must see the REAL pre-seeded stale lock, unchanged.
      if (readFileCalls === 2 && rivalReadbackPayload !== undefined) {
        return rivalReadbackPayload as any;
      }
      return actual.readFile(p as any, enc as any);
    }),
  };
});

const { tryAcquireSpawnLock } = await import('../../src/warden-control.js');

async function scratchDir(): Promise<string> {
  return actualFs.mkdtemp(path.join(os.tmpdir(), 'fr2-04-lockrace-'));
}

describe('@sutradhar/cli tryAcquireSpawnLock read-back (FR2-04 escalation-1, GAP-250/M22)', () => {
  beforeEach(() => {
    readFileCalls = 0;
    rivalReadbackPayload = undefined;
  });

  it('a rename that "succeeds" but is immediately superseded by a rival is caught by the read-back, not trusted on rename success alone', async () => {
    const dir = await scratchDir();
    try {
      // A pid essentially guaranteed dead, so this call takes the stale-lock recovery path.
      await actualFs.writeFile(path.join(dir, 'warden.lock'), JSON.stringify({ pid: 999999, startedAt: Date.now() - 20000 }));
      // Simulate: right after our rename lands, a DIFFERENT process's rename lands a moment later
      // and wins — the lock path now holds someone else's payload, not ours.
      rivalReadbackPayload = JSON.stringify({ pid: 424242, startedAt: Date.now() });
      const result = await tryAcquireSpawnLock(dir);
      // The mutation this test kills (M22: `return true` unconditionally once rename() doesn't
      // throw, skipping the read-back) would report `true` here — rename() onto an existing path
      // never itself throws, so it has no way to know it lost the race. The real code reads the
      // lock back and correctly sees it does NOT hold its own payload any more.
      expect(result).toBe(false);
      expect(readFileCalls).toBe(2); // staleness check + the read-back this test is proving matters
    } finally {
      await actualFs.rm(dir, { recursive: true, force: true });
    }
  });

  it('control: when nothing supersedes it, the same path DOES report ownership (the read-back is not just always-false)', async () => {
    const dir = await scratchDir();
    try {
      await actualFs.writeFile(path.join(dir, 'warden.lock'), JSON.stringify({ pid: 999999, startedAt: Date.now() - 20000 }));
      // rivalReadbackPayload left undefined — the real fs read-back sees exactly what we wrote.
      const result = await tryAcquireSpawnLock(dir);
      expect(result).toBe(true);
    } finally {
      await actualFs.rm(dir, { recursive: true, force: true });
    }
  });
});

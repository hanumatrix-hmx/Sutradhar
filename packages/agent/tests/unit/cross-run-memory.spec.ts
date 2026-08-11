/**
 * @file packages/agent/tests/unit/cross-run-memory.spec.ts
 * @description Unit tests for CrossRunMemory — persisting and retrieving prior run summaries,
 * backed by a real LocalFileStorage pointed at a throwaway per-test directory (no browser or
 * LLM required; matches the fast, no-browser style of packages/capability-runtime's tests).
 */

import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { LocalFileStorage } from '@sutradhar/storage';
import { CrossRunMemory } from '../../src/core/cross-run-memory.js';

function makeMemory(): CrossRunMemory {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutradhar-cross-run-memory-'));
  return new CrossRunMemory({ storage: new LocalFileStorage({ baseDir }) });
}

describe('@sutradhar/agent CrossRunMemory', () => {
  it('returns no relevant runs when nothing has been recorded yet', async () => {
    const memory = makeMemory();
    const relevant = await memory.getRelevantRuns('book a flight to Paris');
    expect(relevant).toEqual([]);
  });

  it('retrieves a previously recorded run whose objective shares keywords with the query', async () => {
    const memory = makeMemory();
    await memory.recordRun({
      goalId: 'goal_1',
      objective: 'Find the cheapest flight from London to Paris',
      status: 'completed',
      summary: 'Found a flight for $120 on BudgetAir.',
      stepCount: 5,
      timestamp: new Date().toISOString(),
    });

    const relevant = await memory.getRelevantRuns('book a flight to Paris next week');
    expect(relevant).toHaveLength(1);
    expect(relevant[0]?.goalId).toBe('goal_1');
  });

  it('excludes runs with zero keyword overlap with the query', async () => {
    const memory = makeMemory();
    await memory.recordRun({
      goalId: 'goal_2',
      objective: 'Check the weather forecast in Tokyo',
      status: 'completed',
      stepCount: 3,
      timestamp: new Date().toISOString(),
    });

    const relevant = await memory.getRelevantRuns('order groceries online');
    expect(relevant).toEqual([]);
  });

  it('ranks runs with more keyword overlap first, and respects the limit', async () => {
    const memory = makeMemory();
    await memory.recordRun({
      goalId: 'goal_low',
      objective: 'Search for restaurant reviews',
      status: 'completed',
      stepCount: 2,
      timestamp: new Date().toISOString(),
    });
    await memory.recordRun({
      goalId: 'goal_high',
      objective: 'Search for restaurant reviews in Paris near the Eiffel Tower',
      status: 'completed',
      stepCount: 4,
      timestamp: new Date().toISOString(),
    });

    const relevant = await memory.getRelevantRuns('restaurant reviews in Paris', 1);
    expect(relevant).toHaveLength(1);
    expect(relevant[0]?.goalId).toBe('goal_high');
  });

  it('never throws when recording fails (best-effort)', async () => {
    // Point storage at a location that cannot be written to (a file, not a directory, as the
    // base dir) so writeFile's mkdir/writeFile calls fail — recordRun must swallow it.
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutradhar-cross-run-memory-'));
    const blockingFile = path.join(baseDir, 'blocked');
    fs.writeFileSync(blockingFile, 'not a directory');
    const memory = new CrossRunMemory({ storage: new LocalFileStorage({ baseDir: blockingFile }) });

    await expect(
      memory.recordRun({
        goalId: 'goal_x',
        objective: 'anything',
        status: 'completed',
        stepCount: 1,
        timestamp: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();
  });

  it('prunes the oldest runs once the stored count exceeds the cap by the margin', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutradhar-cross-run-memory-'));
    const storage = new LocalFileStorage({ baseDir });
    const memory = new CrossRunMemory({ storage });

    // Write 221 records (cap 200 + margin 20 = 220) with strictly increasing timestamps so
    // the prune sweep has a well-defined "oldest" ordering to verify against.
    const base = Date.parse('2020-01-01T00:00:00.000Z');
    for (let i = 0; i < 221; i++) {
      await memory.recordRun({
        goalId: `goal_${i}`,
        objective: `objective number ${i}`,
        status: 'completed',
        stepCount: 1,
        timestamp: new Date(base + i * 1000).toISOString(),
      });
    }

    const remaining = await storage.listFiles('agent-memory');
    expect(remaining.length).toBe(200);

    // The oldest record (goal_0) must be gone; a recent one (goal_220) must survive.
    expect(remaining.some((f) => f.includes('goal_0.json'))).toBe(false);
    expect(remaining.some((f) => f.includes('goal_220.json'))).toBe(true);
  }, 20000);
});

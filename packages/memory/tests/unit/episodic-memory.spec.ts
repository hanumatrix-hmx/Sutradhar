/**
 * @file packages/memory/tests/unit/episodic-memory.spec.ts
 * @description Unit test suite verifying EpisodicMemoryManager lifecycle, retrieval, recovery recording, and lesson extraction.
 */

import { EpisodicMemoryManager } from '../../src/episodic/episodic-memory-manager.js';

describe('Engineering Iteration 6 — Episodic Execution Memory Unit Tests', () => {
  let memoryManager: EpisodicMemoryManager;

  beforeEach(() => {
    memoryManager = new EpisodicMemoryManager();
  });

  it('1. should create and finalize successful execution episode with lessons learned', () => {
    const ep = memoryManager.createEpisode('Submit login form', 'Authentication', 'graph_1');
    expect(ep.goal).toBe('Submit login form');
    expect(ep.pageType).toBe('Authentication');
    expect(ep.outcome).toBe('success');

    memoryManager.recordAction(ep.id, 'click_login');
    memoryManager.recordRecovery(ep.id, 'Dismissed popup modal');
    const finalized = memoryManager.finalizeEpisode(ep.id, 'success', 1500);

    expect(finalized?.outcome).toBe('success');
    expect(finalized?.duration).toBe(1500);
    expect(finalized?.actions).toContain('click_login');
    expect(finalized?.recoveries).toContain('Dismissed popup modal');
    expect(finalized?.lessonsLearned.length).toBeGreaterThan(0);
    expect(finalized?.lessonsLearned[0]).toContain('Successful execution strategy');
  });

  it('2. should query episodes by page type and outcome', () => {
    const ep1 = memoryManager.createEpisode('Search products', 'Search', 'graph_1');
    memoryManager.finalizeEpisode(ep1.id, 'success', 800);

    const ep2 = memoryManager.createEpisode('Login to account', 'Authentication', 'graph_2');
    memoryManager.finalizeEpisode(ep2.id, 'failure', 1200);

    const searchResults = memoryManager.queryEpisodes({ pageType: 'Search' });
    expect(searchResults.length).toBe(1);
    expect(searchResults[0]?.id).toBe(ep1.id);

    const failureResults = memoryManager.queryEpisodes({ outcome: 'failure' });
    expect(failureResults.length).toBe(1);
    expect(failureResults[0]?.id).toBe(ep2.id);
  });

  it('3. should extract negative lessons learned upon execution failure', () => {
    const ep = memoryManager.createEpisode('Fill checkout form', 'Checkout', 'graph_3');
    memoryManager.recordAction(ep.id, 'submit_card');
    const finalized = memoryManager.finalizeEpisode(ep.id, 'failure', 2000);

    expect(finalized?.outcome).toBe('failure');
    expect(
      finalized?.lessonsLearned.some((l) => l.includes('Avoid repeating unsuccessful actions')),
    ).toBe(true);
  });
});

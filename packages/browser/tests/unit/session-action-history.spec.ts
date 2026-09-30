/**
 * @file packages/browser/tests/unit/session-action-history.spec.ts
 * @description FR2-11: the per-tab history's exact cap/eviction counting, and the session-wide merged ring
 * (recording order by seq, closed tabs' entries survive, exact eviction count). BrowserSession with no
 * browserInstance, so tabs have no page.
 */
import { BrowserSession, BrowserTab, MAX_ACTION_HISTORY, type ActionHistoryEntry } from '../../src/index.js';
import { createSessionId, createTabId } from '@sutradhar/contracts';
import type { Page } from 'puppeteer-core';

const entry = (actionType: string, extra: Partial<ActionHistoryEntry> = {}): ActionHistoryEntry => ({
  actionType,
  success: true,
  executionTimeMs: 1,
  timestamp: new Date().toISOString(),
  ...extra,
});

function mockPage() {
  const page = {
    isClosed: () => false,
    url: () => 'https://example.com/',
    title: async () => 't',
    on: vi.fn(() => page),
    setRequestInterception: vi.fn().mockResolvedValue(undefined),
  };
  return page as unknown as Page;
}

describe('FR2-11 per-tab history cap and eviction count', () => {
  it('S1: MAX_ACTION_HISTORY is exported and is 200', () => {
    expect(MAX_ACTION_HISTORY).toBe(200);
  });

  it('S2: 201 records keep 200, drop the oldest, count 1 eviction; 450 records count 250', () => {
    const tab = new BrowserTab(createTabId('t1'), 'about:blank', 'x', true);
    for (let i = 0; i <= 200; i++) tab.recordAction(entry(`a${i}`)); // 201 records: a0..a200
    expect(tab.getActionHistory()).toHaveLength(200);
    expect(tab.getActionHistory()[0]!.actionType).toBe('a1');
    expect(tab.getActionHistoryEvictedCount()).toBe(1);
    for (let i = 201; i < 450; i++) tab.recordAction(entry(`a${i}`));
    expect(tab.getActionHistory()).toHaveLength(200);
    expect(tab.getActionHistory()[0]!.actionType).toBe('a250');
    expect(tab.getActionHistoryEvictedCount()).toBe(250);
  });

  it('exactly 200 records evict nothing (the boundary is not off by one)', () => {
    const tab = new BrowserTab(createTabId('t1'), 'about:blank', 'x', true);
    for (let i = 0; i < 200; i++) tab.recordAction(entry(`a${i}`));
    expect(tab.getActionHistory()).toHaveLength(200);
    expect(tab.getActionHistoryEvictedCount()).toBe(0);
    expect(tab.getActionHistory()[0]!.actionType).toBe('a0');
  });

  it('S3: no records means evicted 0 and an empty history', () => {
    const tab = new BrowserTab(createTabId('t1'), 'about:blank', 'x', true);
    expect(tab.getActionHistoryEvictedCount()).toBe(0);
    expect(tab.getActionHistory()).toEqual([]);
  });

  it('S4: the listener receives the SANITIZED stored object (same reference as the history entry)', () => {
    const tab = new BrowserTab(createTabId('t1'), 'about:blank', 'x', true);
    const seen: ActionHistoryEntry[] = [];
    tab.setActionRecordedListener((s) => seen.push(s));
    tab.recordAction(entry('click', { url: 'http://x/?t=SECRET' }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('http://x/');
    expect(seen[0]).toBe(tab.getActionHistory()[0]);
    expect(JSON.stringify(tab.getActionHistory())).not.toContain('SECRET');
  });

  it('S5: a throwing listener never breaks recordAction', () => {
    const tab = new BrowserTab(createTabId('t1'), 'about:blank', 'x', true);
    tab.setActionRecordedListener(() => {
      throw new Error('listener bug');
    });
    expect(() => tab.recordAction(entry('click'))).not.toThrow();
    expect(tab.getActionHistory()).toHaveLength(1);
  });
});

describe('FR2-11 session merged ring', () => {
  const newSession = () => new BrowserSession(createSessionId('s1'));

  it('S6: merge order is recording order with tabId and seq; per-tab views are unaffected', async () => {
    const s = newSession();
    const A = (await s.createTab()) as BrowserTab;
    const B = (await s.createTab()) as BrowserTab;
    A.recordAction(entry('a1'));
    B.recordAction(entry('b1'));
    A.recordAction(entry('a2'));
    B.recordAction(entry('b2'));
    expect(s.getSessionActionHistory().map((e) => [e.tabId, e.actionType, e.seq])).toEqual([
      [A.id, 'a1', 1],
      [B.id, 'b1', 2],
      [A.id, 'a2', 3],
      [B.id, 'b2', 4],
    ]);
    expect(A.getActionHistory().map((e) => e.actionType)).toEqual(['a1', 'a2']);
    expect('tabId' in A.getActionHistory()[0]!).toBe(false);
    expect('seq' in A.getActionHistory()[0]!).toBe(false);
  });

  it('S7: same-millisecond ordering comes from seq, not timestamp', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const s = newSession();
      const A = (await s.createTab()) as BrowserTab;
      const B = (await s.createTab()) as BrowserTab;
      const ts = new Date().toISOString();
      B.recordAction(entry('onB', { timestamp: ts }));
      A.recordAction(entry('onA', { timestamp: ts }));
      const h = s.getSessionActionHistory();
      expect(h.map((e) => e.actionType)).toEqual(['onB', 'onA']);
      expect(h[0]!.timestamp).toBe(h[1]!.timestamp);
      expect(h.map((e) => e.seq)).toEqual([1, 2]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('S8: a closed tab\'s entries survive in the session view', async () => {
    const s = newSession();
    const A = (await s.createTab()) as BrowserTab;
    await s.createTab();
    A.recordAction(entry('a1'));
    A.recordAction(entry('a2'));
    await s.closeTab(A.id);
    expect(s.getTab(A.id)).toBeUndefined();
    const h = s.getSessionActionHistory();
    expect(h.map((e) => e.actionType)).toEqual(['a1', 'a2']);
    expect(h.every((e) => e.tabId === A.id)).toBe(true);
  });

  it('S9: session eviction is exact (205 records into a 200 ring: 5 evicted, first seq 6); per-tab counts stay 0', async () => {
    const s = newSession();
    const A = (await s.createTab()) as BrowserTab;
    const B = (await s.createTab()) as BrowserTab;
    let a = 0;
    let b = 0;
    while (a < 120 || b < 85) {
      if (a < 120) A.recordAction(entry(`a${a++}`));
      if (b < 85) B.recordAction(entry(`b${b++}`));
    }
    const h = s.getSessionActionHistory();
    expect(h).toHaveLength(200);
    expect(s.getSessionActionHistoryEvictedCount()).toBe(5);
    expect(h[0]!.seq).toBe(6);
    expect(h[199]!.seq).toBe(205);
    expect(A.getActionHistoryEvictedCount()).toBe(0);
    expect(B.getActionHistoryEvictedCount()).toBe(0);
  });

  it('S10: adopted-page tabs are wired too', async () => {
    const s = newSession();
    const t = (await s.adoptExistingPage(mockPage())) as BrowserTab;
    t.recordAction(entry('adopted'));
    expect(s.getSessionActionHistory().map((e) => [e.tabId, e.actionType])).toEqual([[t.id, 'adopted']]);
  });

  it('a session with no records reports an empty ring and 0 evicted', () => {
    const s = newSession();
    expect(s.getSessionActionHistory()).toEqual([]);
    expect(s.getSessionActionHistoryEvictedCount()).toBe(0);
  });
});

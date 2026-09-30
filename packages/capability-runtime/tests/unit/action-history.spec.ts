/**
 * @file packages/capability-runtime/tests/unit/action-history.spec.ts
 * @description FR2-11: navigate / eval / back / forward / reload / point actions / clipboard / trigger-upload are
 * recorded in the tab history around their existing bodies; getActionHistoryReport (tab and session scope, exact
 * eviction, TypeError combinations). No browser: a BrowserSession with pageless or mock-page tabs.
 */
import { SutradharRuntime, BrowserNotAvailableError } from '../../src/index.js';
import { BrowserSession } from '@sutradhar/browser';
import { createSessionId } from '@sutradhar/contracts';
import type { Page } from 'puppeteer-core';

function mockPage(over: Partial<Record<string, any>> = {}) {
  const page: any = {
    isClosed: () => false,
    url: () => 'https://a.test/x',
    title: async () => 'T',
    on: vi.fn(() => page),
    setRequestInterception: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  return page as Page;
}

async function setup(sessionName = 's1') {
  const runtime = new SutradharRuntime();
  const session = new BrowserSession(createSessionId(sessionName));
  vi.spyOn(runtime.getSessionManager(), 'getSession').mockImplementation((id: any) => (id === session.id ? session : undefined));
  return { runtime, session };
}

describe('FR2-11 runtime history recording', () => {
  it('R1: navigate is recorded with a redacted target (no query/fragment) and success', async () => {
    const { runtime, session } = await setup();
    await session.createTab(); // pageless
    await runtime.navigate('s1', 'https://a.test/p?token=SECRET-R1#frag');
    const h = runtime.getActionHistory('s1');
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ actionType: 'navigate', success: true, target: 'https://a.test/p' });
    expect(JSON.stringify(h)).not.toContain('SECRET-R1');
    expect(JSON.stringify(h)).not.toContain('frag');
  });

  it('R2 / N3: eval on a pageless tab throws the SAME error class as before and records a failure with the code preview', async () => {
    const { runtime, session } = await setup();
    await session.createTab();
    await expect(runtime.eval('s1', '1+1')).rejects.toThrow(BrowserNotAvailableError);
    expect(runtime.getActionHistory('s1')[0]).toMatchObject({ actionType: 'eval', success: false, target: '1+1' });
    expect(typeof (runtime.getActionHistory('s1')[0] as any).error).toBe('string');
  });

  it('R2b: the thrown error object is unchanged (rethrown, not wrapped)', async () => {
    const { runtime, session } = await setup();
    const boom = new Error('page exploded');
    await session.adoptExistingPage(
      mockPage({
        evaluate: async () => {
          throw boom;
        },
      }),
    );
    await expect(runtime.eval('s1', 'x')).rejects.toBe(boom);
    expect(runtime.getActionHistory('s1')[0]).toMatchObject({ actionType: 'eval', success: false, error: 'page exploded' });
  });

  it('R3 / N14: eval success records success:true even when the PAGE value has success:false; the value is returned untouched and never stored; no verification key', async () => {
    const { runtime, session } = await setup();
    await session.adoptExistingPage(mockPage({ evaluate: async () => ({ success: false, v: 1, secretValue: 'PAGE-VALUE-SECRET' }) }));
    const out = await runtime.eval('s1', 'window.thing');
    expect(out).toEqual({ success: false, v: 1, secretValue: 'PAGE-VALUE-SECRET' });
    const h = runtime.getActionHistory('s1');
    expect(h).toHaveLength(1);
    expect(h[0]!.success).toBe(true);
    expect('verification' in h[0]!).toBe(false);
    expect(JSON.stringify(h)).not.toContain('PAGE-VALUE-SECRET');
  });

  it('eval records the frame selector and a whitespace-collapsed, URL-redacted, capped preview only', async () => {
    const { runtime, session } = await setup();
    await session.adoptExistingPage(mockPage({ evaluate: async () => 1 }));
    await runtime.eval('s1', 'fetch("https://t.test/x?k=SECRET-EV")\n\n  .then(r => r.text())');
    const long = 'a'.repeat(5000);
    await runtime.eval('s1', long);
    const h = runtime.getActionHistory('s1');
    expect(h[0]!.target).toBe('fetch("https://t.test/x[redacted]');
    expect(JSON.stringify(h)).not.toContain('SECRET-EV');
    expect(h[1]!.target).toHaveLength(200);
    expect(h[1]!.target!.endsWith('…')).toBe(true);
  });

  it('R4: getActionHistoryReport(tab) mirrors getActionHistory but as a copy, with tabId, evicted 0 and capacity 200', async () => {
    const { runtime, session } = await setup();
    const t = await session.createTab();
    await runtime.navigate('s1', 'https://a.test/');
    const rep = runtime.getActionHistoryReport('s1');
    expect(rep).toMatchObject({ scope: 'tab', tabId: t.id, evicted: 0, capacity: 200 });
    expect(rep.entries).toEqual(runtime.getActionHistory('s1'));
    expect(rep.entries).not.toBe(runtime.getActionHistory('s1'));
  });

  it('R5: session scope merges tabs in recording order, each entry with tabId and seq, no report-level tabId', async () => {
    const { runtime, session } = await setup();
    const A = await session.createTab();
    const B = await session.createTab();
    await runtime.navigate('s1', 'https://a.test/1', A.id);
    await runtime.navigate('s1', 'https://b.test/2', B.id);
    await runtime.navigate('s1', 'https://a.test/3', A.id);
    const rep = runtime.getActionHistoryReport('s1', { scope: 'session' });
    expect(rep.scope).toBe('session');
    expect('tabId' in rep).toBe(false);
    expect((rep.entries as any[]).map((e) => [e.tabId, e.seq, e.target])).toEqual([
      [A.id, 1, 'https://a.test/1'],
      [B.id, 2, 'https://b.test/2'],
      [A.id, 3, 'https://a.test/3'],
    ]);
    expect(rep.entries).not.toBe(session.getSessionActionHistory());
  });

  it('R5b: evicted is exact at both scopes (205 actions on one tab)', async () => {
    const { runtime, session } = await setup();
    await session.adoptExistingPage(mockPage({ evaluate: async () => 1 }));
    for (let i = 0; i < 205; i++) await runtime.eval('s1', `${i}+1`);
    const tab = runtime.getActionHistoryReport('s1');
    const ses = runtime.getActionHistoryReport('s1', { scope: 'session' });
    expect(tab.entries).toHaveLength(200);
    expect(tab.evicted).toBe(5);
    expect(tab.entries[0]!.target).toBe('5+1');
    expect(ses.entries).toHaveLength(200);
    expect(ses.evicted).toBe(5);
    expect((ses.entries[0] as any).seq).toBe(6);
  });

  it('R6 / N1: session scope + tabId and an unknown scope are TypeErrors', async () => {
    const { runtime, session } = await setup();
    await session.createTab();
    expect(() => runtime.getActionHistoryReport('s1', { scope: 'session', tabId: 'x' })).toThrow(TypeError);
    expect(() => runtime.getActionHistoryReport('s1', { scope: 'session', tabId: 'x' })).toThrow(/cannot be combined/);
    expect(() => runtime.getActionHistoryReport('s1', { scope: 'bogus' as any })).toThrow(/scope must be/);
  });

  it('R7 / N2: an unknown session throws BrowserNotAvailableError in both scopes', async () => {
    const { runtime } = await setup();
    expect(() => runtime.getActionHistoryReport('nope')).toThrow(BrowserNotAvailableError);
    expect(() => runtime.getActionHistoryReport('nope', { scope: 'session' })).toThrow(BrowserNotAvailableError);
  });

  it('N5: navigate/eval with an unknown tabId throw first and record nothing anywhere', async () => {
    const { runtime, session } = await setup();
    await session.createTab();
    await expect(runtime.eval('s1', '1', 'no-such-tab')).rejects.toThrow(BrowserNotAvailableError);
    await expect(runtime.navigate('s1', 'https://a.test/', 'no-such-tab')).rejects.toThrow(BrowserNotAvailableError);
    expect(session.getSessionActionHistory()).toHaveLength(0);
  });

  it('R8 / N4: a navigation rejected by the allowlist rejects as before and records NOTHING', async () => {
    const runtime = new SutradharRuntime({ allowedDomains: ['example.com'] });
    const session = new BrowserSession(createSessionId('s1'));
    vi.spyOn(runtime.getSessionManager(), 'getSession').mockReturnValue(session);
    await session.createTab();
    await expect(runtime.navigate('s1', 'https://evil.test/')).rejects.toThrow();
    expect(runtime.getActionHistory('s1')).toHaveLength(0);
  });

  it('R9: setClipboard records only a length, never the text', async () => {
    const { runtime, session } = await setup();
    const page = mockPage({
      bringToFront: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(undefined),
      createCDPSession: vi.fn().mockRejectedValue(new Error('no cdp')),
    });
    await session.adoptExistingPage(page);
    await runtime.setClipboard('s1', 'secret');
    const h = runtime.getActionHistory('s1');
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ actionType: 'set_clipboard', target: '<6 chars>' });
    expect(JSON.stringify(h)).not.toContain('secret');
  });

  it('R10: clickAtPoint failing records success:false and the "(x, y) button" target; the returned result is unchanged', async () => {
    const { runtime, session } = await setup();
    const page = mockPage({
      mouse: { click: vi.fn().mockRejectedValue(new Error('mouse broke')) },
      createCDPSession: vi.fn().mockRejectedValue(new Error('no cdp')),
      evaluate: vi.fn().mockResolvedValue(undefined),
      mainFrame: () => ({ evaluate: vi.fn().mockResolvedValue(undefined), isDetached: () => false, childFrames: () => [] }),
    });
    await session.adoptExistingPage(page);
    const r = await runtime.clickAtPoint('s1', 10, 20);
    expect(r.success).toBe(false);
    expect(r.error).toBe('mouse broke');
    expect(runtime.getActionHistory('s1')[0]).toMatchObject({
      actionType: 'click_at_point',
      success: false,
      target: '(10, 20) left',
      error: 'mouse broke',
    });
  });

  it('back / forward / reload / drag_at_points / upload_file_via_trigger are each wired: a failing body is recorded under its own actionType and the error propagates unchanged', async () => {
    const { runtime, session } = await setup();
    const boom = new Error('cdp unavailable');
    const page = mockPage({
      goBack: vi.fn().mockRejectedValue(boom),
      goForward: vi.fn().mockRejectedValue(boom),
      reload: vi.fn().mockRejectedValue(boom),
      createCDPSession: vi.fn().mockRejectedValue(boom),
      evaluate: vi.fn().mockRejectedValue(boom),
      mouse: { move: vi.fn().mockRejectedValue(boom), down: vi.fn(), up: vi.fn() },
      mainFrame: () => ({ evaluate: vi.fn().mockRejectedValue(boom), isDetached: () => false, childFrames: () => [] }),
    });
    await session.adoptExistingPage(page);
    const settled = async (p: Promise<unknown>) => p.then(() => 'resolved', (e) => e);
    await settled(runtime.goBack('s1'));
    await settled(runtime.goForward('s1'));
    await settled(runtime.reload('s1'));
    await settled(runtime.dragAtPoints('s1', 1, 2, 3, 4));
    const up = await settled(runtime.uploadFileViaTrigger('s1', '#pick', 'C:/no/such/dir/file-SECRETNAME.txt'));
    expect(up).toBeInstanceOf(Error);
    const h = runtime.getActionHistory('s1');
    const byType = Object.fromEntries(h.map((e) => [e.actionType, e]));
    for (const t of ['go_back', 'go_forward', 'reload', 'drag_at_points', 'upload_file_via_trigger']) expect(byType[t], t).toBeDefined();
    expect(byType['drag_at_points']!.target).toBe('(1, 2) -> (3, 4)');
    expect(byType['upload_file_via_trigger']).toMatchObject({ success: false, selector: '#pick', target: 'file-SECRETNAME.txt' });
    expect(byType['upload_file_via_trigger']!.target).not.toContain('/');
  });

  it('R11 / verification: an action result verification is stored (the same contract), and its URLs are redacted', async () => {
    const { runtime, session } = await setup();
    await session.createTab();
    const verification = {
      verified: false,
      urlChanged: false,
      elementFound: false,
      confidence: 0.09,
      reason: 'landed on http://x.test/a?token=SECRET-V',
      evidence: { tier: 'contradicted', checks: [{ check: 'navigate.committed', outcome: 'fail', observed: 'http://x.test/a?token=SECRET-V' }] },
    };
    const tab = session.getTabs()[0]!;
    await (runtime as any).withHistory(tab, { actionType: 'navigate', target: 'http://x.test/a' }, true, async () => ({
      tabId: 't',
      url: 'u',
      title: 't',
      verification,
    }));
    const h = runtime.getActionHistory('s1')[0] as any;
    expect(h.verification.evidence.tier).toBe('contradicted');
    expect(h.verification.confidence).toBe(0.09);
    expect(JSON.stringify(h)).not.toContain('SECRET-V');
  });

  it('a wait_for entry now carries url and the verification of the result (FR2-08 evidence)', async () => {
    const runtime = new SutradharRuntime();
    const recorded: any[] = [];
    const frame: any = {
      isDetached: () => false,
      parentFrame: () => null,
      frameElement: async () => null,
      url: () => 'https://a.test/',
      evaluate: vi.fn(async () => true),
    };
    const page = { isClosed: () => false, url: () => 'https://a.test/', title: vi.fn(async () => 'A'), mainFrame: () => frame, frames: () => [frame] };
    const tab = {
      id: 'tab_1',
      url: 'https://a.test/',
      title: 'c',
      page,
      getPendingDialog: () => undefined,
      recordAction: (e: unknown) => recorded.push(e),
    };
    vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
    await runtime.waitFor('s', { text: 'x', timeoutMs: 1000 });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://a.test/');
    expect(recorded[0].verification.evidence.checks.map((c: any) => c.check)).toEqual(['wait_for.text']);
  });
});

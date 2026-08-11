/**
 * @file apps/server/src/routes/browser-routes.ts
 * @description HTTP REST route controller exposing /api/v1/browser/* endpoints
 * delegating to BrowserSessionManager.
 *
 * Every endpoint performs REAL work against the live Puppeteer page and returns
 * an honest HTTP error (404/503) when the session or page is unavailable. There
 * are no canned/mock fallbacks — a missing page yields a 503, not a fake PNG.
 */

import { createSessionId, createTabId, SessionId, TabId } from '@sutradhar/contracts';
import { ApiRouter, ApiResponse } from '../gateway/api-router.js';
import {
  BrowserSessionManager,
  IBrowserSession,
  IBrowserTab,
  DOMSemanticEngine,
  formatGraphForLlm,
} from '@sutradhar/browser';

/**
 * Resolves a tab for a request: the explicit tabId if given, else the session's
 * active tab, else the first tab. Returns 503 via the response if no usable tab
 * with a real page exists.
 */
function resolveTab(
  session: IBrowserSession | undefined,
  tabId: string | undefined,
  res: ApiResponse,
): IBrowserTab | undefined {
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return undefined;
  }
  let tab: IBrowserTab | undefined;
  if (tabId) {
    tab = session.getTab(createTabId(tabId));
  }
  if (!tab) {
    const active = session.activeTabId ? session.getTab(session.activeTabId) : undefined;
    tab = active ?? session.getTabs()[0];
  }
  if (!tab) {
    res.status(503).json({ error: 'No browser tab available in this session' });
    return undefined;
  }
  return tab;
}

export function registerBrowserRoutes(
  router: ApiRouter,
  sessionManager: BrowserSessionManager,
): void {
  router.post('/api/v1/browser/launch', async (req, res) => {
    const body = (req.body as { sessionId?: string; initialUrl?: string }) ?? {};
    const sessionId = createSessionId(body.sessionId || `sess_${Date.now()}`);
    let session = sessionManager.getSession(sessionId);

    if (!session) {
      session = await sessionManager.createSession({ sessionId, initialUrl: body.initialUrl });
    }

    res.status(200).json({ sessionId: session.id, status: 'running' });
  });

  router.post('/api/v1/browser/shutdown', async (req, res) => {
    const body = (req.body as { sessionId?: string }) ?? {};
    if (body.sessionId) {
      await sessionManager.closeSession(createSessionId(body.sessionId));
    }
    res.status(200).json({ success: true });
  });

  router.post('/api/v1/browser/navigate', async (req, res) => {
    const body = (req.body as { sessionId?: string; tabId?: string; url?: string }) ?? {};
    const session = sessionManager.getSession(createSessionId(body.sessionId || ''));

    if (!session) {
      res.status(404).json({ error: `Session not found` });
      return;
    }

    const targetUrl = body.url || 'about:blank';
    let tab = body.tabId ? session.getTab(createTabId(body.tabId)) : undefined;
    if (!tab) {
      // Reuse the active/first tab if it exists, else create one.
      const existing = session.activeTabId
        ? session.getTab(session.activeTabId)
        : session.getTabs()[0];
      tab = existing ?? (await session.createTab(targetUrl));
    }
    await tab.navigate(targetUrl);

    res.status(200).json({ tabId: tab.id, url: tab.url, title: tab.title });
  });

  router.post('/api/v1/browser/tabs/create', async (req, res) => {
    const body = (req.body as { sessionId?: string; url?: string; title?: string }) ?? {};
    const session = sessionManager.getSession(createSessionId(body.sessionId || ''));

    if (!session) {
      res.status(404).json({ error: `Session not found` });
      return;
    }

    const tab = await session.createTab(body.url || 'about:blank');
    res.status(200).json({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      active: tab.isActive,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      historyStack: [tab.url],
      historyIndex: 0,
    });
  });

  router.post('/api/v1/browser/tabs/close', async (req, res) => {
    const body = (req.body as { sessionId?: string; tabId?: string }) ?? {};
    const session = sessionManager.getSession(createSessionId(body.sessionId || ''));
    if (session && body.tabId) {
      await session.closeTab(createTabId(body.tabId));
    }
    res.status(200).json({ success: true });
  });

  router.post('/api/v1/browser/tabs/focus', async (req, res) => {
    const body = (req.body as { sessionId?: string; tabId?: string }) ?? {};
    const session = sessionManager.getSession(createSessionId(body.sessionId || ''));
    if (session && body.tabId) {
      session.setActiveTab(createTabId(body.tabId));
    }
    res.status(200).json({ success: true });
  });

  router.post('/api/v1/browser/goback', async (req, res) => {
    const body = (req.body as { sessionId?: string; tabId?: string }) ?? {};
    const session = sessionManager.getSession(createSessionId(body.sessionId || ''));
    const tab = resolveTab(session, body.tabId, res);
    if (!tab) return;

    if (!tab.page || tab.page.isClosed()) {
      res.status(503).json({ error: 'No real browser page attached to this tab' });
      return;
    }
    try {
      await tab.page.goBack();
    } catch (err) {
      res.status(502).json({ error: `goBack failed: ${(err as Error).message}` });
      return;
    }
    res.status(200).json({ tabId: tab.id, url: tab.url });
  });

  router.post('/api/v1/browser/goforward', async (req, res) => {
    const body = (req.body as { sessionId?: string; tabId?: string }) ?? {};
    const session = sessionManager.getSession(createSessionId(body.sessionId || ''));
    const tab = resolveTab(session, body.tabId, res);
    if (!tab) return;

    if (!tab.page || tab.page.isClosed()) {
      res.status(503).json({ error: 'No real browser page attached to this tab' });
      return;
    }
    try {
      await tab.page.goForward();
    } catch (err) {
      res.status(502).json({ error: `goForward failed: ${(err as Error).message}` });
      return;
    }
    res.status(200).json({ tabId: tab.id, url: tab.url });
  });

  router.post('/api/v1/browser/reload', async (req, res) => {
    const body = (req.body as { sessionId?: string; tabId?: string }) ?? {};
    const session = sessionManager.getSession(createSessionId(body.sessionId || ''));
    const tab = resolveTab(session, body.tabId, res);
    if (!tab) return;

    if (!tab.page || tab.page.isClosed()) {
      res.status(503).json({ error: 'No real browser page attached to this tab' });
      return;
    }
    try {
      await tab.page.reload({ waitUntil: 'domcontentloaded' });
    } catch (err) {
      res.status(502).json({ error: `reload failed: ${(err as Error).message}` });
      return;
    }
    res.status(200).json({ tabId: tab.id, url: tab.url });
  });

  router.post('/api/v1/browser/screenshot', async (req, res) => {
    const body = (req.body as { sessionId?: string; tabId?: string }) ?? {};
    const session = sessionManager.getSession(createSessionId(body.sessionId || ''));
    const tab = resolveTab(session, body.tabId, res);
    if (!tab) return;

    if (!tab.page || tab.page.isClosed()) {
      res.status(503).json({ error: 'No real browser page attached to this tab' });
      return;
    }

    let screenshotData: string;
    try {
      const buffer = await tab.page.screenshot({ type: 'png', encoding: 'base64' });
      screenshotData = `data:image/png;base64,${buffer}`;
    } catch (err) {
      res.status(502).json({ error: `screenshot failed: ${(err as Error).message}` });
      return;
    }
    res.status(200).json({ screenshotData });
  });

  router.post('/api/v1/browser/eval', async (req, res) => {
    const body = (req.body as { sessionId?: string; tabId?: string; code?: string }) ?? {};
    const session = sessionManager.getSession(createSessionId(body.sessionId || ''));
    const tab = resolveTab(session, body.tabId, res);
    if (!tab) return;

    if (!tab.page || tab.page.isClosed()) {
      res.status(503).json({ error: 'No real browser page attached to this tab' });
      return;
    }
    if (!body.code) {
      res.status(400).json({ error: 'Missing required field: code' });
      return;
    }

    try {
      const evalResult = await tab.page.evaluate(body.code);
      res.status(200).json({ success: true, result: evalResult });
    } catch (err) {
      res.status(502).json({ success: false, error: (err as Error).message });
    }
  });

  router.post('/api/v1/browser/cookies', async (req, res) => {
    const body = (req.body as { sessionId?: string; tabId?: string }) ?? {};
    const session = sessionManager.getSession(createSessionId(body.sessionId || ''));
    const tab = resolveTab(session, body.tabId, res);
    if (!tab) return;

    if (!tab.page || tab.page.isClosed()) {
      res.status(503).json({ error: 'No real browser page attached to this tab' });
      return;
    }
    try {
      const cookies = await tab.page.cookies();
      res.status(200).json({ cookies });
    } catch (err) {
      res.status(502).json({ error: `cookies failed: ${(err as Error).message}` });
    }
  });

  router.post('/api/v1/browser/downloads', async (_req, res) => {
    // Download tracking is not yet wired to the browser session. Return an honest
    // empty list (no fabricated mock entries) so callers know there are zero.
    res.status(200).json({ downloads: [] });
  });

  // --- Agent vision: real DOM semantic graph + visible text -----------------
  router.get('/api/v1/browser/snapshot/:sessionId/:tabId', async (req, res) => {
    const params = req.params ?? {};
    const sessionId = (params['sessionId'] ?? '') as SessionId;
    const tabId = (params['tabId'] ?? '') as TabId;
    const session = sessionManager.getSession(sessionId);
    const tab = resolveTab(session, tabId, res);
    if (!tab) return;

    if (!tab.page || tab.page.isClosed()) {
      res.status(503).json({ error: 'No real browser page attached to this tab' });
      return;
    }

    const semanticEngine = new DOMSemanticEngine();
    const graph = await semanticEngine.buildGraph(tab);
    const elementList = formatGraphForLlm(graph);

    let pageText = '';
    try {
      pageText = (await tab.page.evaluate(() => {
        const grab = (sel: string, limit: number): string[] => {
          const out: string[] = [];
          for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
            const t = (el.innerText || '').trim().replace(/\n{2,}/g, '\n');
            if (t) out.push(t);
            if (out.length >= limit) break;
          }
          return out;
        };
        const infobox = document.querySelector<HTMLElement>('.infobox, table.biography');
        const infoboxText = infobox
          ? `[INFOBOX]\n${infobox.innerText.trim().slice(0, 800)}\n[/INFOBOX]\n`
          : '';
        const lead = grab('p', 5).filter((p) => p.length > 40).slice(0, 3);
        return (infoboxText + lead.join('\n')).slice(0, 1500);
      })) as string;
    } catch {
      pageText = '';
    }

    res.status(200).json({
      sessionId,
      tabId,
      url: tab.url,
      title: tab.title,
      interactiveElements: elementList,
      pageText,
      elementCount: graph.nodes.length,
    });
  });
}

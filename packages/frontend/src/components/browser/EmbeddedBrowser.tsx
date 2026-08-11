/**
 * @file packages/frontend/src/components/browser/EmbeddedBrowser.tsx
 * @description Embedded Browser Workspace — full-bleed viewport, tab strip, omnibar, dev console.
 * Rebuilt from first principles: zero inline styles for structural concerns,
 * all layout via CSS classes, no artificial maxWidth on the viewport.
 */

import React, { useState, useEffect, useRef } from 'react';
import { BrowserSession } from '../../runtime/browser/browserSession.js';
import { BrowserCapabilityAPI } from '../../runtime/browser/browserCapabilityAPI.js';
import { TabSnapshot } from '../../runtime/browser/browserTypes.js';
import { Spinner } from '../ui/Spinner.js';
import { Tooltip } from '../ui/Tooltip.js';
import { useToast } from '../ui/Toast.js';
import { cn } from '../../utils/cn.js';
import { isSecureUrl } from '../../utils/sessionUtils.js';
import { getSession } from '../../runtime/api/client.js';
import {
  IconArrowLeft,
  IconArrowRight,
  IconRefresh,
  IconLock,
  IconLockOpen,
  IconPlus,
  IconX,
  IconGlobe,
  IconTerminal,
  IconKeyboard,
} from '../ui/icons.js';

export interface EmbeddedBrowserProps {
  browserSession: BrowserSession;
  /** True while the agent loop is acting — the viewport polls fast. */
  agentActive?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Main component                                                       */
/* ------------------------------------------------------------------ */

/**
 * Consecutive screenshot failures after which live polling stops.
 * Generous on purpose: at session start the backend provisions its browser
 * asynchronously, so the first polls can legitimately 404/503 before the
 * session is live — those must not trip the disconnect state.
 */
const MAX_SCREENSHOT_FAILURES = 5;
/** Poll cadence: fast while the page or the agent is acting, slow at idle. */
const POLL_FAST_MS = 900;
const POLL_IDLE_MS = 3000;

interface ClickRipple { id: number; x: number; y: number; }

export const EmbeddedBrowser: React.FC<EmbeddedBrowserProps> = ({ browserSession, agentActive = false }) => {
  if (!browserSession) {
    return (
      <div className="pt-empty" style={{ height: '100%' }}>
        <Spinner size="lg" />
        <span style={{ fontSize: 'var(--pt-text-sm)', color: 'var(--pt-text-tertiary)', marginTop: 'var(--pt-space-3)' }}>
          Attaching to browser session…
        </span>
      </div>
    );
  }

  const [capability]      = useState(() => new BrowserCapabilityAPI(browserSession));
  const [tabs,             setTabs]          = useState<readonly TabSnapshot[]>(() => browserSession.getTabs());
  const [activeTab,        setActiveTab]     = useState<TabSnapshot | null>(() => browserSession.getActiveTab());
  const [inputUrl,         setInputUrl]      = useState(() => activeTab?.url ?? '');
  const [isLoading,        setIsLoading]     = useState(false);
  const [showConsole,      setShowConsole]   = useState(false);
  const [screenshotFrame,  setScreenshot]    = useState<string | null>(null);
  const [prevFrame,        setPrevFrame]     = useState<string | null>(null);
  const [frameNonce,       setFrameNonce]    = useState(0);
  const [ripples,          setRipples]       = useState<ClickRipple[]>([]);
  const [consoleLogs,      setConsoleLogs]   = useState<string[]>([
    `[Runtime] Attached to session ${browserSession.sessionId}`,
  ]);
  const [typeTextValue, setTypeTextValue] = useState('');
  const [pollingStopped, setPollingStopped] = useState(false);
  const { addToast } = useToast();
  const imgRef = useRef<HTMLImageElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const screenshotFailures = useRef(0);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Aborts the in-flight screenshot request, if any — set right before starting a new one
  // (caps concurrent screenshot requests to 1) and on unmount, so a hung/slow request never
  // outlives the component and doesn't sit in the browser's per-origin connection pool
  // starving other requests (e.g. a History page load) after the user has navigated away.
  const screenshotAbortRef = useRef<AbortController | null>(null);
  const frameRef = useRef<string | null>(null);
  const rippleId = useRef(0);

  /**
   * Map a click on the displayed frame to real backend-page coordinates.
   * Uses the screenshot's intrinsic (natural) size — the true backend
   * viewport — and accounts for `object-fit: contain` letterboxing.
   */
  const handleViewportClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!imgRef.current) return;
    const img = imgRef.current;
    const rect = img.getBoundingClientRect();
    const nw = img.naturalWidth  || 1280;
    const nh = img.naturalHeight || 800;
    const scale = Math.min(rect.width / nw, rect.height / nh);
    const offX = (rect.width  - nw * scale) / 2;
    const offY = (rect.height - nh * scale) / 2;
    const clickX = Math.min(nw, Math.max(0, (e.clientX - rect.left - offX) / scale));
    const clickY = Math.min(nh, Math.max(0, (e.clientY - rect.top  - offY) / scale));

    // Optimistic highlight at the click point (display space).
    const id = ++rippleId.current;
    setRipples((p) => [...p, { id, x: e.clientX - rect.left, y: e.clientY - rect.top }]);
    setTimeout(() => setRipples((p) => p.filter((r) => r.id !== id)), 600);

    setConsoleLogs((p) => [...p, `[User Click] Forwarded coordinate (${Math.round(clickX)}, ${Math.round(clickY)}) of ${nw}×${nh}`]);
    try {
      await capability.clickCoordinate(clickX, clickY);
      void refreshState();
    } catch (err) {
      // Silent failure is a UX bug: the user clicked and nothing happened.
      addToast({ title: 'Click not delivered', message: (err as Error).message, type: 'danger' });
    }
  };

  const handleSendKeystrokes = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!typeTextValue) return;
    const textToSend = typeTextValue;
    setTypeTextValue('');
    setConsoleLogs((p) => [...p, `[User Keypress] Typed text: "${textToSend}"`]);
    try {
      await capability.typeText(textToSend);
      void refreshState();
    } catch (err) {
      addToast({ title: 'Keystrokes not delivered', message: (err as Error).message, type: 'danger' });
    }
  };

  const handlePressEnter = async () => {
    setConsoleLogs((p) => [...p, `[User Keypress] Sent Enter key`]);
    try {
      await capability.executeJavaScript(
        `if (document.activeElement) {
          document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, code: 'Enter', bubbles: true }));
          document.activeElement.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, code: 'Enter', bubbles: true }));
          document.activeElement.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, code: 'Enter', bubbles: true }));
          if (document.activeElement.form) document.activeElement.form.submit();
        }`,
      );
      void refreshState();
    } catch (err) {
      addToast({ title: 'Enter not delivered', message: (err as Error).message, type: 'danger' });
    }
  };

  const refreshState = async () => {
    // Backend session state is the source of truth for the tab strip and
    // address bar — sync before painting so agent-side navigation shows up.
    try {
      const dto = await getSession(browserSession.sessionId);
      if (dto) browserSession.syncFromServer(dto);
    } catch {
      // Session not registered yet (startup race) — keep the local mirror.
    }
    const currentTabs   = browserSession.getTabs();
    const currentActive = browserSession.getActiveTab();
    setTabs(currentTabs);
    setActiveTab(currentActive);
    if (currentActive && document.activeElement !== addressRef.current) {
      setInputUrl(currentActive.url);
    }
      // Cap in-flight screenshot requests to 1: abort whatever the previous poll started
      // before issuing a new one, rather than letting a slow/hung request linger.
      screenshotAbortRef.current?.abort();
      const controller = new AbortController();
      screenshotAbortRef.current = controller;
      try {
        const frame = await capability.captureScreenshot(undefined, controller.signal);
        screenshotFailures.current = 0;
        if (frame?.startsWith('data:image') && frame !== frameRef.current) {
          setPrevFrame(frameRef.current);
          frameRef.current = frame;
          setScreenshot(frame);
          setFrameNonce((n) => n + 1);
        }
      } catch {
        if (controller.signal.aborted) return; // superseded by a newer poll or unmount — not a real failure
        // Screenshot unavailable — honest empty state stays. Repeated failures
        // mean the backend no longer knows this session (e.g. server
        // restarted), so stop polling instead of flooding 404s.
        screenshotFailures.current += 1;
        if (screenshotFailures.current >= MAX_SCREENSHOT_FAILURES) {
          setPollingStopped(true);
          addToast({ title: 'Live view disconnected', message: 'The backend stopped sending screenshots. Reconnect to reattach.', type: 'warning' });
          setConsoleLogs((p) => [
            ...p,
            '[Runtime] Screenshot stream unavailable — live polling paused. Use Reconnect to reattach.',
          ]);
        }
      }
  };

  useEffect(() => {
    screenshotFailures.current = 0;
    void refreshState();

    const offTabCreated   = browserSession.runtime.events.on('TabCreated',       ({ tab })   => { setConsoleLogs((p) => [...p, `[TabCreated] ${tab.id} (${tab.url})`]);             void refreshState(); });
    const offTabClosed    = browserSession.runtime.events.on('TabClosed',        ({ tabId }) => { setConsoleLogs((p) => [...p, `[TabClosed] ${tabId}`]);                           void refreshState(); });
    const offTabActivated = browserSession.runtime.events.on('TabActivated',     ({ tabId }) => { setConsoleLogs((p) => [...p, `[TabActivated] ${tabId}`]);                        void refreshState(); });
    const offNavStarted   = browserSession.runtime.events.on('NavigationStarted',({ url })   => { setIsLoading(true);  setConsoleLogs((p) => [...p, `[NavStarted] → ${url}`]); });
    const offNavCompleted = browserSession.runtime.events.on('NavigationCompleted',({ url, title }) => {
      setIsLoading(false);
      setConsoleLogs((p) => [...p, `[NavCompleted] "${title ?? ''}" (${url})`]);
      void refreshState();
    });

    return () => {
      offTabCreated(); offTabClosed(); offTabActivated(); offNavStarted(); offNavCompleted();
      // Abort any in-flight screenshot request — on unmount AND on browserSession change
      // (e.g. navigating away to a History run detail), so it can't keep holding a
      // connection-pool slot the next page needs. See PROB-006.
      screenshotAbortRef.current?.abort();
    };
  }, [browserSession]);

  // Adaptive polling: fast while the page loads or the agent acts, slow at
  // idle, fully paused while the tab is hidden (Servant Model: no wasted work).
  useEffect(() => {
    if (pollingStopped || document.hidden) return;
    const ms = isLoading || agentActive ? POLL_FAST_MS : POLL_IDLE_MS;
    pollIntervalRef.current = setInterval(() => { void refreshStateRef.current(); }, ms);
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    };
  }, [isLoading, agentActive, pollingStopped, browserSession]);

  // Pause/resume with visibility; refresh immediately on return.
  useEffect(() => {
    const onVisibility = () => { if (!document.hidden) void refreshStateRef.current(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    let target = inputUrl.trim();
    if (!target) return;
    if (!/^https?:\/\//i.test(target) && target !== 'about:blank') {
      target = `https://${target}`;
    }
    void capability.openURL(target).catch((err) => {
      addToast({ title: 'Navigation failed', message: (err as Error).message, type: 'danger' });
    });
  };

  // Reattach after the screenshot stream gave up (e.g. server restarted).
  const handleReconnect = () => {
    screenshotFailures.current = 0;
    setPollingStopped(false);
    void refreshState();
  };

  const secure = isSecureUrl(activeTab?.url ?? '');

  // Latest-refresh closure for the reconnect interval.
  const refreshStateRef = useRef<() => Promise<void>>(async () => {});
  refreshStateRef.current = refreshState;

  return (
    <div className="pt-browser">
      {/* ── Tab strip ── */}
      <div className="pt-tab-strip" role="tablist" aria-label="Browser tabs">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab?.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              className={cn('pt-browser-tab', isActive && 'pt-browser-tab--active')}
              onClick={() => capability.focusTab(tab.id)}
            >
              <span className="pt-browser-tab__favicon">
                <IconGlobe />
              </span>
              <span className="pt-browser-tab__title" title={tab.title}>
                {tab.title || 'New Tab'}
              </span>
              {tabs.length > 1 && (
                <button
                  type="button"
                  className="pt-browser-tab__close"
                  onClick={(e) => { e.stopPropagation(); capability.closeTab(tab.id); }}
                  aria-label={`Close tab: ${tab.title}`}
                >
                  <IconX />
                </button>
              )}
            </button>
          );
        })}
        <Tooltip content="New tab" position="bottom">
          <button
            type="button"
            className="pt-tab-strip__new-btn"
            onClick={() => capability.createTab('about:blank')}
            aria-label="Open new tab"
          >
            <IconPlus />
          </button>
        </Tooltip>
      </div>

      {/* ── Loading progress bar ── */}
      {isLoading && (
        <div className="pt-browser-load-bar">
          <div className="pt-browser-load-bar__fill" />
        </div>
      )}

      {/* ── Omnibar ── */}
      <div className="pt-omnibar">
        <div className="pt-omnibar__nav-btns">
          <Tooltip content="Go back" position="bottom">
            <button
              type="button"
              className="pt-btn pt-btn--ghost pt-btn--sm pt-btn--icon"
              disabled={!activeTab?.canGoBack}
              onClick={() => { void capability.goBack(); }}
              aria-label="Go back"
            >
              <IconArrowLeft />
            </button>
          </Tooltip>
          <Tooltip content="Go forward" position="bottom">
            <button
              type="button"
              className="pt-btn pt-btn--ghost pt-btn--sm pt-btn--icon"
              disabled={!activeTab?.canGoForward}
              onClick={() => { void capability.goForward(); }}
              aria-label="Go forward"
            >
              <IconArrowRight />
            </button>
          </Tooltip>
          <Tooltip content="Reload" position="bottom">
            <button
              type="button"
              className={cn('pt-btn pt-btn--ghost pt-btn--sm pt-btn--icon', isLoading && 'pt-btn--loading')}
              onClick={() => { void capability.reload(); }}
              aria-label="Reload page"
            >
              {isLoading ? <Spinner size="xs" /> : <IconRefresh />}
            </button>
          </Tooltip>
        </div>

        <form className="pt-omnibar__address-wrap" onSubmit={handleNavigate}>
          <span className={cn('pt-omnibar__lock', !secure && 'pt-omnibar__lock--insecure')} aria-hidden="true">
            {secure ? <IconLock /> : <IconLockOpen />}
          </span>
          <input
            ref={addressRef}
            type="text"
            className="pt-omnibar__input"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="Enter URL or search…"
            aria-label="Address bar"
            spellCheck={false}
            autoComplete="off"
          />
        </form>

        <div className="pt-omnibar__actions">
          <Tooltip content="Developer console" position="bottom">
            <button
              type="button"
              className={cn('pt-btn pt-btn--ghost pt-btn--sm pt-btn--icon', showConsole && 'pt-btn--secondary')}
              onClick={() => setShowConsole(!showConsole)}
              aria-label="Toggle developer console"
              aria-pressed={showConsole}
            >
              <IconTerminal />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* ── Viewport input bar (soft strip) ── */}
      <div className="pt-viewport-bar">
        <span className="pt-viewport-bar__label">
          <IconKeyboard />
          Type into viewport
        </span>
        <form onSubmit={handleSendKeystrokes} style={{ flex: 1, display: 'flex', gap: 'var(--pt-space-2)' }}>
          <input
            type="text"
            className="pt-omnibar__input"
            style={{ fontSize: 'var(--pt-text-xs)', height: '28px', flex: 1 }}
            value={typeTextValue}
            onChange={(e) => setTypeTextValue(e.target.value)}
            placeholder="Click an input on the live frame, then type here (e.g. user@gmail.com)…"
          />
          <button type="submit" className="pt-btn pt-btn--primary pt-btn--xs">
            Send Text
          </button>
          <button type="button" className="pt-btn pt-btn--secondary pt-btn--xs" onClick={handlePressEnter}>
            Press Enter
          </button>
        </form>
      </div>

      {/* ── Viewport — backend screenshots are the ONLY source ── */}
      <div className="pt-browser-viewport">
        {pollingStopped && (
          <div className="pt-viewport-banner" role="status">
            Live view disconnected.
            <button type="button" className="pt-btn pt-btn--primary pt-btn--xs" onClick={handleReconnect}>
              Reconnect
            </button>
          </div>
        )}
        {screenshotFrame ? (
          <div className="pt-browser-viewport__stack">
            {prevFrame && prevFrame !== screenshotFrame && (
              <img src={prevFrame} alt="" aria-hidden="true" className="pt-browser-viewport__frame" />
            )}
            <img
              key={frameNonce}
              ref={imgRef}
              src={screenshotFrame}
              onClick={handleViewportClick}
              alt={`Live viewport: ${activeTab?.title ?? ''}`}
              className="pt-browser-viewport__frame pt-browser-viewport__frame--top"
              style={{ cursor: 'crosshair' }}
              title="Click anywhere on the live frame to click the real page"
            />
            {ripples.map((r) => (
              <span key={r.id} className="pt-click-ripple" style={{ left: r.x, top: r.y }} aria-hidden="true" />
            ))}
          </div>
        ) : (
          <div className="pt-browser-viewport__empty">
            {isLoading ? (
              <>
                <Spinner size="lg" />
                <span style={{ fontSize: 'var(--pt-text-sm)', color: 'var(--pt-text-tertiary)' }}>
                  Loading {activeTab?.url ?? 'page'}…
                </span>
              </>
            ) : (
              <>
                <IconGlobe size={24} />
                <span style={{ fontSize: 'var(--pt-text-sm)', color: 'var(--pt-text-secondary)' }}>
                  No live frame yet
                </span>
                <span style={{ fontSize: 'var(--pt-text-xs)', color: 'var(--pt-text-tertiary)', maxWidth: 320, textAlign: 'center' }}>
                  The backend browser streams screenshots here while the session
                  is attached. Navigate to a URL or run the agent to see the page.
                </span>
              </>
            )}
          </div>
        )}

        {/* Dev console */}
        {showConsole && (
          <div className="pt-dev-console">
            <div className="pt-dev-console__header">
              <span>Console</span>
              <button
                type="button"
                className="pt-btn pt-btn--ghost pt-btn--xs pt-btn--icon"
                onClick={() => setShowConsole(false)}
                aria-label="Close console"
              >
                <IconX />
              </button>
            </div>
            <div className="pt-dev-console__log-list">
              {consoleLogs.map((log, idx) => (
                <div
                  key={idx}
                  className={cn(
                    'pt-dev-console__log',
                    log.startsWith('[Nav')         && 'pt-dev-console__log--event',
                    log.startsWith('[TabActivated]') && 'pt-dev-console__log--event',
                    log.startsWith('[TabCreated]')   && 'pt-dev-console__log--event',
                    log.startsWith('[Error]')        && 'pt-dev-console__log--error',
                  )}
                >
                  {log}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

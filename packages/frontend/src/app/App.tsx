/**
 * @file packages/frontend/src/app/App.tsx
 * @description Main client application layout shell, global routing, command palette, and ErrorBoundary.
 */

import React, { useState, useEffect } from 'react';
import { RouterProvider, useRouter } from './router.js';
import { SessionProvider, useSessionStore } from '../stores/sessionStore.js';
import { ToastProvider } from '../components/ui/Toast.js';
import { WorkspaceRail } from '../components/layout/WorkspaceRail.js';
import { GlobalCommandPalette } from '../components/layout/GlobalCommandPalette.js';
import { HomePage } from '../pages/home/HomePage.js';
import { SessionsListPage } from '../pages/sessions/SessionsListPage.js';
import { SessionPage } from '../pages/session/SessionPage.js';
import { SettingsPage } from '../pages/settings/SettingsPage.js';
import { DownloadsPage } from '../pages/downloads/DownloadsPage.js';
import { HistoryPage, RunDetailPage } from '../pages/history/HistoryPage.js';
import { Modal } from '../components/ui/Modal.js';
import { Input } from '../components/ui/Input.js';
import { TextArea } from '../components/ui/TextArea.js';
import { Button } from '../components/ui/Button.js';
import { IconAlert, IconRefresh } from '../components/ui/icons.js';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class GlobalErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Global Error Boundary caught exception:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--pt-surface-0)',
            color: 'var(--pt-text-primary)',
            padding: 'var(--pt-space-6)',
            textAlign: 'center',
          }}
        >
          <div className="pt-empty__icon" style={{ color: 'var(--pt-semantic-warning)', marginBottom: 'var(--pt-space-4)' }}>
            <IconAlert size={24} />
          </div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 600, color: 'var(--pt-text-heading)', margin: 0 }}>
            Workspace Session Recovered
          </h2>
          <p style={{ maxWidth: '480px', color: 'var(--pt-text-secondary)', margin: '12px 0 24px', lineHeight: 1.5 }}>
            A temporary component state error occurred. Click below to reload your browser workspace cleanly.
          </p>
          <Button
            variant="primary"
            onClick={() => {
              try {
                localStorage.removeItem('sutradhar_llm_config_v1');
                localStorage.removeItem('sutradhar_settings_v1');
              } catch {
                // Ignore storage errors
              }
              window.location.assign('/');
            }}
          >
            <IconRefresh size={14} /> Reset & Reload Sutradhar Workspace
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

const AppContent: React.FC = () => {
  const { currentPath, navigate } = useRouter();
  const { createSession }         = useSessionStore();

  const [cmdOpen,     setCmdOpen]     = useState(false);
  const [newSessOpen, setNewSessOpen] = useState(false);
  const [newTitle,    setNewTitle]    = useState('');
  const [newGoal,     setNewGoal]     = useState('');
  const [newUrl,      setNewUrl]      = useState('');
  const [goalError,   setGoalError]   = useState<string | undefined>(undefined);
  const goalRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const handleCreateSession = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGoal.trim()) {
      // PROB-007: clicking Launch with an empty Goal used to just silently do
      // nothing (the button was `disabled`, so this handler never even ran).
      // Now it always runs, so an empty goal gets a visible reason instead of
      // a click that looks like it did nothing.
      setGoalError('Goal is required — describe what the agent should accomplish.');
      goalRef.current?.focus();
      return;
    }
    // Goal is the only required field; the title auto-derives from it and
    // the start URL is explicit (never regex-guessed from the goal text).
    const title   = newTitle.trim() || newGoal.trim().slice(0, 64);
    const created = createSession(title, newGoal.trim(), newUrl.trim() || undefined);
    setNewTitle('');
    setNewGoal('');
    setNewUrl('');
    setGoalError(undefined);
    setNewSessOpen(false);
    navigate(`/session/${created.id}`);
  };

  const openNewSession = () => {
    setGoalError(undefined);
    setNewSessOpen(true);
  };

  const sessionId = currentPath.startsWith('/session/')
    ? currentPath.replace('/session/', '')
    : null;

  // Deep link /#/history/:runId — refresh-safe run detail.
  const historyRunId = currentPath.startsWith('/history/')
    ? currentPath.slice('/history/'.length)
    : null;

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: 'var(--pt-surface-0)',
      }}
    >
      <WorkspaceRail
        onOpenCommandPalette={() => setCmdOpen(true)}
        onOpenNewSessionModal={openNewSession}
      />

      <main style={{ flex: 1, minWidth: 0, height: '100vh', overflow: 'hidden' }}>
        {currentPath === '/' && (
          <HomePage onOpenNewSessionModal={openNewSession} />
        )}
        {currentPath === '/sessions' && (
          <SessionsListPage onOpenNewSessionModal={openNewSession} />
        )}
        {sessionId && <SessionPage key={sessionId} sessionId={sessionId} />}
        {currentPath === '/history' && <HistoryPage />}
        {historyRunId && <RunDetailPage key={historyRunId} runId={historyRunId} />}
        {currentPath === '/settings' && <SettingsPage />}
        {currentPath === '/downloads' && <DownloadsPage />}
      </main>

      <GlobalCommandPalette
        isOpen={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onOpenNewSessionModal={openNewSession}
      />

      <Modal
        isOpen={newSessOpen}
        title="New Browser Session"
        onClose={() => setNewSessOpen(false)}
        footer={
          <>
            <Button variant="ghost" type="button" onClick={() => setNewSessOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              type="button"
              onClick={handleCreateSession as unknown as React.MouseEventHandler<HTMLButtonElement>}
            >
              Launch Session
            </Button>
          </>
        }
      >
        <form
          id="new-session-form"
          onSubmit={handleCreateSession}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pt-space-4)' }}
        >
          <Input
            label="Session Title (optional)"
            placeholder="Auto-derived from the goal if left empty"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            autoFocus
          />
          <TextArea
            ref={goalRef}
            label="Goal"
            placeholder="Describe what the agent should accomplish in this session…"
            value={newGoal}
            onChange={(e) => {
              setNewGoal(e.target.value);
              if (goalError) setGoalError(undefined);
            }}
            error={goalError}
            autoResize
            required
          />
          <Input
            label="Start URL (optional)"
            placeholder="https://example.com — where the browser should open"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            spellCheck={false}
          />
        </form>
      </Modal>
    </div>
  );
};

export const App: React.FC = () => (
  <GlobalErrorBoundary>
    <RouterProvider>
      <SessionProvider>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </SessionProvider>
    </RouterProvider>
  </GlobalErrorBoundary>
);

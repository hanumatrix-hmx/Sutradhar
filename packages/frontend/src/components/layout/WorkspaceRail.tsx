/**
 * @file packages/frontend/src/components/layout/WorkspaceRail.tsx
 * @description WorkspaceRail — 48px icon-only vertical navigation bar.
 * Replaces the old 220px Sidebar. Contains: brand mark, primary nav, session dots, status.
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from '../../app/router.js';
import { useSessionStore } from '../../stores/sessionStore.js';
import { Tooltip } from '../ui/Tooltip.js';
import {
  IconLayers,
  IconSettings,
  IconDownload,
  IconClock,
  IconSearch,
  IconMoon,
  IconSun,
} from '../ui/icons.js';
import { getSessionInitials } from '../../utils/sessionUtils.js';
import { cn } from '../../utils/cn.js';

/* ------------------------------------------------------------------ */
/*  Theme management                                                     */
/* ------------------------------------------------------------------ */

type Theme = 'dark' | 'light';

function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem('sutradhar_theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* ignore */ }
  // Soft UI default: the neumorphic light canvas is the signature look.
  return 'light';
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('sutradhar_theme', theme); } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/*  WorkspaceRail                                                        */
/* ------------------------------------------------------------------ */

export interface WorkspaceRailProps {
  onOpenCommandPalette:   () => void;
  onOpenNewSessionModal:  () => void;
}

export const WorkspaceRail: React.FC<WorkspaceRailProps> = ({
  onOpenCommandPalette,
}) => {
  const { currentPath, navigate } = useRouter();
  const { sessions, activeSession, openSession } = useSessionStore();
  const [sessionListOpen, setSessionListOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(getStoredTheme);

  // Apply stored theme on mount
  useEffect(() => { applyTheme(theme); }, []);

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
  };

  const isActive = (path: string) =>
    path === '/' ? currentPath === '/' : currentPath.startsWith(path);

  return (
    <>
      <aside className="pt-rail" aria-label="Workspace navigation">
        {/* Brand mark */}
        <Tooltip content="Sutradhar" position="right">
          <button
            type="button"
            className="pt-rail__brand"
            onClick={() => navigate('/')}
            aria-label="Go to home"
          >
            P
          </button>
        </Tooltip>

        {/* Primary nav */}
        <nav className="pt-rail__nav" aria-label="Primary navigation">
          <Tooltip content="Sessions (S)" position="right">
            <button
              type="button"
              className={cn('pt-rail__btn', isActive('/sessions') && 'pt-rail__btn--active')}
              onClick={() => setSessionListOpen(!sessionListOpen)}
              aria-label="Sessions"
              aria-expanded={sessionListOpen}
            >
              <IconLayers />
            </button>
          </Tooltip>

          <Tooltip content="Search (⌘K)" position="right">
            <button
              type="button"
              className="pt-rail__btn"
              onClick={onOpenCommandPalette}
              aria-label="Search and commands"
            >
              <IconSearch />
            </button>
          </Tooltip>

          <Tooltip content="Downloads" position="right">
            <button
              type="button"
              className={cn('pt-rail__btn', isActive('/downloads') && 'pt-rail__btn--active')}
              onClick={() => navigate('/downloads')}
              aria-label="Downloads"
            >
              <IconDownload />
            </button>
          </Tooltip>

          <Tooltip content="History" position="right">
            <button
              type="button"
              className={cn('pt-rail__btn', isActive('/history') && 'pt-rail__btn--active')}
              onClick={() => navigate('/history')}
              aria-label="Execution history"
            >
              <IconClock />
            </button>
          </Tooltip>

          {/* Divider */}
          <div className="pt-rail__divider" role="separator" />

          {/* Session dots — one per session, max 6 visible (Desktop only) */}
          <div className="pt-rail__session-dots-wrapper">
            {sessions.slice(0, 6).map((session) => {
              const isActiveSess = activeSession?.id === session.id;
              const initials = getSessionInitials(session.title);
              return (
                <Tooltip key={session.id} content={session.title} position="right">
                  <button
                    type="button"
                    className={cn('pt-rail__session-dot', isActiveSess && 'pt-rail__session-dot--active')}
                    onClick={() => {
                      openSession(session.id);
                      navigate(`/session/${session.id}`);
                    }}
                    aria-label={`Open session: ${session.title}`}
                    aria-current={isActiveSess ? 'page' : undefined}
                  >
                    {initials}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </nav>

        {/* Settings + theme — pinned bottom */}
        <div className="pt-rail__status">
          <Tooltip content={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} position="right">
            <button
              type="button"
              className="pt-rail__btn"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <IconSun /> : <IconMoon />}
            </button>
          </Tooltip>
          <Tooltip content="Settings" position="right">
            <button
              type="button"
              className={cn('pt-rail__btn', isActive('/settings') && 'pt-rail__btn--active')}
              onClick={() => navigate('/settings')}
              aria-label="Settings"
            >
              <IconSettings />
            </button>
          </Tooltip>
        </div>
      </aside>

      {/* Session quick-select overlay */}
      {sessionListOpen && (
        <SessionsQuickOverlay
          onClose={() => setSessionListOpen(false)}
          onSelect={(id) => {
            openSession(id);
            navigate(`/session/${id}`);
            setSessionListOpen(false);
          }}
        />
      )}
    </>
  );
};

/* ------------------------------------------------------------------ */
/*  SessionsQuickOverlay — popover from rail                             */
/* ------------------------------------------------------------------ */

interface SessionsQuickOverlayProps {
  onClose:  () => void;
  onSelect: (id: string) => void;
}

const SessionsQuickOverlay: React.FC<SessionsQuickOverlayProps> = ({ onClose, onSelect }) => {
  const { sessions, activeSession } = useSessionStore();
  const { navigate } = useRouter();
  const [query, setQuery] = useState('');

  const filtered = sessions.filter(
    (s) =>
      s.title.toLowerCase().includes(query.toLowerCase()) ||
      s.goal.toLowerCase().includes(query.toLowerCase()),
  );

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const statusColor = (status: string) => {
    if (status === 'active')    return 'var(--pt-ai-acting)';
    if (status === 'paused')    return 'var(--pt-ai-waiting)';
    if (status === 'completed') return 'var(--pt-brand-primary)';
    return 'var(--pt-ai-idle)';
  };

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 150,
        }}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel — floating soft sheet (Servant Model: overlays, not destinations) */}
      <div
        style={{
          position: 'fixed',
          top: 'var(--pt-space-4)',
          left: 'calc(var(--pt-rail-width) + var(--pt-space-8))',
          bottom: 'var(--pt-space-4)',
          width: '320px',
          background: 'var(--pt-surface-1)',
          border: 'none',
          borderRadius: 'var(--pt-radius-4)',
          zIndex: 151,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--pt-shadow-xl)',
          animation: 'pt-soft-enter var(--pt-duration-panel) var(--pt-ease-spring)',
        }}
        role="dialog"
        aria-label="Sessions list"
      >
        {/* Header */}
        <div style={{ padding: 'var(--pt-space-4) var(--pt-space-4) var(--pt-space-2)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--pt-space-3)' }}>
            <span style={{ fontSize: 'var(--pt-text-sm)', fontWeight: 600, color: 'var(--pt-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Sessions
            </span>
            <button
              type="button"
              className="pt-btn pt-btn--primary pt-btn--sm"
              onClick={() => { navigate('/sessions'); onClose(); }}
            >
              View all
            </button>
          </div>
          <input
            autoFocus
            type="text"
            placeholder="Filter sessions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pt-input"
            style={{ fontSize: 'var(--pt-text-sm)' }}
          />
        </div>

        {/* Session list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--pt-space-2) 0' }}>
          {filtered.length === 0 ? (
            <div className="pt-empty" style={{ padding: 'var(--pt-space-8)' }}>
              <p className="pt-empty__message">No sessions match your search.</p>
            </div>
          ) : (
            filtered.map((session) => {
              const isActiveSess = activeSession?.id === session.id;
              return (
                <button
                  key={session.id}
                  type="button"
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--pt-space-3)',
                    padding: 'var(--pt-space-2) var(--pt-space-4)',
                    background: isActiveSess ? 'var(--pt-brand-primary-dim)' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: isActiveSess ? 'var(--pt-brand-primary)' : 'var(--pt-text-primary)',
                    transition: 'background-color var(--pt-duration-fast) var(--pt-ease-standard)',
                  }}
                  onClick={() => onSelect(session.id)}
                >
                  <span
                    style={{
                      width: 6, height: 6,
                      borderRadius: '50%',
                      background: statusColor(session.status),
                      flexShrink: 0,
                    }}
                    aria-hidden="true"
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--pt-text-base)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {session.title}
                    </div>
                    <div style={{ fontSize: 'var(--pt-text-xs)', color: 'var(--pt-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                      {session.goal}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
};

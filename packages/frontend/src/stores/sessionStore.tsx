/**
 * @file packages/frontend/src/stores/sessionStore.tsx
 * @description Centralized Session Store and React Context provider binding BrowserSession instances.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Session, RunRecord, TimelineEvent } from '../models/session.js';
import { BrowserManager } from '../runtime/browser/browserManager.js';
import { BrowserSession } from '../runtime/browser/browserSession.js';
import {
  createSession as createBackendSession,
  listSessions as listBackendSessions,
  deleteSession as deleteBackendSession,
  getRun as getBackendRun,
} from '../runtime/api/client.js';

export interface SessionContextValue {
  sessions: readonly Session[];
  activeSessionId: string | null;
  activeSession: Session | null;
  activeBrowserSession: BrowserSession | null;
  createSession: (title: string, goal: string, startUrl?: string) => Session;
  openSession: (id: string) => void;
  closeSession: () => void;
  renameSession: (id: string, title: string) => void;
  archiveSession: (id: string) => void;
  deleteSession: (id: string) => void;
  addNoteToSession: (id: string, content: string) => void;
  toggleTask: (sessionId: string, taskId: string) => void;
  resumeSessionWithAuth: (id: string, credentials?: { email?: string; password?: string }) => void;
  /** Retry launching the real backend browser session after a failure/detach. */
  relaunchBackend: (id: string) => void;
  /** Write-through persistence for agent run records (survives reloads). */
  upsertRun: (sessionId: string, run: RunRecord) => void;
  /** Append one real timeline entry (live agent steps land here as they happen). */
  appendTimeline: (sessionId: string, event: Omit<TimelineEvent, 'id'>) => void;
  recentSessions: readonly Session[];
}

export const SessionContext = createContext<SessionContextValue | undefined>(undefined);

const STORAGE_KEY = 'pinchtab_sessions_v2';
const BROWSER_SNAPSHOT_PREFIX = 'pinchtab_browser_snap_';

function normalizeStoredSession(raw: Session): Session {
  // Older localStorage payloads predate runs/backendSessionId — backfill so
  // legacy sessions load without crashing and without fabricated data.
  return {
    ...raw,
    backendSessionId: raw.backendSessionId ?? null,
    runs: Array.isArray(raw.runs) ? raw.runs : [],
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    progress: typeof raw.progress === 'number' ? raw.progress : 0,
  };
}

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const browserManager = BrowserManager.getInstance();

  const [sessions, setSessions] = useState<Session[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return (JSON.parse(stored) as Session[]).map(normalizeStoredSession);
      }
    } catch {
      // Corrupt localStorage — start clean.
    }
    // No fabricated demo sessions: the list is empty until the user creates a
    // real one (which launches a real backend browser session).
    return [];
  });

  // Ref mirror so stable callbacks can read the latest sessions list.
  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    return sessions[0]?.id || null;
  });

  // Track active BrowserSession
  const [activeBrowserSession, setActiveBrowserSession] = useState<BrowserSession | null>(() => {
    const initialId = sessions[0]?.id;
    if (initialId) {
      const bs = browserManager.getOrCreateBrowser(initialId, sessions[0]?.browserState.currentUrl);
      const savedSnap = localStorage.getItem(`${BROWSER_SNAPSHOT_PREFIX}${initialId}`);
      if (savedSnap) bs.deserialize(savedSnap);
      return bs;
    }
    return null;
  });

  // Persist sessions
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch {
      // Storage quota exceeded or disabled
    }
  }, [sessions]);

  // Boot reconciliation: mark sessions whose backend browser session no
  // longer exists (e.g. server restarted) as 'detached' instead of leaving
  // them falsely 'active'. Backend unreachable → leave state untouched.
  useEffect(() => {
    let cancelled = false;
    void listBackendSessions()
      .then((backend) => {
        if (cancelled) return;
        const liveIds = new Set(backend.map((b) => b.id));
        setSessions((prev) =>
          prev.map((s) => {
            if (!s.backendSessionId) return s;
            if (liveIds.has(s.backendSessionId)) return s;
            if (s.status === 'archived' || s.status === 'completed') return s;
            return { ...s, status: 'detached' as const };
          }),
        );
      })
      .catch(() => {
        // Backend offline at boot: the UI shows its own health state; we do
        // not fabricate detachments without evidence.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Run reconciliation: localStorage is a CACHE — the server is the source
  // of truth for runs. Any locally-'running' run (e.g. the tab closed
  // mid-run) is settled from its persisted server record at boot.
  useEffect(() => {
    let cancelled = false;
    const stale = sessionsRef.current.flatMap((s) =>
      s.runs
        .filter((r) => r.status === 'running' && r.serverRunId)
        .map((r) => ({ sessionId: s.id, run: r })),
    );
    for (const { sessionId, run } of stale) {
      void getBackendRun(run.serverRunId!)
        .then((rec) => {
          if (cancelled) return;
          // Still genuinely running server-side — leave it alone.
          if (rec.status === 'running') return;
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== sessionId) return s;
              return {
                ...s,
                runs: s.runs.map((r) =>
                  r.runId === run.runId
                    ? {
                        ...r,
                        status: rec.status,
                        endedAt: rec.endedAt ?? r.endedAt ?? new Date().toISOString(),
                        durationMs: rec.durationMs ?? r.durationMs,
                        steps: rec.steps.length > 0 ? rec.steps : r.steps,
                        answer: rec.answer ?? r.answer ?? null,
                        error:
                          rec.status === 'failed'
                            ? rec.error ?? rec.summary ?? 'Agent execution failed.'
                            : r.error ?? null,
                      }
                    : r,
                ),
              };
            }),
          );
        })
        .catch(() => {
          if (cancelled) return;
          // Server has no such record (offline or lost): settle honestly as
          // interrupted instead of spinning 'running' forever.
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== sessionId) return s;
              return {
                ...s,
                runs: s.runs.map((r) =>
                  r.runId === run.runId
                    ? {
                        ...r,
                        status: 'failed' as const,
                        endedAt: new Date().toISOString(),
                        error: r.error ?? 'Run interrupted — the server has no record of it.',
                      }
                    : r,
                ),
              };
            }),
          );
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;

  const openSession = useCallback((id: string) => {
    const existing = sessions.find((s) => s.id === id);
    setActiveSessionId(id);
    const bs = browserManager.getOrCreateBrowser(id, existing ? existing.browserState.currentUrl : 'https://github.com/pinchtab/pinchtab');
    const savedSnap = localStorage.getItem(`${BROWSER_SNAPSHOT_PREFIX}${id}`);
    if (savedSnap) bs.deserialize(savedSnap);
    setActiveBrowserSession(bs);
  }, [browserManager, sessions]);

  /**
   * Launch the real backend browser session for a frontend session.
   * Honest outcomes only: success records backendSessionId; failure sets
   * status 'error' (never 'paused' — that used to open the auth modal).
   */
  const launchBackendFor = useCallback((sessionId: string, startUrl?: string) => {
    // Pass the UI session id so the backend browser session gets the SAME id —
    // viewport, store and agent loop then share one live browser session.
    void createBackendSession(startUrl, sessionId)
      .then((backendSession) => {
        const launchTime = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sessionId) return s;
            return {
              ...s,
              backendSessionId: backendSession.id,
              status:
                s.status === 'error' || s.status === 'detached'
                  ? ('active' as const)
                  : s.status,
              updatedAt: new Date().toISOString(),
              timeline: [
                ...s.timeline,
                {
                  id: `t_${Date.now()}_backend`,
                  timestamp: launchTime,
                  action: `[Backend] Real browser session ${backendSession.id} launched${
                    backendSession.tabs[0]?.url ? ` → ${backendSession.tabs[0].url}` : ''
                  }.`,
                  category: 'navigation' as const,
                },
              ],
            };
          }),
        );
      })
      .catch((err) => {
        const errTime = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sessionId) return s;
            return {
              ...s,
              status: 'error' as const,
              updatedAt: new Date().toISOString(),
              timeline: [
                ...s.timeline,
                {
                  id: `t_${Date.now()}_err`,
                  timestamp: errTime,
                  action: `[Backend Error] Could not launch browser session: ${(err as Error).message}`,
                  category: 'extraction' as const,
                },
              ],
            };
          }),
        );
      });
  }, []);

  const relaunchBackend = useCallback(
    (id: string) => {
      const target = sessionsRef.current.find((s) => s.id === id);
      launchBackendFor(id, target?.browserState.currentUrl);
    },
    [launchBackendFor],
  );

  const createSession = useCallback((title: string, goal: string, startUrl?: string): Session => {
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Honest initial state only: zero progress, no boilerplate tasks, no
    // fabricated timeline entries. The start URL is explicit — never guessed.
    const newSession: Session = {
      id: `sess_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      title,
      goal,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      progress: 0,
      backendSessionId: null,
      browserState: {
        currentUrl: startUrl,
        pageTitle: startUrl ? `Target: ${startUrl}` : undefined,
        tabCount: 1,
      },
      downloads: [],
      timeline: [
        {
          id: `t_${Date.now()}_1`,
          timestamp: nowTime,
          action: `Created new Session: "${title}"`,
          category: 'navigation',
        },
      ],
      notes: [],
      bookmarks: [],
      tasks: [],
      runs: [],
    };

    setSessions((prev) => [newSession, ...prev]);

    const bs = browserManager.getOrCreateBrowser(newSession.id, startUrl);
    setActiveSessionId(newSession.id);
    setActiveBrowserSession(bs);

    launchBackendFor(newSession.id, startUrl);

    return newSession;
  }, [browserManager, launchBackendFor]);

  const closeSession = useCallback(() => {
    setActiveSessionId((prevId) => {
      if (prevId) {
        const bs = browserManager.getBrowser(prevId);
        if (bs) localStorage.setItem(`${BROWSER_SNAPSHOT_PREFIX}${prevId}`, bs.serialize());
      }
      return null;
    });
    setActiveBrowserSession(null);
  }, [browserManager]);

  const renameSession = useCallback((id: string, title: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title, updatedAt: new Date().toISOString() } : s)),
    );
  }, []);

  const archiveSession = useCallback((id: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, status: 'archived', updatedAt: new Date().toISOString() } : s,
      ),
    );
  }, []);

  const deleteSession = useCallback((id: string) => {
    const target = sessionsRef.current.find((s) => s.id === id);
    if (target?.backendSessionId) {
      void deleteBackendSession(target.backendSessionId).catch(() => {
        // Backend already gone or unreachable — local cleanup still proceeds.
      });
    }
    browserManager.destroyBrowser(id);
    localStorage.removeItem(`${BROWSER_SNAPSHOT_PREFIX}${id}`);
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== id);
      return remaining;
    });
    setActiveSessionId((prevId) => {
      if (prevId !== id) return prevId;
      return null;
    });
    setActiveBrowserSession((prev) => (prev?.sessionId === id ? null : prev));
  }, [browserManager]);

  const addNoteToSession = useCallback((id: string, content: string) => {
    const newNote = {
      id: crypto.randomUUID(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content,
    };
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id
          ? { ...s, notes: [newNote, ...s.notes], updatedAt: new Date().toISOString() }
          : s,
      ),
    );
  }, []);

  const toggleTask = useCallback((sessionId: string, taskId: string) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s;
        const updatedTasks = s.tasks.map((tk) =>
          tk.id === taskId ? { ...tk, completed: !tk.completed } : tk,
        );
        const allCompleted = updatedTasks.every((t) => t.completed);
        const completedCount = updatedTasks.filter((t) => t.completed).length;
        const progress = updatedTasks.length > 0 ? Math.round((completedCount / updatedTasks.length) * 100) : 100;

        return {
          ...s,
          tasks: updatedTasks,
          progress,
          status: allCompleted ? 'completed' : 'active',
          updatedAt: new Date().toISOString(),
        };
      }),
    );
  }, []);

  const resumeSessionWithAuth = useCallback(
    (sessionId: string, _credentials?: { email?: string; password?: string }) => {
      // Honest resume: clear the auth-paused state so the user can drive the real
      // agent again. We do NOT fabricate Gmail automation or claim an email was
      // sent — credential entry into a real page is the user's action, and any
      // subsequent automation must come from the real agent loop (Run Agent).
      const resumeTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            status: 'active',
            authRequired: false,
            updatedAt: new Date().toISOString(),
            timeline: [
              ...s.timeline,
              {
                id: `t_${Date.now()}_resume`,
                timestamp: resumeTime,
                action: '[Human-in-the-Loop] Session resumed. Use "Run Agent" to continue.',
                category: 'navigation' as const,
              },
            ],
          };
        }),
      );
    },
    [],
  );

  const upsertRun = useCallback((sessionId: string, run: RunRecord) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s;
        const exists = s.runs.some((r) => r.runId === run.runId);
        const runs = exists
          ? s.runs.map((r) => (r.runId === run.runId ? run : r))
          : [run, ...s.runs];
        return { ...s, runs, updatedAt: new Date().toISOString() };
      }),
    );
  }, []);

  const appendTimeline = useCallback(
    (sessionId: string, event: Omit<TimelineEvent, 'id'>) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const entry: TimelineEvent = {
            ...event,
            id: `t_${Date.now()}_${s.timeline.length}`,
          };
          return { ...s, timeline: [...s.timeline, entry], updatedAt: new Date().toISOString() };
        }),
      );
    },
    [],
  );

  const recentSessions = useMemo(
    () => [...sessions].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [sessions],
  );

  const contextValue = useMemo<SessionContextValue>(
    () => ({
      sessions,
      activeSessionId,
      activeSession,
      activeBrowserSession,
      createSession,
      openSession,
      closeSession,
      renameSession,
      archiveSession,
      deleteSession,
      addNoteToSession,
      toggleTask,
      resumeSessionWithAuth,
      relaunchBackend,
      upsertRun,
      appendTimeline,
      recentSessions,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, activeSessionId, activeBrowserSession],
  );

  return (
    <SessionContext.Provider value={contextValue}>
      {children}
    </SessionContext.Provider>
  );
};

export const useSessionStore = (): SessionContextValue => {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSessionStore must be used within a SessionProvider');
  }
  return context;
};

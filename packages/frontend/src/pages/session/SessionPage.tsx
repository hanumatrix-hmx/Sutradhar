/**
 * @file packages/frontend/src/pages/session/SessionPage.tsx
 * @description Session Workspace — browser-first layout with hero viewport + Expandable Fullscreen AI Dock.
 * Architecture: WorkspaceRail | BrowserStage (tabs, omnibar, viewport) | AIDock (Expandable/Fullscreen)
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSessionStore } from '../../stores/sessionStore.js';
import { useRouter } from '../../app/router.js';
import { EmbeddedBrowser } from '../../components/browser/EmbeddedBrowser.js';
import { AITimeline } from './AITimeline.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Progress } from '../../components/ui/Progress.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { useToast } from '../../components/ui/Toast.js';
import { deriveSessionPhase, getPhaseLabel, getPhaseVariant, formatElapsed } from '../../utils/sessionUtils.js';
import { loadLLMConfig } from '../../stores/llmSettingsStore.js';
import { loadAppSettings } from '../../stores/appSettingsStore.js';
import { RunRecord, RunStep, TimelineEvent } from '../../models/session.js';
import { AuthPromptModal } from '../../components/auth/AuthPromptModal.js';
import {
  startRun,
  cancelRun,
  runEventsUrl,
  listRuns,
  AgentGoalResultDto,
  RunRecordDto,
} from '../../runtime/api/client.js';
import {
  IconAlert,
  IconCheck,
  IconCheckCircle,
  IconClock,
  IconCopy,
  IconDownload,
  IconPlay,
  IconRefresh,
  IconSparkle,
  IconStop,
  IconX,
  IconXCircle,
} from '../../components/ui/icons.js';
import { cn } from '../../utils/cn.js';

export interface SessionPageProps {
  sessionId: string;
}

type DockTab = 'result' | 'timeline' | 'notes' | 'tasks' | 'downloads';
type DockMode = 'collapsed' | 'default' | 'expanded';

/** Maps a real agent action onto the timeline's category taxonomy. */
function timelineCategoryFor(actionName: string): TimelineEvent['category'] {
  switch (actionName) {
    case 'type':
      return 'search';
    case 'extract':
      return 'extraction';
    case 'done':
      return 'summary';
    default:
      return 'navigation';
  }
}

/** One honest, human-readable line for a real agent step. */
function describeStepAction(step: RunStep): string {
  const detail = step.observation.replace(/\s+/g, ' ').slice(0, 90);
  return `${step.actionName} — ${detail || 'no observation'}`;
}

/** Terminal SSE frame is either a full agent result or a raw failure payload. */
function isGoalResult(value: unknown): value is AgentGoalResultDto {
  return typeof value === 'object' && value !== null && 'objective' in value;
}

/** One row of the Past runs strip — server records win over the cache. */
interface PastRunRow {
  key: string;
  /** Server run id — present means deep-linkable to /history/:runId. */
  runId?: string;
  status: RunRecord['status'];
  startedAt: string;
  stepsCount: number;
  answer?: string | null;
  error?: string | null;
}

/* ── SVG Icons ── */
const IconChevronDown = ({ rotated }: { rotated?: boolean }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 12 12"
    fill="none"
    aria-hidden="true"
    style={{ transform: rotated ? 'rotate(180deg)' : undefined, transition: 'transform 200ms' }}
  >
    <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconExpand = ({ isExpanded }: { isExpanded?: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    {isExpanded ? (
      <path
        d="M6 10H3v3M10 6h3V3M6 10L2 14M10 6l4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ) : (
      <path
        d="M3 6V3h3M13 10v3h-3M3 3l4 4M13 13l-4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    )}
  </svg>
);

export const SessionPage: React.FC<SessionPageProps> = ({ sessionId }) => {
  const { addToast } = useToast();
  const {
    sessions,
    activeBrowserSession,
    openSession,
    addNoteToSession,
    toggleTask,
    archiveSession,
    resumeSessionWithAuth,
    relaunchBackend,
    upsertRun,
    appendTimeline,
  } = useSessionStore();

  const [dockTab, setDockTab] = useState<DockTab>('result');
  const [dockMode, setDockMode] = useState<DockMode>('default');
  const [newNoteText, setNewNoteText] = useState('');
  const [timelineFilter, setTimelineFilter] = useState<string>('all');
  const noteInputRef = useRef<HTMLInputElement>(null);

  // Real agent execution state (driven by the live backend, no mocks).
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentAnswer, setAgentAnswer] = useState<string | null>(null);
  // Floating answer card keeps living on the stage until the user dismisses
  // it — the servant brings the result to you, it never hides itself.
  const [answerCardOpen, setAnswerCardOpen] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  // Error card at the point of cause — floats over the stage until handled.
  const [errorCardOpen, setErrorCardOpen] = useState(false);
  // Honest wall-clock timer, measured client-side while the run is in flight.
  const [elapsedMs, setElapsedMs] = useState(0);
  const [agentSteps, setAgentSteps] = useState<
    ReadonlyArray<{
      stepNumber: number;
      reasoning: string;
      actionName: string;
      observation: string;
      success: boolean;
      errorMessage?: string;
      timestamp: string;
    }>
  >([]);

  // Live run tracker: server-assigned runId + its SSE stream. Stop now hits
  // the backend cancel endpoint (end-to-end), not just the local connection.
  const runTrackerRef = useRef<{ es: EventSource | null; serverRunId: string | null }>({
    es: null,
    serverRunId: null,
  });

  const runRealAgent = async () => {
    if (!session || agentRunning) return;
    const runId = `run_${Date.now()}`;
    const startedAt = new Date().toISOString();
    const stepsRef: { current: RunStep[] } = { current: [] };

    setAgentRunning(true);
    setAgentError(null);
    setErrorCardOpen(false);
    setAgentAnswer(null);
    setAgentSteps([]);

    // Write-through: the run exists in the session model from the moment it
    // starts, so results survive navigation and reloads.
    upsertRun(session.id, { runId, goal: session.goal, status: 'running', startedAt, steps: [] });
    const finish = (patch: Partial<RunRecord>) => {
      upsertRun(session.id, {
        runId,
        goal: session.goal,
        status: 'running',
        startedAt,
        steps: stepsRef.current,
        ...patch,
      });
    };

    try {
      // The server assigns the runId — the client never invents identifiers.
      const { runId: serverRunId } = await startRun(session.goal, session.id);
      runTrackerRef.current.serverRunId = serverRunId;
      // Run linkage early: the persisted record carries the server id from
      // the first moment it is known, not only after the run ends.
      finish({ serverRunId });

      // Live progress over SSE: real steps stream in as the loop executes.
      // Reconnects lose nothing — the server replays its frame buffer.
      const es = new EventSource(runEventsUrl(serverRunId));
      runTrackerRef.current.es = es;

      es.addEventListener('step', (e) => {
        const step = JSON.parse((e as MessageEvent).data) as RunStep;
        stepsRef.current = [...stepsRef.current, step];
        setAgentSteps(stepsRef.current);
        finish({ steps: stepsRef.current });
        // Servant model: the timeline fills itself as real actions happen.
        appendTimeline(session.id, {
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          category: timelineCategoryFor(step.actionName),
          action: `Agent: ${describeStepAction(step)}`,
        });
      });

      es.addEventListener('result', (e) => {
        es.close();
        const dto = JSON.parse((e as MessageEvent).data) as
          | AgentGoalResultDto
          | { status: string; error?: string; summary?: string };
        const endedAt = new Date().toISOString();

        // User-cancelled run (from any backend path): a legitimate terminal
        // state, not an error — no error card, no failure record.
        if (dto.status === 'cancelled') {
          finish({
            status: 'cancelled',
            endedAt,
            durationMs: Date.now() - Date.parse(startedAt),
            steps: stepsRef.current,
          });
          setAgentRunning(false);
          return;
        }

        // Transport-level failure shape (no agent result at all).
        if (!isGoalResult(dto)) {
          const msg = dto.error || 'Agent execution failed.';
          setAgentError(msg);
          setErrorCardOpen(true);
          finish({
            status: 'failed',
            endedAt: new Date().toISOString(),
            durationMs: Date.now() - Date.parse(startedAt),
            error: msg,
          });
          setAgentRunning(false);
          return;
        }

        const result = dto;
        const finalSteps = result.steps ?? stepsRef.current;
        setAgentSteps(finalSteps);
        setAgentAnswer(result.answer ?? null);
        if (result.answer) setAnswerCardOpen(true);
        const failed = result.status === 'failed' && !result.answer;
        if (failed) {
          setAgentError(result.summary ?? 'Agent could not complete the goal.');
          setErrorCardOpen(true);
        }
        finish({
          status: failed ? 'failed' : 'completed',
          endedAt: new Date().toISOString(),
          durationMs: result.durationMs ?? Date.now() - Date.parse(startedAt),
          steps: finalSteps,
          answer: result.answer ?? null,
          error: failed ? result.summary ?? 'Agent could not complete the goal.' : null,
          serverRunId: result.id,
        });
        setAgentRunning(false);
      });

      es.onerror = () => {
        // EventSource auto-reconnects and the server replays frames, so a
        // transient drop loses nothing. Only a dead stream is a real error.
        if (es.readyState === EventSource.CLOSED) {
          es.close();
          const msg = 'Lost connection to the agent run stream.';
          setAgentError(msg);
          setErrorCardOpen(true);
          finish({
            status: 'failed',
            endedAt: new Date().toISOString(),
            durationMs: Date.now() - Date.parse(startedAt),
            error: msg,
          });
          setAgentRunning(false);
        }
      };
    } catch (err) {
      const msg = `Could not start the agent run: ${(err as Error).message}`;
      setAgentError(msg);
      setErrorCardOpen(true);
      finish({
        status: 'failed',
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - Date.parse(startedAt),
        error: msg,
      });
      setAgentRunning(false);
    }
  };

  // End-to-end Stop: the backend aborts the real loop (honored at the next
  // step boundary). The terminal 'cancelled' frame finalizes the record.
  const stopAgent = () => {
    const serverRunId = runTrackerRef.current.serverRunId;
    if (serverRunId) {
      void cancelRun(serverRunId).catch(() => {
        addToast({
          title: 'Stop not delivered',
          message: 'The backend could not be reached to cancel the run.',
          type: 'danger',
        });
      });
    }
  };

  // Leaving the page closes our view of the stream; the backend run itself
  // keeps its honest lifecycle and stays queryable via /api/v1/runs/:id.
  useEffect(
    () => () => {
      runTrackerRef.current.es?.close();
      runTrackerRef.current.es = null;
      runTrackerRef.current.serverRunId = null;
    },
    [],
  );

  const session = sessions.find((s) => s.id === sessionId) ?? sessions[0];

  // Auto-sync active browser session with current page sessionId
  useEffect(() => {
    if (sessionId) {
      openSession(sessionId);
    }
  }, [sessionId, openSession]);

  // Servant Model: visible, controllable auto-start. The run begins when the
  // backend session is confirmed (real signal: backendSessionId — no magic
  // string matching), unless the user disabled auto-start in Settings.
  const autoTriggeredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!session || agentRunning) return;
    if (!session.backendSessionId) return;
    if (!loadAppSettings().autoStartRuns) return;
    if (autoTriggeredRef.current.has(session.id)) return;

    autoTriggeredRef.current.add(session.id);
    void runRealAgent();
    // runRealAgent is stable for a given session — we intentionally only
    // depend on session id, backend readiness and running flag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.backendSessionId, agentRunning]);

  // Shortcut: Cmd+Shift+D toggles dock state
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setDockMode((prev) => (prev === 'collapsed' ? 'default' : 'collapsed'));
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Run timer — ticks only while a real execution is in flight.
  useEffect(() => {
    if (!agentRunning) return;
    const t0 = Date.now();
    setElapsedMs(0);
    const iv = setInterval(() => setElapsedMs(Date.now() - t0), 1000);
    return () => clearInterval(iv);
  }, [agentRunning]);

  const { navigate } = useRouter();

  // Past runs strip (Phase 5): fed by the SERVER history for this session —
  // localStorage runs are cache only. Refetched whenever the local run list
  // changes so freshly finished runs show their terminal server state.
  const [serverRuns, setServerRuns] = useState<readonly RunRecordDto[] | null>(null);
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void listRuns({ sessionId: session.id })
      .then((runs) => {
        if (!cancelled) setServerRuns(runs);
      })
      .catch(() => {
        // Offline: the strip falls back to the local cache. No fabrication.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.runs.length, session?.runs[0]?.status]);

  const pastRuns = useMemo<PastRunRow[]>(() => {
    const rows: PastRunRow[] = [];
    const seen = new Set<string>();
    for (const rec of serverRuns ?? []) {
      seen.add(rec.runId);
      rows.push({
        key: rec.runId,
        runId: rec.runId,
        status: rec.status,
        startedAt: rec.startedAt,
        stepsCount: rec.steps.length,
        answer: rec.answer ?? null,
        error: rec.error ?? null,
      });
    }
    for (const local of session?.runs ?? []) {
      const sid = local.serverRunId;
      if (sid && seen.has(sid)) continue;
      rows.push({
        key: local.runId,
        ...(sid ? { runId: sid } : {}),
        status: local.status,
        startedAt: local.startedAt,
        stepsCount: local.steps.length,
        answer: local.answer ?? null,
        error: local.error ?? null,
      });
    }
    return rows.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }, [serverRuns, session?.runs]);

  if (!session) {
    return (
      <div className="pt-empty" style={{ height: '100%' }}>
        <Spinner size="md" />
        <p className="pt-empty__title">Session not found</p>
        <p className="pt-empty__message">The session with ID "{sessionId}" could not be found.</p>
      </div>
    );
  }

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (newNoteText.trim()) {
      addNoteToSession(session.id, newNoteText.trim());
      setNewNoteText('');
      noteInputRef.current?.focus();
    }
  };

  const handleCopySummary = () => {
    const summaryText = `# ${session.title} — Research Report
Goal: ${session.goal}

## Extracted Notes
${session.notes.map((n) => `[${n.timestamp}] ${n.content}`).join('\n\n')}

## Timeline History
${session.timeline.map((t) => `[${t.timestamp}] (${t.category}) ${t.action}`).join('\n')}
`;
    void navigator.clipboard.writeText(summaryText);
    addToast({
      title: 'Copied Research Summary',
      message: 'Full research notes and timeline copied to clipboard!',
      type: 'success',
    });
  };

  const handleExportMarkdown = () => {
    const markdownContent = `# ${session.title} — Research Report
Date: ${session.createdAt}
Goal: ${session.goal}
Status: ${session.status}

## Extracted Research Notes
${session.notes.map((n) => `### ${n.timestamp}\n${n.content}`).join('\n\n')}

## Execution Timeline
${session.timeline.map((t) => `- **[${t.timestamp}]** *[${t.category.toUpperCase()}]* ${t.action}`).join('\n')}
`;
    const blob = new Blob([markdownContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sutradhar_research_${session.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
    addToast({
      title: 'Exported Research Report',
      message: `Downloaded sutradhar_research_${session.id}.md`,
      type: 'success',
    });
  };

  const filteredTimeline = session.timeline.filter((evt) => {
    if (timelineFilter === 'all') return true;
    return evt.category === timelineFilter;
  });

  // Real lifecycle — derived from facts (backend readiness, run state),
  // never invented: preparing → ready → running → terminal → archived.
  const phase = deriveSessionPhase({
    status: session.status,
    backendReady: Boolean(session.backendSessionId),
    agentRunning,
    agentError: Boolean(agentError),
    lastRunStatus: session.runs[0]?.status,
  });

  const latestRun = session.runs[0];

  const handleCopyAnswer = () => {
    const text = latestRun?.answer ?? agentAnswer;
    if (!text) return;
    void navigator.clipboard.writeText(text);
    addToast({ title: 'Answer copied', message: 'The answer is on your clipboard.', type: 'success' });
  };

  const dockTabs = [
    { id: 'result', label: 'Result', count: session.runs.length },
    { id: 'timeline', label: 'Timeline', count: session.timeline.length },
    { id: 'notes', label: 'Notes', count: session.notes.length },
    { id: 'tasks', label: 'Tasks', count: session.tasks.length },
    { id: 'downloads', label: 'Downloads', count: session.downloads.length },
  ] as const;

  const dockHeightMap: Record<DockMode, string> = {
    collapsed: '36px',
    default: '280px',
    expanded: '75vh',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* ── Context Topbar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 var(--pt-space-4)',
          height: 'var(--pt-topbar-height)',
          background: 'var(--pt-surface-1)',
          flexShrink: 0,
          gap: 'var(--pt-space-4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--pt-space-3)', minWidth: 0 }}>
          <h2
            style={{
              fontSize: 'var(--pt-text-md)',
              fontWeight: 600,
              color: 'var(--pt-text-heading)',
              margin: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '280px',
            }}
          >
            {session.title}
          </h2>
          <Badge variant={getPhaseVariant(phase)}>{getPhaseLabel(phase)}</Badge>
          {(() => {
            const cfg = loadLLMConfig();
            if (cfg?.providerMode === 'openrouter') {
              const rawModel = cfg.openrouterModel || 'google/gemini-2.0-flash-exp:free';
              const modelName = rawModel.includes('/') ? rawModel.split('/')[1] : rawModel;
              return <Badge variant="info">OpenRouter ({modelName})</Badge>;
            }
            if (cfg?.providerMode === 'ollama') {
              return <Badge variant="info">Ollama ({cfg.ollamaModel || 'qwen2.5'})</Badge>;
            }
            return <Badge variant="neutral">Local Heuristic</Badge>;
          })()}
        </div>

        <div
          style={{
            flex: 1,
            maxWidth: '500px',
            fontSize: 'var(--pt-text-xs)',
            color: 'var(--pt-text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {session.goal}
        </div>

        {session.tasks.length > 0 && (
          <div style={{ width: '120px', flexShrink: 0 }}>
            <Progress value={session.progress} size="sm" />
          </div>
        )}
      </div>

      {/* ── Main Stage (Embedded Browser) ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {session.status === 'error' || session.status === 'detached' ? (
          <div className="pt-empty" style={{ height: '100%' }}>
            <p className="pt-empty__title">
              {session.status === 'error'
                ? 'Backend session failed to launch'
                : 'Backend session no longer exists'}
            </p>
            <p className="pt-empty__message">
              {session.status === 'error'
                ? 'The backend could not start a browser for this session. Check the server is running, then retry.'
                : 'The server restarted or the session was closed on the backend. Relaunch to continue.'}
            </p>
            <Button variant="primary" onClick={() => relaunchBackend(session.id)}>
              {session.status === 'error' ? 'Retry launch' : 'Relaunch session'}
            </Button>
          </div>
        ) : activeBrowserSession ? (
          <EmbeddedBrowser browserSession={activeBrowserSession} agentActive={agentRunning} />
        ) : (
          <div className="pt-empty" style={{ height: '100%' }}>
            <Spinner size="lg" />
            <p style={{ marginTop: 'var(--pt-space-3)', color: 'var(--pt-text-secondary)', fontSize: 'var(--pt-text-sm)' }}>
              Initializing Browser Engine for Session…
            </p>
          </div>
        )}

        {/* Agent status orb — the always-visible heartbeat of the run */}
        <button
          type="button"
          className={cn(
            'pt-orb',
            phase === 'running' && 'pt-orb--acting',
            phase === 'preparing' && 'pt-orb--thinking',
            (phase === 'failed' || phase === 'error') && 'pt-orb--error',
            phase === 'completed' && 'pt-orb--done',
            session.authRequired && phase !== 'running' && 'pt-orb--waiting',
          )}
          onClick={() => setDockMode((prev) => (prev === 'collapsed' ? 'default' : prev === 'default' ? 'expanded' : 'default'))}
          aria-label={
            agentRunning ? 'Agent is working — open the dock'
            : agentError ? 'Agent hit an error — open the dock'
            : agentAnswer ? 'Agent finished — open the dock'
            : 'Agent status — open the dock'
          }
          title="Agent status — click to open the dock"
        >
          <span className="pt-orb__dot">
            {agentRunning ? <IconSparkle size={16} />
              : agentError ? <IconAlert size={16} />
              : agentAnswer ? <IconCheck size={16} />
              : <IconSparkle size={16} />}
          </span>
          {agentSteps.length > 0 && !agentRunning && (
            <span className="pt-orb__badge">{agentSteps.length}</span>
          )}
        </button>

        {/* Answer delivery card — the servant brings the result to you */}
        {answerCardOpen && agentAnswer && (
          <div className="pt-answer-card" role="status">
            <div className="pt-answer-card__label">
              <IconCheckCircle size={14} /> Answer ready
            </div>
            <div className="pt-answer-card__text">{agentAnswer}</div>
            <div className="pt-answer-card__actions">
              <Button
                variant="primary"
                size="xs"
                onClick={() => {
                  void navigator.clipboard.writeText(agentAnswer);
                  addToast({ title: 'Answer copied', message: 'The answer is on your clipboard.', type: 'success' });
                }}
              >
                <IconCopy size={12} /> Copy
              </Button>
              <Button variant="secondary" size="xs" onClick={handleExportMarkdown}>
                <IconDownload size={12} /> Export
              </Button>
              <Button variant="secondary" size="xs" onClick={() => void runRealAgent()}>
                <IconRefresh size={12} /> Re-run
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setAnswerCardOpen(false)} aria-label="Dismiss answer">
                <IconX size={12} />
              </Button>
            </div>
          </div>
        )}

        {/* Error card at the point of cause — never buried, always actionable */}
        {errorCardOpen && agentError && !agentRunning && (
          <div className="pt-answer-card pt-answer-card--error" role="alert">
            <div className="pt-answer-card__label">
              <IconAlert size={14} /> Run failed
            </div>
            <div className="pt-answer-card__text">{agentError}</div>
            <div className="pt-answer-card__actions">
              <Button variant="primary" size="xs" onClick={() => void runRealAgent()}>
                <IconRefresh size={12} /> Retry
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setErrorCardOpen(false)} aria-label="Dismiss error">
                <IconX size={12} />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Expandable / Fullscreen AI Dock ── */}
      <div
        className="pt-dock"
        style={{
          height: dockHeightMap[dockMode],
          transition: 'height var(--pt-duration-panel) var(--pt-ease-soft)',
          zIndex: dockMode === 'expanded' ? 300 : 50,
        }}
      >
        {/* Dock Header & Controls Bar */}
        <div className="pt-dock__tabbar" style={{ display: 'flex', alignItems: 'center' }}>
          {dockTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={cn('pt-dock__tab', dockTab === tab.id && 'pt-dock__tab--active')}
              onClick={() => {
                setDockTab(tab.id as DockTab);
                if (dockMode === 'collapsed') setDockMode('default');
              }}
            >
              {tab.label}
              {tab.count > 0 && (
                <span
                  style={{
                    fontSize: '10px',
                    padding: '1px 6px',
                    boxShadow: 'var(--pt-shadow-inset-sm)',
                    borderRadius: '999px',
                    color: 'var(--pt-text-tertiary)',
                  }}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}

          {/* Controls Group (Pinned Right for Mobile & Desktop) */}
          <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, gap: '4px', marginLeft: 'auto' }}>
            {dockMode !== 'collapsed' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--pt-space-1)' }}>
                {dockTab === 'timeline' && (
                  <select
                    value={timelineFilter}
                    onChange={(e) => setTimelineFilter(e.target.value)}
                    style={{
                      fontSize: '11px',
                      padding: '2px 6px',
                      boxShadow: 'var(--pt-shadow-inset-sm)',
                      color: 'var(--pt-text-secondary)',
                      border: 'none',
                      borderRadius: 'var(--pt-radius-md)',
                    }}
                  >
                    <option value="all">All</option>
                    <option value="search">Search</option>
                    <option value="navigation">Nav</option>
                    <option value="extraction">Extract</option>
                  </select>
                )}

                <Button type="button" variant="ghost" size="xs" onClick={handleCopySummary} title="Copy research summary" aria-label="Copy research summary">
                  <IconCopy size={14} />
                </Button>
                <Button type="button" variant="ghost" size="xs" onClick={handleExportMarkdown} title="Export Markdown" aria-label="Export Markdown">
                  <IconDownload size={14} />
                </Button>
              </div>
            )}

            {/* Fullscreen / Expand Arrow Toggle */}
            <button
              type="button"
              className="pt-dock__collapse-btn"
              onClick={() => setDockMode((prev) => (prev === 'expanded' ? 'default' : 'expanded'))}
              aria-label={dockMode === 'expanded' ? 'Restore dock height' : 'Expand dock to fullscreen'}
              title={dockMode === 'expanded' ? 'Restore height' : 'Fullscreen Dock'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                boxShadow: 'var(--pt-shadow-raised-sm)',
                borderRadius: '999px',
                color: 'var(--pt-brand-primary)',
                fontSize: '11px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              <IconExpand isExpanded={dockMode === 'expanded'} />
              <span>{dockMode === 'expanded' ? 'Restore' : 'Expand'}</span>
            </button>

            {/* Collapse Toggle */}
            <button
              type="button"
              className="pt-dock__collapse-btn"
              onClick={() => setDockMode((prev) => (prev === 'collapsed' ? 'default' : 'collapsed'))}
              aria-label={dockMode === 'collapsed' ? 'Open AI dock' : 'Collapse AI dock'}
              title="Collapse / Open Dock"
            >
              <IconChevronDown rotated={dockMode !== 'collapsed'} />
            </button>
          </div>
        </div>

        {/* Dock Body Content */}
        {dockMode !== 'collapsed' && (
          <div className="pt-dock__content" style={{ height: 'calc(100% - 36px)', overflowY: 'auto' }}>
            {/* Result — first-class answer surface: the run's outcome lives here */}
            {dockTab === 'result' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pt-space-3)', padding: 'var(--pt-space-3)' }}>
                {agentRunning ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pt-space-3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--pt-space-3)' }}>
                      <Spinner size="sm" />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontWeight: 600, fontSize: 'var(--pt-text-sm)', color: 'var(--pt-text-heading)' }}>
                          Agent working… {formatElapsed(elapsedMs)}
                        </span>
                        <span style={{ fontSize: 'var(--pt-text-xs)', color: 'var(--pt-text-tertiary)' }}>
                          {agentSteps.length} step{agentSteps.length !== 1 ? 's' : ''} so far
                        </span>
                      </div>
                      <Button variant="secondary" size="sm" onClick={stopAgent} style={{ marginLeft: 'auto' }}>
                        <IconStop size={12} /> Stop
                      </Button>
                    </div>

                    {/* Live steps during execution */}
                    {agentSteps.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pt-space-2)' }}>
                        {agentSteps.map((s) => (
                          <div
                            key={s.stepNumber}
                            style={{
                              display: 'flex',
                              gap: 'var(--pt-space-2)',
                              padding: 'var(--pt-space-2)',
                              background: 'var(--pt-surface-2)',
                              borderRadius: 'var(--pt-radius-md)',
                              fontSize: 'var(--pt-text-sm)',
                              lineHeight: 1.4,
                            }}
                          >
                            <span
                              style={{
                                color: s.success ? 'var(--pt-semantic-success)' : 'var(--pt-semantic-danger)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                flexShrink: 0,
                              }}
                            >
                              {s.success ? '✓' : '✗'}
                            </span>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                              <span style={{ fontWeight: 500, color: 'var(--pt-text-secondary)' }}>
                                Step {s.stepNumber}: {s.actionName}
                              </span>
                              {s.reasoning && (
                                <span style={{ fontSize: 'var(--pt-text-xs)', color: 'var(--pt-text-tertiary)', fontStyle: 'italic' }}>
                                  {s.reasoning}
                                </span>
                              )}
                              {s.observation && (
                                <span style={{ fontSize: 'var(--pt-text-xs)', color: 'var(--pt-text-primary)' }}>
                                  {s.observation}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : latestRun ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pt-space-3)' }}>
                    {/* Header: status + metadata */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pt-space-2)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--pt-space-2)', flexWrap: 'wrap' }}>
                        <Badge
                          variant={
                            latestRun.status === 'completed' ? 'success'
                            : latestRun.status === 'running' ? 'warning'
                            : latestRun.status === 'cancelled' ? 'neutral'
                            : 'danger'
                          }
                        >
                          {latestRun.status}
                        </Badge>
                        <span style={{ fontSize: 'var(--pt-text-xs)', color: 'var(--pt-text-tertiary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <IconClock size={12} />
                          {latestRun.durationMs != null ? formatElapsed(latestRun.durationMs) : '—'}
                          {' · '}{latestRun.steps.length} step{latestRun.steps.length !== 1 ? 's' : ''}
                          {' · '}{new Date(latestRun.startedAt).toLocaleString()}
                        </span>
                        {latestRun.serverRunId && (
                          <span style={{ fontSize: 'var(--pt-text-xs)', color: 'var(--pt-text-tertiary)' }}>
                            {latestRun.serverRunId}
                          </span>
                        )}
                      </div>
                      {/* Goal */}
                      <div style={{ fontSize: 'var(--pt-text-sm)', color: 'var(--pt-text-secondary)', lineHeight: 1.5 }}>
                        <strong style={{ color: 'var(--pt-text-heading)' }}>Goal: </strong>
                        {latestRun.goal}
                      </div>
                    </div>

                    {/* Answer panel — prominent if available */}
                    {latestRun.answer && (
                      <div style={{ boxShadow: 'var(--pt-shadow-inset-sm)', borderRadius: 'var(--pt-radius-md)', padding: 'var(--pt-space-3)', background: 'var(--pt-surface-2)' }}>
                        <div style={{ fontSize: 'var(--pt-text-xs)', fontWeight: 600, color: 'var(--pt-text-tertiary)', marginBottom: 'var(--pt-space-2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Answer
                        </div>
                        <div style={{ fontSize: 'var(--pt-text-sm)', lineHeight: 1.6, color: 'var(--pt-text-primary)', whiteSpace: 'pre-wrap' }}>
                          {latestRun.answer}
                        </div>
                      </div>
                    )}

                    {/* Error panel — if failed */}
                    {latestRun.error && (
                      <div style={{ borderRadius: 'var(--pt-radius-md)', padding: 'var(--pt-space-3)', background: 'var(--pt-semantic-danger)', color: 'white' }}>
                        <div style={{ fontSize: 'var(--pt-text-xs)', fontWeight: 600, marginBottom: 'var(--pt-space-1)', textTransform: 'uppercase', letterSpacing: '0.5px', opacity: 0.9 }}>
                          Error
                        </div>
                        <div style={{ fontSize: 'var(--pt-text-sm)', lineHeight: 1.5 }}>
                          {latestRun.error}
                        </div>
                      </div>
                    )}

                    {/* Step trace — full details */}
                    {latestRun.steps.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pt-space-2)' }}>
                        <div style={{ fontSize: 'var(--pt-text-xs)', fontWeight: 600, color: 'var(--pt-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Step Trace ({latestRun.steps.length})
                        </div>
                        {latestRun.steps.map((s) => (
                          <div
                            key={s.stepNumber}
                            style={{
                              display: 'flex',
                              gap: 'var(--pt-space-2)',
                              padding: 'var(--pt-space-2)',
                              background: 'var(--pt-surface-2)',
                              borderRadius: 'var(--pt-radius-md)',
                              borderLeft: `3px solid ${s.success ? 'var(--pt-semantic-success)' : 'var(--pt-semantic-danger)'}`,
                            }}
                          >
                            <span
                              style={{
                                color: s.success ? 'var(--pt-semantic-success)' : 'var(--pt-semantic-danger)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                flexShrink: 0,
                                fontSize: 'var(--pt-text-sm)',
                              }}
                            >
                              {s.success ? '✓' : '✗'}
                            </span>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--pt-space-2)' }}>
                                <span style={{ fontWeight: 600, fontSize: 'var(--pt-text-sm)', color: 'var(--pt-text-heading)' }}>
                                  Step {s.stepNumber}
                                </span>
                                <span style={{ fontSize: 'var(--pt-text-xs)', color: 'var(--pt-text-tertiary)', fontFamily: 'monospace' }}>
                                  {s.actionName}
                                </span>
                              </div>
                              {s.reasoning && (
                                <div style={{ fontSize: 'var(--pt-text-xs)', color: 'var(--pt-text-tertiary)', fontStyle: 'italic', lineHeight: 1.4 }}>
                                  {s.reasoning}
                                </div>
                              )}
                              {s.observation && (
                                <div style={{ fontSize: 'var(--pt-text-xs)', color: 'var(--pt-text-primary)', lineHeight: 1.4 }}>
                                  {s.observation}
                                </div>
                              )}
                              <div style={{ fontSize: '10px', color: 'var(--pt-text-tertiary)', marginTop: '2px' }}>
                                {new Date(s.timestamp).toLocaleTimeString()}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: 'var(--pt-space-2)', flexWrap: 'wrap', paddingTop: 'var(--pt-space-2)', borderTop: '1px solid var(--pt-border-subtle)' }}>
                      {latestRun.answer && (
                        <Button variant="primary" size="sm" onClick={handleCopyAnswer}>
                          <IconCopy size={12} /> Copy answer
                        </Button>
                      )}
                      <Button variant="secondary" size="sm" onClick={handleExportMarkdown}>
                        <IconDownload size={12} /> Export report
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => void runRealAgent()} disabled={!session.backendSessionId}>
                        <IconRefresh size={12} /> Re-run
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="pt-empty" style={{ padding: 'var(--pt-space-4)' }}>
                    <p className="pt-empty__title">No run yet</p>
                    <p className="pt-empty__message">
                      {session.backendSessionId
                        ? 'Start the agent to work this goal — the answer lands here.'
                        : 'Waiting for the backend session before the agent can start.'}
                    </p>
                    <Button variant="primary" size="sm" disabled={!session.backendSessionId || agentRunning} onClick={() => void runRealAgent()}>
                      <IconPlay size={12} /> Run agent
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Real Agent Runner — drives the live backend agent loop, no mocks */}
            {dockTab === 'timeline' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pt-space-2)', padding: 'var(--pt-space-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--pt-space-2)' }}>
                  {agentRunning ? (
                    <>
                      <Button variant="primary" size="sm" disabled>
                        Running…
                      </Button>
                      <Button variant="secondary" size="sm" onClick={stopAgent}>
                        <IconStop size={12} /> Stop
                      </Button>
                      <span style={{ fontSize: 'var(--pt-text-xs)', color: 'var(--pt-text-tertiary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <IconClock size={12} /> {formatElapsed(elapsedMs)}
                      </span>
                    </>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!session || !session.backendSessionId}
                      onClick={runRealAgent}
                      title={
                        session.backendSessionId
                          ? 'Execute the goal with the real agent'
                          : 'Waiting for the backend session…'
                      }
                    >
                      <IconPlay size={12} /> Run
                    </Button>
                  )}
                  {!agentRunning && !session.backendSessionId &&
                    session.status !== 'error' && session.status !== 'detached' && (
                      <span style={{ fontSize: 'var(--pt-text-xs)', color: 'var(--pt-text-tertiary)' }}>
                        Waiting for backend session…
                      </span>
                    )}
                </div>
                {/* Answer + error are delivered by the floating cards and the
                    Result tab — the timeline keeps only the raw step trace. */}
                {agentSteps.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {agentSteps.map((s) => (
                      <div key={s.stepNumber} style={{ fontSize: '12px', lineHeight: 1.4, opacity: s.success ? 1 : 0.8, display: 'flex', gap: 'var(--pt-space-2)', alignItems: 'baseline' }}>
                        <span style={{ color: s.success ? 'var(--pt-semantic-success)' : 'var(--pt-semantic-danger)', display: 'inline-flex', alignItems: 'center' }}>
                          {s.success ? <IconCheckCircle size={12} /> : <IconXCircle size={12} />}
                          <span style={{ marginLeft: '4px' }}>[{s.stepNumber}]</span>
                        </span>{' '}
                        <span><strong>{s.actionName}</strong> — {s.observation.slice(0, 120)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Past runs — fed by the server history for this session
                    (Phase 5). Server-backed rows deep-link into History. */}
                {pastRuns.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pt-space-2)', marginTop: 'var(--pt-space-2)' }}>
                    <div style={{ fontSize: 'var(--pt-text-xs)', fontWeight: 600, color: 'var(--pt-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Past runs
                    </div>
                    {pastRuns.map((run) => (
                      <div
                        key={run.key}
                        role={run.runId ? 'button' : undefined}
                        tabIndex={run.runId ? 0 : undefined}
                        onClick={() => { if (run.runId) navigate(`/history/${run.runId}`); }}
                        onKeyDown={(e) => {
                          if (run.runId && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            navigate(`/history/${run.runId}`);
                          }
                        }}
                        style={{ boxShadow: 'var(--pt-shadow-raised-sm)', borderRadius: 'var(--pt-radius-2)', padding: 'var(--pt-space-2)', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '4px', cursor: run.runId ? 'pointer' : 'default' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--pt-space-2)' }}>
                          <Badge
                            variant={
                              run.status === 'completed' ? 'success'
                              : run.status === 'running' ? 'warning'
                              : run.status === 'cancelled' ? 'neutral'
                              : 'danger'
                            }
                          >
                            {run.status}
                          </Badge>
                          <span style={{ color: 'var(--pt-text-tertiary)' }}>
                            {new Date(run.startedAt).toLocaleString()} · {run.stepsCount} steps
                          </span>
                        </div>
                        {run.answer && (
                          <div><strong>Answer:</strong> {run.answer}</div>
                        )}
                        {run.error && <div style={{ color: 'var(--pt-semantic-danger)' }}>{run.error}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Timeline */}
            {dockTab === 'timeline' && <AITimeline events={filteredTimeline} />}

            {/* Notes */}
            {dockTab === 'notes' && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 'var(--pt-space-3)' }}>
                <form onSubmit={handleAddNote} style={{ display: 'flex', gap: 'var(--pt-space-2)', flexShrink: 0 }}>
                  <Input
                    ref={noteInputRef}
                    placeholder="Add custom research note…"
                    value={newNoteText}
                    onChange={(e) => setNewNoteText(e.target.value)}
                    aria-label="New note"
                  />
                  <Button type="submit" variant="primary" size="sm" disabled={!newNoteText.trim()}>
                    Add Note
                  </Button>
                </form>
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--pt-space-2)' }}>
                  {session.notes.length === 0 ? (
                    <div className="pt-empty" style={{ padding: 'var(--pt-space-6)' }}>
                      <p className="pt-empty__message">No notes yet. Add the first one above.</p>
                    </div>
                  ) : (
                    session.notes.map((note) => (
                      <div key={note.id} className="pt-note-card">
                        <div className="pt-note-card__ts">{note.timestamp}</div>
                        <div className="pt-note-card__content">{note.content}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Tasks */}
            {dockTab === 'tasks' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pt-space-2)' }}>
                {session.tasks.length === 0 ? (
                  <div className="pt-empty" style={{ padding: 'var(--pt-space-6)' }}>
                    <p className="pt-empty__message">No tasks defined for this session.</p>
                  </div>
                ) : (
                  session.tasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      className="pt-task-item"
                      onClick={() => toggleTask(session.id, task.id)}
                      aria-pressed={task.completed}
                    >
                      <span
                        className={cn(
                          'pt-task-item__checkbox',
                          task.completed && 'pt-task-item__checkbox--checked',
                        )}
                        aria-hidden="true"
                      >
                        {task.completed && <IconCheck size={9} />}
                      </span>
                      <span className={cn('pt-task-item__label', task.completed && 'pt-task-item__label--done')}>
                        {task.title}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}

            {/* Downloads */}
            {dockTab === 'downloads' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pt-space-2)' }}>
                {session.downloads.length === 0 ? (
                  <div className="pt-empty" style={{ padding: 'var(--pt-space-6)' }}>
                    <p className="pt-empty__message">No downloads in this session yet.</p>
                  </div>
                ) : (
                  session.downloads.map((dl) => (
                    <div key={dl.id} className="pt-card pt-card--sm" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 'var(--pt-text-base)', fontWeight: 500, color: 'var(--pt-text-primary)' }}>
                          {dl.filename}
                        </div>
                        <div style={{ fontSize: 'var(--pt-text-xs)', color: 'var(--pt-text-tertiary)', marginTop: '2px' }}>
                          {dl.size} · {dl.timestamp}
                        </div>
                      </div>
                      <Badge variant={dl.status === 'completed' ? 'success' : dl.status === 'failed' ? 'danger' : 'warning'}>
                        {dl.status}
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <AuthPromptModal
        isOpen={Boolean(session.authRequired)}
        siteName={session.browserState.currentUrl || session.goal}
        onResumeManual={() => resumeSessionWithAuth(session.id)}
        onCancel={() => archiveSession(session.id)}
      />
    </div>
  );
};

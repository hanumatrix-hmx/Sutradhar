/**
 * @file packages/frontend/src/pages/history/HistoryPage.tsx
 * @description Execution History — multi-day, server-persisted run records (Phase 5).
 *
 * Two views, both refresh-safe deep links:
 *   - HistoryPage  (/history)          → day-grouped cards, search + status filter
 *   - RunDetailPage (/history/:runId)  → full step trace, answer, export, open/re-run/delete
 *
 * Honesty doctrine: the list comes ONLY from the server runs API — nothing
 * is synthesized, and every card reflects a real persisted record.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from '../../app/router.js';
import { useSessionStore } from '../../stores/sessionStore.js';
import { useToast } from '../../components/ui/Toast.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Modal } from '../../components/ui/Modal.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { formatElapsed, formatRelativeTime } from '../../utils/sessionUtils.js';
import {
  listRuns,
  getRun,
  deleteRun,
  RunRecordDto,
  RunStatus,
} from '../../runtime/api/client.js';
import {
  IconArrowLeft,
  IconCheckCircle,
  IconClock,
  IconCopy,
  IconDownload,
  IconExternal,
  IconPlay,
  IconTrash,
  IconXCircle,
} from '../../components/ui/icons.js';
import { cn } from '../../utils/cn.js';

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                       */
/* ------------------------------------------------------------------ */

type StatusFilter = 'all' | RunStatus;

const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'completed', 'failed', 'cancelled', 'running'];

const statusDotColor = (status: RunStatus): string => {
  switch (status) {
    case 'running':
      return 'var(--pt-ai-acting)';
    case 'completed':
      return 'var(--pt-semantic-success)';
    case 'failed':
      return 'var(--pt-semantic-danger)';
    case 'cancelled':
      return 'var(--pt-text-tertiary)';
  }
};

const statusBadgeVariant = (status: RunStatus): 'success' | 'danger' | 'neutral' | 'warning' => {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'running':
      return 'warning';
    case 'cancelled':
      return 'neutral';
  }
};

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return 'Today';
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Honest markdown export of a real run record. */
function toMarkdown(run: RunRecordDto): string {
  const lines: string[] = [
    `# ${run.goal}`,
    '',
    `- Status: ${run.status}`,
    `- Started: ${run.startedAt}`,
    ...(run.endedAt ? [`- Ended: ${run.endedAt}`] : []),
    ...(run.durationMs !== undefined ? [`- Duration: ${formatElapsed(run.durationMs)}`] : []),
    ...(run.provider ? [`- Provider: ${run.provider}`] : []),
    ...(run.model ? [`- Model: ${run.model}`] : []),
    '',
  ];
  if (run.answer) {
    lines.push('## Answer', '', run.answer, '');
  }
  if (run.summary) {
    lines.push('## Summary', '', run.summary, '');
  }
  if (run.error) {
    lines.push('## Error', '', run.error, '');
  }
  if (run.steps.length > 0) {
    lines.push('## Steps', '');
    for (const step of run.steps) {
      const mark = step.success ? '✓' : '✗';
      lines.push(`${step.stepNumber}. [${mark}] **${step.actionName}** — ${step.observation}`);
      if (step.errorMessage) lines.push(`   - Error: ${step.errorMessage}`);
    }
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/*  HistoryPage — day-grouped list                                       */
/* ------------------------------------------------------------------ */

export const HistoryPage: React.FC = () => {
  const { navigate } = useRouter();
  const [runs, setRuns] = useState<readonly RunRecordDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const load = useCallback(() => {
    setError(null);
    setRuns(null);
    void listRuns()
      .then(setRuns)
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!runs) return [];
    const q = query.trim().toLowerCase();
    return runs.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (q && !r.goal.toLowerCase().includes(q) && !(r.answer ?? '').toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [runs, query, statusFilter]);

  // Group by local calendar day, preserving newest-first order.
  const groups = useMemo(() => {
    const out: Array<{ label: string; items: RunRecordDto[] }> = [];
    for (const run of filtered) {
      const key = dayKey(run.startedAt);
      const last = out[out.length - 1];
      if (last && dayKey(last.items[0]!.startedAt) === key) {
        last.items.push(run);
      } else {
        out.push({ label: dayLabel(run.startedAt), items: [run] });
      }
    }
    return out;
  }, [filtered]);

  return (
    <div className="pt-page">
      <div className="pt-page__body">
        <div className="pt-page__header">
          <div>
            <h1 className="pt-page__title">History</h1>
            <p className="pt-page__subtitle">
              {runs
                ? `${runs.length} run${runs.length === 1 ? '' : 's'} · persisted server-side, kept indefinitely`
                : 'Loading persisted run history…'}
            </p>
          </div>
        </div>

        {/* Search + status filter */}
        <div style={{ display: 'flex', gap: 'var(--pt-space-3)', marginBottom: 'var(--pt-space-6)', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: '220px' }}>
            <Input
              placeholder="Search goals and answers…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              isOmnibox
            />
          </div>
          <div style={{ display: 'flex', gap: 'var(--pt-space-1)', flexWrap: 'wrap' }}>
            {STATUS_FILTERS.map((status) => (
              <button
                key={status}
                type="button"
                className={cn(
                  'pt-btn pt-btn--sm',
                  statusFilter === status ? 'pt-btn--secondary' : 'pt-btn--ghost',
                )}
                onClick={() => setStatusFilter(status)}
                style={{ textTransform: 'capitalize' }}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="pt-empty" style={{ padding: 'var(--pt-space-8)' }}>
            <p className="pt-empty__message">Could not load history: {error}</p>
            <Button variant="primary" onClick={load}>Retry</Button>
          </div>
        )}

        {!error && runs === null && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--pt-space-8)' }}>
            <Spinner />
          </div>
        )}

        {!error && runs !== null && filtered.length === 0 && (
          <div className="pt-empty" style={{ padding: 'var(--pt-space-8)' }}>
            <IconClock size={28} />
            <p className="pt-empty__message">
              {runs.length === 0
                ? 'No runs yet. Start a session and its runs will appear here — forever.'
                : 'No runs match your search.'}
            </p>
          </div>
        )}

        {groups.map((group) => (
          <section key={group.label} style={{ marginBottom: 'var(--pt-space-6)' }}>
            <div style={{ fontSize: 'var(--pt-text-xs)', fontWeight: 600, color: 'var(--pt-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 var(--pt-space-3)' }}>
              {group.label}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pt-space-3)' }}>
              {group.items.map((run) => (
                <button
                  key={run.runId}
                  type="button"
                  onClick={() => navigate(`/history/${run.runId}`)}
                  style={{
                    textAlign: 'left',
                    background: 'var(--pt-surface-1)',
                    border: 'none',
                    borderRadius: 'var(--pt-radius-3)',
                    boxShadow: 'var(--pt-shadow-raised-sm)',
                    padding: 'var(--pt-space-3) var(--pt-space-4)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--pt-space-1)',
                    transition: 'box-shadow var(--pt-duration-fast) var(--pt-ease-standard)',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--pt-shadow-raised)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--pt-shadow-raised-sm)'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--pt-space-2)' }}>
                    <span
                      style={{ width: 8, height: 8, borderRadius: '50%', background: statusDotColor(run.status), flexShrink: 0 }}
                      aria-hidden="true"
                    />
                    <span style={{ fontWeight: 600, color: 'var(--pt-text-heading)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {run.goal}
                    </span>
                    <span style={{ fontSize: 'var(--pt-text-xs)', color: 'var(--pt-text-tertiary)', flexShrink: 0 }}>
                      {formatRelativeTime(run.startedAt)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--pt-space-2)', fontSize: 'var(--pt-text-xs)', color: 'var(--pt-text-secondary)' }}>
                    <Badge variant={statusBadgeVariant(run.status)}>{run.status}</Badge>
                    {run.durationMs !== undefined && <span>{formatElapsed(run.durationMs)}</span>}
                    <span>{run.steps.length} step{run.steps.length === 1 ? '' : 's'}</span>
                    {run.provider && <span>· {run.provider}{run.model ? ` / ${run.model}` : ''}</span>}
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  RunDetailPage — full trace, answer, export, actions                  */
/* ------------------------------------------------------------------ */

export interface RunDetailPageProps {
  runId: string;
}

export const RunDetailPage: React.FC<RunDetailPageProps> = ({ runId }) => {
  const { navigate } = useRouter();
  const { addToast } = useToast();
  const { sessions, openSession, createSession } = useSessionStore();
  const [run, setRun] = useState<RunRecordDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    setError(null);
    setRun(null);
    void getRun(runId)
      .then(setRun)
      .catch((err) => setError((err as Error).message));
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

  const sessionExists = Boolean(run?.sessionId && sessions.some((s) => s.id === run.sessionId));

  const handleCopyMarkdown = async () => {
    if (!run) return;
    await navigator.clipboard.writeText(toMarkdown(run));
    addToast({ title: 'Run exported', message: 'Markdown is on your clipboard.', type: 'success' });
  };

  const handleCopyAnswer = async () => {
    if (!run?.answer) return;
    await navigator.clipboard.writeText(run.answer);
    addToast({ title: 'Answer copied', message: 'The answer is on your clipboard.', type: 'success' });
  };

  const handleOpenSession = () => {
    if (!run?.sessionId) return;
    openSession(run.sessionId);
    navigate(`/session/${run.sessionId}`);
  };

  const handleRerun = () => {
    if (!run) return;
    const created = createSession(run.goal.slice(0, 64), run.goal);
    navigate(`/session/${created.id}`);
  };

  const handleDelete = async () => {
    if (!run) return;
    setDeleting(true);
    try {
      await deleteRun(run.runId);
      addToast({ title: 'Run deleted', message: 'The record was removed from history.', type: 'info' });
      navigate('/history');
    } catch (err) {
      addToast({ title: 'Delete failed', message: (err as Error).message, type: 'danger' });
      setDeleting(false);
    }
  };

  if (error) {
    return (
      <div className="pt-page">
        <div className="pt-page__body">
          <div className="pt-empty" style={{ padding: 'var(--pt-space-8)' }}>
            <p className="pt-empty__message">Could not load this run: {error}</p>
            <div style={{ display: 'flex', gap: 'var(--pt-space-2)' }}>
              <Button variant="ghost" onClick={() => navigate('/history')}>
                <IconArrowLeft size={14} /> Back to history
              </Button>
              <Button variant="primary" onClick={load}>Retry</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="pt-page">
        <div className="pt-page__body">
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--pt-space-8)' }}>
            <Spinner />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-page">
      <div className="pt-page__body">
        {/* Header + actions */}
        <div className="pt-page__header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--pt-space-4)' }}>
          <div style={{ minWidth: 0 }}>
            <button
              type="button"
              className="pt-btn pt-btn--ghost pt-btn--sm"
              onClick={() => navigate('/history')}
              style={{ marginBottom: 'var(--pt-space-2)' }}
            >
              <IconArrowLeft size={14} /> History
            </button>
            <h1 className="pt-page__title" style={{ overflowWrap: 'anywhere' }}>{run.goal}</h1>
            <p className="pt-page__subtitle">
              {new Date(run.startedAt).toLocaleString()}
              {run.durationMs !== undefined ? ` · ${formatElapsed(run.durationMs)}` : ''}
              {run.provider ? ` · ${run.provider}${run.model ? ` / ${run.model}` : ''}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--pt-space-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={handleCopyMarkdown}>
              <IconDownload size={14} /> Export
            </Button>
            {sessionExists && (
              <Button variant="ghost" onClick={handleOpenSession}>
                <IconExternal size={14} /> Open session
              </Button>
            )}
            <Button variant="secondary" onClick={handleRerun}>
              <IconPlay size={14} /> Re-run goal
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
              <IconTrash size={14} /> Delete
            </Button>
          </div>
        </div>

        {/* Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--pt-space-2)', marginBottom: 'var(--pt-space-4)' }}>
          <Badge variant={statusBadgeVariant(run.status)}>{run.status}</Badge>
          <span style={{ fontSize: 'var(--pt-text-xs)', color: 'var(--pt-text-tertiary)' }}>
            {run.steps.length} step{run.steps.length === 1 ? '' : 's'}
            {run.endedAt ? ` · ended ${new Date(run.endedAt).toLocaleString()}` : ' · still executing'}
          </span>
        </div>

        {/* Answer panel */}
        {run.answer && (
          <div
            style={{
              background: 'var(--pt-surface-1)',
              borderRadius: 'var(--pt-radius-3)',
              boxShadow: 'var(--pt-shadow-raised-sm)',
              padding: 'var(--pt-space-4)',
              marginBottom: 'var(--pt-space-4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--pt-space-2)' }}>
              <span style={{ fontSize: 'var(--pt-text-xs)', fontWeight: 600, color: 'var(--pt-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Answer
              </span>
              <button type="button" className="pt-btn pt-btn--ghost pt-btn--sm" onClick={handleCopyAnswer}>
                <IconCopy size={14} /> Copy
              </button>
            </div>
            <div style={{ color: 'var(--pt-text-primary)', lineHeight: 1.6, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
              {run.answer}
            </div>
          </div>
        )}

        {/* Honest failure surface */}
        {run.error && (
          <div
            style={{
              background: 'var(--pt-surface-1)',
              borderRadius: 'var(--pt-radius-3)',
              boxShadow: 'var(--pt-shadow-raised-sm)',
              padding: 'var(--pt-space-4)',
              marginBottom: 'var(--pt-space-4)',
              color: 'var(--pt-semantic-danger)',
              display: 'flex',
              gap: 'var(--pt-space-2)',
              alignItems: 'flex-start',
            }}
          >
            <IconXCircle size={16} />
            <span style={{ lineHeight: 1.5 }}>{run.error}</span>
          </div>
        )}

        {run.summary && !run.answer && (
          <div style={{ fontSize: 'var(--pt-text-sm)', color: 'var(--pt-text-secondary)', marginBottom: 'var(--pt-space-4)', lineHeight: 1.5 }}>
            {run.summary}
          </div>
        )}

        {/* Full step trace — real steps only */}
        <div style={{ fontSize: 'var(--pt-text-xs)', fontWeight: 600, color: 'var(--pt-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--pt-space-2)' }}>
          Step trace
        </div>
        {run.steps.length === 0 ? (
          <div className="pt-empty" style={{ padding: 'var(--pt-space-6)' }}>
            <p className="pt-empty__message">
              {run.status === 'running' ? 'No steps yet — the run is executing.' : 'This run executed no steps.'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pt-space-2)' }}>
            {run.steps.map((step) => (
              <div
                key={step.stepNumber}
                style={{
                  background: 'var(--pt-surface-1)',
                  borderRadius: 'var(--pt-radius-2)',
                  boxShadow: 'var(--pt-shadow-inset)',
                  padding: 'var(--pt-space-3)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  fontSize: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--pt-space-2)' }}>
                  <span style={{ color: step.success ? 'var(--pt-semantic-success)' : 'var(--pt-semantic-danger)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    {step.success ? <IconCheckCircle size={12} /> : <IconXCircle size={12} />}
                    [{step.stepNumber}]
                  </span>
                  <strong>{step.actionName}</strong>
                  {step.timestamp && (
                    <span style={{ color: 'var(--pt-text-tertiary)', marginLeft: 'auto' }}>
                      {new Date(step.timestamp).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                {step.reasoning && (
                  <div style={{ color: 'var(--pt-text-secondary)', fontStyle: 'italic' }}>{step.reasoning}</div>
                )}
                <div style={{ color: 'var(--pt-text-primary)', overflowWrap: 'anywhere' }}>{step.observation}</div>
                {step.errorMessage && (
                  <div style={{ color: 'var(--pt-semantic-danger)' }}>{step.errorMessage}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation — never silent */}
      <Modal
        isOpen={confirmDelete}
        title="Delete this run?"
        onClose={() => { if (!deleting) setConfirmDelete(false); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              Keep it
            </Button>
            <Button variant="primary" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete run'}
            </Button>
          </>
        }
      >
        <p style={{ color: 'var(--pt-text-secondary)', lineHeight: 1.5 }}>
          The run “{run.goal}” will be permanently removed from the server history.
          This cannot be undone.
        </p>
      </Modal>
    </div>
  );
};

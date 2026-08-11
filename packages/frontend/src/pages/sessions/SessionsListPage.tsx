/**
 * @file packages/frontend/src/pages/sessions/SessionsListPage.tsx
 * @description Sessions Manager — searchable, filterable list of all sessions.
 */

import React, { useState } from 'react';
import { useSessionStore } from '../../stores/sessionStore.js';
import { useRouter } from '../../app/router.js';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Input } from '../../components/ui/Input.js';
import { Progress } from '../../components/ui/Progress.js';
import { getStatusVariant, formatRelativeTime } from '../../utils/sessionUtils.js';
import { cn } from '../../utils/cn.js';

export interface SessionsListPageProps {
  onOpenNewSessionModal: () => void;
}

type StatusFilter = 'all' | 'active' | 'paused' | 'completed' | 'archived';

export const SessionsListPage: React.FC<SessionsListPageProps> = ({ onOpenNewSessionModal }) => {
  const { sessions, openSession, archiveSession, deleteSession } = useSessionStore();
  const { navigate } = useRouter();
  const [query,        setQuery]        = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const filtered = sessions.filter((s) => {
    const matchQuery  = s.title.toLowerCase().includes(query.toLowerCase()) ||
                        s.goal.toLowerCase().includes(query.toLowerCase());
    const matchStatus = statusFilter === 'all' || s.status === statusFilter;
    return matchQuery && matchStatus;
  });

  const STATUS_FILTERS: StatusFilter[] = ['all', 'active', 'paused', 'completed', 'archived'];

  return (
    <div className="pt-page">
      <div className="pt-page__body">
        {/* Page header */}
        <div className="pt-page__header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--pt-space-4)' }}>
          <div>
            <h1 className="pt-page__title">Sessions</h1>
            <p className="pt-page__subtitle">
              {sessions.length} total · {sessions.filter((s) => s.status === 'active').length} active
            </p>
          </div>
          <Button variant="primary" onClick={onOpenNewSessionModal}>
            New Session
          </Button>
        </div>

        {/* Filter bar */}
        <div style={{ display: 'flex', gap: 'var(--pt-space-3)', marginBottom: 'var(--pt-space-6)', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: '220px' }}>
            <Input
              placeholder="Search by title or goal…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              shortcutBadge="/"
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

        {/* Sessions list */}
        {filtered.length === 0 ? (
          <div className="pt-empty">
            <p className="pt-empty__title">No sessions found</p>
            <p className="pt-empty__message">
              {query || statusFilter !== 'all'
                ? 'Try adjusting your filters.'
                : 'Create your first session to get started.'}
            </p>
            {sessions.length === 0 && (
              <Button variant="primary" onClick={onOpenNewSessionModal}>New Session</Button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pt-space-3)' }}>
            {filtered.map((s) => {
              const completedTasks = s.tasks.filter((t) => t.completed).length;
              const taskPct        = s.tasks.length > 0
                ? Math.round((completedTasks / s.tasks.length) * 100)
                : 0;

              return (
                <div key={s.id} className="pt-session-card">
                  <div className="pt-session-card__header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--pt-space-2)', minWidth: 0 }}>
                      <h3 className="pt-session-card__title">{s.title}</h3>
                      <Badge variant={getStatusVariant(s.status)} showDot>
                        {s.status}
                      </Badge>
                    </div>
                    <div className="pt-session-card__actions">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => { openSession(s.id); navigate(`/session/${s.id}`); }}
                      >
                        Open
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => archiveSession(s.id)}
                        disabled={s.status === 'archived'}
                      >
                        Archive
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteSession(s.id)}
                        style={{ color: 'var(--pt-semantic-danger)' }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>

                  <p className="pt-session-card__goal">{s.goal}</p>

                  {s.tasks.length > 0 && (
                    <div style={{ marginBottom: 'var(--pt-space-3)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--pt-text-xs)', color: 'var(--pt-text-tertiary)', marginBottom: 'var(--pt-space-1)' }}>
                        <span>Progress</span>
                        <span>{taskPct}%</span>
                      </div>
                      <Progress
                        value={taskPct}
                        variant={s.status === 'completed' ? 'primary' : 'success'}
                        label={`${taskPct}% complete`}
                      />
                    </div>
                  )}

                  <div className="pt-session-card__meta">
                    <span>{completedTasks}/{s.tasks.length} tasks</span>
                    <span>{s.downloads.length} downloads</span>
                    <span>Updated {formatRelativeTime(s.updatedAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * @file packages/frontend/src/pages/home/HomePage.tsx
 * @description Home dashboard — action-first goal intake + recent sessions.
 * Servant Model: the primary action ("tell the agent what to do") lives at
 * the very top, one keystroke away. Stats and history follow.
 */

import React, { useState } from 'react';
import { useSessionStore } from '../../stores/sessionStore.js';
import { useRouter } from '../../app/router.js';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Progress } from '../../components/ui/Progress.js';
import { getStatusVariant, formatRelativeTime } from '../../utils/sessionUtils.js';
import { IconArrowRight, IconPlay, IconSparkle } from '../../components/ui/icons.js';

export interface HomePageProps {
  onOpenNewSessionModal: () => void;
}

export const HomePage: React.FC<HomePageProps> = ({ onOpenNewSessionModal }) => {
  const { recentSessions, openSession, createSession } = useSessionStore();
  const { navigate } = useRouter();

  const [heroGoal, setHeroGoal] = useState('');

  const activeCount    = recentSessions.filter((s) => s.status === 'active').length;
  const completedCount = recentSessions.filter((s) => s.status === 'completed').length;

  // Goal is the only input — title auto-derives, session launches immediately.
  const launchFromHero = () => {
    const goal = heroGoal.trim();
    if (!goal) return;
    const created = createSession(goal.slice(0, 64), goal);
    setHeroGoal('');
    navigate(`/session/${created.id}`);
  };

  return (
    <div className="pt-page">
      <div className="pt-page__body">
        {/* Action-first hero: state the goal, the agent takes it from there */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            margin: 'var(--pt-space-8) auto var(--pt-space-8)',
            maxWidth: '640px',
            animation: 'pt-page-enter var(--pt-duration-page) var(--pt-ease-soft) both',
          }}
        >
          <div style={{ color: 'var(--pt-brand-primary)', marginBottom: 'var(--pt-space-3)' }}>
            <IconSparkle size={28} />
          </div>
          <h1 className="pt-page__title" style={{ marginBottom: 'var(--pt-space-2)' }}>
            What should the agent do?
          </h1>
          <p className="pt-page__subtitle" style={{ marginBottom: 'var(--pt-space-6)' }}>
            Describe the goal — PinchTab opens a browser, works through it, and brings you the answer.
          </p>

          <div
            style={{
              width: '100%',
              boxShadow: 'var(--pt-shadow-inset)',
              borderRadius: 'var(--pt-radius-3)',
              padding: 'var(--pt-space-3)',
              display: 'flex',
              gap: 'var(--pt-space-2)',
              alignItems: 'flex-end',
            }}
          >
            <textarea
              value={heroGoal}
              onChange={(e) => setHeroGoal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  launchFromHero();
                }
              }}
              placeholder="e.g. Find the cheapest flight from NYC to London next Friday…"
              rows={3}
              autoFocus
              aria-label="Goal"
              style={{
                flex: 1,
                resize: 'none',
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: 'var(--pt-text-primary)',
                fontSize: 'var(--pt-text-base)',
                lineHeight: 1.5,
                fontFamily: 'inherit',
              }}
            />
            <Button variant="primary" size="lg" disabled={!heroGoal.trim()} onClick={launchFromHero}>
              <IconPlay size={14} /> Launch
            </Button>
          </div>

          <p style={{ marginTop: 'var(--pt-space-3)', fontSize: 'var(--pt-text-xs)', color: 'var(--pt-text-tertiary)' }}>
            Enter to launch · Shift+Enter for a new line · <button type="button" onClick={onOpenNewSessionModal} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--pt-brand-primary)', cursor: 'pointer', fontSize: 'inherit', fontFamily: 'inherit' }}>more options</button> (title, start URL)
          </p>
        </div>

        {/* Quiet stats — context, not the headline */}
        <div className="pt-grid-3" style={{ marginBottom: 'var(--pt-space-8)' }}>
          <div className="pt-stat-card">
            <div className="pt-stat-card__label">Total Sessions</div>
            <div className="pt-stat-card__value">{recentSessions.length}</div>
          </div>
          <div className="pt-stat-card">
            <div className="pt-stat-card__label">Active</div>
            <div className="pt-stat-card__value" style={{ color: 'var(--pt-semantic-success)' }}>
              {activeCount}
            </div>
          </div>
          <div className="pt-stat-card">
            <div className="pt-stat-card__label">Completed</div>
            <div className="pt-stat-card__value" style={{ color: 'var(--pt-brand-primary)' }}>
              {completedCount}
            </div>
          </div>
        </div>

        {/* Recent sessions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--pt-space-4)' }}>
          <h2 style={{ fontSize: 'var(--pt-text-lg)', fontWeight: 600, color: 'var(--pt-text-heading)', margin: 0 }}>
            Recent Sessions
          </h2>
          <Button variant="ghost" size="sm" onClick={() => navigate('/sessions')}>
            View all <IconArrowRight size={12} />
          </Button>
        </div>

        {recentSessions.length === 0 ? (
          <div className="pt-empty">
            <p className="pt-empty__title">No sessions yet</p>
            <p className="pt-empty__message">
              Create your first session to start using the browser agent.
            </p>
            <Button variant="primary" onClick={onOpenNewSessionModal}>New Session</Button>
          </div>
        ) : (
          <div className="pt-grid-auto">
            {recentSessions.slice(0, 6).map((session) => {
              const completedTasks = session.tasks.filter((t) => t.completed).length;
              const taskPct        = session.tasks.length > 0
                ? Math.round((completedTasks / session.tasks.length) * 100)
                : session.progress ?? 0;

              return (
                <div key={session.id} className="pt-session-card">
                  <div className="pt-session-card__header">
                    <h3 className="pt-session-card__title">{session.title}</h3>
                    <Badge variant={getStatusVariant(session.status)} showDot>
                      {session.status}
                    </Badge>
                  </div>

                  <p className="pt-session-card__goal">{session.goal}</p>

                  {/* Progress — only when real tasks exist (no fabricated bars) */}
                  {session.tasks.length > 0 && (
                    <div style={{ marginBottom: 'var(--pt-space-3)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--pt-text-xs)', color: 'var(--pt-text-tertiary)', marginBottom: 'var(--pt-space-1)' }}>
                        <span>Progress</span>
                        <span>{taskPct}%</span>
                      </div>
                      <Progress
                        value={taskPct}
                        variant={session.status === 'completed' ? 'primary' : 'success'}
                        label={`${taskPct}% complete`}
                      />
                    </div>
                  )}

                  <div className="pt-session-card__meta" style={{ justifyContent: 'space-between' }}>
                    <span>Updated {formatRelativeTime(session.updatedAt)}</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        openSession(session.id);
                        navigate(`/session/${session.id}`);
                      }}
                    >
                      Open
                    </Button>
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

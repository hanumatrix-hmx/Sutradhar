/**
 * @file packages/frontend/src/pages/downloads/DownloadsPage.tsx
 * @description Global Downloads Manager — all downloads across all sessions.
 */

import React from 'react';
import { useSessionStore } from '../../stores/sessionStore.js';
import { Badge } from '../../components/ui/Badge.js';

const IconDownload = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

export const DownloadsPage: React.FC = () => {
  const { sessions } = useSessionStore();

  const allDownloads = sessions.flatMap((s) =>
    s.downloads.map((dl) => ({ ...dl, sessionTitle: s.title, sessionId: s.id })),
  );

  return (
    <div className="pt-page">
      <div className="pt-page__body">
        <div className="pt-page__header">
          <h1 className="pt-page__title">Downloads</h1>
          <p className="pt-page__subtitle">
            {allDownloads.length} file{allDownloads.length !== 1 ? 's' : ''} across all sessions
          </p>
        </div>

        {allDownloads.length === 0 ? (
          <div className="pt-empty">
            <IconDownload />
            <p className="pt-empty__title">No downloads yet</p>
            <p className="pt-empty__message">
              Files downloaded by browser sessions will appear here.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pt-space-2)' }}>
            {allDownloads.map((dl) => (
              <div
                key={dl.id}
                className="pt-card"
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--pt-space-3)', justifyContent: 'space-between' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--pt-space-3)', minWidth: 0 }}>
                  <span style={{ color: 'var(--pt-text-secondary)', flexShrink: 0 }}>
                    <IconDownload />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--pt-text-md)', fontWeight: 500, color: 'var(--pt-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {dl.filename}
                    </div>
                    <div style={{ fontSize: 'var(--pt-text-xs)', color: 'var(--pt-text-tertiary)', marginTop: '2px' }}>
                      {dl.sessionTitle} · {dl.size} · {dl.timestamp}
                    </div>
                  </div>
                </div>
                <Badge
                  variant={
                    dl.status === 'completed' ? 'success' :
                    dl.status === 'failed'    ? 'danger'  : 'warning'
                  }
                >
                  {dl.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

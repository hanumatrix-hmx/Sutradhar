/**
 * @file packages/frontend/src/pages/session/AITimeline.tsx
 * @description AI Activity Timeline — chronological event stream with category-coded icons.
 * Zero inline styles; all layout via CSS classes.
 */

import React from 'react';
import { TimelineEvent } from '../../models/session.js';
import { cn } from '../../utils/cn.js';

export interface AITimelineProps {
  events: readonly TimelineEvent[];
}

/* ── Category icons ── */
const SearchIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.4"/>
    <path d="M8 8L10.5 10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
);
const NavIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M6 1.5C6 1.5 4 4 4 6s2 4.5 2 4.5M6 1.5C6 1.5 8 4 8 6s-2 4.5-2 4.5M1.5 6h9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);
const DownloadIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M6 2v6M3.5 5.5L6 8l2.5-2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M2 10h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
);
const ZapIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M7 1.5L2.5 7H6.5L5 10.5L9.5 5H5.5L7 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
  </svg>
);
const DocIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <rect x="2" y="1.5" width="8" height="9" rx="1" stroke="currentColor" strokeWidth="1.3"/>
    <path d="M4 4.5h4M4 6.5h4M4 8.5h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);
const DotIcon = () => (
  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
    <circle cx="4" cy="4" r="3" fill="currentColor"/>
  </svg>
);

function getCategoryIcon(category: TimelineEvent['category']): React.ReactNode {
  switch (category) {
    case 'search':     return <SearchIcon />;
    case 'navigation': return <NavIcon />;
    case 'download':   return <DownloadIcon />;
    case 'extraction': return <ZapIcon />;
    case 'summary':    return <DocIcon />;
    default:           return <DotIcon />;
  }
}

function getCategoryClass(category: TimelineEvent['category']): string {
  switch (category) {
    case 'search':     return 'pt-timeline__icon--search';
    case 'navigation': return 'pt-timeline__icon--navigation';
    case 'download':   return 'pt-timeline__icon--download';
    case 'extraction': return 'pt-timeline__icon--extraction';
    case 'summary':    return 'pt-timeline__icon--summary';
    default:           return '';
  }
}

export const AITimeline: React.FC<AITimelineProps> = ({ events }) => {
  if (events.length === 0) {
    return (
      <div className="pt-empty">
        <ZapIcon />
        <p className="pt-empty__title">No agent activity yet</p>
        <p className="pt-empty__message">Agent events will appear here as the session runs.</p>
      </div>
    );
  }

  return (
    <div className="pt-timeline">
      <div className="pt-timeline__track" aria-hidden="true" />
      {events.map((event) => (
        <div key={event.id} className="pt-timeline__event">
          <div className={cn('pt-timeline__icon', getCategoryClass(event.category))}>
            {getCategoryIcon(event.category)}
          </div>
          <div className="pt-timeline__body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--pt-space-2)' }}>
              <span className="pt-timeline__action">{event.action}</span>
              <span className="pt-timeline__ts">{event.timestamp}</span>
            </div>
            {event.details && (
              <p className="pt-timeline__details">{event.details}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

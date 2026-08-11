/**
 * @file packages/frontend/src/utils/sessionUtils.ts
 * @description Shared session domain utilities — single source of truth for derived session state.
 */

import { SessionStatus } from '../models/session.js';
import type { BadgeVariant } from '../components/ui/Badge.js';

/**
 * Maps a SessionStatus to the correct Badge variant.
 * Centralised to prevent the 4x duplication that existed previously.
 */
export function getStatusVariant(status: SessionStatus | string): BadgeVariant {
  switch (status) {
    case 'active':    return 'success';
    case 'paused':    return 'warning';
    case 'completed': return 'primary';
    case 'archived':  return 'neutral';
    case 'error':     return 'danger';
    case 'detached':  return 'warning';
    default:          return 'neutral';
  }
}

/**
 * Formats an ISO date string into a human-friendly relative label.
 * Examples: "just now", "5m ago", "2h ago", "Jul 28"
 */
export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now  = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffH   = Math.floor(diffMin / 60);
  const diffD   = Math.floor(diffH   / 24);

  if (diffMin < 1)  return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffH   < 24) return `${diffH}h ago`;
  if (diffD   < 7)  return `${diffD}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Derives the display colour token name for an agent status.
 */
export type AgentStatus = 'thinking' | 'acting' | 'waiting' | 'error' | 'idle';

export function getAgentStatusLabel(status: AgentStatus): string {
  switch (status) {
    case 'thinking': return 'Thinking…';
    case 'acting':   return 'Acting';
    case 'waiting':  return 'Waiting for approval';
    case 'error':    return 'Error';
    case 'idle':     return 'Idle';
  }
}

/* ---- Real lifecycle state machine (Phase 2) --------------------------- */

/**
 * Honest session lifecycle derived from facts only — never fabricated:
 * preparing → ready → running → completed|failed|cancelled → archived.
 * Broken backend states (error/detached) short-circuit everything else.
 */
export type SessionPhase =
  | 'preparing'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'archived'
  | 'error'
  | 'detached';

export interface PhaseInputs {
  readonly status: string;
  readonly backendReady: boolean;
  readonly agentRunning: boolean;
  readonly agentError: boolean;
  /** Status of the most recent run, if any. */
  readonly lastRunStatus?: 'running' | 'completed' | 'failed' | 'cancelled';
}

export function deriveSessionPhase(i: PhaseInputs): SessionPhase {
  if (i.status === 'error') return 'error';
  if (i.status === 'detached') return 'detached';
  if (i.status === 'archived') return 'archived';
  if (i.agentRunning || i.lastRunStatus === 'running') return 'running';
  if (i.agentError || i.lastRunStatus === 'failed') return 'failed';
  if (i.lastRunStatus === 'cancelled') return 'cancelled';
  if (i.lastRunStatus === 'completed') return 'completed';
  if (!i.backendReady) return 'preparing';
  return 'ready';
}

export function getPhaseLabel(phase: SessionPhase): string {
  switch (phase) {
    case 'preparing': return 'Preparing';
    case 'ready':     return 'Ready';
    case 'running':   return 'Running';
    case 'completed': return 'Completed';
    case 'failed':    return 'Failed';
    case 'cancelled': return 'Cancelled';
    case 'archived':  return 'Archived';
    case 'error':     return 'Error';
    case 'detached':  return 'Detached';
  }
}

export function getPhaseVariant(phase: SessionPhase): BadgeVariant {
  switch (phase) {
    case 'ready':
    case 'running':   return 'success';
    case 'completed': return 'primary';
    case 'failed':
    case 'error':     return 'danger';
    case 'preparing':
    case 'cancelled':
    case 'detached':  return 'warning';
    case 'archived':  return 'neutral';
  }
}

/** Formats an elapsed duration (ms) as mm:ss for the run timer. */
export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Generates a deterministic initials string from a session title (max 2 chars).
 */
export function getSessionInitials(title: string): string {
  const words = title.trim().split(/\s+/);
  if (words.length >= 2) {
    return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase();
  }
  return title.slice(0, 2).toUpperCase();
}

/**
 * Determines whether a URL should show the secure lock icon.
 */
export function isSecureUrl(url: string): boolean {
  return url.startsWith('https://');
}

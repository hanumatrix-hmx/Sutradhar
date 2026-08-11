/**
 * @file packages/frontend/src/models/session.ts
 * @description Session domain model interfaces, status types, and helper factories.
 */

export type SessionStatus =
  | 'active'
  | 'paused'
  | 'completed'
  | 'archived'
  | 'error'
  | 'detached';

/** One step of a real agent run, mirrored from the backend DTO. */
export interface RunStep {
  stepNumber: number;
  reasoning: string;
  actionName: string;
  observation: string;
  success: boolean;
  errorMessage?: string;
  timestamp: string;
}

/**
 * A persisted agent execution. Runs are written into the session model the
 * moment they start and updated when they end, so results survive navigation
 * and reloads (multi-day history arrives server-side in Phase 5).
 */
export interface RunRecord {
  runId: string;
  /** Server-assigned run id, linked once the goal endpoint returns. */
  serverRunId?: string;
  goal: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  endedAt?: string;
  /** Real elapsed wall-clock time reported by the backend (or client-measured). */
  durationMs?: number;
  steps: readonly RunStep[];
  answer?: string | null;
  error?: string | null;
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  action: string;
  category: 'search' | 'navigation' | 'download' | 'extraction' | 'summary';
  details?: string;
}

export interface SessionDownload {
  id: string;
  filename: string;
  size: string;
  timestamp: string;
  status: 'completed' | 'in_progress' | 'failed';
}

export interface SessionNote {
  id: string;
  timestamp: string;
  content: string;
}

export interface SessionBookmark {
  id: string;
  title: string;
  url: string;
  addedAt: string;
}

export interface SessionTask {
  id: string;
  title: string;
  completed: boolean;
}

export interface BrowserState {
  currentUrl?: string;
  pageTitle?: string;
  tabCount?: number;
}

export interface Session {
  id: string;
  title: string;
  goal: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  progress: number;
  authRequired?: boolean;
  /** Id of the real backend browser session, once launch is confirmed. */
  backendSessionId?: string | null;
  browserState: BrowserState;
  downloads: SessionDownload[];
  timeline: TimelineEvent[];
  notes: SessionNote[];
  bookmarks: SessionBookmark[];
  tasks: SessionTask[];
  /** Persisted agent executions, newest first. */
  runs: RunRecord[];
}

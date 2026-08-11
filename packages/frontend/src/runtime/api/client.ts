/**
 * @file packages/frontend/src/runtime/api/client.ts
 * @description Typed REST client for the PinchTab backend.
 *
 * This is the ONLY frontend module that talks to the backend. All calls are
 * real fetches; there are no mock fallbacks. Errors throw BackendTransportError,
 * which the UI surfaces to the user.
 */

import { BackendTransportError, HttpBrowserTransport } from '../browser/adapters/browserTransport.js';

// Re-export so callers can catch by type without a second import.
export { BackendTransportError };

let sharedTransport: HttpBrowserTransport | null = null;

/** Returns the process-wide shared transport (one base URL, one origin for CORS). */
export function getTransport(): HttpBrowserTransport {
  if (!sharedTransport) sharedTransport = new HttpBrowserTransport();
  return sharedTransport;
}

// ---- Response shapes (mirror the backend routes) --------------------------

export interface SessionTabDto {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly isActive: boolean;
}
export interface SessionDto {
  readonly id: string;
  readonly activeTabId?: string;
  readonly tabs: readonly SessionTabDto[];
  readonly createdAt: string;
  readonly isIncognito: boolean;
}

export interface AgentGoalResultDto {
  readonly id: string;
  /** Server-assigned run identifier (echoes `id` — the client never invents ids). */
  readonly runId?: string;
  /** Client session echoed back for run linkage. */
  readonly sessionId?: string;
  readonly agentId: string;
  readonly objective: string;
  readonly status:
    | 'pending'
    | 'planning'
    | 'executing'
    | 'verifying'
    | 'completed'
    | 'failed'
    | 'cancelled';
  readonly createdAt: string;
  /** Answer extracted by the real agent loop, when available. */
  readonly answer?: string;
  /** Full real step trace, when the backend exposes it. */
  readonly steps?: readonly AgentStepDto[];
  readonly summary?: string;
  /** Real elapsed wall-clock time in ms, reported by the backend. */
  readonly durationMs?: number;
}

export interface AgentStepDto {
  readonly stepNumber: number;
  readonly reasoning: string;
  readonly actionName: string;
  readonly observation: string;
  readonly success: boolean;
  readonly errorMessage?: string;
  readonly timestamp: string;
}

export interface BrowserSnapshotDto {
  readonly sessionId: string;
  readonly tabId: string;
  readonly url: string;
  readonly title: string;
  readonly interactiveElements: string;
  readonly pageText: string;
  readonly elementCount: number;
}

// ---- Agent API ------------------------------------------------------------

export async function executeGoal(
  goal: string,
  options?: { sessionId?: string; signal?: AbortSignal },
): Promise<AgentGoalResultDto> {
  return getTransport().send<AgentGoalResultDto>(
    '/api/v1/agents/goals',
    { goal, ...(options?.sessionId ? { sessionId: options.sessionId } : {}) },
    { signal: options?.signal },
  );
}

export async function getAgentStatus(): Promise<unknown> {
  return getTransport().get('/api/v1/agents/status');
}

// ---- Runs API (Phase 4: live progress & cancel; Phase 5: history) --------

export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** The canonical persisted run record (mirrors the backend RunRecordDto). */
export interface RunRecordDto {
  readonly runId: string;
  readonly sessionId?: string;
  readonly goal: string;
  readonly status: RunStatus;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly durationMs?: number;
  /** LLM provider that actually served the run (honest attribution). */
  readonly provider?: string;
  readonly model?: string;
  readonly steps: readonly AgentStepDto[];
  readonly answer?: string;
  readonly summary?: string;
  readonly error?: string;
  readonly result?: AgentGoalResultDto;
  readonly exportedAt?: string;
}

export interface ListRunsFilter {
  readonly sessionId?: string;
  readonly status?: RunStatus;
  /** ISO timestamps (inclusive bounds). */
  readonly from?: string;
  readonly to?: string;
}

/** Starts an async run; the server assigns the runId (never invented client-side). */
export async function startRun(goal: string, sessionId?: string): Promise<{ runId: string }> {
  return getTransport().send<{ runId: string }>('/api/v1/runs', {
    goal,
    ...(sessionId ? { sessionId } : {}),
  });
}

/** History listing — server-persisted, survives restarts (newest first). */
export async function listRuns(filter: ListRunsFilter = {}): Promise<readonly RunRecordDto[]> {
  const params = new URLSearchParams();
  if (filter.sessionId) params.set('sessionId', filter.sessionId);
  if (filter.status) params.set('status', filter.status);
  if (filter.from) params.set('from', filter.from);
  if (filter.to) params.set('to', filter.to);
  const qs = params.toString();
  const res = await getTransport().get<{ runs: readonly RunRecordDto[] }>(
    `/api/v1/runs${qs ? `?${qs}` : ''}`,
  );
  return res.runs;
}

export async function getRun(runId: string): Promise<RunRecordDto> {
  return getTransport().get<RunRecordDto>(`/api/v1/runs/${encodeURIComponent(runId)}`);
}

/** Explicit deletion — the UI must confirm before calling this. */
export async function deleteRun(runId: string): Promise<{ runId: string; deleted: boolean }> {
  return getTransport().delete(`/api/v1/runs/${encodeURIComponent(runId)}`);
}

/** End-to-end Stop: aborts the real agent loop (honored at step boundaries). */
export async function cancelRun(
  runId: string,
): Promise<{ runId: string; cancelled: boolean; status: string }> {
  return getTransport().send(`/api/v1/runs/${encodeURIComponent(runId)}/cancel`, {});
}

/** Absolute SSE URL for a run's live event stream (EventSource needs a full URL). */
export function runEventsUrl(runId: string): string {
  return `${getTransport().baseUrl}/api/v1/runs/${encodeURIComponent(runId)}/events`;
}

// ---- Session API ----------------------------------------------------------

export async function createSession(initialUrl?: string, sessionId?: string): Promise<SessionDto> {
  // Caller-supplied sessionId binds the backend browser session to this UI
  // session — one shared session, never an orphan second browser.
  return getTransport().send<SessionDto>('/api/v1/sessions', {
    initialUrl,
    ...(sessionId ? { sessionId } : {}),
  });
}

export async function listSessions(): Promise<readonly SessionDto[]> {
  return getTransport().get<readonly SessionDto[]>('/api/v1/sessions');
}

export async function getSession(id: string): Promise<SessionDto | undefined> {
  return getTransport().get<SessionDto>(`/api/v1/sessions/${encodeURIComponent(id)}`);
}

export async function deleteSession(id: string): Promise<void> {
  await getTransport().delete(`/api/v1/sessions/${encodeURIComponent(id)}`);
}

// ---- Browser API ----------------------------------------------------------

export async function navigate(
  sessionId: string,
  tabId: string,
  url: string,
): Promise<{ tabId: string; url: string; title: string }> {
  return getTransport().send('/api/v1/browser/navigate', { sessionId, tabId, url });
}

export async function screenshot(sessionId: string, tabId: string): Promise<string> {
  const res = await getTransport().send<{ screenshotData: string }>(
    '/api/v1/browser/screenshot',
    { sessionId, tabId },
  );
  return res.screenshotData;
}

export async function getSnapshot(
  sessionId: string,
  tabId: string,
): Promise<BrowserSnapshotDto> {
  return getTransport().get<BrowserSnapshotDto>(
    `/api/v1/browser/snapshot/${encodeURIComponent(sessionId)}/${encodeURIComponent(tabId)}`,
  );
}

// ---- LLM Config API (Phase 6: honest settings) -------------------------

export interface LlmConfigDto {
  readonly providerMode: 'heuristic' | 'openrouter' | 'ollama';
  readonly openrouterModel?: string;
  readonly openrouterBaseUrl?: string;
  readonly ollamaEndpoint?: string;
  readonly ollamaModel?: string;
  readonly temperature?: number;
}

export interface LlmConfigUpdateDto extends LlmConfigDto {
  readonly openrouterApiKey?: string;
}

export async function getLlmConfig(): Promise<LlmConfigDto> {
  return getTransport().get<LlmConfigDto>('/api/v1/llm/config');
}

export async function updateLlmConfig(
  config: LlmConfigUpdateDto,
): Promise<{ ok: boolean; providerMode: string }> {
  return getTransport().send('/api/v1/llm/config', config as unknown as Record<string, unknown>);
}

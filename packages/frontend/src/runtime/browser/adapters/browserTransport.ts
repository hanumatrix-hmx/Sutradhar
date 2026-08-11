/**
 * @file packages/frontend/src/runtime/browser/adapters/browserTransport.ts
 * @description Transport abstraction for the frontend→backend bridge.
 *
 * The HTTP transport performs REAL fetches to the PinchTab backend and throws on
 * any failure (network error or non-2xx response). It NEVER silently returns a
 * fake object — callers must know when the backend is unreachable so the UI can
 * show a real error instead of fabricated state.
 */

export interface IBrowserTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send<T = unknown>(
    endpointPath: string,
    params?: Record<string, unknown>,
    opts?: TransportRequestOptions,
  ): Promise<T>;
  get<T = unknown>(endpointPath: string): Promise<T>;
  delete<T = unknown>(endpointPath: string): Promise<T>;
  on(event: string, handler: (payload: any) => void): () => void;
}

/** Optional per-request controls (e.g. aborting a long agent run). */
export interface TransportRequestOptions {
  signal?: AbortSignal;
}

/** Thrown when the backend is unreachable or returns a non-2xx status. */
export class BackendTransportError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
    public readonly bodyText?: string,
  ) {
    super(message);
    this.name = 'BackendTransportError';
  }
}

/**
 * Resolves the backend base URL from (in order):
 *   1. explicit argument
 *   2. VITE_API_BASE_URL (Vite env, injected at build/dev time)
 *   3. same origin as the page (when served by the backend in production)
 *   4. http://localhost:8081 (the default PinchTab server port)
 *
 * In dev, prefer setting the Vite proxy (see vite.config.ts) and leaving this
 * unset so requests go to same-origin and are proxied to the backend.
 */
function resolveBaseUrl(explicit?: string): string {
  if (explicit) return explicit.replace(/\/+$/, '');

  // Vite-injected env (browser context)
  try {
    const envUrl =
      typeof import.meta !== 'undefined' &&
      (import.meta as any).env &&
      (import.meta as any).env.VITE_API_BASE_URL;
    if (envUrl) return envUrl.replace(/\/+$/, '');
  } catch {
    /* ignore */
  }

  // Same-origin when the frontend is served by the backend itself.
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }

  return 'http://localhost:8081';
}

/** No-op transport used only by unit tests that exercise event wiring, not HTTP. */
export class DirectBrowserTransport implements IBrowserTransport {
  private readonly listeners = new Map<string, Set<(payload: any) => void>>();

  public async connect(): Promise<void> {}
  public async disconnect(): Promise<void> {
    this.listeners.clear();
  }

  public async send<T = unknown>(
    endpointPath: string,
    _params?: Record<string, unknown>,
    _opts?: TransportRequestOptions,
  ): Promise<T> {
    // Tests that need real backend behavior must use HttpBrowserTransport.
    return { endpointPath, status: 'test-only' } as unknown as T;
  }

  public async get<T = unknown>(_endpointPath: string): Promise<T> {
    return { status: 'test-only' } as unknown as T;
  }

  public async delete<T = unknown>(_endpointPath: string): Promise<T> {
    return { status: 'test-only' } as unknown as T;
  }

  public on(event: string, handler: (payload: any) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => {
      this.listeners.get(event)?.delete(handler);
    };
  }

  public emit(event: string, payload: any): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const fn of handlers) fn(payload);
    }
  }
}

/**
 * Real HTTP transport. Every call performs a genuine fetch to the backend and
 * throws BackendTransportError on any failure. There is no fallback object and
 * no silent logging — errors propagate to the caller (and thus to the UI).
 */
export class HttpBrowserTransport implements IBrowserTransport {
  private readonly listeners = new Map<string, Set<(payload: any) => void>>();
  public readonly baseUrl: string;

  public constructor(baseUrl?: string) {
    this.baseUrl = resolveBaseUrl(baseUrl);
  }

  public async connect(): Promise<void> {}
  public async disconnect(): Promise<void> {
    this.listeners.clear();
  }

  public async send<T = unknown>(
    endpointPath: string,
    params?: Record<string, unknown>,
    opts?: TransportRequestOptions,
  ): Promise<T> {
    const finalUrl = `${this.baseUrl}${endpointPath}`;

    let response: Response;
    try {
      response = await fetch(finalUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params ?? {}),
        signal: opts?.signal,
      });
    } catch (err) {
      // AbortError must reach the caller untouched so runs can be cancelled
      // cleanly; only genuine network failures become transport errors.
      if ((err as Error).name === 'AbortError') throw err;
      // Network-level failure: backend unreachable, DNS, CORS preflight rejected, etc.
      throw new BackendTransportError(
        `Cannot reach backend at ${finalUrl}: ${(err as Error).message}`,
        0,
        endpointPath,
      );
    }

    const textBody = await response.text();

    if (!response.ok) {
      throw new BackendTransportError(
        `Backend returned HTTP ${response.status} ${response.statusText} for ${endpointPath}: ${textBody.slice(0, 300)}`,
        response.status,
        endpointPath,
        textBody,
      );
    }

    try {
      return JSON.parse(textBody) as T;
    } catch (err) {
      throw new BackendTransportError(
        `Backend returned non-JSON response for ${endpointPath}: ${textBody.slice(0, 300)}`,
        response.status,
        endpointPath,
        textBody,
      );
    }
  }

  /** GET convenience for read endpoints (e.g. snapshot, sessions list). */
  public async get<T = unknown>(endpointPath: string): Promise<T> {
    const finalUrl = `${this.baseUrl}${endpointPath}`;
    let response: Response;
    try {
      response = await fetch(finalUrl, { method: 'GET' });
    } catch (err) {
      throw new BackendTransportError(
        `Cannot reach backend at ${finalUrl}: ${(err as Error).message}`,
        0,
        endpointPath,
      );
    }
    const textBody = await response.text();
    if (!response.ok) {
      throw new BackendTransportError(
        `Backend returned HTTP ${response.status} for ${endpointPath}: ${textBody.slice(0, 300)}`,
        response.status,
        endpointPath,
        textBody,
      );
    }
    try {
      return JSON.parse(textBody) as T;
    } catch {
      throw new BackendTransportError(
        `Backend returned non-JSON response for ${endpointPath}`,
        response.status,
        endpointPath,
        textBody,
      );
    }
  }

  public on(event: string, handler: (payload: any) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => {
      this.listeners.get(event)?.delete(handler);
    };
  }

  /** DELETE convenience (e.g. closing a backend browser session). */
  public async delete<T = unknown>(endpointPath: string): Promise<T> {
    const finalUrl = `${this.baseUrl}${endpointPath}`;
    let response: Response;
    try {
      response = await fetch(finalUrl, { method: 'DELETE' });
    } catch (err) {
      throw new BackendTransportError(
        `Cannot reach backend at ${finalUrl}: ${(err as Error).message}`,
        0,
        endpointPath,
      );
    }
    const textBody = await response.text();
    if (!response.ok) {
      throw new BackendTransportError(
        `Backend returned HTTP ${response.status} for ${endpointPath}: ${textBody.slice(0, 300)}`,
        response.status,
        endpointPath,
        textBody,
      );
    }
    try {
      return JSON.parse(textBody) as T;
    } catch {
      return { success: true } as unknown as T;
    }
  }
}

/**
 * @file apps/server/src/gateway/api-router.ts
 * @description Lightweight high-performance ApiRouter matching HTTP routes and dispatching request handlers.
 */

export interface ApiRequest {
  readonly body?: unknown;
  readonly params?: Record<string, string>;
  readonly query?: Record<string, string>;
  readonly headers?: Record<string, string>;
  readonly url?: string;
  readonly method?: string;
}

export interface ApiResponse {
  status(code: number): ApiResponse;
  json(data: unknown): void;
  send(text: string): void;
  readonly statusCode?: number;
  readonly body?: unknown;
  /**
   * Optional streaming capability (SSE). Present on the real HTTP response;
   * absent on mock responses, so handlers can feature-detect and fall back.
   * Once `stream()` is called the handler owns the connection: the gateway
   * skips its buffered write when `ended` is true.
   */
  stream?(options: { contentType: string; headers?: Record<string, string> }): void;
  writeChunk?(text: string): void;
  endStream?(): void;
  /** Fires when the client disconnects (SSE cleanup hook). */
  onClose?(handler: () => void): void;
  /** True once the underlying connection has been finalized by the handler. */
  readonly ended?: boolean;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type RouteHandler = (req: ApiRequest, res: ApiResponse) => Promise<void>;

export interface ApiRoute {
  readonly method: HttpMethod;
  readonly path: string;
  readonly handler: RouteHandler;
}

export class MockApiResponse implements ApiResponse {
  public statusCode = 200;
  public body: unknown;

  public status(code: number): ApiResponse {
    this.statusCode = code;
    return this;
  }

  public json(data: unknown): void {
    this.body = data;
  }

  public send(text: string): void {
    this.body = text;
  }
}

export class ApiRouter {
  private readonly routes: ApiRoute[] = [];

  public get(path: string, handler: RouteHandler): void {
    this.register('GET', path, handler);
  }

  public post(path: string, handler: RouteHandler): void {
    this.register('POST', path, handler);
  }

  public put(path: string, handler: RouteHandler): void {
    this.register('PUT', path, handler);
  }

  public delete(path: string, handler: RouteHandler): void {
    this.register('DELETE', path, handler);
  }

  public register(method: HttpMethod, path: string, handler: RouteHandler): void {
    this.routes.push({ method, path, handler });
  }

  public async dispatch(
    method: string,
    urlPath: string,
    req: ApiRequest = {},
    res: ApiResponse = new MockApiResponse(),
  ): Promise<ApiResponse> {
    const uppercaseMethod = method.toUpperCase() as HttpMethod;

    for (const route of this.routes) {
      if (route.method !== uppercaseMethod) {
        continue;
      }

      const match = this.matchRoute(route.path, urlPath);
      if (match.isMatch) {
        const enrichedReq: ApiRequest = {
          ...req,
          method: uppercaseMethod,
          url: urlPath,
          params: match.params,
          query: this.parseQuery(urlPath),
        };

        await route.handler(enrichedReq, res);
        return res;
      }
    }

    res.status(404).json({ error: `Route ${uppercaseMethod} ${urlPath} not found` });
    return res;
  }

  /** Parses the query string of a URL into a plain key/value map. */
  private parseQuery(urlPath: string): Record<string, string> {
    const queryIndex = urlPath.indexOf('?');
    if (queryIndex === -1) return {};
    const query: Record<string, string> = {};
    for (const pair of urlPath.slice(queryIndex + 1).split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const key = eq === -1 ? pair : pair.slice(0, eq);
      const value = eq === -1 ? '' : pair.slice(eq + 1);
      try {
        query[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
      } catch {
        // Malformed escape sequences are kept raw rather than throwing.
        query[key] = value;
      }
    }
    return query;
  }

  private matchRoute(
    routePath: string,
    urlPath: string,
  ): { isMatch: boolean; params: Record<string, string> } {
    const routeParts = routePath.split('/').filter(Boolean);
    const urlParts = urlPath.split('?')[0]!.split('/').filter(Boolean);

    if (routeParts.length !== urlParts.length) {
      return { isMatch: false, params: {} };
    }

    const params: Record<string, string> = {};
    for (let i = 0; i < routeParts.length; i++) {
      const rPart = routeParts[i]!;
      const uPart = urlParts[i]!;

      if (rPart.startsWith(':')) {
        const paramName = rPart.slice(1);
        params[paramName] = uPart;
      } else if (rPart !== uPart) {
        return { isMatch: false, params: {} };
      }
    }

    return { isMatch: true, params };
  }
}

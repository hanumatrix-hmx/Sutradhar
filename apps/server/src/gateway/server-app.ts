/**
 * @file apps/server/src/gateway/server-app.ts
 * @description ServerApp class managing real HTTP server lifecycle, CORS preflight, health check route, and router integration.
 */

import * as http from 'node:http';
import { StructuredLogger } from '@sutradhar/observability';
import { ServerOptions, DEFAULT_SERVER_OPTIONS } from './server-options.js';
import { ApiRouter, ApiRequest, ApiResponse, MockApiResponse } from './api-router.js';
import { registerConsoleRoute } from './static-handler.js';

/**
 * Real HTTP response adapter. Buffers json()/send() like the mock variant,
 * but additionally supports streaming responses (SSE): once `stream()` is
 * called the route handler owns the connection and `ended` flips to true,
 * so the gateway skips its buffered write.
 */
class NodeHttpResponse implements ApiResponse {
  public statusCode = 200;
  public body: unknown;
  /** Gateway handoff flag: once true, the buffered write is skipped.
   *  Flips at stream() time — the handler owns the connection from there. */
  public ended = false;
  private streaming = false;
  /** Socket-level flag: the response body has been fully sent. */
  private finished = false;

  public constructor(private readonly nodeRes: http.ServerResponse) {}

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

  public stream(options: { contentType: string; headers?: Record<string, string> }): void {
    this.streaming = true;
    // The handler owns the connection from here: mark it ended up front so
    // the gateway's buffered write never touches an already-headed response
    // (an ERR_HTTP_HEADERS_SENT here would crash the whole process).
    this.ended = true;
    this.nodeRes.writeHead(this.statusCode, {
      'Content-Type': options.contentType,
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...(options.headers ?? {}),
    });
  }

  public writeChunk(text: string): void {
    if (this.streaming && !this.finished) {
      this.nodeRes.write(text);
    }
  }

  public endStream(): void {
    if (!this.finished) {
      this.finished = true;
      this.nodeRes.end();
    }
  }

  public onClose(handler: () => void): void {
    this.nodeRes.on('close', handler);
  }
}

export class ServerApp {
  public port: number;
  public readonly host: string;
  public readonly router: ApiRouter;
  private isRunning = false;
  private httpServer: http.Server | null = null;
  private readonly logger: StructuredLogger;

  public constructor(options: ServerOptions = {}) {
    this.port = options.port ?? DEFAULT_SERVER_OPTIONS.port;
    this.host = options.host ?? DEFAULT_SERVER_OPTIONS.host;
    this.logger = options.logger ?? new StructuredLogger({ minLevel: 'info' });
    this.router = new ApiRouter();

    // Register system health check and developer console endpoints
    this.registerHealthCheck();
    registerConsoleRoute(this.router);
  }

  public get isServerRunning(): boolean {
    return this.isRunning;
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    const createHttpServer = () =>
      http.createServer(async (nodeReq, nodeRes) => {
        // Set CORS headers for all incoming frontend client requests
        nodeRes.setHeader('Access-Control-Allow-Origin', '*');
        nodeRes.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        nodeRes.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        // Handle CORS OPTIONS preflight
        if (nodeReq.method === 'OPTIONS') {
          nodeRes.statusCode = 204;
          nodeRes.end();
          return;
        }

        // Read request body
        const chunks: Buffer[] = [];
        nodeReq.on('data', (chunk) => chunks.push(chunk));
        nodeReq.on('end', async () => {
          let body: unknown = undefined;
          if (chunks.length > 0) {
            try {
              body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            } catch {
              // Body is plain text or raw
            }
          }

          const apiReq: ApiRequest = {
            body,
            url: nodeReq.url,
            method: nodeReq.method,
            headers: nodeReq.headers as Record<string, string>,
          };

          const apiRes = new NodeHttpResponse(nodeRes);
          await this.router.dispatch(nodeReq.method || 'GET', nodeReq.url || '/', apiReq, apiRes);

          // Streaming handlers (SSE) own the connection end-to-end — the
          // gateway must not write a buffered body on top of their stream.
          if (apiRes.ended) {
            return;
          }

          nodeRes.statusCode = apiRes.statusCode;
          nodeRes.setHeader('Content-Type', 'application/json');
          nodeRes.end(
            typeof apiRes.body === 'string' ? apiRes.body : JSON.stringify(apiRes.body),
          );
        });
      });

    return new Promise((resolve, reject) => {
      this.httpServer = createHttpServer();

      this.httpServer.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          // If preferred port is occupied (e.g. parallel Vitest workers), bind to any available port
          this.httpServer = createHttpServer();
          this.httpServer.listen(0, this.host, () => {
            this.isRunning = true;
            const addr = this.httpServer!.address();
            if (typeof addr === 'object' && addr?.port) {
              this.port = addr.port;
            }
            this.logger.info(
              `[ServerApp] Sutradhar REST API Gateway running on fallback port http://${this.host}:${this.port}`,
            );
            resolve();
          });
          return;
        }

        this.logger.error('[ServerApp] Failed to start HTTP server', { error: err.message });
        reject(err);
      });

      this.httpServer.listen(this.port, this.host, () => {
        this.isRunning = true;
        this.logger.info(
          `[ServerApp] Sutradhar REST API Gateway running at http://${this.host}:${this.port}`,
        );
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.isRunning || !this.httpServer) {
      return;
    }

    return new Promise((resolve) => {
      this.httpServer!.close(() => {
        this.isRunning = false;
        this.logger.info('[ServerApp] Sutradhar REST API Gateway stopped');
        resolve();
      });
    });
  }

  public async handleRequest(
    method: string,
    urlPath: string,
    req: ApiRequest = {},
    res: ApiResponse = new MockApiResponse(),
  ): Promise<ApiResponse> {
    return this.router.dispatch(method, urlPath, req, res);
  }

  private registerHealthCheck(): void {
    this.router.get('/health', async (_req, res) => {
      res.status(200).json({
        status: 'ok',
        service: '@sutradhar/server',
        version: '0.1.0',
        timestamp: new Date().toISOString(),
      });
    });
  }
}

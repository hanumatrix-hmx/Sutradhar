/**
 * @file packages/mcp-server/src/index.ts
 * @description Package entry point for @sutradhar/mcp-server.
 *
 * Programmatic API: use {@link createSutradharServer} to build an McpServer and attach it
 * to any transport (stdio, SSE, HTTP). For the stdio CLI binary, run `node dist/cli.js`.
 */

export { MCP_SERVER_VERSION } from './version.js';

export { createSutradharServer } from './server.js';
export type { CreateServerOptions, SutradharServerHandle } from './server.js';
export { registerTools } from './tools.js';
export type { RegisterToolsOptions, AgentHandle } from './tools.js';

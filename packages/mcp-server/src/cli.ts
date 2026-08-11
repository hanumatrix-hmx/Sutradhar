#!/usr/bin/env node
/**
 * @file packages/mcp-server/src/cli.ts
 * @description stdio entry point for the Sutradhar MCP server. This is what an AI client
 * spawns when configured as:
 *
 *   { "mcpServers": { "sutradhar": { "command": "node", "args": ["dist/cli.js"] } } }
 *
 * or, once published: `"command": "npx", "args": ["-y", "@sutradhar/mcp-server"]`
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSutradharServer } from './server.js';

// Every tool handler already catches its own errors and returns an MCP `isError` result —
// an exception reaching this far means something escaped that (e.g. a dangling timer/promise
// from a background browser operation, unrelated to the tool call that's still in flight
// from the client's perspective). Log and keep the process alive rather than taking down the
// whole server — and therefore every other open browser session — over one stray error.
process.on('uncaughtException', (err) => {
  console.error('[sutradhar-mcp] uncaught exception (server staying alive):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[sutradhar-mcp] unhandled rejection (server staying alive):', reason);
});

async function main(): Promise<void> {
  const { server, runtime } = await createSutradharServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep the process alive; the transport owns the lifecycle now.

  // Without this, the process exiting (client disconnect, host shutdown) never releases what
  // the runtime holds: open Chrome sessions, the idle-reaper timer, EventBus subscriptions —
  // all previously only reachable via an explicit browser.shutdown_all tool call that an
  // exiting client has no chance to make.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    runtime
      .shutdownAll()
      .catch((err) => console.error(`[sutradhar-mcp] error during ${signal} shutdown:`, err))
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  // stdio: write errors to stderr so we never corrupt the JSON-RPC stdout channel.
  console.error('[sutradhar-mcp] fatal:', e);
  process.exit(1);
});

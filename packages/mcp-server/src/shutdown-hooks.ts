/**
 * @file packages/mcp-server/src/shutdown-hooks.ts
 * @description Wires up every trigger that should cleanly shut down the MCP server's runtime
 * (open Chrome sessions, the idle-reaper timer, EventBus subscriptions), split out of `cli.ts`
 * so it's independently testable with fake EventEmitters/timers. `@modelcontextprotocol/sdk`'s
 * `StdioServerTransport` only listens for stdin `data`/`error` — never `end`/`close` — so
 * without this, an MCP client that closes its write side (rather than sending SIGINT/SIGTERM)
 * leaves the process running forever with no way to release what it holds (FR2-03 spec §0.6).
 */

export interface ShutdownHookOptions {
  runtime: { shutdownAll(): Promise<void> };
  stdin: NodeJS.EventEmitter;
  proc: { on(ev: 'SIGINT' | 'SIGTERM', fn: () => void): unknown; exit(code: number): never };
  /** Default: `console.error` — NEVER stdout, which stdio MCP reserves for JSON-RPC. */
  log?: (msg: string, err?: unknown) => void;
  /** Forces `exit(1)` if `shutdownAll()` hasn't settled within this long. Default 10000ms. */
  deadlineMs?: number;
}

export interface ShutdownHooks {
  trigger(reason: string): void;
}

/** Installs the shutdown triggers: stdin `'end'` or `'close'`, `SIGINT`, `SIGTERM` — all behind
 *  one shared guard, so no matter which one fires first (or several fire in quick succession),
 *  `shutdownAll()` runs exactly once and `exit()` is called exactly once. `stdin 'error'` alone
 *  is deliberately NOT a trigger (a real disconnect also produces `end`/`close`; an `error`
 *  with no `end`/`close` is not proof the client is actually gone). */
export function installShutdownHooks(opts: ShutdownHookOptions): ShutdownHooks {
  const log = opts.log ?? console.error;
  const deadlineMs = opts.deadlineMs ?? 10_000;
  let triggered = false;
  let exited = false;

  const doExit = (code: number) => {
    if (exited) return;
    exited = true;
    opts.proc.exit(code);
  };

  const trigger = (reason: string) => {
    if (triggered) return;
    triggered = true;
    log(`[sutradhar-mcp] shutting down (${reason})`);

    const deadline = setTimeout(() => {
      log(`[sutradhar-mcp] shutdownAll did not settle within ${deadlineMs}ms — forcing exit(1)`);
      doExit(1);
    }, deadlineMs);
    if (typeof (deadline as unknown as { unref?: () => void }).unref === 'function') {
      (deadline as unknown as { unref: () => void }).unref();
    }

    opts.runtime
      .shutdownAll()
      .catch((err) => log(`[sutradhar-mcp] error during shutdown (${reason})`, err))
      .finally(() => {
        clearTimeout(deadline);
        doExit(0);
      });
  };

  opts.stdin.on('end', () => trigger('stdin-end'));
  opts.stdin.on('close', () => trigger('stdin-close'));
  opts.proc.on('SIGINT', () => trigger('SIGINT'));
  opts.proc.on('SIGTERM', () => trigger('SIGTERM'));

  return { trigger };
}

/**
 * @file packages/mcp-server/src/config-banner.ts
 * @description FR2-14: the startup lines the MCP server prints (to STDERR — stdout is JSON-RPC)
 * about which `.sutradhar.json` it loaded, or where the search stopped. The cwd an MCP host spawns
 * the server with is not always meaningful, so the effective file is always made visible.
 * Pure: no I/O.
 */
import type { ConfigDiscovery } from '@sutradhar/capability-runtime';

const PREFIX = '[sutradhar-mcp]';

const STOP_TEXT = { 'git-root': 'git root', home: 'home', 'filesystem-root': 'filesystem root' } as const;

/** One info line, then one `warning:` line per config warning (plus the accept warning, D12c). */
export function describeConfigDiscovery(d: ConfigDiscovery, cwd: string): string[] {
  if (d.status === 'none') {
    if (d.reason === 'disabled') return [`${PREFIX} config: disabled (SUTRADHAR_CONFIG=none)`];
    const stop = d.stoppedAt ? `, stopped at ${STOP_TEXT[d.stoppedAt]}${d.stopDir ? ` ${d.stopDir}` : ''}` : '';
    return [
      `${PREFIX} config: none found (searched upward from ${cwd}${stop}); set SUTRADHAR_CONFIG to an absolute path to load one explicitly`,
    ];
  }
  const c = d.config;
  const how = c.origin === 'discovered' ? `found by searching upward from ${cwd}` : 'SUTRADHAR_CONFIG';
  const lines = [`${PREFIX} config: loaded ${c.path} (${how})`];
  for (const w of c.warnings) lines.push(`${PREFIX} warning: ${w}`);
  if (c.origin === 'discovered' && c.values.dialog?.mode === 'accept') {
    lines.push(
      `${PREFIX} warning: ${c.path} sets dialog.mode "accept": native alert/confirm/prompt dialogs will be accepted automatically.`,
    );
  }
  return lines;
}

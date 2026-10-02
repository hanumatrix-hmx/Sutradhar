/**
 * @file packages/mcp-server/src/startup-config.ts
 * @description FR2-14: the `sutradhar-mcp` entry point's project-config step, as a function so it
 * can be unit-tested (cli.ts runs `main()` on import). `SUTRADHAR_CONFIG=none` never touches the
 * filesystem; an absolute path loads that file explicitly (trusted like an env var); otherwise the
 * file is searched upward from `cwd`. Any failure rejects with a `ProjectConfigError` — the entry
 * point turns that into `[sutradhar-mcp] fatal:` + exit 1 before the server starts.
 */
import { loadProjectConfig, readConfigEnv, type ConfigDiscovery } from '@sutradhar/capability-runtime';
import { describeConfigDiscovery } from './config-banner.js';

export async function loadStartupConfig(i: {
  env: Record<string, string | undefined>;
  cwd: string;
  load?: typeof loadProjectConfig;
}): Promise<{ discovery: ConfigDiscovery; lines: string[] }> {
  const load = i.load ?? loadProjectConfig;
  const env = readConfigEnv(i.env);
  const discovery: ConfigDiscovery =
    env.kind === 'disabled'
      ? { status: 'none', reason: 'disabled', searched: [] }
      : await load({
          cwd: i.cwd,
          discover: env.kind === 'unset',
          explicitPath: env.kind === 'path' ? env.path : undefined,
          explicitOrigin: 'env',
        });
  return { discovery, lines: describeConfigDiscovery(discovery, i.cwd) };
}

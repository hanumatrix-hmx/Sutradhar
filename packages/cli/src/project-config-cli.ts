/**
 * @file packages/cli/src/project-config-cli.ts
 * @description FR2-14: pure (no I/O) CLI-side project-config logic. cli.ts runs `main()` on import,
 * so everything testable lives here: the one function that resolves every setting the CLI reads
 * from flag / persisted flag state / env / `.sutradhar.json` / default ({@link resolveCliSettings}),
 * the dialog mapping for config values the CLI cannot honor, the trust notice for a discovered file,
 * and the `doctor` lines.
 *
 * Precedence (§4.6, decided): CLI flag > env var > config file > default. "Persisted state" holds
 * only values that CAME FROM A FLAG on an earlier command (D10), so it ranks directly below a flag
 * on the current command and above everything else; nothing from a config file is ever written to
 * state.json.
 */
import {
  resolveAllowedDomains,
  resolveFsRoots,
  fsRootsConfigLayer,
  resolveViewport,
  type LoadedProjectConfig,
  type ConfigDiscovery,
  type ProjectConfigError,
  type Resolved,
  type ResolvedFsRoots,
  type ValueSource,
} from '@sutradhar/capability-runtime';
import { resolveDialogPolicyDetailed, type ResolvedDialogPolicy, type DialogPolicyMode } from './dialog-cli.js';
import type { CliState } from './state.js';

/** Maps the config file's `dialog` onto what the CLI can do: `auto` (a timer that dies with each
 *  CLI process) becomes `report`, with a warning. */
export function cliDialogFromConfig(cfg: LoadedProjectConfig | undefined): {
  policy: { mode: DialogPolicyMode; promptText?: string } | undefined;
  warnings: string[];
} {
  const d = cfg?.values.dialog;
  if (!cfg || !d) return { policy: undefined, warnings: [] };
  if (d.mode === 'auto') {
    return {
      policy: { mode: 'report' },
      warnings: [`${cfg.path}: dialog.mode "auto" is not supported by the CLI (each command is a separate process); using "report"`],
    };
  }
  return { policy: d.promptText !== undefined ? { mode: d.mode, promptText: d.promptText } : { mode: d.mode }, warnings: [] };
}

export interface CliSettingsInput {
  flags: {
    allowlistDomains?: readonly string[];
    viewport?: { width: number; height: number };
    dialog?: 'accept' | 'dismiss' | 'report';
    dialogText?: string;
  };
  env: Record<string, string | undefined>;
  state?: Pick<CliState, 'viewport' | 'dialogPolicy'>;
  config?: LoadedProjectConfig;
  /** `sutradhar download <ref> <dir>`: a directory the user granted explicitly on THIS command line.
   *  It is a flag-level layer, so it replaces a discovered file's refused download roots too (F1). */
  extraDownloadRoots?: readonly string[];
  platform?: NodeJS.Platform;
  homedir?: string;
}

export interface CliSettings {
  allowedDomains: Resolved<readonly string[] | undefined>;
  /** Throws (fail closed) on a malformed SUTRADHAR_ALLOWED_*_ROOTS. */
  fsRoots: ResolvedFsRoots;
  viewport: Resolved<{ width: number; height: number } | undefined>;
  dialog: ResolvedDialogPolicy & { source: 'flag' | 'state' | 'config' | 'default' };
  warnings: string[];
}

/** The single place the CLI resolves a setting that a project config can supply. */
export function resolveCliSettings(i: CliSettingsInput): CliSettings {
  const fromCfg = cliDialogFromConfig(i.config);
  return {
    allowedDomains: resolveAllowedDomains({ flag: i.flags.allowlistDomains, env: i.env, config: i.config }),
    fsRoots: resolveFsRoots({
      env: i.env,
      config: fsRootsConfigLayer(
        i.config && i.extraDownloadRoots?.length && i.config.downloadRefusal !== undefined
          ? { ...i.config, resolved: { ...i.config.resolved, allowedDownloadRoots: undefined }, downloadRefusal: undefined }
          : i.config,
      ),
      platform: i.platform,
      homedir: i.homedir,
    }),
    viewport: resolveViewport({ flag: i.flags.viewport, state: i.state?.viewport, config: i.config }),
    dialog: resolveDialogPolicyDetailed(i.flags.dialog, i.flags.dialogText, i.state, fromCfg.policy),
    warnings: fromCfg.warnings,
  };
}

/**
 * D12c: a DISCOVERED file that is actually supplying the download destination, or an auto-accept
 * dialog policy, is announced on stderr on every command (an agent that `cd`s into a cloned repo
 * must not have those changed silently). `undefined` = nothing to say.
 */
export function cliTrustNotice(
  cfg: LoadedProjectConfig | undefined,
  s: { downloadSource: string; dialogSource: string; dialogMode: string },
): string | undefined {
  if (!cfg || cfg.origin !== 'discovered') return undefined;
  const parts: string[] = [];
  if (s.downloadSource === 'config') parts.push('downloadDir/allowedDownloadRoots');
  if (s.dialogSource === 'config' && s.dialogMode === 'accept') parts.push('dialog.mode "accept"');
  if (parts.length === 0) return undefined;
  return `Note: using ${parts.join(', ')} from project config ${cfg.path}. Set SUTRADHAR_CONFIG=none to ignore it.`;
}

export interface DoctorSources {
  allowedDomains: string;
  downloadRoots: string;
  uploadRoots: string;
  dialog: string;
  viewport: string;
}

const STOP_TEXT = { 'git-root': 'git root', home: 'home', 'filesystem-root': 'filesystem root' } as const;
const LABEL = (s: string): string => s.padEnd(17, ' ');

/** The `Config:` / `Config warning:` / `Config sources:` lines of `sutradhar doctor`. Echoes no
 *  value from the file, only its path, the keys' sources and the loader's own messages. */
export function formatDoctorConfigLines(i: {
  discovery?: ConfigDiscovery;
  error?: ProjectConfigError | Error;
  cwd: string;
  sources?: DoctorSources;
}): string[] {
  if (i.error) return [`${LABEL('Config:')}INVALID: ${i.error.message}`];
  const d = i.discovery!;
  const lines: string[] = [];
  if (d.status === 'loaded') {
    lines.push(`${LABEL('Config:')}${d.config.path} (${d.config.origin === 'discovered' ? 'discovered' : 'SUTRADHAR_CONFIG'})`);
    for (const w of d.config.warnings) lines.push(`${LABEL('Config warning:')}${w}`);
  } else if (d.reason === 'disabled') {
    lines.push(`${LABEL('Config:')}disabled (SUTRADHAR_CONFIG=none)`);
  } else {
    const stop = d.stoppedAt ? `; stopped at ${STOP_TEXT[d.stoppedAt]}${d.stopDir ? ` ${d.stopDir}` : ''}` : '';
    lines.push(`${LABEL('Config:')}none (searched ${d.searched.length} directories upward from ${i.cwd}${stop})`);
  }
  if (i.sources) {
    const s = i.sources;
    lines.push(
      `${LABEL('Config sources:')}allowedDomains=${s.allowedDomains}, downloadRoots=${s.downloadRoots}, uploadRoots=${s.uploadRoots}, dialog=${s.dialog}, viewport=${s.viewport}`,
    );
  }
  return lines;
}

/** Source label for the `Config sources:` line. */
export function sourceLabel(source: ValueSource | 'unrestricted'): string {
  return source;
}

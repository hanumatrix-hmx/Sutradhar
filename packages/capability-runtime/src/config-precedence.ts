/**
 * @file packages/capability-runtime/src/config-precedence.ts
 * @description FR2-14: the ONE precedence rule for every setting a project config can supply:
 * CLI flag > env var > config file > built-in default (§4.6). It is a single shape-free function
 * ({@link firstDefined}); every per-key resolver below is only a list of layers handed to it, so
 * there is no per-key precedence logic to get wrong. First defined layer wins, whole value, never
 * merged (D9). An empty array, `null` and `undefined` count as absent (FR2-05 R9; FR2-14 fix-1 F2);
 * `0`, `''` and `false` are values.
 *
 * A config file is always the LOWEST layer above the default, so it can never override anything a
 * caller set explicitly with a flag, an option or an env var.
 */
import type { DialogPolicy } from '@sutradhar/browser';
import type { LoadedProjectConfig } from './project-config.js';
import { isLayerSet } from './layer-set.js';

export type ValueSource = 'flag' | 'state' | 'option' | 'env' | 'config' | 'default';
export interface Resolved<T> {
  value: T;
  source: ValueSource;
}

export const ALLOWED_DOMAINS_ENV = 'SUTRADHAR_ALLOWED_DOMAINS';
export const IDLE_TIMEOUT_ENV = 'SUTRADHAR_IDLE_TIMEOUT_MS';

/**
 * Returns the first layer whose value is set (not `undefined`/`null`; for arrays, non-empty), otherwise
 * `fallback`. The value is returned as-is (same reference): never merged with another layer.
 */
export function firstDefined<T>(
  layers: ReadonlyArray<readonly [ValueSource, T | undefined]>,
  fallback: Resolved<T>,
): Resolved<T> {
  for (const [source, value] of layers) {
    // What "set" means is defined ONCE (layer-set.ts): not undefined/null, and a list is non-empty;
    // a typed `0`, `''` or `false` is still a value that wins.
    if (!isLayerSet(value)) continue;
    return { value, source };
  }
  return fallback;
}

/** Comma/trim/filter; an empty or all-blank value is `undefined` (unset). */
export function parseDomainsEnv(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const list = raw
    .split(',')
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
  return list.length > 0 ? list : undefined;
}

/**
 * `SUTRADHAR_IDLE_TIMEOUT_MS`: unset/'' -> `undefined`; otherwise it must be digits only and be 0
 * (never close idle sessions) or 1000..2147483647. Anything else THROWS — it used to become `NaN`
 * and silently disable the reaper, leaking Chrome (C2).
 */
export function parseIdleTimeoutMs(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n === 0 || (n >= 1000 && n <= 2147483647)) return n;
  }
  throw new Error(
    `${name} must be 0 (never close idle sessions) or an integer between 1000 and 2147483647 (milliseconds); got "${raw.length > 40 ? raw.slice(0, 40) + '...' : raw}"`,
  );
}

export function resolveAllowedDomains(i: {
  flag?: readonly string[];
  option?: readonly string[];
  env?: Record<string, string | undefined>;
  config?: LoadedProjectConfig;
}): Resolved<readonly string[] | undefined> {
  return firstDefined<readonly string[] | undefined>(
    [
      ['flag', i.flag],
      ['option', i.option],
      ['env', i.env ? parseDomainsEnv(i.env[ALLOWED_DOMAINS_ENV]) : undefined],
      ['config', i.config?.values.allowedDomains],
    ],
    { value: undefined, source: 'default' },
  );
}

/**
 * option > env > config > fallback. A value of 0 (or, for the programmatic option, anything <= 0)
 * means "disabled" and resolves to `undefined` while keeping the layer that said so. The env var
 * is parsed (and a bad value throws) even when a higher layer would win: a typo is reported, not
 * hidden behind an option.
 */
export function resolveIdleTimeoutMs(i: {
  option?: number;
  env?: Record<string, string | undefined>;
  config?: LoadedProjectConfig;
  fallback: number | undefined;
}): Resolved<number | undefined> {
  if (i.option !== undefined && i.option !== null && !Number.isFinite(i.option)) {
    throw new TypeError(`idleTimeoutMs must be a finite number of milliseconds (0 disables); got ${String(i.option)}`);
  }
  const envValue = i.env ? parseIdleTimeoutMs(IDLE_TIMEOUT_ENV, i.env[IDLE_TIMEOUT_ENV]) : undefined;
  const r = firstDefined<number | undefined>(
    [
      ['option', i.option],
      ['env', envValue],
      ['config', i.config?.values.idleTimeoutMs],
    ],
    { value: i.fallback, source: 'default' },
  );
  const v = r.value;
  return { value: v !== undefined && v <= 0 ? undefined : v, source: r.source };
}

/** The largest width/height Chrome's `Emulation.setDeviceMetricsOverride` accepts. */
export const VIEWPORT_MAX = 10_000_000;

const isViewport = (v: unknown): v is { width: number; height: number } =>
  typeof v === 'object' &&
  v !== null &&
  Number.isInteger((v as { width?: unknown }).width) &&
  Number.isInteger((v as { height?: unknown }).height) &&
  (v as { width: number }).width >= 1 &&
  (v as { height: number }).height >= 1 &&
  (v as { width: number }).width <= VIEWPORT_MAX &&
  (v as { height: number }).height <= VIEWPORT_MAX;

/**
 * flag > state > option > config > default, whole object from ONE layer (never a width from one
 * layer and a height from another). A malformed layer (e.g. a hand-edited state file) is treated
 * as absent rather than trusted.
 */
export function resolveViewport(i: {
  flag?: { width: number; height: number };
  state?: { width: number; height: number };
  option?: { width: number; height: number };
  config?: LoadedProjectConfig;
}): Resolved<{ width: number; height: number } | undefined> {
  const ok = <T>(v: T | undefined): T | undefined => (v !== undefined && isViewport(v) ? v : undefined);
  return firstDefined<{ width: number; height: number } | undefined>(
    [
      ['flag', ok(i.flag)],
      ['state', ok(i.state)],
      ['option', ok(i.option)],
      ['config', ok(i.config?.values.viewport)],
    ],
    { value: undefined, source: 'default' },
  );
}

/**
 * The runtime-level (MCP/SDK) dialog policy: option > config > undefined (the runtime's own
 * default, `auto`). MCP honors all four modes. The SDK has no dialog-handling API, so `report`
 * would leave `page.evaluate` waiting forever on an open alert (P2): a config `report` maps to
 * `auto` with a warning, and an explicit option `report` throws.
 */
export function resolveRuntimeDialogPolicy(i: {
  option?: DialogPolicy;
  config?: LoadedProjectConfig;
  surface: 'mcp' | 'sdk';
}): { value: DialogPolicy | undefined; source: ValueSource; warnings: string[] } {
  const warnings: string[] = [];
  if (i.surface === 'sdk' && i.option?.mode === 'report') {
    throw new TypeError(
      'launch(): dialogPolicy mode "report" is not supported by the SDK (there is no way to handle a pending dialog from a Page yet); use "auto", "accept" or "dismiss"',
    );
  }
  const r = firstDefined<DialogPolicy | undefined>(
    [
      ['option', i.option],
      ['config', i.config?.values.dialog],
    ],
    { value: undefined, source: 'default' },
  );
  if (r.source === 'config' && i.surface === 'sdk' && r.value?.mode === 'report') {
    warnings.push(
      `${i.config!.path}: dialog.mode "report" is not supported by the SDK (it has no way to handle a pending dialog); using "auto"`,
    );
    return { value: { mode: 'auto' }, source: 'config', warnings };
  }
  return { value: r.value, source: r.source, warnings };
}

/**
 * The config layer handed to `resolveFsRoots`, built in ONE place so no surface can forget the
 * discovered-file refusal (`downloadRefusal`, raised by the resolver only when this layer would
 * actually supply the download roots).
 */
export function fsRootsConfigLayer(
  cfg: LoadedProjectConfig | null | undefined,
): { allowedDownloadRoots?: string[]; allowedUploadRoots?: string[]; baseDir: string; downloadRefusal?: string } | undefined {
  if (!cfg) return undefined;
  return { ...cfg.resolved, baseDir: cfg.baseDir, ...(cfg.downloadRefusal !== undefined ? { downloadRefusal: cfg.downloadRefusal } : {}) };
}

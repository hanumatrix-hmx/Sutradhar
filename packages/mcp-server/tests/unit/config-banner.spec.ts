/**
 * @file packages/mcp-server/tests/unit/config-banner.spec.ts
 * @description FR2-14: the MCP startup lines about which `.sutradhar.json` was (not) loaded, and
 * the startup loader glue (SUTRADHAR_CONFIG handling). stderr only, never stdout (JSON-RPC).
 */
import os from 'node:os';
import path from 'node:path';
import { ProjectConfigError, type ConfigDiscovery, type LoadedProjectConfig, type ProjectConfigFile } from '@sutradhar/capability-runtime';
import { describeConfigDiscovery } from '../../src/config-banner.js';
import { loadStartupConfig } from '../../src/startup-config.js';

const CWD = path.join(os.tmpdir(), 'proj', 'sub');
const FILE = path.join(os.tmpdir(), 'proj', '.sutradhar.json');
function loaded(origin: 'discovered' | 'env', values: ProjectConfigFile = {}, warnings: string[] = []): ConfigDiscovery {
  const config: LoadedProjectConfig = { path: FILE, baseDir: path.dirname(FILE), origin, values, resolved: {}, warnings };
  return { status: 'loaded', config, searched: [] };
}

describe('describeConfigDiscovery', () => {
  it('CB1: loaded by discovery', () => {
    expect(describeConfigDiscovery(loaded('discovered'), CWD)).toEqual([`[sutradhar-mcp] config: loaded ${FILE} (found by searching upward from ${CWD})`]);
  });
  it('CB2: loaded via SUTRADHAR_CONFIG', () => {
    expect(describeConfigDiscovery(loaded('env'), CWD)).toEqual([`[sutradhar-mcp] config: loaded ${FILE} (SUTRADHAR_CONFIG)`]);
  });
  it('CB3: none found names where the search stopped, and how to load one explicitly', () => {
    const d: ConfigDiscovery = { status: 'none', reason: 'not-found', searched: [], stoppedAt: 'git-root', stopDir: '/p' };
    expect(describeConfigDiscovery(d, CWD)).toEqual([
      `[sutradhar-mcp] config: none found (searched upward from ${CWD}, stopped at git root /p); set SUTRADHAR_CONFIG to an absolute path to load one explicitly`,
    ]);
    const home: ConfigDiscovery = { status: 'none', reason: 'not-found', searched: [], stoppedAt: 'home', stopDir: '/h' };
    expect(describeConfigDiscovery(home, CWD)[0]).toContain('stopped at home /h');
    const root: ConfigDiscovery = { status: 'none', reason: 'not-found', searched: [], stoppedAt: 'filesystem-root' };
    expect(describeConfigDiscovery(root, CWD)[0]).toContain('stopped at filesystem root)');
  });
  it('CB4: disabled', () => {
    expect(describeConfigDiscovery({ status: 'none', reason: 'disabled', searched: [] }, CWD)).toEqual(['[sutradhar-mcp] config: disabled (SUTRADHAR_CONFIG=none)']);
  });
  it('CB5: a discovered config with dialog.mode accept adds the loud warning; an explicit one, or dismiss, does not', () => {
    const lines = describeConfigDiscovery(loaded('discovered', { dialog: { mode: 'accept' } }), CWD);
    expect(lines[1]).toBe(`[sutradhar-mcp] warning: ${FILE} sets dialog.mode "accept": native alert/confirm/prompt dialogs will be accepted automatically.`);
    expect(describeConfigDiscovery(loaded('env', { dialog: { mode: 'accept' } }), CWD)).toHaveLength(1);
    expect(describeConfigDiscovery(loaded('discovered', { dialog: { mode: 'dismiss' } }), CWD)).toHaveLength(1);
  });
  it('CB6: config warnings are prefixed', () => {
    const lines = describeConfigDiscovery(loaded('discovered', {}, ['w1', 'w2']), CWD);
    expect(lines.slice(1)).toEqual(['[sutradhar-mcp] warning: w1', '[sutradhar-mcp] warning: w2']);
  });
  it('a secret-looking value in the file never appears in the banner', () => {
    const lines = describeConfigDiscovery(loaded('discovered', { dialog: { mode: 'accept', promptText: 'hunter2-SECRET' } }), CWD).join('\n');
    expect(lines).not.toContain('hunter2-SECRET');
  });
});

describe('loadStartupConfig (SUTRADHAR_CONFIG glue)', () => {
  const discovered = loaded('discovered');
  it('SC-a: unset -> discovers from cwd', async () => {
    const load = vi.fn().mockResolvedValue(discovered);
    const r = await loadStartupConfig({ env: {}, cwd: CWD, load });
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ cwd: CWD, discover: true, explicitPath: undefined }));
    expect(r.discovery).toBe(discovered);
    expect(r.lines[0]).toContain('found by searching upward');
  });
  it('SC-b: none -> the loader is never called (no filesystem access at all)', async () => {
    const load = vi.fn();
    const r = await loadStartupConfig({ env: { SUTRADHAR_CONFIG: 'none' }, cwd: CWD, load });
    expect(load).not.toHaveBeenCalled();
    expect(r.discovery).toMatchObject({ status: 'none', reason: 'disabled' });
    expect(r.lines).toEqual(['[sutradhar-mcp] config: disabled (SUTRADHAR_CONFIG=none)']);
  });
  it('SC-c: an absolute path is loaded explicitly with origin env and no discovery', async () => {
    const load = vi.fn().mockResolvedValue(loaded('env'));
    const abs = path.join(os.tmpdir(), 'x.json');
    await loadStartupConfig({ env: { SUTRADHAR_CONFIG: abs }, cwd: CWD, load });
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ discover: false, explicitPath: abs, explicitOrigin: 'env' }));
  });
  it('SC-d: a relative SUTRADHAR_CONFIG and a loader failure both reject with a ProjectConfigError (the entry point exits 1)', async () => {
    await expect(loadStartupConfig({ env: { SUTRADHAR_CONFIG: 'rel.json' }, cwd: CWD, load: vi.fn() })).rejects.toBeInstanceOf(ProjectConfigError);
    const load = vi.fn().mockRejectedValue(new ProjectConfigError(FILE, 'Invalid project config x: nope'));
    await expect(loadStartupConfig({ env: {}, cwd: CWD, load })).rejects.toThrow('Invalid project config x: nope');
  });
});

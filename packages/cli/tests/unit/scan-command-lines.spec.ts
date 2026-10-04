/**
 * @file packages/cli/tests/unit/scan-command-lines.spec.ts
 * @description S6d (0.6.1): the process scan behind rule 2. On Linux it reads `/proc/<pid>/cmdline`
 * (no procps/`ps` dependency, no argv truncation); on macOS it runs `ps -A -ww -o args=`; on Windows
 * a CIM query. An unreadable source is `null` (fail closed: the dir is kept). Everything goes through
 * the injectable `deps` seam, so these tests run on every OS without a real `/proc` or `ps`.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { psBin } from '../../src/system-binaries.js';
import {
  commandLinesReference,
  readProcCommandLines,
  removeSessionTempProfile,
  scanCommandLines,
  type ScanDeps,
} from '../../src/temp-profile.js';

const PREFIXED = 'node /x/chrome --user-data-dir=/tmp/sutradhar-cli-1790000000111-AbC123 --type=renderer';
const OTHER = '/usr/sbin/cron -f';

/** A `run` that must never be called (proves the Linux path does not depend on `ps`). */
const runMustNotBeCalled: NonNullable<ScanDeps['run']> = async () => {
  throw new Error('run (ps) must not be used on linux');
};

describe('scanCommandLines: Linux reads /proc (no ps)', () => {
  it('D1: returns only the lines that carry the prefix, from the injected /proc reader; `ps` is never run', async () => {
    const seen: number[] = [];
    const lines = await scanCommandLines(1234, {
      platform: 'linux',
      run: runMustNotBeCalled,
      readProc: async (ms) => {
        seen.push(ms);
        return [OTHER, PREFIXED, ''];
      },
    });
    expect(lines).toEqual([PREFIXED]);
    expect(seen).toEqual([1234]); // the (already clamped) timeout is passed through
  });

  it('D2: an unreadable /proc is null (fail closed), and a close with that scan keeps the dir (scan-unavailable)', async () => {
    const deps: ScanDeps = { platform: 'linux', run: runMustNotBeCalled, readProc: async () => null };
    expect(await scanCommandLines(1000, deps)).toBeNull();
    const root = mkdtempSync(path.join(os.tmpdir(), 'd2-'));
    try {
      const dir = path.join(root, 'sutradhar-cli-1790000000222-AbC123');
      mkdirSync(dir);
      const res = await removeSessionTempProfile(dir, undefined, { tmpRoot: root, scan: (ms) => scanCommandLines(ms, deps) });
      expect(res).toEqual({ removed: false, reason: 'scan-unavailable' });
      expect(existsSync(dir)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('D2b: a reader that matched nothing is [] (the query ran), distinct from null', async () => {
    expect(await scanCommandLines(1000, { platform: 'linux', readProc: async () => [OTHER] })).toEqual([]);
  });
});

describe('scanCommandLines: macOS / other POSIX use ps -ww', () => {
  it('D3: darwin runs the absolute ps with exactly -A -ww -o args= and the given timeout', async () => {
    const calls: Array<{ file: string; args: string[]; ms: number }> = [];
    const lines = await scanCommandLines(777, {
      platform: 'darwin',
      readProc: async () => {
        throw new Error('/proc must not be read on darwin');
      },
      run: async (file, args, ms) => {
        calls.push({ file, args, ms });
        return `${OTHER}\n${PREFIXED}\n`;
      },
    });
    expect(calls).toEqual([{ file: psBin(), args: ['-A', '-ww', '-o', 'args='], ms: 777 }]);
    expect(path.isAbsolute(psBin()) || psBin().startsWith('/')).toBe(true);
    expect(lines).toEqual([PREFIXED]);
  });

  it('D4: a failed ps (null output) is null', async () => {
    expect(await scanCommandLines(1000, { platform: 'darwin', run: async () => null })).toBeNull();
  });
});

describe('readProcCommandLines (the /proc reader)', () => {
  const ENOENT = Object.assign(new Error('gone'), { code: 'ENOENT' });
  const fsOf = (names: string[] | Error, cmdlines: Record<string, string | Error>) => ({
    readdir: async () => {
      if (names instanceof Error) throw names;
      return names;
    },
    readFile: async (p: string) => {
      const pid = p.split('/')[2] ?? '';
      const v = cmdlines[pid];
      if (v === undefined || v instanceof Error) throw v ?? ENOENT;
      return Buffer.from(v, 'utf8');
    },
  });

  it('D5: NUL separators become spaces, non-numeric entries are skipped, empty cmdlines (kernel threads) are dropped', async () => {
    const lines = await readProcCommandLines(5000, fsOf(['1', 'self', 'sys', '42', '77'], { '1': 'init\0--x\0', self: 'must-not-be-listed', sys: 'must-not-be-listed', '42': 'chrome\0--user-data-dir=/t/sutradhar-cli-1790000000333\0', '77': '' }));
    expect(lines).toEqual(['init --x', 'chrome --user-data-dir=/t/sutradhar-cli-1790000000333']);
  });

  it('D6: a process that exits between readdir and read is skipped, not an error', async () => {
    const lines = await readProcCommandLines(5000, fsOf(['1', '2'], { '1': 'a\0b', '2': ENOENT }));
    expect(lines).toEqual(['a b']);
  });

  it('D7: an unreadable /proc (readdir fails) is null', async () => {
    expect(await readProcCommandLines(5000, fsOf(Object.assign(new Error('no /proc'), { code: 'ENOENT' }), {}))).toBeNull();
  });

  it('D8: a /proc that lists processes but where NOTHING can be read is null, never []', async () => {
    expect(await readProcCommandLines(5000, fsOf(['1', '2'], {}))).toBeNull();
    expect(await readProcCommandLines(5000, fsOf([], {}))).toBeNull(); // empty dir: not a working /proc
  });

  it('D9: the deadline is honoured: a timeout of 0 is null', async () => {
    expect(await readProcCommandLines(0, fsOf(['1'], { '1': 'a' }))).toBeNull();
  });

  it('D9b: the deadline stops the scan EARLY (slow reads: null after a few, not after all of them)', async () => {
    const names = Array.from({ length: 40 }, (_, i) => String(i + 1));
    let reads = 0;
    const slow = {
      readdir: async () => names,
      readFile: async () => {
        reads++;
        await new Promise((r) => setTimeout(r, 25));
        return Buffer.from('p', 'utf8');
      },
    };
    expect(await readProcCommandLines(120, slow)).toBeNull();
    expect(reads).toBeLessThan(20);
  });

  it.skipIf(process.platform === 'linux')('D10: on a host without /proc the default reader is null (so a linux scan fails closed)', async () => {
    expect(await readProcCommandLines(5000)).toBeNull();
    expect(await scanCommandLines(5000, { platform: 'linux' })).toBeNull();
  });

  it.skipIf(process.platform !== 'linux')('D11 (Linux): the real /proc sees a child whose argv is longer than 4096 characters, untruncated', async () => {
    const marker = `sutradhar-cli-1790000000444-Pad${'x'.repeat(5000)}`;
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)', marker], { stdio: 'ignore' });
    try {
      const deadline = performance.now() + 10_000;
      let hit: string | undefined;
      while (performance.now() < deadline && !hit) {
        hit = (await scanCommandLines(5000))?.find((l) => l.includes(marker));
        if (!hit) await new Promise((r) => setTimeout(r, 100));
      }
      expect(hit).toBeDefined();
      expect(hit?.length ?? 0).toBeGreaterThan(5000);
    } finally {
      child.kill('SIGKILL');
    }
  });
});

// ---------------------------------------------------------------------------------------------
// S6e-2 (F2): the post-filter must be case-INSENSITIVE on every platform. WQL `LIKE` is
// case-insensitive, so a process that holds the dir as `SUTRADHAR-CLI-...` was returned by the query
// and then dropped by a case-sensitive `includes`, which let the dir be deleted (S4 audit A5).
// ---------------------------------------------------------------------------------------------
describe('S6e-2 (F2): case-insensitive scan post-filter', () => {
  const UPPER = '"C:\\Program Files\\Chrome\\chrome.exe" --user-data-dir=C:\\T\\SUTRADHAR-CLI-1790000000777-ABC123 --type=renderer';
  const LOWER = '"C:\\Program Files\\Chrome\\chrome.exe" --user-data-dir=C:\\T\\sutradhar-cli-1790000000778-def456';
  const NONE = 'C:\\Windows\\system32\\svchost.exe -k netsvcs';

  it('F2-a: raw CRLF output with an upper-case, a lower-case and an unrelated line keeps exactly the two prefixed lines', async () => {
    const raw = `${UPPER}\r\n${LOWER}\r\n${NONE}\r\n`;
    const lines = await scanCommandLines(1000, { platform: 'win32', run: async () => raw });
    expect(lines).toEqual([UPPER, LOWER]);
  });

  it('F2-b: a dir referenced only in UPPER case is in-use for close (the rule-2 scan sees it)', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'f2b-'));
    try {
      const dir = path.join(root, 'sutradhar-cli-1790000000777-ABC123');
      mkdirSync(dir);
      const scan = (ms?: number) => scanCommandLines(ms, { platform: 'win32', run: async () => `${UPPER}\r\n` });
      const res = await removeSessionTempProfile(dir, undefined, { tmpRoot: root, scan });
      expect(res).toEqual({ removed: false, reason: 'in-use' });
      expect(existsSync(dir)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('N4-b: the filter is only a SUBSTRING pre-filter: a line whose token merely contains the prefix is still returned; the word boundary lives in commandLinesReference', async () => {
    const longerToken = 'chrome --user-data-dir=/tmp/sutradhar-cli-1790000000999-ZZZextra --type=gpu-process';
    const embedded = 'launcher --label=mysutradhar-cli-1790000000999-ZZZ';
    const lines = await scanCommandLines(1000, { platform: 'linux', readProc: async () => [longerToken, embedded, NONE] });
    expect(lines).toEqual([longerToken, embedded]); // both pass the pre-filter (the unrelated line does not)
    // ... but the token matcher decides: `...-ZZZextra` is a different (longer) name than `...-ZZZ`, so it does not reference that dir.
    expect(commandLinesReference('/tmp/sutradhar-cli-1790000000999-ZZZ', [longerToken])).toBe(false);
    expect(commandLinesReference('/tmp/sutradhar-cli-1790000000999-ZZZextra', [longerToken])).toBe(true);
  });

  it('F2-c: the same filter applies to the Linux /proc reader and to macOS ps output', async () => {
    const upperPosix = 'node x --user-data-dir=/tmp/SUTRADHAR-CLI-1790000000999-ZZZ';
    expect(await scanCommandLines(1000, { platform: 'linux', readProc: async () => [upperPosix, NONE] })).toEqual([upperPosix]);
    expect(await scanCommandLines(1000, { platform: 'darwin', run: async () => `${upperPosix}\n${NONE}\n` })).toEqual([upperPosix]);
  });
});

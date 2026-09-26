/**
 * @file packages/cli/tests/unit/process-list.spec.ts
 * @description FR2-03 PL1-PL8: cross-platform process-list parsers, pure and injectable so
 * these never actually shell out.
 */
import { spawn } from 'node:child_process';
import {
  parseWindowsCommandLine,
  extractUserDataDir,
  isBrowserProcess,
  parseEtime,
  parsePsOutput,
  parseCimJson,
  listProcesses,
  isPidAlive,
} from '../../src/process-list.js';

describe('PL1: parseWindowsCommandLine', () => {
  it('splits a quoted command line, preserving the quoted --user-data-dir value', () => {
    const tokens = parseWindowsCommandLine(
      '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=1 ' +
        '"--user-data-dir=C:\\Users\\John Doe\\AppData\\Local\\Temp\\sutradhar-cli-1727000000000-AbC123" --no-first-run',
    );
    expect(tokens[2]).toBe('--user-data-dir=C:\\Users\\John Doe\\AppData\\Local\\Temp\\sutradhar-cli-1727000000000-AbC123');
  });
});

describe('PL2: extractUserDataDir', () => {
  it('handles a quoted value with spaces', () => {
    expect(extractUserDataDir('chrome.exe "--user-data-dir=C:\\a b\\c" --foo')).toBe('C:\\a b\\c');
  });
  it('handles an unquoted value', () => {
    expect(extractUserDataDir('chrome.exe --user-data-dir=/tmp/x --foo')).toBe('/tmp/x');
  });
  it('undefined when absent', () => {
    expect(extractUserDataDir('chrome.exe --foo')).toBeUndefined();
  });
  it('undefined when the value is empty', () => {
    expect(extractUserDataDir('chrome.exe --user-data-dir= --foo')).toBeUndefined();
  });
});

describe('PL3: isBrowserProcess', () => {
  it('false for a renderer', () => {
    expect(isBrowserProcess('chrome.exe --type=renderer')).toBe(false);
  });
  it('false for crashpad-handler', () => {
    expect(isBrowserProcess('chrome.exe --type=crashpad-handler')).toBe(false);
  });
  it('true with no --type', () => {
    expect(isBrowserProcess('chrome.exe --user-data-dir=/tmp/x')).toBe(true);
  });
});

describe('PL4: parseEtime', () => {
  it.each([
    ['05:03', 303],
    ['12:34:56', 45296],
    ['1-02:03:04', 93784],
  ])('%s -> %d seconds', (input, expected) => {
    expect(parseEtime(input)).toBe(expected);
  });
  it('undefined for garbage', () => {
    expect(parseEtime('x')).toBeUndefined();
  });
});

describe('PL5: parsePsOutput', () => {
  it('parses pid/ppid/startMs/command from a 3-line sample with leading spaces', () => {
    const now = 1_700_000_000_000;
    const sample = [
      '    1     0 01:00:00 /sbin/init',
      '  123     1 00:05:03 /usr/bin/chrome --user-data-dir=/tmp/x --flag with spaces',
      ' 9999   123 00:00:10 chrome --type=renderer',
    ].join('\n');
    const parsed = parsePsOutput(sample, now);
    expect(parsed).toHaveLength(3);
    expect(parsed[1]!.pid).toBe(123);
    expect(parsed[1]!.ppid).toBe(1);
    expect(parsed[1]!.commandLine).toBe('/usr/bin/chrome --user-data-dir=/tmp/x --flag with spaces');
    expect(Math.abs(parsed[1]!.startMs - (now - 303_000))).toBeLessThanOrEqual(1000);
  });
});

describe('PL6: parseCimJson', () => {
  it('single object (not array)', () => {
    expect(parseCimJson('{"p":1,"pp":0,"c":1700000000000,"a":null}')).toEqual([
      { pid: 1, ppid: 0, startMs: 1700000000000, commandLine: undefined },
    ]);
  });
  it('array', () => {
    expect(parseCimJson('[{"p":1,"pp":0,"c":1},{"p":2,"pp":1,"c":2,"a":"cmd"}]')).toHaveLength(2);
  });
  it('empty string gives []', () => {
    expect(parseCimJson('')).toEqual([]);
  });
});

describe('PL7: listProcesses never throws', () => {
  it('a runner that throws gives {ok:false, reason}', async () => {
    const result = await listProcesses(async () => {
      throw new Error('boom');
    });
    expect(result).toEqual({ ok: false, reason: 'boom' });
  });
  it('GAP-179/GAP-181: a runner returning unparsable garbage on win32 gives {ok:false}, never a ' +
    'silent ok:true empty list (spec §0.2 -- GC must treat this as enumeration-unavailable, not ' +
    'as "verified: nothing references any directory")', async () => {
    const result = await listProcesses(async () => ({ stdout: 'not json at all', code: 0 }), 'win32');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBeTruthy();
  });
  it('genuinely empty stdout (no processes at all) still gives {ok:true, processes:[]}', async () => {
    const result = await listProcesses(async () => ({ stdout: '', code: 0 }), 'win32');
    expect(result).toEqual({ ok: true, processes: [] });
  });
});

describe('PL8: isPidAlive', () => {
  it('true for this process', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });
  it('false for an exited child', async () => {
    const child = spawn(process.execPath, ['-e', '']);
    const pid = child.pid!;
    await new Promise((resolve) => child.on('exit', resolve));
    // Give the OS a brief moment to fully reap the process table entry on some platforms.
    await new Promise((r) => setTimeout(r, 100));
    expect(isPidAlive(pid)).toBe(false);
  });
});

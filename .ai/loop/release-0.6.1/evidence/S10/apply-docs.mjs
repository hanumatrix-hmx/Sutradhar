// S10 docs edits. Each edit's anchor must occur exactly once (else throws). Preserves each file's line endings.
// Usage (from the worktree root): node .ai/loop/release-0.6.1/evidence/S10/apply-docs.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const edit = (file, pairs) => {
  const raw = readFileSync(file, 'utf-8');
  const crlf = raw.includes('\r\n');
  let s = raw.replace(/\r\n/g, '\n');
  for (const [from, to] of pairs) {
    const n = s.split(from).length - 1;
    if (n !== 1) throw new Error(`${file}: anchor occurs ${n} times: ${from.slice(0, 60)}`);
    s = s.replace(from, () => to);
  }
  writeFileSync(file, crlf ? s.replace(/\n/g, '\r\n') : s);
  console.log(`edited ${file} (${pairs.length} edit(s), crlf=${crlf})`);
};

// --- README.md: heading, one sentence, changelog pointer ------------------------------------------
edit('README.md', [
  [
    '### Status (0.6.0) and known limitations\n\n0.6.0 adds a `verification` result',
    '### Status (0.6.1) and known limitations\n\n' +
      '0.6.1 is a security and cleanup patch: it updates the `fast-uri` copy bundled in the MCP server (six advisories) and ' +
      'makes the CLI remove its own temporary Chrome profile directories; there are no API or tool changes.\n\n' +
      '0.6.0 adds a `verification` result',
  ],
  [
    '(best effort). The full list is in [docs/22-changelog.md](./docs/22-changelog.md) under "0.6.0"\nand "0.5.0 (2026-09-29)"',
    '(best effort). The full list is in [docs/22-changelog.md](./docs/22-changelog.md) under "0.6.1", "0.6.0"\nand "0.5.0 (2026-09-29)"',
  ],
]);

// --- "as of 0.6.0" -> "as of 0.6.1" (each limitation list re-checked: 0.6.1 changes no SDK/MCP/browser behaviour) ---
edit('SECURITY.md', [['(status: partial, as of 0.6.0)', '(status: partial, as of 0.6.1)']]);
edit('packages/mcp-server/README.md', [['reproduced problems as of 0.6.0.', 'reproduced problems as of 0.6.1.']]);
edit('packages/sutradhar/README.md', [['These are open as of 0.6.0:', 'These are open as of 0.6.1:']]);

// --- packages/cli/README.md: cleanup section + limitations ------------------------------------------
edit('packages/cli/README.md', [
  [
    'These are open, reproduced problems as of 0.6.0, not\nhypothetical ones.',
    'These are open, reproduced problems as of 0.6.1, not\nhypothetical ones.',
  ],
  [
    '## Known limitations\n',
    [
      '## Temp profile directories and their cleanup',
      '',
      'Without `--profile`, the first command that needs a browser starts Chrome with a throwaway profile directory,',
      '`<OS temp>/sutradhar-cli-<epoch ms>[-<suffix>]` (50-100+ MB once Chrome has run). Since 0.6.1 the CLI removes these itself:',
      '',
      '- **`close`** (and recovery from a dead session) stops Chrome, forgets the recorded Chrome process ID, and only then removes that',
      "  session's own directory. Stopping Chrome is capped at about 10 s; the directory cleanup then has one 15 s deadline (waiting for",
      '  Chrome to exit, the process scan and the delete together). The exit code is unchanged: if the directory could not be removed,',
      '  `close` prints `Warning: could not remove temp profile ...` and still exits 0; if the state file itself cannot be cleared it fails',
      '  as in 0.6.0 (after the directory cleanup ran).',
      '- **Every new session** first sweeps leftover `sutradhar-cli-*` directories that are older than 10 minutes, within a 15 s budget',
      '  (a Windows process query is part of it). A directory a sweep cannot remove is simply retried by a later session started 10 or more',
      '  minutes afterwards.',
      '- **A failed start** (Chrome cannot be spawned, exits at once, or never becomes ready) removes the directory that start created.',
      '- **A directory is deleted only if all of these hold:** it is a real directory (never a link, junction or file) named like a',
      "  CLI temp profile directly in the OS temp dir; the process scan succeeded and no running process has it on its command line; its",
      '  owner process (recorded in `.sutradhar-owner.json`, or Chrome\'s POSIX `SingletonLock`) is gone; for a sweep, it is older than',
      "  10 minutes; and on Windows Chrome's own `lockfile` can be deleted (a held lock means the profile is in use).",
      '- **If the CLI cannot tell whether a directory is in use** (process scan failed or timed out, owner marker unreadable or corrupt), it',
      '  leaves the directory alone. Named `--profile` directories, and anything not matching the name pattern, are never touched.',
      '- **Bounds.** All deadlines use a monotonic clock and no delete starts with under 1 s left, but a delete that has already started cannot',
      '  be cancelled, so the real worst case is the deadline plus one directory delete.',
      '- **Diagnostics.** `SUTRADHAR_CLI_DEBUG_CLEANUP=1` prints every directory the cleanup considers, removes or keeps as',
      '  `[cleanup] <event> ... path="<abs>"` on stderr (see [Environment](#environment)).',
      '',
      '## Known limitations',
      '',
    ].join('\n'),
  ],
  [
    '  because the engine retries twice (`timeoutMs <= 0` does not retry).\n\n## Why `axsnap`',
    [
      '  because the engine retries twice (`timeoutMs <= 0` does not retry).',
      '',
      '**Temp profile cleanup**',
      '',
      '- On POSIX there is no equivalent of the Windows `lockfile` check: a live Chrome there is detected through the process scan and the',
      '  owner PID only (the scan reads `/proc` on Linux and uses `ps -ww` on macOS). The 0.6.1 audits exercised Windows (Node 18, 20, 22 and',
      '  25, with real Chrome and Edge) and Linux (WSL, Node 20, without Chrome); macOS and real Chrome on Linux were not exercised.',
      '- The process scan cannot see the processes of other users or elevated processes. Such cases rely on the owner-PID check (a PID that exists but cannot',
      '  be signalled counts as alive) and, on Windows, on the lock file.',
      '- If the PID in a directory\'s marker is reused by an unrelated process, the directory is kept for good (a leak, not a loss).',
      '- A stale-name directory that the CLI keeps because its marker is corrupt is never removed automatically; delete it by hand.',
      '- One delete already in progress cannot be cancelled (see above), so `close` or the first command of a session can run past the',
      '  stated bounds by the time that one delete takes.',
      '',
      '## Why `axsnap`',
    ].join('\n'),
  ],
]);

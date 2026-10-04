// Generates the S6 unit-level mutant spec (session-flow.ts mutants; the cli.ts wiring mutants M-051a-live/M-051e run live as bundle mutants).
import { writeFileSync } from 'node:fs';
const S = 'packages/cli/src/session-flow.ts';
const guard = `    if (!deps.mayLaunch) throw deps.noSession(); // I-051: BEFORE spawnFresh/afterAttach/fn — nothing is launched or written\n`;
const spawn = `    sessionId = await deps.spawnFresh();\n`;
const after = `    await deps.afterAttach(sessionId, true);\n`;
const spec = {
  suites: [{ pkg: 'cli', files: ['tests/unit/session-flow.spec.ts', 'tests/unit/help-text.spec.ts'] }],
  mutants: [
    { id: 'M-051a-unit', note: 'mayLaunch ignored: the guard never fires', file: S, count: 1, find: guard, repl: '' },
    { id: 'M-051b', note: 'guard placed AFTER spawnFresh', file: S, count: 1, find: guard + spawn, repl: spawn + guard },
    { id: 'M-051c', note: 'guard placed AFTER afterAttach', file: S, count: 1, find: guard + spawn + after, repl: spawn + after + guard },
    { id: 'M-051d', note: 'newtab without a url is launch-capable', file: S, count: 1,
      find: `    case 'nav':\n    case 'newtab':\n    case 'audit':\n      return given(0);`, repl: `    case 'nav':\n    case 'audit':\n      return given(0);\n    case 'newtab':\n      return true;` },
    { id: 'M-051d2', note: 'audit without a url is launch-capable', file: S, count: 1,
      find: `    case 'nav':\n    case 'newtab':\n    case 'audit':\n      return given(0);`, repl: `    case 'nav':\n    case 'newtab':\n      return given(0);\n    case 'audit':\n      return true;` },
    { id: 'M-051d3', note: 'compare needs only one url', file: S, count: 1, find: `return given(0) && given(1);`, repl: `return given(0);` },
    { id: 'M-051d4', note: 'an empty-string url counts as given', file: S, count: 1, find: `typeof args[i] === 'string' && args[i]!.length > 0`, repl: `typeof args[i] === 'string'` },
    { id: 'M-051d5', note: 'a read verb (snap) is launch-capable', file: S, count: 1, find: `    default:\n      return false;`, repl: `    case 'snap':\n      return true;\n    default:\n      return false;` },
    { id: 'M-051d6', note: 'nav is never launch-capable', file: S, count: 1, find: `    case 'nav':\n    case 'newtab':`, repl: `    case 'newtab':` },
    { id: 'M-051f', note: 'NoSessionError message loses the verb', file: S, count: 1, find: `"\${verb ?? ''}" needs`, repl: `"" needs` },
    { id: 'M-051g', note: 'NoSessionError message uses a hyphen instead of the em dash', file: S, count: 1, find: `session \\u2014 "`, repl: `session - "` },
    { id: 'M-051h', note: 'NoSessionError name is wrong (main().catch matches by name)', file: S, count: 1, find: `this.name = 'NoSessionError';`, repl: `this.name = 'Error';` },
    { id: 'M-051i', note: 'guard fires when state is present too', file: S, count: 1,
      find: `  await deps.gate(state); // may throw DialogBlockedError`, repl: `  if (!deps.mayLaunch) throw deps.noSession();\n  await deps.gate(state); // may throw DialogBlockedError` },
    { id: 'M-051j', note: 'grant help line loses the needs-a-session statement', file: 'packages/cli/src/cli.ts', count: 1,
      find: `                                (needs an active session; run nav first)`, repl: `                                (see "tabs")` },
  ],
};
writeFileSync(process.argv[2], JSON.stringify(spec, null, 2));

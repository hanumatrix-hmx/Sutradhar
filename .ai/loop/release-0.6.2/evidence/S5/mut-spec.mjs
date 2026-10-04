// Generates the S5 mutant spec json (avoids shell escaping of backslashes).
import { writeFileSync } from 'node:fs';
const line = String.raw`  const bracketed = /^#(\d+)$/.exec(trimmed) ?? /^\[#(\d+)\]$/.exec(trimmed);`;
const T = 'packages/capability-runtime/src/types.ts';
const spec = {
  suites: [
    { pkg: 'capability-runtime', files: ['tests/unit/runtime.spec.ts'] },
    { pkg: 'cli', files: ['tests/unit/selector-args.spec.ts'] },
  ],
  mutants: [
    { id: 'M-049a', note: 'unanchored regexes', file: T, count: 1, find: line,
      repl: String.raw`  const bracketed = /#(\d+)/.exec(trimmed) ?? /\[#(\d+)\]/.exec(trimmed);` },
    { id: 'M-049b', note: '#N only (no [#N])', file: T, count: 1, find: line,
      repl: String.raw`  const bracketed = /^#(\d+)$/.exec(trimmed);` },
    { id: 'M-049b2', note: '[#N] only (no #N)', file: T, count: 1, find: line,
      repl: String.raw`  const bracketed = /^\[#(\d+)\]$/.exec(trimmed);` },
    { id: 'M-049c', note: 'Number() normalisation of the digits (#05 -> 5)', file: T, count: 1,
      find: 'if (bracketed) return `[data-sd-node-id="${bracketed[1]}"]`;',
      repl: 'if (bracketed) return `[data-sd-node-id="${Number(bracketed[1])}"]`;' },
    { id: 'M-049d', note: 'untrimmed match (padded #5 rejected)', file: T, count: 1, find: line,
      repl: String.raw`  const bracketed = /^#(\d+)$/.exec(target) ?? /^\[#(\d+)\]$/.exec(target);` },
  ],
};
writeFileSync(process.argv[2], JSON.stringify(spec, null, 2));

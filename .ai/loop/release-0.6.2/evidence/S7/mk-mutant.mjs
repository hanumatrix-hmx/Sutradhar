// usage: node mk-mutant.mjs <a|b|c|d|e|f>  -- writes dist/cli-bin.mutant.js (exactly 1 replacement) from the real dist/cli-bin.js
import { readFileSync, writeFileSync } from 'node:fs';
const D = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041/packages/sutradhar/dist';
const which = process.argv[2];
const classifyEdge = 'if (checks.some((c) => c.check === `${t}.history-edge`)) return "edge";';
const M = {
  // M-NAVa: back mapped to goForward
  a: { find: 'o.verb === "back" ? await runtime.goBack(sessionId, void 0, o.expect, o.settle)', repl: 'o.verb === "back" ? await runtime.goForward(sessionId, void 0, o.expect, o.settle)' },
  // M-NAVb: the edge is printed as "Navigated back"
  b: { find: '      case "edge":\n        stdout.push(edgeLine());', repl: '      case "edge":\n        stdout.push(`Navigated ${verb2} to ${result.url}`);' },
  // M-NAVc: reload as navigate(currentUrl) WITHOUT the beforeunload handling (the whole try/catch/cancel block, one contiguous replacement)
  c: {
    find: 'let result;\n  try {\n    result = o.verb === "back" ? await runtime.goBack(sessionId, void 0, o.expect, o.settle) : o.verb === "forward" ? await runtime.goForward(sessionId, void 0, o.expect, o.settle) : await runtime.reload(sessionId, void 0, o.expect, o.settle);\n  } catch (err) {\n    const tries = o.pollTries ?? 10;\n    for (let i = 0; i < tries; i++) {\n      if (cancelled()) return cancelLines();\n      await new Promise((r) => setTimeout(r, o.pollMs ?? 50));\n    }\n    throw err;\n  }\n  if (cancelled()) return cancelLines(result.url);',
    repl: 'let result;\n  result = o.verb === "back" ? await runtime.goBack(sessionId, void 0, o.expect, o.settle) : o.verb === "forward" ? await runtime.goForward(sessionId, void 0, o.expect, o.settle) : await runtime.navigate(sessionId, (await runtime.listTabs(sessionId)).find((t) => t.isActive).url, void 0, o.expect, o.settle);',
  },
  // M-NAVd: no-history detected by loaderId (document not observed as a new document => "edge")
  d: { find: classifyEdge, repl: 'if (!checks.some((c) => c.check === `${t}.document` && c.observed === "new-document")) return "edge";' },
  // M-NAVe: a failed --expect-* outranks the edge
  e: { find: '  if (outcome === "edge") return 1;\n  if (expectGiven && failedExpectations(verification).length > 0) return EXIT_EXPECTATION_FAILED;', repl: '  if (expectGiven && failedExpectations(verification).length > 0) return EXIT_EXPECTATION_FAILED;\n  if (outcome === "edge") return 1;' },
  // M-NAVf: edge detected from the verdict reason text
  f: { find: classifyEdge, repl: 'if (/no (forward )?history entry/.test(verification?.reason ?? "")) return "edge";' },
};
const m = M[which];
const src = readFileSync(`${D}/cli-bin.js`, 'utf8').replace(/\r\n/g, '\n');
const n = src.split(m.find).length - 1;
if (n !== 1) { console.error(`replacement count ${n} != 1`); process.exit(3); }
writeFileSync(`${D}/cli-bin.mutant.js`, src.replace(m.find, () => m.repl));
console.log(`mutant ${which} written, replacements=${n}`);

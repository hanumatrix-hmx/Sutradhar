audit-2 note: every *.spec.ts / mutated *.ts in this directory was renamed to *.txt AFTER its run
(runs recorded in the matching *-run.txt files). Reason: the root vitest.config.ts has no include
restriction, so a root-level `vitest run` would collect .ai/**/*.spec.ts -- and u10-mutant.spec.ts
deliberately reproduces an infinite synchronous loop that no vitest timeout can interrupt.
To re-run one: copy it back to a .spec.ts name in a scratch dir (see the -run.txt files for the
exact commands' shape: `vitest run --globals --root <dir>`, with a node_modules junction to the
package's node_modules for the capability-runtime cases).

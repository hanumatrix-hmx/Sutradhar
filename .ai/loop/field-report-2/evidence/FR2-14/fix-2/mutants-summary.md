| id | mutant | caught by (failed tests per package) | restored sha256 | rebuild |
|---|---|---|---|---|
| C1 | choke point removed in the toAbs catch (the audit-2 `~user` path) | capability-runtime: 6 failed , 483 passed (489) | true | 0 |
| C2 | choke point removed in resolveConfigPath (fs-roots) | capability-runtime: 2 failed , 487 passed (489) | true | 0 |
| C3 | choke point removed in the unknown-key warning | capability-runtime: 8 failed , 481 passed (489) | true | 0 |
| C4 | domain suggestion: no length limit, no choke point | capability-runtime: 2 failed , 487 passed (489) | true | 0 |
| C5 | choke point removed in the "cannot be checked" refusal | capability-runtime: 4 failed , 485 passed (489) | true | 0 |
| C6 | choke point removed in the "outside this config's directory" refusal (resolved path) | capability-runtime: 5 failed , 484 passed (489) | true | 0 |
| C7 | choke point removed in the duplicate-key error | capability-runtime: 5 failed , 484 passed (489) | true | 0 |
| C8 | choke point removed around the redacted JSON engine message | capability-runtime: 2 failed , 487 passed (489) | true | 0 |
| C9 | the cap removed from echo() | capability-runtime: 10 failed , 479 passed (489) | true | 0 |
| C10 | control/NUL/bidi replacement removed from echo() | capability-runtime: 7 failed , 482 passed (489) | true | 0 |
| C11 | path cap widened 200 -> 2000 | capability-runtime: 4 failed , 485 passed (489) | true | 0 |
| H1 | the canonical walk reverted (a link above home pointing in climbs its logical parents) | capability-runtime: 11 failed , 478 passed (489) | true | 0 |
| H2 | the reverse-link guard removed (a directory whose real location is above home is searched) | capability-runtime: 12 failed , 477 passed (489) | true | 0 |
| H3 | audit-2 B14 / pre-fix F3: inHome from the canonical cwd only | capability-runtime: 21 failed , 468 passed (489) | true | 0 |
| S1 | audit-2 B1: a blank / `;;` DOWNLOAD env counts as set (refusal skipped, FILE roots used) | capability-runtime: 3 failed , 486 passed (489); cli: 3 failed , 239 passed (242) | true | 0 |
| S2 | audit-2 B10: an UPLOAD-roots env var skips the DOWNLOAD refusal (other-surface env counts) | capability-runtime: 2 failed , 487 passed (489); cli: 2 failed , 240 passed (242) | true | 0 |
| S3 | audit-2 B12: a blank env becomes the default roots | capability-runtime: 6 failed , 483 passed (489); cli: 3 failed , 239 passed (242) | true | 0 |
| S4 | a blank / `;;` UPLOAD env counts as set (upload allowlist silently becomes unrestricted) | capability-runtime: 3 failed , 486 passed (489) | true | 0 |
| S5 | isLayerSet: an empty list counts as set | capability-runtime: 6 failed , 483 passed (489); cli: 2 failed , 240 passed (242); mcp-server: 1 failed , 155 passed (156) | true | 0 |
| S6 | isLayerSet: null counts as set | capability-runtime: 24 failed , 465 passed (489); cli: 1 failed , 241 passed (242); mcp-server: 7 failed , 149 passed (156); sutradhar: 7 failed , 57 passed (64) | true | 0 |
| S7 | firstDefined bypasses the shared definition (null and [] win) | capability-runtime: 15 failed , 474 passed (489); cli: 1 failed , 241 passed (242); mcp-server: 2 failed , 154 passed (156); sutradhar: 1 failed , 63 passed (64) | true | 0 |
| S8 | audit-2 B11 (wiring): cli.ts does not hand the `download <ref> <dir>` argument to the resolver | cli: 1 failed , 241 passed (242) | true | 0 |
| S9 | CLI: an empty `download` dir list counts as a set layer (clears the refusal) | cli: 2 failed , 240 passed (242) | true | 0 |
| Z1 | the zod bound removed from the MCP browser.launch viewport | mcp-server: 1 failed , 155 passed (156) | true | 0 |
| N8 | the override-of-a-refused-root note removed | capability-runtime: 1 failed , 488 passed (489); sutradhar: 1 failed , 63 passed (64) | true | 0 |
| A1 | audit-1 A1: MCP only: config allowedDomains outranks env (one pair reversed on one surface) | mcp-server: 2 failed , 154 passed (156) | true | 0 |
| A2 | audit-1 A2: CLI only: sticky state dialog outranks an accept/dismiss flag | cli: 4 failed , 238 passed (242) | true | 0 |
| A3 | audit-1 A3: .git exclusion computed on the literal (non-canonical) path: junction-to-.git bypass | capability-runtime: 1 failed , 488 passed (489) | true | 0 |
| A4 | audit-1 A4: .git exclusion dropped entirely | capability-runtime: 6 failed , 483 passed (489); cli: 2 failed , 240 passed (242); mcp-server: 2 failed , 154 passed (156); sutradhar: 2 failed , 62 passed (64) | true | 0 |
| A5 | audit-1 A5: a discovered file is treated like an explicit (trusted) one | NOT COUNTED: mutant does not type-check: packages/capability-runtime/src/project-config.ts(552,7): erro | true | 0 |
| A5b | audit-1 A5b: a discovered file is treated like an explicit (trusted) one (type-valid spelling) | capability-runtime: 24 failed , 465 passed (489); cli: 6 failed , 236 passed (242); mcp-server: 4 failed , 152 passed (156); sutradhar: 7 failed , 57 passed (64) | true | 0 |
| A6r | audit-1 A6 (re-spelled): an explicit falsy value (0) falls through instead of winning | capability-runtime: 6 failed , 483 passed (489); mcp-server: 2 failed , 154 passed (156) | true | 0 |
| A7 | audit-1 A7: CLI fail-open: --allowlist-domains "" / " , " means unrestricted again | cli: 1 failed , 241 passed (242) | true | 0 |
| A8r | audit-1 A8 (re-spelled): home boundary compared literally (no canonicalisation/case fold) | capability-runtime: 2 failed , 487 passed (489) | true | 0 |
| A8br | audit-1 A8b (re-spelled): home boundary needs a LITERAL match of the walk to the home string as well | capability-runtime: 2 failed , 487 passed (489) | true | 0 |
| A9 | audit-1 A9: MCP: server default viewport outranks the browser.launch call argument | mcp-server: 1 failed , 155 passed (156) | true | 0 |
| A10 | audit-1 A10: duplicate keys only detected at the top level | capability-runtime: 1 failed , 488 passed (489) | true | 0 |
| A11 | audit-1 A11: SDK: a config dialog "report" is not mapped to auto (would hang page.evaluate) | capability-runtime: 1 failed , 488 passed (489); sutradhar: 1 failed , 63 passed (64) | true | 0 |
| A12 | audit-1 A12: nested unknown keys (dialog.*) silently dropped without a warning | capability-runtime: 1 failed , 488 passed (489) | true | 0 |
| B2 | audit-2 B2: env set: env roots MERGED with the refused file roots | capability-runtime: 15 failed , 474 passed (489); cli: 8 failed , 234 passed (242); mcp-server: 8 failed , 148 passed (156) | true | 0 |
| B3 | audit-2 B3: an allowedDownloadRoots option that is present but empty/null skips the refusal (file roots used) | capability-runtime: 6 failed , 483 passed (489); mcp-server: 4 failed , 152 passed (156); sutradhar: 4 failed , 60 passed (64) | true | 0 |
| B4 | audit-2 B4: MCP only: refusal not passed to the resolver (pre-fix composition) | mcp-server: 4 failed , 152 passed (156) | true | 0 |
| B5 | audit-2 B5: SDK only: refusal not passed to the resolver | sutradhar: 6 failed , 58 passed (64) | true | 0 |
| B6r | audit-2 B6 (re-spelled): CLI download <dir> is NOT treated as a higher layer | cli: 6 failed , 236 passed (242) | true | 0 |
| B7 | audit-2 B7: CLI resolver: download <dir> clears the refusal but KEEPS the file roots (merged with <dir>) | cli: 6 failed , 236 passed (242) | true | 0 |
| B8 | audit-2 B8: central: fsRootsConfigLayer drops downloadRefusal on every surface | capability-runtime: 12 failed , 477 passed (489); cli: 6 failed , 236 passed (242); mcp-server: 4 failed , 152 passed (156); sutradhar: 6 failed , 58 passed (64) | true | 0 |
| B9 | audit-2 B9: over-refusal: an EXPLICIT (SUTRADHAR_CONFIG) file is also refused | capability-runtime: 3 failed , 486 passed (489) | true | 0 |
| B13r | audit-2 B13 (re-spelled): home boundary by exact string equality of the canonical paths (equivalent on win32: canonicalizePath normalises case) | **SURVIVED** | true | 0 |

valid mutants: 47; caught by unit tests: 46; survivors: B13r

Audit-2's own runner (`mutants-a2.mjs`, unmodified copy in `mutants-a2-runner/probes/`; only B1's find-string re-spelled in that copy's `mutants-def.mjs`
because the guard text moved) re-run for the three mutants that survived all 848 unit tests in audit-2:

| id | mutant | unit | f1-attack | live CLI F1 | restored | rebuild |
|---|---|---|---|---|---|---|
| B1 | blank / `;;` env counts as set | CAUGHT: capability-runtime 2 failed, cli 2 failed | 54 fail | 3 fail | true | pkg 0, bundle 0 |
| B10 | upload env skips the download refusal | CAUGHT: capability-runtime 2 failed, cli 2 failed | 13 fail | 1 fail | true | pkg 0, bundle 0 |
| B11 | cli.ts does not pass `<dir>` to the resolver (wiring) | CAUGHT: cli 1 failed (the wiring guard) | 0 fail (expected: function level) | 1 fail | true | pkg 0, bundle 0 |

B13r (exact-string home equality) is EQUIVALENT on win32: `canonicalizePath` already normalises case, so `sameFold(a, b)` implies `a === b` (audit-2 ruled the same, `audit-2/b13-equivalence.txt`); it is not counted as a missed catch.

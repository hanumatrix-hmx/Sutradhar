/**
 * @file packages/capability-runtime/src/layer-set.ts
 * @description FR2-14 fix-2 (N3): the ONE definition of "this configuration layer is set", used by
 * every layer (flag/option/env/config), every resolver and every surface (CLI, MCP, SDK). Fix-1 had
 * several inline spellings of it (`?.length`, `roots !== undefined`, `=== undefined`), and the unit
 * tests varied the FILE but not what makes a higher layer count; audit-2 mutants B1 (a blank or
 * `;;` env counts as set), B10 (an other-surface env counts) and B11 (the CLI `download <dir>`
 * layer not handed over) survived. Defining it once makes the generated override matrix
 * (`override-matrix.spec.ts`, N3 section) a complete test of it.
 *
 * A layer is SET iff it holds a value: not `undefined`, not `null`, and, for a list, not empty.
 * `0`, `''` and `false` ARE values (a typed 0 disables something). An ENVIRONMENT variable is turned
 * into a list/number by its own parser first; one that yields no entry (unset, `''`, blank,
 * `;;`) is therefore NOT set, and one the parser rejects (`0` or `false` as a path, `[]`) is an
 * ERROR, never "set" and never "unset" (a typo must not silently fall through to a weaker layer).
 */

/** True iff the layer holds a value (see the file comment). */
export function isLayerSet<T>(v: T | undefined | null): v is T {
  if (v === undefined || v === null) return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

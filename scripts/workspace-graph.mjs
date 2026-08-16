/**
 * @file scripts/workspace-graph.mjs
 * @description Computes the real `@sutradhar/*` workspace-dependency closure and build order
 * for the packages the published `sutradhar` bundle's import graph can reach — from actual
 * `package.json` dependency edges, not a hand-maintained list (which silently drifts as the
 * real dependency graph changes; this project's own history already shows exactly that kind of
 * drift going unnoticed — see the Phase 6 investigation in .ai/known-problems.md). Shared by
 * `build-bundle.mjs` (which rebuilds this closure from clean) and `check-release-ready.mjs`
 * (which verifies nothing in it is stale before allowing `npm publish`) so both scripts agree
 * on exactly the same set of packages.
 */
import path from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

/** Every `packages/<name>` directory that has a package.json, keyed by its package name. */
export function discoverWorkspacePackages(root) {
  const packagesDir = path.join(root, 'packages');
  const byName = new Map(); // package name (e.g. "@sutradhar/browser") -> { dir, deps: string[] }
  for (const dirName of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!dirName.isDirectory()) continue;
    const pkgJsonPath = path.join(packagesDir, dirName.name, 'package.json');
    let pkgJson;
    try {
      pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    } catch {
      continue; // no package.json (or unreadable) — not a real workspace package
    }
    const deps = Object.keys(pkgJson.dependencies ?? {}).filter((d) => d.startsWith('@sutradhar/'));
    byName.set(pkgJson.name, { dir: path.join(packagesDir, dirName.name), deps });
  }
  return byName;
}

/**
 * BFS the real dependency graph from the three bundle entry packages, then topologically sort
 * so each package appears only after everything it imports — a package's own `tsc` run resolves
 * its `@sutradhar/*` imports' TYPES through their `dist/*.d.ts`, so building (or checking
 * freshness) out of order can act on stale or missing types.
 */
export function computeBuildOrder(byName) {
  // `sutradhar`'s own package.json declares no @sutradhar/* deps (they're inlined by esbuild,
  // not real npm deps of the published package) — seed the walk with what its src actually
  // needs directly, plus the other two bundle entries.
  const roots = ['@sutradhar/cli', '@sutradhar/mcp-server', '@sutradhar/capability-runtime'];
  const closure = new Set();
  const stack = [...roots];
  while (stack.length) {
    const name = stack.pop();
    if (closure.has(name)) continue;
    closure.add(name);
    const info = byName.get(name);
    if (!info) throw new Error(`[workspace-graph] Unknown workspace dependency "${name}" — check packages/*/package.json.`);
    stack.push(...info.deps);
  }

  // Kahn's algorithm over the closure only.
  const inDegree = new Map([...closure].map((n) => [n, 0]));
  for (const name of closure) {
    for (const dep of byName.get(name).deps) {
      if (closure.has(dep)) inDegree.set(name, inDegree.get(name) + 1);
    }
  }
  const order = [];
  let frontier = [...closure].filter((n) => inDegree.get(n) === 0);
  const remaining = new Set(closure);
  while (frontier.length) {
    const next = [];
    for (const name of frontier) {
      order.push(name);
      remaining.delete(name);
      for (const other of remaining) {
        if (byName.get(other).deps.includes(name)) {
          inDegree.set(other, inDegree.get(other) - 1);
          if (inDegree.get(other) === 0) next.push(other);
        }
      }
    }
    frontier = next;
  }
  if (remaining.size > 0) {
    throw new Error(`[workspace-graph] Dependency cycle detected among: ${[...remaining].join(', ')}`);
  }
  return order.map((name) => byName.get(name));
}

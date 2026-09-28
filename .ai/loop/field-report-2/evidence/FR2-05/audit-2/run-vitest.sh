#!/usr/bin/env bash
# Runs the full vitest suite for the 5 FR2-05-touched packages, one log each.
ROOT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"
E="$ROOT/.ai/loop/field-report-2/evidence/FR2-05/audit-2"
: > "$E/vitest-exits.txt"
for pkg in browser capability-runtime mcp-server cli sutradhar; do
  cd "$ROOT/packages/$pkg" || exit 1
  "$ROOT/node_modules/.bin/vitest" run > "$E/vitest-$pkg.log" 2>&1
  echo "$pkg exit=$?" >> "$E/vitest-exits.txt"
done
echo done >> "$E/vitest-exits.txt"

#!/bin/bash
# runs the real vitest suite of every touched (and two regression) package; logs per package
cd "$1"
RUN="$2"
for p in packages/browser packages/capability-runtime packages/mcp-server packages/cli packages/sutradhar packages/agent apps/server; do
  n=$(basename $p)
  (cd $p && ../../node_modules/.bin/vitest run --globals > "$RUN/vitest-$n.log" 2>&1; echo "exit $?" >> "$RUN/vitest-$n.log")
done
echo finished > "$RUN/vitest-all.done"

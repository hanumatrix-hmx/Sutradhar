#!/bin/bash
# FR2-14 fix-2: re-run the audit-1 and audit-2 probes UNMODIFIED (sha256-verified copies), one after another, each with a hard timeout.
cd "E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041" || exit 1
EV=.ai/loop/field-report-2/evidence/FR2-14
A2=$EV/fix-2-rerun-a2
A1=$EV/fix-2-rerun-a1
S=E:/AI-Cache/tmp/fr214f2/pr
mkdir -p $S
SUM=$EV/fix-2/probes-rerun-summary.txt
: > $SUM
run() { # run <dir> <name> <cmd...>
  local dir=$1 name=$2; shift 2
  df -h /e | tail -1 | awk '{print "disk avail " $4}' >> $SUM
  (cd $dir/probes && timeout 1190 "$@" > ../$name.log 2>&1; echo "$name exit=$?" >> ../../fix-2/probes-rerun-summary.txt)
}
PKG_MCP=$PWD/packages/mcp-server/dist/cli.js
BUN_MCP=$PWD/packages/sutradhar/dist/mcp-cli.js
run $A2 f4-tilde-multiline node f4-tilde-multiline.mjs $S/f4
run $A2 f3-reverse node f3-reverse.mjs $S/f3
run $A2 fixes-fn node fixes-fn.mjs $S/fx ../fixes-fn.json
run $A2 f1-attack node f1-attack.mjs $S/f1 ../f1-attack.json
run $A2 mcp-callhuge-ab-pkg node mcp-callhuge-ab.mjs $PKG_MCP $S/mc1
run $A2 mcp-callhuge-ab-bundle node mcp-callhuge-ab.mjs $BUN_MCP $S/mc2
run $A2 prec-gen node prec-gen.mjs $S/pg ../prec-gen.json
run $A1 loader-probes node loader-probes.mjs $S/lp
run $A1 precedence-fn node precedence-fn.mjs $S/pf
run $A1 live-failclosed node live-failclosed.mjs $S/fc
for b in pkg bundle; do
  for part in f1 f6f8 prec0 prec1; do
    run $A2 live-cli-$b-$part node live-cli.mjs $b $S/lc-$b $part
  done
done
run $A2 live-sdk node live-sdk.mjs $S/ls
run $A2 live-mcp-pkg node live-mcp.mjs pkg $S/lm1
run $A2 live-mcp-bundle node live-mcp.mjs bundle $S/lm2
echo "ALL DONE" >> $SUM

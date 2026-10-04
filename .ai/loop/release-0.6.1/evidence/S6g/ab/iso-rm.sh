#!/bin/bash
# exact-path guarded delete of the S6g harness ISO dir (a dir this step created; only after the harness confirmed nothing references it)
set -u
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; ISO="$SP/S6gi"
[ -n "${SP:-}" ] && [ -d "$SP" ] || { echo "REFUSE: SP unset"; exit 1; }
[ "$ISO" = "$SP/S6gi" ] && [ -d "$ISO" ] || { echo "REFUSE/absent $ISO"; exit 1; }
rm -rf -- "$ISO"; [ -e "$ISO" ] && echo "STILL EXISTS" || echo "removed $(basename "$ISO")"

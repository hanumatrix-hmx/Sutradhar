#!/bin/bash
# usage: iso.sh create|delete <ISO path>  -- 0.2 item 1 (fail-closed create) and item 8 (guarded delete)
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"
op=$1; ISO=$2
if [ "$op" = create ]; then
  [ ! -e "$ISO" ] || { echo "ISO exists: $ISO"; exit 1; }
  mkdir -p "$(dirname "$ISO")" && mkdir "$ISO" && : > "$ISO/.r062" && echo "created $ISO"
else
  set -u; [ -n "${SP:-}" ] && [ -d "$SP" ] && [ -f "$ISO/.r062" ] || { echo "REFUSE: SP unset or no .r062 marker"; exit 1; }
  case "$ISO" in "$SP"/r062/S[0-9]*-tmp|"$SP"/r062/S[0-9]*-tmp-*|"$SP"/[ANSW][0-9a-z]t) ;; *) echo "REFUSE rm $ISO"; exit 1 ;; esac
  find "$ISO" -mindepth 1 -maxdepth 1 ! -name .r062 -exec rm -rf -- {} +
  if [ -z "$(find "$ISO" -mindepth 1 -maxdepth 1 ! -name .r062 -print -quit)" ]; then rm -f -- "$ISO/.r062" && rmdir -- "$ISO"; fi
  [ ! -e "$ISO" ] || { echo "ISO NOT REMOVED (marker kept): $ISO"; ls -la "$ISO"; exit 1; }
  echo "deleted $ISO"
fi

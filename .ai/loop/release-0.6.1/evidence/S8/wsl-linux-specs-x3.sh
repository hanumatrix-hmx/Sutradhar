# runs INSIDE wsl (sh); self-contained: mktemp, copy HEAD cli src+tests, install vitest 1.6.1, run the new specs on Linux Node 20 (CI-like), guarded rm
set -u
WTM=/mnt/e/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041
D=$(mktemp -d) || exit 1
case "$D" in /tmp/tmp.*) ;; *) echo "REFUSE D=$D"; exit 1;; esac
echo "D=$D node=$(node -v) uname=$(uname -sr)"
mkdir -p "$D/packages/cli" "$D/stub" "$D/t"
cp -r "$WTM/packages/cli/src" "$WTM/packages/cli/tests" "$D/packages/cli/"
cd "$D/packages/cli" && sha256sum src/temp-profile.ts src/spawn-chrome.ts src/close-session.ts tests/unit/temp-profile.spec.ts
printf '%s\n' 'export class BrowserLauncher { findExecutablePath() { return undefined; } }' > "$D/stub/browser.mjs"
printf '%s\n' '{"name":"s8-linux-specs","private":true,"type":"module"}' > "$D/package.json"
printf '%s\n' "import { defineConfig } from 'vitest/config'; export default defineConfig({ test: { globals: true, environment: 'node', testTimeout: 120000, alias: { '@sutradhar/browser': '$D/stub/browser.mjs' } } });" > "$D/packages/cli/vitest.config.mjs"
( cd "$D" && timeout 400 npm install --no-audit --no-fund --silent vitest@1.6.1 >/dev/null 2>&1; echo "npm-install-exit=$?" )
for k in 1 2 3; do cd "$D/packages/cli" && TMPDIR="$D/t" timeout 600 "$D/node_modules/.bin/vitest" run --config vitest.config.mjs tests/unit/temp-profile.spec.ts tests/unit/scan-command-lines.spec.ts tests/unit/spawn-failure-cleanup.spec.ts tests/unit/close-session.spec.ts tests/unit/system-binaries.spec.ts 2>&1 | sed "s/[[0-9;]*m//g" | grep -E "Test Files|Tests |FAIL|×"; echo "# run $k done"; done
echo "# vitest-exit=$?"
cd /; rm -rf -- "$D" && echo "# removed own D=$D"

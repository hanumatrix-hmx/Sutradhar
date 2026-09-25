// FR2-06 audit-1: process-level tracer, loaded via `node --import <this> <entry>`.
// Logs (append, one JSON line each) to $AUDIT_TRACE_FILE:
//   - every CDP message this process SENDS over any `ws` WebSocket (method + short fn snippet)
//   - every outbound http.request / http.get (a puppeteer.connect handshake or a /json/version probe)
//   - every child_process spawn/execFile/fork/exec (a Chrome spawn, a taskkill, a powershell probe)
// Nothing here changes behavior; it only observes.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import http from 'node:http';
import cp from 'node:child_process';

const out = process.env.AUDIT_TRACE_FILE;
const repoRoot = process.env.AUDIT_REPO_ROOT;
function log(entry) {
  if (!out) return;
  try {
    fs.appendFileSync(out, JSON.stringify({ t: Date.now(), pid: process.pid, ...entry }) + '\n');
  } catch {}
}
log({ kind: 'process-start', argv: process.argv.slice(1) });

try {
  const req = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
  const pptr = req.resolve('puppeteer-core');
  const WS = createRequire(pptr)('ws');
  const orig = WS.prototype.send;
  WS.prototype.send = function (data, ...rest) {
    try {
      const m = JSON.parse(String(data));
      log({
        kind: 'cdp-send',
        method: m.method,
        fn: typeof m.params?.functionDeclaration === 'string' ? m.params.functionDeclaration.slice(0, 100) : undefined,
      });
    } catch {
      log({ kind: 'cdp-send', method: '<unparsed>' });
    }
    return orig.call(this, data, ...rest);
  };
} catch (e) {
  log({ kind: 'preload-error', message: String(e && e.message) });
}

const origReq = http.request;
http.request = function (...args) {
  const a = args[0];
  log({ kind: 'http-request', target: typeof a === 'string' ? a : a && (a.href || `${a.host || a.hostname}:${a.port}${a.path}`) });
  return origReq.apply(this, args);
};
const origGet = http.get;
http.get = function (...args) {
  const a = args[0];
  log({ kind: 'http-get', target: typeof a === 'string' ? a : a && (a.href || `${a.host || a.hostname}:${a.port}${a.path}`) });
  return origGet.apply(this, args);
};
for (const name of ['spawn', 'execFile', 'fork', 'exec', 'spawnSync', 'execFileSync', 'execSync']) {
  const orig = cp[name];
  cp[name] = function (...args) {
    log({ kind: 'child-process', fn: name, cmd: String(args[0]).slice(0, 200) });
    return orig.apply(this, args);
  };
}
// Make ESM named imports (`import { spawn } from 'node:child_process'`) see the patched functions.
(await import('node:module')).syncBuiltinESMExports();

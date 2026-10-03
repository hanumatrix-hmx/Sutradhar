// A/B: MCP createSutradharServer with falsy non-null option values, on a given tree (argv[2]).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const T = process.argv[2];
const MCP = await import(pathToFileURL(path.join(T, 'packages/mcp-server/dist/server.js')).href);
process.env.SUTRADHAR_ALLOWED_DOMAINS = 'e.test';
const out = {};
for (const [lab, o] of [['dom-empty-string', { allowedDomains: '' }], ['dom-false', { allowedDomains: false }], ['dom-zero', { allowedDomains: 0 }], ['dom-null', { allowedDomains: null }], ['dlg-false', { dialogPolicy: false }], ['idle-null', { idleTimeoutMs: null }]]) {
  try { const r = await MCP.createSutradharServer({ ...o, disableAgent: true }); out[lab] = { allowedDomains: r.runtime.allowedDomains ?? null, dialog: r.runtime.dialogPolicy ?? null, idle: r.runtime.sessionManager.idleTimeoutMs ?? null }; }
  catch (e) { out[lab] = 'THROW ' + e.message.slice(0, 100); }
}
console.log('RESULT ' + JSON.stringify(out));
process.exit(0);

// FR2-17 probe: register the real MCP tools against a recording mock server and report the
// real tool registry (count, names, which require sessionId, key descriptions/params).
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const tools = await import(pathToFileURL(path.join(root, 'packages/mcp-server/dist/tools.js')).href);
const rt = await import(pathToFileURL(path.join(root, 'packages/capability-runtime/dist/index.js')).href);

const registered = new Map();
const server = { registerTool: (name, config, handler) => { registered.set(name, { config, handler }); } };
const runtime = new rt.SutradharRuntime();
// agent handle present so agent.runGoal registers too
tools.registerTools(server, { runtime, agent: { runGoal: async () => ({}) } });

const names = [...registered.keys()];
const browserTools = names.filter((n) => n.startsWith('browser.'));
const agentTools = names.filter((n) => n.startsWith('agent.'));
console.log(JSON.stringify({ total: names.length, browser: browserTools.length, agent: agentTools.length }));
const requiredSession = [];
const withSession = [];
for (const [n, { config }] of registered) {
  const s = config.inputSchema?.sessionId;
  if (s) {
    withSession.push(n);
    if (!(typeof s.isOptional === 'function' && s.isOptional())) requiredSession.push(n);
  }
}
console.log('tools with a sessionId field:', withSession.length);
console.log('tools where sessionId is REQUIRED:', JSON.stringify(requiredSession));
console.log('names:', names.join(','));
const want = process.argv[3] ? process.argv[3].split(',') : [];
for (const n of want) {
  const c = registered.get(n)?.config;
  console.log('---', n, c ? '' : 'NOT REGISTERED');
  if (c) {
    console.log('params:', Object.keys(c.inputSchema ?? {}).join(','));
    console.log('description:', c.description);
  }
}
process.exit(0);

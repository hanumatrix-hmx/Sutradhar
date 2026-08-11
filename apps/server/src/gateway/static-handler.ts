/**
 * @file apps/server/src/gateway/static-handler.ts
 * @description Static HTML file handler serving developer test console interface.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ApiRouter } from './api-router.js';

export function registerConsoleRoute(router: ApiRouter): void {
  router.get('/', async (_req, res) => {
    try {
      const consolePath = path.join(
        process.cwd(),
        'apps',
        'server',
        'src',
        'console',
        'developer-console.html',
      );
      const htmlContent = await fs.readFile(consolePath, 'utf-8');
      res.status(200).send(htmlContent);
    } catch {
      // Inline HTML fallback if file is served from dist package directory
      const fallbackHtml = `
        <!DOCTYPE html>
        <html>
        <head><title>Sutradhar Test Console</title></head>
        <body style="font-family:sans-serif;background:#0f172a;color:#f8fafc;padding:24px;">
          <h2>Sutradhar Developer Test Console</h2>
          <p>Runtime API Active</p>
          <input id="g" style="width:300px;" value="Go to github.com and summarize homepage" />
          <button onclick="fetch('/api/v1/agents/goals',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({goal:document.getElementById('g').value})}).then(r=>r.json()).then(d=>document.getElementById('r').innerText=JSON.stringify(d,null,2))">Run</button>
          <pre id="r"></pre>
        </body>
        </html>
      `;
      res.status(200).send(fallbackHtml);
    }
  });
}

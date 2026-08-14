// Persistent driver server for Playwright: launches ONE browser+page and keeps the same
// client-side Playwright session alive for the server's whole lifetime, so aria-ref snapshot
// refs stay valid across commands (they're scoped to the connection that produced them --
// per-command reconnection broke this, confirmed live). Talk to it with plain curl POSTs, one
// action per call -- the same "one round trip per action" shape as driving Sutradhar's MCP
// tools turn-by-turn.
//
// POST /cmd  {"action":"navigate","url":"..."}
// POST /cmd  {"action":"snapshot"}
// POST /cmd  {"action":"click","ref":"e6"}
// POST /cmd  {"action":"type","ref":"e6","text":"..."}
// POST /cmd  {"action":"press","ref":"e6","key":"Enter"}
// POST /cmd  {"action":"text"}
// POST /cmd  {"action":"title"}
// POST /cmd  {"action":"newTask","url":"..."}   -- closes current page, opens a fresh one (new task boundary)
import { chromium } from 'playwright-core';
import http from 'node:http';

const PORT = process.env.PW_SERVER_PORT || 9444;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
});
let context = await browser.newContext();
let page = await context.newPage();

async function handle(body) {
  const { action, ...args } = body;
  switch (action) {
    case 'newTask': {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      context = await browser.newContext();
      page = await context.newPage();
      if (args.url) await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      return { ok: true, url: page.url(), title: await page.title() };
    }
    case 'navigate': {
      await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      return { ok: true, url: page.url(), title: await page.title() };
    }
    case 'snapshot': {
      const snap = await page.locator('body').ariaSnapshot({ mode: 'ai' });
      return { ok: true, url: page.url(), title: await page.title(), snapshot: snap.slice(0, 14000) };
    }
    case 'click': {
      await page.locator(`aria-ref=${args.ref}`).click({ timeout: 10000 });
      try {
        return { ok: true, url: page.url(), title: await page.title() };
      } catch {
        await new Promise((r) => setTimeout(r, 500));
        return { ok: true, url: page.url(), title: await page.title() };
      }
    }
    case 'type': {
      const loc = page.locator(`aria-ref=${args.ref}`);
      await loc.click({ timeout: 10000 });
      await loc.fill('');
      await loc.fill(args.text);
      return { ok: true, typed: args.text };
    }
    case 'press': {
      await page.locator(`aria-ref=${args.ref}`).press(args.key, { timeout: 10000 });
      return { ok: true, url: page.url() };
    }
    case 'text': {
      const text = await page.evaluate(() => document.body.innerText.slice(0, 3000));
      return { ok: true, url: page.url(), title: await page.title(), text };
    }
    case 'title': {
      return { ok: true, url: page.url(), title: await page.title() };
    }
    case 'links': {
      // Fallback when aria-ref matching is unreliable: raw hrefs matching a filter, closest
      // Puppeteer-equivalent capability (no curated grounding, just DOM query).
      const filter = args.filter || '';
      const links = await page.evaluate((f) =>
        Array.from(document.querySelectorAll('a'))
          .filter((a) => !f || (a.href || '').includes(f) || (a.textContent || '').toLowerCase().includes(f.toLowerCase()))
          .slice(0, 15)
          .map((a) => ({ text: a.textContent.trim().slice(0, 80), href: a.href })), filter);
      return { ok: true, links };
    }
    case 'clickHref': {
      await page.locator(`a[href="${args.href}"]`).first().click({ timeout: 10000 });
      return { ok: true, url: page.url(), title: await page.title() };
    }
    case 'shutdown': {
      setTimeout(() => process.exit(0), 100);
      return { ok: true, shuttingDown: true };
    }
    default:
      return { ok: false, error: `unknown action ${action}` };
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/cmd') {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    try {
      const parsed = JSON.parse(body);
      const result = await handle(parsed);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: err.message }));
    }
  });
});

server.listen(PORT, () => console.log(`pw-server listening on ${PORT}`));

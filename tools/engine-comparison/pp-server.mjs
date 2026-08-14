// Persistent driver server for bare Puppeteer -- deliberately NO curated accessibility/AI
// snapshot layer, because Puppeteer doesn't have one out of the box (its official MCP server
// is dead, confirmed earlier this session) and giving it Sutradhar/Playwright-quality
// grounding would no longer be testing Puppeteer's real capability. `list` is the honest
// baseline: a flat, unstructured DOM query for common interactive tags, indexed only by
// document order -- exactly what you'd have to hand-roll yourself with plain Puppeteer.
//
// POST /cmd  {"action":"newTask","url":"..."}
// POST /cmd  {"action":"navigate","url":"..."}
// POST /cmd  {"action":"list"}                      -- flat interactive-element list, indexed
// POST /cmd  {"action":"click","index":N}
// POST /cmd  {"action":"type","index":N,"text":"..."}
// POST /cmd  {"action":"press","index":N,"key":"Enter"}
// POST /cmd  {"action":"text"}
// POST /cmd  {"action":"title"}
import puppeteer from 'puppeteer-core';
import http from 'node:http';

const PORT = process.env.PP_SERVER_PORT || 9445;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browser = await puppeteer.launch({ headless: true, executablePath: CHROME });
let page = await browser.newPage();

const LIST_SCRIPT = `(() => {
  const els = Array.from(document.querySelectorAll('a, button, input, select, textarea'));
  return els.filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }).slice(0, 120).map((el, i) => {
    el.setAttribute('data-pp-idx', String(i));
    return {
      index: i,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || undefined,
      text: (el.innerText || el.value || el.placeholder || '').trim().slice(0, 80),
      href: el.tagName === 'A' ? el.href : undefined,
    };
  });
})()`;

async function handle(body) {
  const { action, ...args } = body;
  switch (action) {
    case 'newTask': {
      await page.close().catch(() => {});
      page = await browser.newPage();
      if (args.url) await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      return { ok: true, url: page.url(), title: await page.title() };
    }
    case 'navigate': {
      await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      return { ok: true, url: page.url(), title: await page.title() };
    }
    case 'list': {
      const els = await page.evaluate(LIST_SCRIPT);
      return { ok: true, url: page.url(), title: await page.title(), elements: els };
    }
    case 'click': {
      // A click that triggers navigation can destroy the execution context right as we try to
      // read title()/url() back -- race, not a real failure. Retry the read once after a beat.
      await page.click(`[data-pp-idx="${args.index}"]`, { timeout: 10000 });
      try {
        return { ok: true, url: page.url(), title: await page.title() };
      } catch {
        await new Promise((r) => setTimeout(r, 500));
        return { ok: true, url: page.url(), title: await page.title() };
      }
    }
    case 'type': {
      const sel = `[data-pp-idx="${args.index}"]`;
      await page.click(sel, { timeout: 10000 });
      await page.evaluate((s) => { document.querySelector(s).value = ''; }, sel);
      await page.type(sel, args.text);
      return { ok: true, typed: args.text };
    }
    case 'press': {
      const sel = `[data-pp-idx="${args.index}"]`;
      await page.focus(sel);
      await page.keyboard.press(args.key);
      return { ok: true, url: page.url() };
    }
    case 'text': {
      const text = await page.evaluate(() => document.body.innerText.slice(0, 3000));
      return { ok: true, url: page.url(), title: await page.title(), text };
    }
    case 'title': {
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

server.listen(PORT, () => console.log(`pp-server listening on ${PORT}`));

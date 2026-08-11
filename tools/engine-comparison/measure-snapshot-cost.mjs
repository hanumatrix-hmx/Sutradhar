// Measures the actual token cost of SutradharRuntime.snapshot()'s output — the thing an LLM
// actually reads on every step of an agent loop — against a few representative real pages.
// Real Sutradhar publishes ~800 tokens/page as a design target; this establishes our own number
// so we're not flying blind on it. No tokenizer package is installed in this repo, so token
// count is the standard ~4-chars-per-token English-text approximation (used by OpenAI/Anthropic
// docs for rough budgeting) — reported alongside raw character/byte counts so the estimate's
// basis is transparent, not hidden behind a single "precise-looking" number.
import { SutradharRuntime } from '../../packages/capability-runtime/dist/index.js';

const HEADLESS = process.env.HEADFUL !== '1';
const CHARS_PER_TOKEN = 4;

const PAGES = [
  { name: 'the-internet.herokuapp.com/login', url: 'https://the-internet.herokuapp.com/login' },
  { name: 'the-internet.herokuapp.com (homepage, long link list)', url: 'https://the-internet.herokuapp.com/' },
  { name: 'saucedemo.com (product grid)', url: 'https://www.saucedemo.com/' },
  { name: 'example.com (minimal page, baseline)', url: 'https://example.com/' },
];

function approxTokens(str) {
  return Math.ceil(str.length / CHARS_PER_TOKEN);
}

async function main() {
  const runtime = new SutradharRuntime({ logger: { info() {}, warn() {}, error() {}, debug() {} } });
  const { sessionId } = await runtime.launch({ headless: HEADLESS });
  const results = [];
  try {
    for (const page of PAGES) {
      await runtime.navigate(sessionId, page.url);
      const snap = await runtime.snapshot(sessionId);
      const serialized = JSON.stringify(snap);
      const interactiveElementsStr = JSON.stringify(snap.interactiveElements);
      results.push({
        page: page.name,
        elementCount: snap.elementCount,
        interactiveElementsChars: interactiveElementsStr.length,
        interactiveElementsApproxTokens: approxTokens(interactiveElementsStr),
        pageTextChars: snap.pageText.length,
        pageTextApproxTokens: approxTokens(snap.pageText),
        fullSnapshotChars: serialized.length,
        fullSnapshotApproxTokens: approxTokens(serialized),
      });
    }
  } finally {
    await runtime.shutdown(sessionId).catch(() => {});
  }
  return results;
}

const results = await main();
console.log(JSON.stringify(results, null, 2));

const avgFullTokens = Math.round(results.reduce((s, r) => s + r.fullSnapshotApproxTokens, 0) / results.length);
console.log(`\nAverage full-snapshot size across ${results.length} pages: ~${avgFullTokens} tokens (${CHARS_PER_TOKEN} chars/token approximation)`);

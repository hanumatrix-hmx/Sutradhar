// Long-lived, real-stdio-MCP reliability soak for PROB-043.
//
// The failure oracle deliberately does not trust browser.type's handle-based verification:
// every claimed success is cross-checked with a separate browser.eval call that freshly queries
// the top-level DOM and the fixture's application-owned state. Results are append-only JSONL so
// a crash or forced stop retains every completed operation.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const serverPath = path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js');
const fixtureUrl = pathToFileURL(
  path.join(repoRoot, 'tools', 'scenario-suite', 'fixtures', 'prob043-keyboard.html'),
).href;

const targetCalls = positiveInt(process.env.PROB043_CALLS, 1000);
const minimumMinutes = nonNegativeNumber(process.env.PROB043_MINUTES, 0);
const headless = process.env.HEADFUL !== '1';
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const outputDir = path.resolve(process.env.PROB043_OUTPUT_DIR ?? path.join(here, 'results'));
const outputPath = path.join(outputDir, `prob043-mcp-soak-${runId}.jsonl`);

let child;
let stdoutBuffer = '';
let nextRequestId = 1;
let callCount = 0;
let mismatchCount = 0;
const pending = new Map();
const stderrTail = [];
let sessionId;

function positiveInt(raw, fallback) {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Expected a positive integer, got ${raw}`);
  return value;
}

function nonNegativeNumber(raw, fallback) {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Expected a non-negative number, got ${raw}`);
  return value;
}

async function record(kind, payload = {}) {
  const entry = { timestamp: new Date().toISOString(), kind, callCount, ...payload };
  await fs.appendFile(outputPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function startServer() {
  child = spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    env: { ...process.env, SUTRADHAR_IDLE_TIMEOUT_MS: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString('utf8');
    let newline;
    while ((newline = stdoutBuffer.indexOf('\n')) >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id === undefined || !pending.has(message.id)) continue;
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(`JSON-RPC error: ${JSON.stringify(message.error)}`));
      else waiter.resolve(message.result);
    }
  });

  child.stderr.on('data', (chunk) => {
    stderrTail.push(chunk.toString('utf8'));
    if (stderrTail.length > 100) stderrTail.shift();
  });

  child.on('exit', (code, signal) => {
    const error = new Error(`MCP server exited before shutdown (code=${code}, signal=${signal})`);
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
  });
}

function mcpCall(method, params, timeoutMs = 60_000) {
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method} (request ${id})`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

async function initialize() {
  await mcpCall('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'prob043-mcp-soak', version: '1.0.0' },
  });
  notify('notifications/initialized', {});
  const listed = await mcpCall('tools/list', {});
  return listed.tools?.length ?? 0;
}

function textOf(result) {
  return result?.content?.[0]?.text ?? '';
}

function jsonOf(result) {
  const text = textOf(result);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected JSON tool output, received ${JSON.stringify(text.slice(0, 500))}: ${error.message}`);
  }
}

async function tool(name, args, options = {}) {
  callCount++;
  const startedAt = Date.now();
  const result = await mcpCall('tools/call', { name, arguments: args }, options.timeoutMs ?? 60_000);
  const durationMs = Date.now() - startedAt;
  if (result?.isError) {
    await record('tool-error', { name, durationMs, args, response: textOf(result) });
    throw new Error(`${name} returned MCP isError: ${textOf(result)}`);
  }
  await record('tool', { name, durationMs, args: options.logArgs === false ? undefined : args });
  return result;
}

async function evaluate(code, tabId) {
  return jsonOf(await tool('browser.eval', { sessionId, tabId, code })).result;
}

async function probe(selector, tabId) {
  return evaluate(
    `(() => {
      const selector = ${JSON.stringify(selector)};
      const element = document.querySelector(selector);
      const id = element?.id ?? null;
      return {
        selector,
        matchCount: document.querySelectorAll(selector).length,
        id,
        value: element && 'value' in element ? element.value : null,
        applicationValue: id ? window.__prob043Probe?.applicationValues?.[id] ?? null : null,
        events: id ? window.__prob043Probe?.events?.[id] ?? null : null,
        activeElementId: document.activeElement?.id ?? null,
        bootId: window.__prob043Probe?.bootId ?? null,
        url: location.href,
      };
    })()`,
    tabId,
  );
}

async function checkedType(selector, value, tabId, cycle, fieldKind) {
  const action = jsonOf(
    await tool('browser.type', { sessionId, tabId, target: selector, value }, { logArgs: false }),
  );
  const independent = await probe(selector, tabId);
  const matches = independent.value === value && independent.applicationValue === value;
  const claimedVerified = action.success === true && action.verification?.verified === true;

  await record('type-check', {
    cycle,
    fieldKind,
    selector,
    expected: value,
    action: {
      success: action.success,
      error: action.error,
      verification: action.verification,
      executionTimeMs: action.executionTimeMs,
      retriesUsed: action.retriesUsed,
    },
    independent,
    matches,
  });

  if (!action.success || !matches || (action.verification && !action.verification.verified)) {
    if (claimedVerified && !matches) mismatchCount++;
    const diagnostic = await evaluate(
      `({
        title: document.title,
        readyState: document.readyState,
        activeElement: document.activeElement?.outerHTML?.slice(0, 500) ?? null,
        probeBootId: window.__prob043Probe?.bootId ?? null,
        bodyText: document.body?.innerText?.slice(0, 500) ?? null
      })`,
      tabId,
    ).catch((error) => ({ diagnosticError: error.message }));
    await record('mismatch', { cycle, fieldKind, selector, expected: value, action, independent, diagnostic });
    throw new Error(
      `Keyboard oracle mismatch at cycle ${cycle} for ${selector}: ` +
        `actionSuccess=${action.success}, verified=${action.verification?.verified}, ` +
        `DOM=${JSON.stringify(independent.value)}, app=${JSON.stringify(independent.applicationValue)}`,
    );
  }
}

async function checkedPress(selector, baseValue, key, expectedValue, tabId, cycle) {
  await checkedType(selector, baseValue, tabId, cycle, 'press-base');
  await tool('browser.focus', { sessionId, tabId, target: selector });
  const action = jsonOf(await tool('browser.press_key', { sessionId, tabId, key }));
  const independent = await probe(selector, tabId);
  const matches = independent.value === expectedValue && independent.applicationValue === expectedValue;
  await record('press-check', { cycle, selector, key, expected: expectedValue, action, independent, matches });
  if (!action.success || !matches) {
    await record('mismatch', { cycle, fieldKind: 'press', selector, expected: expectedValue, action, independent });
    throw new Error(
      `Press oracle mismatch at cycle ${cycle} for ${selector}: ` +
        `actionSuccess=${action.success}, DOM=${JSON.stringify(independent.value)}, ` +
        `app=${JSON.stringify(independent.applicationValue)}`,
    );
  }
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, '', 'utf8');
  const startedAt = Date.now();
  const minimumDurationMs = minimumMinutes * 60_000;
  let outcome = 'failed';
  let primaryTabId;

  await record('run-start', {
    runId,
    targetCalls,
    minimumMinutes,
    headless,
    node: process.version,
    serverPath,
    fixtureUrl,
  });

  try {
    startServer();
    const toolCount = await initialize();
    await record('mcp-ready', { toolCount, serverPid: child.pid });

    const launch = jsonOf(await tool('browser.launch', { headless, initialUrl: fixtureUrl }));
    sessionId = launch.sessionId;
    primaryTabId = launch.activeTabId;
    if (!primaryTabId) {
      const tabs = jsonOf(await tool('browser.list_tabs', { sessionId })).tabs;
      primaryTabId = tabs.find((tab) => tab.url === fixtureUrl)?.tabId ?? tabs[0]?.tabId;
    }
    if (!sessionId || !primaryTabId) throw new Error('Launch did not return a usable session/tab');

    await evaluate(`document.getElementById('ready')?.textContent`, primaryTabId);
    let cycle = 0;
    while (callCount < targetCalls || Date.now() - startedAt < minimumDurationMs) {
      const index = cycle % 64;
      await checkedType(`#plain-${index}`, `plain-${cycle}`, primaryTabId, cycle, 'plain');
      await checkedType(`#controlled-${index}`, `controlled-${cycle}`, primaryTabId, cycle, 'controlled');
      await checkedPress(`#press-${index}`, `press-${cycle}`, 'a', `press-${cycle}a`, primaryTabId, cycle);

      if (cycle % 8 === 0) {
        await tool('browser.snapshot', {
          sessionId,
          tabId: primaryTabId,
          maxElements: 12,
          noText: true,
        });
      }

      if (cycle > 0 && cycle % 20 === 0) {
        const extra = jsonOf(await tool('browser.new_tab', { sessionId, url: fixtureUrl }));
        await tool('browser.snapshot', { sessionId, tabId: extra.id, maxElements: 5, noText: true });
        await tool('browser.close_tab', { sessionId, tabId: extra.id });
      }

      if (cycle > 0 && cycle % 40 === 0) {
        await tool('browser.reload', { sessionId, tabId: primaryTabId });
        await evaluate(`document.getElementById('ready')?.textContent`, primaryTabId);
      }

      if (cycle % 10 === 0) {
        await record('checkpoint', {
          cycle,
          elapsedMs: Date.now() - startedAt,
          rssBytes: process.memoryUsage().rss,
          heapUsedBytes: process.memoryUsage().heapUsed,
          mismatches: mismatchCount,
        });
      }
      cycle++;
    }

    outcome = 'passed';
  } catch (error) {
    await record('run-error', { error: error.stack ?? error.message, stderrTail }).catch(() => {});
    throw error;
  } finally {
    if (sessionId && child?.exitCode === null) {
      await tool('browser.shutdown', { sessionId }, { logArgs: false }).catch(() => {});
    }
    if (child?.exitCode === null) {
      const waitForExit = () =>
        new Promise((resolve) => {
          child.once('exit', (code, signal) => resolve({ code, signal }));
        });
      let exitPromise = waitForExit();
      child.stdin.end();
      let exit = await Promise.race([
        exitPromise,
        new Promise((resolve) => setTimeout(() => resolve(null), 5_000)),
      ]);
      if (!exit && child.exitCode === null) {
        child.kill();
        exitPromise = waitForExit();
        await Promise.race([
          exitPromise,
          new Promise((resolve) => setTimeout(() => resolve(null), 2_000)),
        ]);
      }
    }
    await record('run-end', {
      outcome,
      elapsedMs: Date.now() - startedAt,
      mismatchCount,
      serverExitCode: child?.exitCode ?? null,
      stderrTail,
    }).catch(() => {});
    process.stderr.write(`[prob043-soak] ${outcome} calls=${callCount} mismatches=${mismatchCount} result=${outputPath}\n`);
  }
}

await main();

// PinchTab background service worker.
//
// Two responsibilities:
//   1. Connection state — track whether the PinchTab server is reachable and expose it to
//      the popup. Settings (server URL + remote-debugging port) live in chrome.storage.
//   2. Command relay — when the popup submits a goal, POST it to the PinchTab server's
//      agent endpoint. The server attaches to the user's Chrome (exposed via
//      --remote-debugging-port) and drives it.
//
// Future (seamless) path: instead of requiring --remote-debugging-port, this worker can
// expose the active tab via chrome.debugger.attach and relay CDP frames to the server over
// a WebSocket. That removes the launch-flag requirement but needs a full CDP bridge; see
// README "Future work".

const DEFAULTS = { serverUrl: 'http://127.0.0.1:8081', debugPort: 9222 };

async function getSettings() {
  const s = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}

async function pingServer(url) {
  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/health`, { method: 'GET' });
    return r.ok;
  } catch {
    return false;
  }
}

// Listen for messages from the popup.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'PING') {
      const { serverUrl } = await getSettings();
      sendResponse({ ok: await pingServer(serverUrl) });
      return;
    }
    if (msg.type === 'RUN_GOAL') {
      const { serverUrl } = await getSettings();
      try {
        const r = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/v1/agents/goals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal: msg.goal }),
        });
        const data = await r.json();
        sendResponse({ ok: r.ok, data });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return;
    }
    if (msg.type === 'GET_SETTINGS') {
      sendResponse(await getSettings());
      return;
    }
    if (msg.type === 'SAVE_SETTINGS') {
      await chrome.storage.local.set(msg.settings);
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, error: 'unknown message type' });
  })();
  return true; // keep the channel open for the async sendResponse
});

// On install, seed default settings.
chrome.runtime.onInstalled.addListener(async () => {
  const cur = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const settings = { ...DEFAULTS, ...cur };
  await chrome.storage.local.set(settings);
});

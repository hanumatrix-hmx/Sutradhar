// PinchTab popup script — goal submission + settings UI.
// Talks to the background service worker via chrome.runtime.sendMessage.

const $ = (id) => document.getElementById(id);
const send = (type, extra = {}) =>
  new Promise((resolve) => chrome.runtime.sendMessage({ type, ...extra }, resolve));

function setStatus(state, text) {
  const el = $('status');
  el.textContent = text;
  el.className = `status status--${state}`;
}

function showResult(cls, text) {
  const el = $('result');
  el.textContent = text;
  el.className = `result result--${cls}`;
}

async function refreshStatus() {
  setStatus('unknown', 'checking…');
  const r = await send('PING');
  if (r?.ok) setStatus('ok', 'connected');
  else setStatus('bad', 'no server');
}

// Load settings into the form.
(async () => {
  const s = await send('GET_SETTINGS');
  $('serverUrl').value = s.serverUrl;
  $('debugPort').value = s.debugPort;
  $('portEcho').textContent = s.debugPort;
  await refreshStatus();
})();

$('run').addEventListener('click', async () => {
  const goal = $('goal').value.trim();
  if (!goal) return;
  $('run').disabled = true;
  showResult('ok', 'Running… (the agent is attaching to this browser and working)');
  const r = await send('RUN_GOAL', { goal });
  $('run').disabled = false;
  if (r?.ok) {
    const d = r.data;
    showResult('ok', `Status: ${d.status ?? '?'}\nAnswer: ${d.answer ?? '(none)'}\nSummary: ${d.summary ?? '(none)'}`);
  } else {
    showResult('bad', `Failed: ${r?.error ?? 'unknown error'}`);
  }
});

$('save').addEventListener('click', async () => {
  const settings = {
    serverUrl: $('serverUrl').value.trim(),
    debugPort: Number($('debugPort').value),
  };
  await send('SAVE_SETTINGS', { settings });
  $('portEcho').textContent = settings.debugPort;
  await refreshStatus();
});

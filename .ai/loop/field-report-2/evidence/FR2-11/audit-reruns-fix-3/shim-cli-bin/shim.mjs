const displayFrameUrl = (x) => x;
import path from "node:path";
var HISTORY_STRING_CAP = 200;
var HISTORY_TEXT_CAP = 300;
var CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
function capHistoryString(s, cap2 = HISTORY_STRING_CAP) {
  const flat = s.replace(CONTROL_CHARS, " ");
  return flat.length <= cap2 ? flat : flat.slice(0, cap2 - 1) + "\u2026";
}
var REDACTED_PLACEHOLDER = "[redacted]";
var MAX_REDACT_INPUT = 8e3;
function basenameOfPath(p) {
  const parts = p.split(/[\\/]+/).filter((x) => x !== "");
  return parts.length === 0 ? "" : parts[parts.length - 1];
}
var FILE_URL_PREFIX = "file://\u2026/";
function redactHistoryUrl(url) {
  if (url === "")
    return "(no url)";
  return redactHistoryText(redactHistoryUrlD5(decodeDelimiters(url)));
}
function redactHistoryUrlD5(url) {
  const cutAtDelimiter = (s) => s.replace(/[?#;].*$/s, "");
  const fallback = () => cutAtDelimiter(url);
  let u;
  try {
    u = new URL(url);
  } catch {
    return fallback();
  }
  switch (u.protocol) {
    case "http:":
    case "https:":
    case "ws:":
    case "wss:":
      return u.origin + cutAtDelimiter(u.pathname);
    case "file:":
      return FILE_URL_PREFIX + basenameOfPath(u.pathname);
    case "blob:": {
      try {
        return "blob:" + new URL(u.pathname).origin;
      } catch {
        return "blob:\u2026";
      }
    }
    case "data:":
      return "data:\u2026";
    case "javascript:":
    case "vbscript:":
      return u.protocol + "\u2026";
    case "about:":
      return "about:" + cutAtDelimiter(u.pathname);
    default:
      return u.host && !u.username && !u.password ? `${u.protocol}//${u.host}${cutAtDelimiter(u.pathname)}` : fallback();
  }
}
var WS_SPLIT = /([\s\u0000-\u001f\u007f\u0085\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]+)/;
var TRUE_WS = /([\t-\r \u0000-\u001f\u007f\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+)/;
var SUB_DELIM = new RegExp("(\\\\*['\"`]|[,()[\\]{}|^]|<(?!dir>)|(?<!<dir)>|\\p{Cf}+)", "gu");
var IPV6_HOST = /(?<=\/\/|@)\[[0-9A-Fa-f:.%]+\]/g;
var SCHEME_SEP = /:(?:\\?\/){2,}/;
var SCHEME_NAME_END = /[A-Za-z][A-Za-z0-9+.-]*$/;
function schemeEnd(t) {
  const m = SCHEME_SEP.exec(t);
  if (!m)
    return -1;
  const pre = t.slice(0, m.index);
  if (!SCHEME_NAME_END.test(pre) || /[/\\]/.test(pre.replace(/\\["']/g, "")))
    return -1;
  return m.index + m[0].length;
}
var MARKER_START = String.raw`(?:(?<![A-Za-z0-9])|(?<=\\[tnrfbv]))`;
var OPAQUE_BODY = new RegExp(`${MARKER_START}(?:data|javascript|vbscript):`, "i");
var FILE_TOKEN = new RegExp(`${MARKER_START}file:`, "i");
var BLOB_TOKEN = /(?:(?<![A-Za-z0-9])|(?<=\\[tnrfbv]))blob:((?:[A-Za-z][A-Za-z0-9+.-]*:(?:\\?\/){2})?[^\s/\\?#;]*)/i;
var SEP_THEN_TEXT = /[\\/][^\\/]/;
var HAS_EXTENSION = /\w\.\w|^\.\w/;
var URLISH = /[/\\@%]|:[0-9/]|:$|^[^A-Za-z0-9]*(?:about|chrome|chrome-error|edge|view-source|blob|file|data|javascript|mailto|tel|urn|ws|wss|ftp|http|https):/i;
var TOKEN_URLISH = /[/\\@%:]/;
var DIR_PLACEHOLDER = "<dir>";
var IDENT_CHAR = /[\w\-\\]|[\u0080-\uffff]/;
var BARE_ID = /^#(?:[\w\-\\]|[\u0080-\uffff])+$/;
var PERCENT_DELIM = /%(3[AFBDafbd]|23|26|2[Ff]|40|5[Cc])/g;
var JSON_ESC_DELIM = /\\(?:u00|x)(3[AFBDafbd]|23|26|2[Ff]|40|5[Cc])/g;
function decodeDelimiters(s) {
  let out = s.normalize("NFKC");
  out = out.replace(JSON_ESC_DELIM, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  for (let i = 0; i < 8; i++) {
    const n = out.replace(/%25(?=[0-9a-fA-F]{2})/g, "%");
    if (n === out)
      break;
    out = n;
  }
  return out.replace(PERCENT_DELIM, (_m, h) => String.fromCharCode(parseInt(h, 16)));
}
function stripUserinfo(t) {
  if (!t.includes("@"))
    return t;
  const parts = t.split("@");
  let acc = parts[0];
  for (let k = 1; k < parts.length; k++)
    acc = acc.slice(0, acc.lastIndexOf("/") + 1) + parts[k];
  return acc;
}
function urlSpanEnd(t, from) {
  for (let i = from; i < t.length; i++)
    if (t[i] === "\\" && t[i + 1] !== "/")
      return i;
  return t.length;
}
function reduceLoosePath(t) {
  if (!SEP_THEN_TEXT.test(t))
    return t;
  const name = basenameOfPath(t);
  return HAS_EXTENSION.test(name) ? name : DIR_PLACEHOLDER;
}
function reduceBeforeMarker(prefix) {
  const r = reducePathToken(prefix);
  const tail = /[^A-Za-z0-9]+$/.exec(prefix);
  return tail && /[A-Za-z0-9]$/.test(r) ? r + tail[0] : r;
}
function reducePathToken(t) {
  const file = FILE_TOKEN.exec(t);
  if (file) {
    const base = basenameOfPath(t.slice(file.index + file[0].length));
    return reduceBeforeMarker(t.slice(0, file.index)) + FILE_URL_PREFIX + (base === "" || /^[.…]+$/.test(base) ? "\u2026" : HAS_EXTENSION.test(base) ? base : DIR_PLACEHOLDER);
  }
  const blob = BLOB_TOKEN.exec(t);
  if (blob)
    return reduceBeforeMarker(t.slice(0, blob.index)) + "blob:" + blob[1];
  const end = schemeEnd(t);
  if (end >= 0) {
    const span = urlSpanEnd(t, end);
    return span >= t.length ? t : t.slice(0, span) + reduceLoosePath(t.slice(span));
  }
  return reduceLoosePath(t);
}
function splitSubTokens(head) {
  const hosts = [...head.matchAll(IPV6_HOST)].map((m) => [m.index, m.index + m[0].length]);
  const out = [];
  let last = 0;
  for (const m of head.matchAll(SUB_DELIM)) {
    const at = m.index;
    if (hosts.some(([from, to]) => at >= from && at < to))
      continue;
    out.push(head.slice(last, at), m[0]);
    last = at + m[0].length;
  }
  out.push(head.slice(last));
  return out;
}
function reducePathTokens(head, suffix) {
  const parts = splitSubTokens(head);
  parts[parts.length - 1] += suffix;
  return parts.map((p, i) => i % 2 === 1 || p === "" ? p : reducePathToken(p)).join("");
}
function redactToken(tok, selector, afterUrlish) {
  const opaque = OPAQUE_BODY.exec(tok);
  if (opaque) {
    const pre = opaque.index > 0 ? redactToken(tok.slice(0, opaque.index), selector, afterUrlish) : null;
    if (pre?.swallow)
      return pre;
    return { out: (pre?.out ?? "") + opaque[0].toLowerCase() + "\u2026", swallow: true };
  }
  let cutAt = -1;
  for (let i = 0; i < tok.length; i++) {
    const c = tok[i];
    if (c === "?" || c === ";") {
      cutAt = i;
      break;
    }
    if (c === "#" && (!selector || afterUrlish || TOKEN_URLISH.test(tok.slice(0, i)) || !IDENT_CHAR.test(tok[i + 1] ?? ""))) {
      cutAt = i;
      break;
    }
  }
  let head = cutAt < 0 ? tok : tok.slice(0, cutAt);
  const swallow2 = cutAt >= 0 && !(cutAt === 0 && BARE_ID.test(tok));
  head = stripUserinfo(head);
  const probe = selector ? head.replace(/\[[^\]]*\]?/g, "") : head;
  if (/=/.test(probe) || head.includes("&")) {
    return { out: REDACTED_PLACEHOLDER, swallow: swallow2 || head.includes("&") };
  }
  const suffix = cutAt >= 0 ? REDACTED_PLACEHOLDER : "";
  return { out: selector && /\[[^\]]*=/.test(head) ? head + suffix : stripUserinfo(reducePathTokens(head, suffix)), swallow: swallow2 };
}
function redactHistoryText(text, opts = {}) {
  const selector = opts.mode === "selector";
  const raw = text.length > MAX_REDACT_INPUT ? text.slice(0, MAX_REDACT_INPUT) : text;
  const decoded = decodeDelimiters(raw);
  const input = decoded.split(TRUE_WS).map((p, i) => i % 2 === 1 ? p : stripUserinfo(p)).join("");
  const parts = input.split(WS_SPLIT);
  if (raw.length < text.length && parts[parts.length - 1] !== "")
    parts[parts.length - 1] = REDACTED_PLACEHOLDER;
  const out = [];
  let afterUrlish = selector && decoded !== raw;
  for (let i = 0; i < parts.length; i += 2) {
    const tok = parts[i];
    const ws = i > 0 ? parts[i - 1] : "";
    if (tok === "") {
      out.push(ws);
      continue;
    }
    const r = redactToken(tok, selector, afterUrlish);
    out.push(ws, r.out);
    if (r.swallow)
      break;
    afterUrlish = afterUrlish || URLISH.test(tok);
  }
  return out.join("");
}
var redactHistorySelector = (text) => redactHistoryText(text, { mode: "selector" });
var EVAL_WS = new RegExp(`[^\\S${String.fromCharCode(65279)}]+`, "g");
function evalCodePreview(code) {
  return capHistoryString(redactHistoryText(code.replace(EVAL_WS, " ").trim()), HISTORY_STRING_CAP);
}
var WAIT_STATE_TARGET = /^state=(?:visible|hidden|attached|detached)$/;
var uploadTarget = (name) => HAS_EXTENSION.test(name) ? redactedString(name, HISTORY_STRING_CAP) : DIR_PLACEHOLDER;
var redactedString = (s, cap2) => capHistoryString(redactHistoryText(s), cap2);
var KEY_EQ = String.fromCharCode(57344);
var CONDITION_KEY = /(^| AND )(textGone|text)="/g;
function conditionSelector(s) {
  return redactHistoryText(s.replace(CONDITION_KEY, (_m, sep, k) => `${sep}${k}${KEY_EQ}"`)).split(KEY_EQ).join("=");
}
function sanitizeHistoryEntry(e) {
  const out = { ...e };
  if (typeof e.selector === "string") {
    out.selector = capHistoryString(e.actionType === "wait_for" ? conditionSelector(e.selector) : redactHistorySelector(e.selector), HISTORY_STRING_CAP);
  }
  if (typeof e.target === "string") {
    out.target = e.actionType === "navigate" ? capHistoryString(redactHistoryUrl(e.target), HISTORY_STRING_CAP) : e.actionType === "eval" ? evalCodePreview(e.target) : e.actionType === "upload_file" || e.actionType === "upload_file_via_trigger" ? uploadTarget(e.target) : WAIT_STATE_TARGET.test(e.target) ? e.target : redactedString(e.target, HISTORY_STRING_CAP);
  }
  if (typeof e.url === "string")
    out.url = capHistoryString(redactHistoryUrl(e.url), HISTORY_STRING_CAP);
  if (typeof e.error === "string")
    out.error = redactedString(e.error, HISTORY_TEXT_CAP);
  if (e.verification)
    out.verification = sanitizeVerification(e.verification);
  for (const k of Object.keys(out))
    if (out[k] === void 0)
      delete out[k];
  return out;
}
function sanitizeVerification(v) {
  const scalar = (x) => typeof x === "string" ? redactedString(x, HISTORY_STRING_CAP) : x;
  const out = { ...v };
  if (typeof v.reason === "string")
    out.reason = redactedString(v.reason, HISTORY_TEXT_CAP);
  const ev = v.evidence;
  if (ev && typeof ev === "object") {
    const evOut = { ...ev };
    if (Array.isArray(ev.checks)) {
      evOut.checks = ev.checks.map((c) => {
        const cOut = { ...c };
        if ("expected" in c)
          cOut.expected = scalar(c.expected);
        if ("observed" in c)
          cOut.observed = scalar(c.observed);
        if (typeof c.detail === "string")
          cOut.detail = redactedString(c.detail, HISTORY_TEXT_CAP);
        for (const k of Object.keys(cOut))
          if (cOut[k] === void 0)
            delete cOut[k];
        return cOut;
      });
    }
    out.evidence = evOut;
  }
  return out;
}
function describeActionTarget(params) {
  switch (params.actionType) {
    case "navigate":
      return params.url;
    case "press_key":
      return params.key === void 0 ? void 0 : [...params.modifiers ?? [], params.key].join("+");
    case "click_by_text":
      return params.text;
    case "click_by_role":
      return params.role === void 0 ? void 0 : params.name ? `${params.role} "${params.name}"` : params.role;
    case "type_by_label":
      return params.label;
    case "scroll": {
      const t = [params.direction, params.amount].filter((x) => x !== void 0).join(" ");
      return t === "" ? void 0 : t;
    }
    case "wait":
      return params.milliseconds === void 0 ? void 0 : `${params.milliseconds}ms`;
    case "wait_for_selector":
      return `state=${params.state ?? "visible"}`;
    case "upload_file":
      return params.filePath === void 0 ? void 0 : path.basename(params.filePath.replace(/\\/g, "/"));
    default:
      return void 0;
  }
}
function scrubVerification(params, v) {
  const s = (x) => typeof x === "string" ? scrubActionError(params, x) : x;
  const out = { ...v };
  if (typeof v.reason === "string")
    out.reason = scrubActionError(params, v.reason);
  const ev = v.evidence;
  if (ev && typeof ev === "object") {
    const evOut = { ...ev };
    if (Array.isArray(ev.checks)) {
      evOut.checks = ev.checks.map((c) => {
        const cOut = { ...c };
        if ("expected" in c)
          cOut.expected = s(c.expected);
        if ("observed" in c)
          cOut.observed = s(c.observed);
        if ("detail" in c)
          cOut.detail = s(c.detail);
        return cOut;
      });
    }
    out.evidence = evOut;
  }
  return out;
}
function scrubActionError(params, error) {
  const landed = error.indexOf("type did not land the expected value");
  if ((params.actionType === "type" || params.actionType === "type_by_label") && landed >= 0) {
    return error.slice(0, landed) + "type did not land the expected value (the typed text and the field content are not recorded)";
  }
  let out = error;
  for (const value of [params.value, ...params.values ?? []]) {
    if (typeof value === "string" && value.length >= 3) {
      out = out.split(JSON.stringify(value)).join("<value>").split(value).join("<value>");
    }
  }
  return out;
}

import { open as open2, readFile as readFile4, rename, stat as stat6, mkdir as mkdir4 } from "node:fs/promises";
import os6 from "node:os";
import path11 from "node:path";
var HISTORY_SCHEMA_VERSION = 1;
var HISTORY_MAX_LINE_BYTES = 64 * 1024;
var HISTORY_ROTATE_BYTES = 5 * 1024 * 1024;
var HISTORY_ROTATED_FILE_NAME = "history.1.jsonl";
var ARG_CAP = 200;
var ERROR_CAP = 300;
var ARGS_KEPT_WHEN_OVER_GUARD = 20;
var SELECTOR_ARG_INDEXES = {
  click: [0],
  hover: [0],
  type: [0],
  select: [0],
  press: [0],
  drag: [0, 1],
  upload: [0],
  download: [0]
};
function redactCwd(cwd, home = os6.homedir()) {
  if (cwd === "<dir>" || cwd === "~" || cwd.startsWith("~/")) return cwd;
  const norm = (p) => p.replace(/[\\/]+/g, "/").replace(/\/$/, "");
  const c = norm(cwd);
  const h = norm(home);
  if (h === "" || h === "/") return "<dir>";
  const ci = /^[A-Za-z]:/.test(h) || h.startsWith("//");
  const cmp = (x) => ci ? x.toLowerCase() : x;
  if (cmp(c) === cmp(h)) return "~";
  if (cmp(c).startsWith(cmp(h) + "/")) return "~" + c.slice(h.length);
  return "<dir>";
}
var lenTag = (s) => `<${s.length} chars>`;
var URL_ARG_INDEXES = { nav: [0], newtab: [0], audit: [0], compare: [0, 1] };
var PATH_ARG_INDEXES = {
  upload: [1],
  screenshot: [0],
  compare: [2]
};
var DIR_ARG_INDEXES = { download: [1], audit: [1] };
function redactCliArgs(verb2, args) {
  const fin = (a) => capHistoryString(redactHistoryText(a), ARG_CAP);
  const finSel = (a) => capHistoryString(redactHistorySelector(a), ARG_CAP);
  const selIdx = SELECTOR_ARG_INDEXES[verb2] ?? [];
  const urlIdx = URL_ARG_INDEXES[verb2] ?? [];
  const pathIdx = PATH_ARG_INDEXES[verb2] ?? [];
  const dirIdx = DIR_ARG_INDEXES[verb2] ?? [];
  const perArg = (a, i) => dirIdx.includes(i) ? "<dir>" : pathIdx.includes(i) ? fin(basenameOfPath(redactHistoryText(a)) || "\u2026") : urlIdx.includes(i) ? fin(redactHistoryUrl(a)) : selIdx.includes(i) ? finSel(a) : fin(a);
  switch (verb2) {
    case "type":
    case "select":
      return args.length === 0 ? [] : [finSel(args[0]), ...args.length > 1 ? [lenTag(args.slice(1).join(" "))] : []];
    case "setclipboard":
      return [lenTag(args.join(" "))];
    case "eval":
      return args.length === 0 ? [] : [evalCodePreview(args.join(" "))];
    case "dialog":
      return args.length === 0 ? [] : [fin(args[0]), ...args.length > 1 ? [lenTag(args.slice(1).join(" "))] : []];
    default:
      return args.map(perArg);
  }
}
function secretsOfCliArgs(verb2, args) {
  switch (verb2) {
    case "type":
    case "select":
      return args.length > 1 ? [args.slice(1).join(" ")] : [];
    case "setclipboard":
      return [args.join(" ")];
    case "dialog":
      return args.length > 1 ? [args.slice(1).join(" ")] : [];
    default:
      return [];
  }
}
function scrubDeep(value, secrets) {
  const usable = secrets.filter((s) => s.length >= 3);
  if (usable.length === 0) return value;
  const scrubString = (s) => {
    let out = s;
    for (const secret of usable) out = out.split(secret).join("<redacted>");
    return out;
  };
  const walk = (x) => {
    if (typeof x === "string") return scrubString(x);
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") {
      const o = {};
      for (const [k, v] of Object.entries(x)) o[k] = walk(v);
      return o;
    }
    return x;
  };
  return walk(value);
}
function buildHistoryLine(input) {
  const secrets = input.secrets ?? [];
  const actions = scrubDeep(
    (input.actions ?? []).map((a) => sanitizeHistoryEntry(a)),
    secrets
  );
  const error = input.error !== void 0 ? capHistoryString(redactHistoryText(scrubDeep(input.error, secrets)), ERROR_CAP) : void 0;
  const line = {
    v: HISTORY_SCHEMA_VERSION,
    type: "command",
    ts: input.ts,
    sessionId: input.sessionId,
    cwd: redactCwd(input.cwd, input.home),
    verb: input.verb,
    args: [...input.args],
    exitCode: input.exitCode,
    durationMs: input.durationMs,
    ...error !== void 0 ? { error } : {},
    actions,
    actionsEvicted: input.actionsEvicted ?? 0,
    ...input.actionsUnavailable !== void 0 ? { actionsUnavailable: capHistoryString(redactHistoryText(input.actionsUnavailable), ERROR_CAP) } : {}
  };
  if (Buffer.byteLength(JSON.stringify(line), "utf-8") >= HISTORY_MAX_LINE_BYTES) {
    const omitted = line.actions.length;
    line.actions = [];
    line.truncated = true;
    line.actionsOmitted = omitted;
    if (Buffer.byteLength(JSON.stringify(line), "utf-8") >= HISTORY_MAX_LINE_BYTES) {
      line.args = line.args.slice(0, ARGS_KEPT_WHEN_OVER_GUARD);
    }
  }
  return line;
}
async function appendHistoryLine(file, line, deps = {}) {
  const rotateBytes = deps.rotateBytes ?? HISTORY_ROTATE_BYTES;
  try {
    const dir = path11.dirname(file);
    await mkdir4(dir, { recursive: true });
    let rotated = false;
    try {
      const st = await stat6(file);
      if (st.isFile() && st.size >= rotateBytes) {
        await rename(file, path11.join(dir, HISTORY_ROTATED_FILE_NAME));
        rotated = true;
      }
    } catch {
    }
    const payload = JSON.stringify(line) + "\n";
    const fh = await open2(file, "a+", 384);
    try {
      let prefix = "";
      const size = (await fh.stat()).size;
      if (size > 0) {
        const last = Buffer.alloc(1);
        const { bytesRead } = await fh.read(last, 0, 1, size - 1);
        if (bytesRead === 1 && last[0] !== 10) prefix = "\n";
      }
      const buf = Buffer.from(prefix + payload, "utf-8");
      let written = 0;
      while (written < buf.length) {
        const { bytesWritten } = await fh.write(buf, written, buf.length - written);
        written += bytesWritten;
      }
    } finally {
      await fh.close();
    }
    return { ok: true, rotated };
  } catch (e) {
    return { ok: false, code: e?.code ?? "UNKNOWN" };
  }
}
async function readHistoryFile(file) {
  let text;
  try {
    text = await readFile4(file, "utf-8");
  } catch (e) {
    if (e?.code === "ENOENT") return { lines: [], skipped: 0, rotatedExists: await rotatedExists(file) };
    throw e;
  }
  const lines = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === "") continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      skipped++;
      continue;
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Number.isInteger(parsed.v) && parsed.v > 0) {
      lines.push({ raw, parsed });
    } else {
      skipped++;
    }
  }
  return { lines, skipped, rotatedExists: await rotatedExists(file) };
}
async function rotatedExists(file) {
  try {
    return (await stat6(path11.join(path11.dirname(file), HISTORY_ROTATED_FILE_NAME))).isFile();
  } catch {
    return false;
  }
}
var firstLine2 = (s, cap2) => capHistoryString(s.split(/\r?\n/, 1)[0] ?? "", cap2);
function middleTruncate(s, max) {
  if (s.length <= max) return s;
  const head = Math.floor((max - 1) / 2);
  const tail = max - 1 - head;
  return `${s.slice(0, head)}\u2026${s.slice(s.length - tail)}`;
}
function displayCommandText(verb2, args) {
  const sel = SELECTOR_ARG_INDEXES[verb2] ?? [];
  const shown = [redactHistoryText(verb2), ...args.map((a, i) => sel.includes(i) ? redactHistorySelector(a) : redactHistoryText(a))].join(" ");
  return capHistoryString(shown.replace(/\b(?:https?|wss?|blob):\/\/\S+/gi, (m) => displayFrameUrl(m)), 200);
}
var ts19 = (ts) => `${ts.slice(0, 19).replace("T", " ")}Z`;
function verifLabel(v) {
  const ver = v;
  if (!ver || typeof ver !== "object") return "no-verification";
  if (typeof ver.evidence?.tier === "string") return ver.evidence.tier;
  return ver.verified === true ? "verified" : "not-verified";
}
function formatHistoryHuman(r, opts) {
  const out = [`History: ${r.lines.length} command(s) in ${opts.file}`];
  let previousSession;
  for (const { parsed } of r.lines) {
    const sessionId = typeof parsed.sessionId === "string" ? parsed.sessionId : null;
    if (previousSession === void 0 || sessionId !== previousSession) {
      out.push(`--- session ${sessionId ?? "(none)"}${sessionId !== null && sessionId === opts.currentSessionId ? " (current)" : ""} ---`);
      previousSession = sessionId;
    }
    const when = typeof parsed.ts === "string" ? ts19(parsed.ts) : "(no time)";
    if (parsed.v > HISTORY_SCHEMA_VERSION) {
      out.push(`${when}  (history line version ${parsed.v} \u2014 upgrade sutradhar to display it)`);
      continue;
    }
    const args = Array.isArray(parsed.args) ? parsed.args.map(String) : [];
    const cmd = displayCommandText(String(parsed.verb ?? "?"), args);
    const exit = String(parsed.exitCode ?? "?").padEnd(3);
    const dur = `${String(parsed.durationMs ?? "?").padStart(5)}ms`;
    out.push(`${when}  exit ${exit} ${dur}  ${cmd}`);
    if (typeof parsed.error === "string") out.push(`    error: ${firstLine2(redactHistoryText(parsed.error), ERROR_CAP)}`);
    const actions = Array.isArray(parsed.actions) ? parsed.actions.map((x) => sanitizeHistoryEntry(x)) : [];
    for (const a of actions) {
      const what = middleTruncate(String(a.target ?? a.selector ?? ""), 80);
      const err = typeof a.error === "string" ? `: ${firstLine2(a.error, 200)}` : "";
      const row = `    - ${String(a.actionType ?? "?")} ${a.success === true ? "ok" : "FAILED"} ${verifLabel(a.verification)} ${String(a.tabId ?? "?")}`;
      out.push(what === "" ? `${row}${err}` : `${row} ${what}${err}`);
    }
    const evicted = typeof parsed.actionsEvicted === "number" ? parsed.actionsEvicted : 0;
    if (evicted > 0) out.push(`    (${evicted} earlier action(s) of this command were evicted from the 200-entry in-memory history)`);
    if (typeof parsed.actionsUnavailable === "string") out.push(`    (actions unavailable: ${firstLine2(redactHistoryText(parsed.actionsUnavailable), 200)})`);
    if (parsed.truncated === true) out.push(`    (line truncated: ${String(parsed.actionsOmitted ?? "?")} action(s) omitted)`);
  }
  if (r.rotatedExists) out.push(`Older commands were rotated to ${path11.join(path11.dirname(opts.file), HISTORY_ROTATED_FILE_NAME)} (not shown).`);
  return out.join("\n");
}

export { redactHistoryText, sanitizeHistoryEntry, redactHistoryUrl, evalCodePreview, redactCliArgs, buildHistoryLine, formatHistoryHuman, redactCwd };
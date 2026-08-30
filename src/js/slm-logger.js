const SENSITIVE_KEY = /authorization|cookie|credential|password|secret|token/i;
const MAX_STRING_LENGTH = 2000;
const MAX_DEPTH = 4;
const MAX_RECORDS = 500;
const diagnosticRecords = [];
const COMPACT_KEYS = {
  component: 'cmp',
  modelId: 'mid',
  moduleUrl: 'mod',
  wasmPaths: 'wasm',
  requestLength: 'req',
  scenarioCount: 'sc',
  answerLength: 'ans',
  scenario: 'scn',
  status: 'st',
  percent: 'pct',
  file: 'f'
};

export function webLlmDiagnosticText() {
  return diagnosticRecords.map((record) => JSON.stringify(record)).join('\n');
}

export function clearWebLlmDiagnostics() {
  diagnosticRecords.length = 0;
  resetUrlRefs();
}

function redactText(value) {
  let text = String(value);
  text = text.replace(/(\bbearer\s+)[^\s,;]+/gi, '$1[redacted]');
  text = text.replace(
    /(\b(?:api[_-]?key|authorization|credential|password|secret|token)\b\s*[:=]\s*)([^\s,;]+)/gi,
    '$1[redacted]'
  );
  text = text.replace(
    /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g,
    '[redacted]'
  );
  text = text.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (url) => {
    try {
      const parsed = new URL(url);
      parsed.search = '';
      parsed.hash = '';
      return parsed.href;
    } catch {
      return url.split(/[?#]/, 1)[0];
    }
  });
  if (text.length > MAX_STRING_LENGTH) return `${text.slice(0, MAX_STRING_LENGTH)}…`;
  return text;
}

export function safeLogValue(value, key, depth) {
  const level = depth || 0;
  if (SENSITIVE_KEY.test(String(key || ''))) return '[redacted]';
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') return redactText(value);
  if (value instanceof Error) {
    const summary = {
      name: redactText(value.name || 'Error'),
      message: redactText(value.message || '')
    };
    if (value.stack) summary.stack = redactText(value.stack);
    if (value.cause && level < MAX_DEPTH) summary.cause = safeLogValue(value.cause, 'cause', level + 1);
    return summary;
  }
  if (level >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => safeLogValue(item, '', level + 1));
  }
  if (typeof value === 'object') {
    const result = {};
    Object.keys(value).slice(0, 50).forEach((property) => {
      try {
        result[property] = safeLogValue(value[property], property, level + 1);
      } catch {
        result[property] = '[unavailable]';
      }
    });
    return result;
  }
  return redactText(value);
}

const URL_PATTERN = /^https?:\/\//i;
const MIN_PREFIX_LENGTH = 20;
const REF_MARKER = '#';
const urlRefRegistry = new Map();
const seenUrlPrefixes = new Set();
let urlRefCounter = 0;

function resetUrlRefs() {
  urlRefRegistry.clear();
  seenUrlPrefixes.clear();
  urlRefCounter = 0;
}

// Directory portion of a URL (everything up to and including the last '/'),
// used as the key for interning repeated hosts/paths across the whole
// diagnostic session (CDN/vendor directories, model shard hosts, cache keys).
function urlDirname(url) {
  const lastSlash = url.lastIndexOf('/');
  return lastSlash > 8 ? url.slice(0, lastSlash + 1) : null;
}

// The first time a URL directory is seen it is left untouched (a single
// occurrence gains nothing from a reference). From the second occurrence
// onward it is assigned a short, session-stable id so later records reuse it
// via "#<id>" instead of repeating the full host/path; the mapping itself is
// only emitted once, on the record that introduces the reference.
function compactUrl(url, newRefs) {
  const prefix = urlDirname(url);
  if (!prefix || prefix.length < MIN_PREFIX_LENGTH) return url;
  const existingId = urlRefRegistry.get(prefix);
  if (existingId !== undefined) return `${REF_MARKER}${existingId}${url.slice(prefix.length)}`;
  if (!seenUrlPrefixes.has(prefix)) {
    seenUrlPrefixes.add(prefix);
    return url;
  }
  const id = urlRefCounter++;
  urlRefRegistry.set(prefix, id);
  newRefs[id] = prefix;
  return `${REF_MARKER}${id}${url.slice(prefix.length)}`;
}

function compactUrlsInValue(value, newRefs) {
  if (typeof value === 'string') return URL_PATTERN.test(value) ? compactUrl(value, newRefs) : value;
  if (Array.isArray(value)) return value.map((item) => compactUrlsInValue(item, newRefs));
  if (value && typeof value === 'object') {
    const result = {};
    Object.keys(value).forEach((key) => {
      result[key] = compactUrlsInValue(value[key], newRefs);
    });
    return result;
  }
  return value;
}

// Replaces repeated URLs with a short "#<id>" reference into a session-wide
// registry instead of repeating the same host/path across many records. The
// mapping for a given id is only included the first time it is used (in
// `refs`), so later records citing the same id stay compact.
function compactUrls(record) {
  const newRefs = {};
  const compacted = compactUrlsInValue(record, newRefs);
  if (Object.keys(newRefs).length === 0) return compacted;
  return { ...compacted, refs: newRefs };
}

function compactRecordKeys(value) {
  if (Array.isArray(value)) return value.map(compactRecordKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [COMPACT_KEYS[key] || key, compactRecordKeys(entry)])
  );
}

function callConsole(consoleImpl, method, args) {
  const fn = consoleImpl && typeof consoleImpl[method] === 'function'
    ? consoleImpl[method]
    : consoleImpl && consoleImpl.log;
  if (typeof fn !== 'function') return;
  try {
    fn.apply(consoleImpl, args);
  } catch {
    // Diagnostics must never interrupt model execution.
  }
}

function monotonicNow(now) {
  if (typeof now === 'function') return now();
  if (globalThis.performance && typeof globalThis.performance.now === 'function') {
    return globalThis.performance.now();
  }
  return Date.now();
}

export function createWebLlmLogger(options) {
  const opts = options || {};
  const consoleImpl = opts.console === undefined ? globalThis.console : opts.console;
  const context = safeLogValue(opts.context || {}, '');
  const sid = context.sid
    || opts.diagnosticSession
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const now = opts.now;
  const onRecord = typeof opts.onRecord === 'function' ? opts.onRecord : null;

  function emit(level, event, details) {
    let record = {
      ...context,
      ...safeLogValue(details || {}, 'details'),
      lvl: level,
      evt: redactText(event)
    };
    record = compactRecordKeys(compactUrls(record));
    diagnosticRecords.push(safeLogValue(record, ''));
    if (diagnosticRecords.length > MAX_RECORDS) diagnosticRecords.shift();
    if (onRecord) {
      try {
        onRecord(record);
      } catch {
        // Diagnostics extensions must not interrupt model execution.
      }
    }
    if (!consoleImpl) return record;

    const label = `[WebLLM] ${record.evt}`;
    const canCloseGroup = typeof consoleImpl.groupEnd === 'function';
    const groupMethod = canCloseGroup && typeof consoleImpl.groupCollapsed === 'function'
      ? 'groupCollapsed'
      : (canCloseGroup && typeof consoleImpl.group === 'function' ? 'group' : null);
    if (groupMethod) {
      callConsole(consoleImpl, groupMethod, [label]);
      callConsole(consoleImpl, level, [record]);
      if (typeof consoleImpl.table === 'function') {
        const summary = {};
        Object.keys(record).forEach((key) => {
          const value = record[key];
          if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) summary[key] = value;
        });
        callConsole(consoleImpl, 'table', [[summary]]);
      }
      callConsole(consoleImpl, 'groupEnd', []);
    } else {
      callConsole(consoleImpl, level, [label, record]);
    }
    return record;
  }

  return {
    debug: (event, details) => emit('debug', event, details),
    log: (event, details) => emit('log', event, details),
    warn: (event, details) => emit('warn', event, details),
    error: (event, details) => emit('error', event, details),
    child(additionalContext) {
      return createWebLlmLogger({
        ...opts,
        diagnosticSession: sid,
        context: { ...context, ...safeLogValue(additionalContext || {}, '') }
      });
    },
    operation(event, details) {
      const startedAt = monotonicNow(now);
      emit('log', `${event}.started`, details);
      return {
        end(outcome, finalDetails) {
          const ms = Math.max(0, Math.round(monotonicNow(now) - startedAt));
          const level = outcome === 'failed' ? 'error' : 'log';
          return emit(level, `${event}.${outcome || 'completed'}`, { ...finalDetails, ms });
        }
      };
    }
  };
}

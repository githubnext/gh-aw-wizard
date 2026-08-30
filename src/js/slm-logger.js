const SENSITIVE_KEY = /authorization|cookie|credential|password|secret|token/i;
const SECRET_ASSIGNMENT = /(\b(?:api[_-]?key|authorization|credential|password|secret|token)\b\s*[:=]\s*)([^\s,;]+)/gi;
const BEARER_TOKEN = /(\bbearer\s+)[^\s,;]+/gi;
const KNOWN_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g;
const URL_WITH_PRIVATE_PARTS = /\bhttps?:\/\/[^\s"'<>]+/gi;
const MAX_STRING_LENGTH = 2000;
const MAX_DEPTH = 4;

function redactText(value) {
  let text = String(value);
  text = text.replace(BEARER_TOKEN, '$1[redacted]');
  text = text.replace(SECRET_ASSIGNMENT, '$1[redacted]');
  text = text.replace(KNOWN_TOKEN, '[redacted]');
  text = text.replace(URL_WITH_PRIVATE_PARTS, (url) => {
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
      result[property] = safeLogValue(value[property], property, level + 1);
    });
    return result;
  }
  return redactText(value);
}

function callConsole(consoleImpl, method, args) {
  const fn = consoleImpl && typeof consoleImpl[method] === 'function'
    ? consoleImpl[method]
    : consoleImpl && consoleImpl.log;
  if (typeof fn === 'function') fn.apply(consoleImpl, args);
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
  const consoleImpl = opts.console || globalThis.console;
  const context = safeLogValue(opts.context || {}, 'context');
  const now = opts.now;
  const timestamp = opts.timestamp || (() => new Date().toISOString());
  const onRecord = typeof opts.onRecord === 'function' ? opts.onRecord : null;

  function emit(level, event, details) {
    const record = {
      timestamp: timestamp(),
      level,
      event: redactText(event),
      ...context,
      ...safeLogValue(details || {}, 'details')
    };
    if (onRecord) onRecord(record);
    if (!consoleImpl) return record;

    const label = `[WebLLM] ${record.event}`;
    const canCloseGroup = typeof consoleImpl.groupEnd === 'function';
    const groupMethod = canCloseGroup && typeof consoleImpl.groupCollapsed === 'function'
      ? 'groupCollapsed'
      : (canCloseGroup && typeof consoleImpl.group === 'function' ? 'group' : null);
    if (groupMethod) {
      callConsole(consoleImpl, groupMethod, [label]);
      callConsole(consoleImpl, level, [record]);
      if (typeof consoleImpl.table === 'function') callConsole(consoleImpl, 'table', [record]);
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
        context: { ...context, ...safeLogValue(additionalContext || {}, 'context') }
      });
    },
    operation(event, details) {
      const startedAt = monotonicNow(now);
      emit('log', `${event}.started`, details);
      return {
        end(outcome, finalDetails) {
          const durationMs = Math.max(0, Math.round(monotonicNow(now) - startedAt));
          const level = outcome === 'failed' ? 'error' : 'log';
          return emit(level, `${event}.${outcome || 'completed'}`, { ...finalDetails, durationMs });
        }
      };
    }
  };
}

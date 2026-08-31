// DOM wiring for the in-browser scenario assistant ("wizard" button).

import { keywordScenarioMatch, scenarioCatalog, scenarioLabel, slmConfig } from './slm.js';
import { createWebLlmLogger, webLlmDiagnosticText } from './slm-logger.js';
import { createScenarioAssistant, supportsWebGPU } from './slm-runner.js';

function element(id) {
  return document.getElementById(id);
}

function fallbackCopy(text, documentImpl) {
  const textarea = documentImpl.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  documentImpl.body.appendChild(textarea);
  textarea.select();
  try {
    if (!documentImpl.execCommand('copy')) throw new Error('Copy command was rejected');
  } finally {
    documentImpl.body.removeChild(textarea);
  }
}

const MAX_COPY_LENGTH = 64 * 1024;

// Keeps the most recent diagnostics (the ones relevant to what just went
// wrong) and drops the older, less useful prefix rather than truncating the
// end of the log.
function trimToTail(text, maxLength) {
  if (text.length <= maxLength) return text;
  const tail = text.slice(text.length - maxLength);
  const firstNewline = tail.indexOf('\n');
  return firstNewline === -1 ? tail : tail.slice(firstNewline + 1);
}

export async function copyWebLlmDiagnostics(options) {
  const opts = options || {};
  const navigatorImpl = opts.navigator || (typeof navigator !== 'undefined' ? navigator : null);
  const documentImpl = opts.document || document;
  const text = trimToTail(webLlmDiagnosticText(), MAX_COPY_LENGTH);
  if (navigatorImpl && navigatorImpl.clipboard && typeof navigatorImpl.clipboard.writeText === 'function') {
    try {
      await navigatorImpl.clipboard.writeText(text);
      return;
    } catch {
      // The legacy copy command remains useful where Clipboard API permission is denied.
    }
  }
  fallbackCopy(text, documentImpl);
}

export function initDiagnosticLogCopy(options) {
  const opts = options || {};
  const button = element('footer-copy-logs');
  const status = element('footer-copy-logs-status');
  if (!button) return null;
  button.addEventListener('click', () => {
    copyWebLlmDiagnostics(opts).then(() => {
      if (status) status.textContent = button.dataset.successLabel || 'Diagnostic logs copied.';
    }).catch(() => {
      if (status) status.textContent = button.dataset.failureLabel || 'Diagnostic logs could not be copied.';
    });
  });
  return button;
}

function assistantCopy(wizardConfig) {
  const assistant = wizardConfig && wizardConfig.assistant ? wizardConfig.assistant : {};
  return {
    analyzing: assistant.analyzing_status || 'Analyzing your request…',
    matched: assistant.matched_status || 'Selected the closest scenario:',
    no_match: assistant.no_match_status || 'No close match found. Pick a scenario below.',
    empty: assistant.empty_status || 'Describe what you want to automate first.',
    no_scenarios: assistant.no_scenarios_status || 'Scenarios are not available yet. Please try again.',
    failure: assistant.failure_status || 'The in-browser model could not analyze the request. Pick a scenario below.',
    fallback: assistant.fallback_status || 'The in-browser model is unavailable. Closest keyword match:',
    result_eyebrow: assistant.result_eyebrow || 'Scenario selected',
    result_fallback_eyebrow: assistant.result_fallback_eyebrow || 'Closest keyword match',
    result_copy_label: assistant.result_copy_label || 'Copy prompt',
    result_copy_success_label: assistant.result_copy_success_label || 'Copied',
    result_copy_failure_label: assistant.result_copy_failure_label || 'Copy failed'
  };
}

function fallbackCopyText(text, documentImpl) {
  if (!documentImpl || !documentImpl.body || typeof documentImpl.createElement !== 'function') return;
  const textarea = documentImpl.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  documentImpl.body.appendChild(textarea);
  textarea.select();
  try {
    if (documentImpl.execCommand) {
      documentImpl.execCommand('copy');
    }
  } finally {
    if (documentImpl.body && typeof documentImpl.body.removeChild === 'function') {
      documentImpl.body.removeChild(textarea);
    }
  }
}

function bindAssistPromptCopy() {
  const button = element('assist-modal-copy');
  if (!button || typeof button.addEventListener !== 'function' || button.dataset.assistCopyBound === 'true') return;
  button.dataset.assistCopyBound = 'true';
  button.dataset.defaultLabel = button.dataset.defaultLabel || button.textContent || 'Copy prompt';
  button.addEventListener('click', async () => {
    const modal = element('assist-modal');
    const prompt = modal && typeof modal.assistPrompt === 'string' ? modal.assistPrompt : '';
    const navigatorImpl = typeof navigator !== 'undefined' ? navigator : null;
    const documentImpl = typeof document !== 'undefined' ? document : null;
    const defaultLabel = button.dataset.defaultLabel || 'Copy prompt';
    const successLabel = button.dataset.successLabel || 'Copied';
    const failureLabel = button.dataset.failureLabel || 'Copy failed';
    try {
      if (navigatorImpl && navigatorImpl.clipboard && typeof navigatorImpl.clipboard.writeText === 'function') {
        await navigatorImpl.clipboard.writeText(prompt);
      } else if (documentImpl && documentImpl.body && typeof documentImpl.createElement === 'function') {
        fallbackCopyText(prompt, documentImpl);
      } else {
        return;
      }
      const prior = button.textContent;
      button.textContent = successLabel;
      window.setTimeout(() => { button.textContent = prior || defaultLabel; }, 1500);
    } catch {
      const prior = button.textContent;
      button.textContent = failureLabel;
      window.setTimeout(() => { button.textContent = prior || defaultLabel; }, 1500);
    }
  });
}

// Summarizes what the assistant picked once the analysis succeeded, so the
// selection made on the user's behalf is explicit rather than a silent radio
// change further down the page.
export function showAssistantResult(summary) {
  const modal = element('assist-modal');
  if (!modal || typeof modal.showModal !== 'function') return false;
  const set = (id, value) => {
    const node = element(id);
    if (node && typeof value === 'string') node.textContent = value;
  };
  bindAssistPromptCopy();
  set('assist-modal-eyebrow', summary.eyebrow);
  set('assist-modal-title', summary.label);
  modal.assistPrompt = summary.request || '';
  const copyButton = element('assist-modal-copy');
  if (copyButton) {
    copyButton.textContent = summary.copyLabel || summary.result_copy_label || copyButton.dataset.defaultLabel || 'Copy prompt';
    copyButton.dataset.defaultLabel = copyButton.dataset.defaultLabel || copyButton.textContent || 'Copy prompt';
    copyButton.dataset.successLabel = summary.copySuccessLabel || summary.result_copy_success_label || 'Copied';
    copyButton.dataset.failureLabel = summary.copyFailureLabel || summary.result_copy_failure_label || 'Copy failed';
    copyButton.disabled = !summary.request;
  }
  if (!modal.open) modal.showModal();
  return true;
}

function bindAssistantResultModal() {
  const modal = element('assist-modal');
  if (!modal) return;
  modal.querySelectorAll('[data-assist-modal-close]').forEach((button) => {
    button.addEventListener('click', () => modal.close());
  });
  modal.addEventListener('click', (event) => {
    if (event.target === modal) modal.close();
  });
}

function scenarioSummary(scenarios, id) {
  const scenario = (scenarios || []).find((candidate) => candidate.id === id);
  return {
    label: scenario ? scenario.label : id
  };
}

// Selects the archetype radio the model picked. The change event is dispatched
// so the existing wizard wiring (prefills, summary, navigation) runs unchanged.
export function selectArchetypeRadio(scenarioId) {
  const radios = Array.from(document.querySelectorAll('input[name="archetype"]'));
  const radio = radios.find((candidate) => candidate.value === scenarioId);
  if (!radio) return false;
  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

export function initScenarioAssistant(context) {
  const ctx = context || {};
  const logger = ctx.logger || createWebLlmLogger({ context: { component: 'ui' } });
  const run = element('wizard-assist');
  const input = element('intent-description');
  const status = element('wizard-assist-status');
  const progressField = element('wizard-assist-progress-field');
  const progress = element('wizard-assist-progress');
  if (!input || !run) {
    logger.warn('initialization.skipped', { reason: 'required controls missing' });
    return null;
  }

  const config = slmConfig(ctx.wizardConfig);
  // The assistant is hidden by default and only revealed where the model can
  // actually run: without WebGPU the wasm backend is too slow to be useful.
  // iOS Safari is included since it reports navigator.gpu; slm.js swaps in a
  // smaller model there to fit its tighter memory limits.
  if (config.enabled === false || !supportsWebGPU(ctx.navigator)) {
    logger.log('initialization.skipped', {
      reason: config.enabled === false ? 'disabled by configuration' : 'WebGPU unavailable'
    });
    return null;
  }
  run.removeAttribute('hidden');
  logger.log('initialization.completed', {
    webgpu: true,
    modelId: config.model_id,
    iosModelId: config.ios_model_id
  });

  const copy = assistantCopy(ctx.wizardConfig);
  bindAssistantResultModal();
  let assistant = null;
  let running = false;

  // The run button stays disabled until the intent textarea (shared with the
  // rest of the wizard) actually has text, because there is nothing to analyze
  // otherwise.
  function syncRunEnabled() {
    run.disabled = !input.value.trim();
  }
  syncRunEnabled();
  input.addEventListener('input', syncRunEnabled);

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  function setProgress(percent) {
    if (!progress || !progressField) return;
    if (percent === null) {
      progressField.setAttribute('hidden', '');
      return;
    }
    progressField.removeAttribute('hidden');
    if (typeof percent === 'number') {
      progress.value = percent;
      progress.setAttribute('value', String(percent));
      return;
    }
    progress.removeAttribute('value');
  }

  run.addEventListener('click', () => {
    if (running) return;
    const request = input.value.trim();
    if (!request) {
      logger.warn('analysis.skipped', { reason: 'empty request' });
      setStatus(copy.empty);
      input.focus();
      return;
    }
    const scenarios = scenarioCatalog(ctx.patterns(), ctx.extraScenarios ? ctx.extraScenarios() : []);
    if (!scenarios.length) {
      logger.warn('analysis.skipped', { reason: 'scenarios unavailable' });
      setStatus(copy.no_scenarios);
      return;
    }

    running = true;
    run.disabled = true;
    setProgress(0);
    setStatus(copy.analyzing);
    logger.log('analysis.requested', { requestLength: request.length, scenarioCount: scenarios.length });
    if (!assistant) {
      assistant = createScenarioAssistant({
        config,
        logger: logger.child({ component: 'runner' })
      });
    }

    assistant.analyze(request, scenarios, (update) => {
      setProgress(update.percent);
      setStatus(update.label);
    }).then((result) => {
      setProgress(null);
      if (result.scenario && selectArchetypeRadio(result.scenario)) {
        logger.log('analysis.selection.applied', { scenario: result.scenario });
        setStatus(`${copy.matched} ${scenarioLabel(scenarios, result.scenario)}`);
        const custom = element('custom-description');
        if (result.scenario === 'custom' && custom && !custom.value) custom.value = request;
        const scenario = scenarioSummary(scenarios, result.scenario);
        showAssistantResult({
          eyebrow: copy.result_eyebrow,
          label: scenario.label,
          request,
          copyLabel: copy.result_copy_label,
          copySuccessLabel: copy.result_copy_success_label,
          copyFailureLabel: copy.result_copy_failure_label
        });
        return;
      }
      logger.warn('analysis.selection.unavailable', { scenario: result.scenario });
      setStatus(copy.no_match);
    }).catch((error) => {
      setProgress(null);
      // The model may be unavailable (offline, blocked model host, unsupported
      // browser); keep the button useful with the deterministic matcher.
      const fallback = keywordScenarioMatch(request, scenarios);
      if (fallback && selectArchetypeRadio(fallback)) {
        logger.warn('analysis.fallback.applied', { error, scenario: fallback });
        setStatus(`${copy.fallback} ${scenarioLabel(scenarios, fallback)}`);
        const scenario = scenarioSummary(scenarios, fallback);
        showAssistantResult({
          eyebrow: copy.result_fallback_eyebrow,
          label: scenario.label,
          request,
          copyLabel: copy.result_copy_label,
          copySuccessLabel: copy.result_copy_success_label,
          copyFailureLabel: copy.result_copy_failure_label
        });
        return;
      }
      logger.error('analysis.failed', { error, fallbackMatched: false });
      setStatus(copy.failure);
    }).finally(() => {
      running = false;
      syncRunEnabled();
    });
  });

  return { run };
}

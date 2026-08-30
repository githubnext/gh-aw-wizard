// DOM wiring for the in-browser scenario assistant ("wizard" button).

import { keywordScenarioMatch, scenarioCatalog, scenarioLabel, slmConfig } from './slm.js';
import { createScenarioAssistant, supportsWebGPU } from './slm-runner.js';

function element(id) {
  return document.getElementById(id);
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
    result_fallback_description: assistant.result_fallback_description
      || 'The in-browser model was unavailable, so the closest keyword match was selected. Pick another scenario if this is not what you meant.',
    result_request_label: assistant.result_request_label || 'Your request'
  };
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
  set('assist-modal-eyebrow', summary.eyebrow);
  set('assist-modal-title', summary.label);
  set('assist-modal-description', summary.description);
  set('assist-modal-request-label', summary.requestLabel);
  set('assist-modal-request', summary.request);
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
    label: scenario ? scenario.label : id,
    description: scenario && scenario.description ? scenario.description : ''
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
  const container = element('wizard-assist');
  const toggle = element('btn-wizard-assist');
  const panel = element('wizard-assist-panel');
  const input = element('intent-description');
  const run = element('btn-wizard-assist-run');
  const status = element('wizard-assist-status');
  const progressField = element('wizard-assist-progress-field');
  const progress = element('wizard-assist-progress');
  if (!toggle || !panel || !input || !run) return null;

  const config = slmConfig(ctx.wizardConfig);
  // The assistant is hidden by default and only revealed where the model can
  // actually run: without WebGPU the wasm backend is too slow to be useful.
  // iOS Safari is included since it reports navigator.gpu; slm.js swaps in a
  // smaller model there to fit its tighter memory limits.
  if (config.enabled === false || !supportsWebGPU(ctx.navigator)) return null;
  if (container) container.removeAttribute('hidden');

  const copy = assistantCopy(ctx.wizardConfig);
  bindAssistantResultModal();
  let assistant = null;
  let running = false;

  toggle.addEventListener('click', () => {
    const open = panel.hasAttribute('hidden');
    if (open) panel.removeAttribute('hidden');
    else panel.setAttribute('hidden', '');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) input.focus();
  });

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
    progress.value = percent;
  }

  run.addEventListener('click', () => {
    if (running) return;
    const request = input.value.trim();
    if (!request) {
      setStatus(copy.empty);
      input.focus();
      return;
    }
    const scenarios = scenarioCatalog(ctx.patterns(), ctx.extraScenarios ? ctx.extraScenarios() : []);
    if (!scenarios.length) {
      setStatus(copy.no_scenarios);
      return;
    }

    running = true;
    run.disabled = true;
    setProgress(0);
    setStatus(copy.analyzing);
    if (!assistant) assistant = createScenarioAssistant({ config });

    assistant.analyze(request, scenarios, (update) => {
      setProgress(update.percent);
      setStatus(update.label);
    }).then((result) => {
      setProgress(null);
      if (result.scenario && selectArchetypeRadio(result.scenario)) {
        setStatus(`${copy.matched} ${scenarioLabel(scenarios, result.scenario)}`);
        const custom = element('custom-description');
        if (result.scenario === 'custom' && custom && !custom.value) custom.value = request;
        const scenario = scenarioSummary(scenarios, result.scenario);
        showAssistantResult({
          eyebrow: copy.result_eyebrow,
          label: scenario.label,
          description: scenario.description,
          requestLabel: copy.result_request_label,
          request
        });
        return;
      }
      setStatus(copy.no_match);
    }).catch(() => {
      setProgress(null);
      // The model may be unavailable (offline, blocked CDN, unsupported
      // browser); keep the button useful with the deterministic matcher.
      const fallback = keywordScenarioMatch(request, scenarios);
      if (fallback && selectArchetypeRadio(fallback)) {
        setStatus(`${copy.fallback} ${scenarioLabel(scenarios, fallback)}`);
        const scenario = scenarioSummary(scenarios, fallback);
        showAssistantResult({
          eyebrow: copy.result_fallback_eyebrow,
          label: scenario.label,
          description: scenario.description
            ? `${scenario.description} ${copy.result_fallback_description}`
            : copy.result_fallback_description,
          requestLabel: copy.result_request_label,
          request
        });
        return;
      }
      setStatus(copy.failure);
    }).finally(() => {
      running = false;
      syncRunEnabled();
    });
  });

  return { toggle, panel };
}

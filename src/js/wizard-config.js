export const WIZARD_CONFIG_URL = 'wizard.json';

export function loadWizardConfig(configUrl, fetchImpl) {
  const url = configUrl || WIZARD_CONFIG_URL;
  const request = fetchImpl || fetch;
  return request(url).then((response) => {
    if (!response.ok) throw new Error('Unable to load wizard configuration');
    return response.json();
  });
}

export function resolveWizardAssetUrl(assetUrl, configUrl, baseUrl) {
  if (!assetUrl) return null;
  const base = configUrl || WIZARD_CONFIG_URL;
  const documentBase = globalThis.document && globalThis.document.baseURI;
  const locationBase = globalThis.location && globalThis.location.href;
  const pageBase = baseUrl || documentBase || locationBase;
  if (!pageBase) return assetUrl;
  return new URL(assetUrl, new URL(base, pageBase)).href;
}

export function wizardStep(config, id) {
  return config && config.steps && config.steps[id] ? config.steps[id] : {};
}

export function wizardOptions(config, id) {
  const step = wizardStep(config, id);
  return Array.isArray(step.options) ? step.options : [];
}

const LANDING_ELEMENTS = {
  title: 'landing-title',
  message: 'landing-message',
  button: 'landing-button-label',
  hint: 'landing-hint',
  runner: 'landing-runner',
  trigger_label: 'landing-trigger-label',
  trigger_description: 'landing-trigger-description',
  agent_label: 'landing-agent-label',
  outputs_label: 'landing-outputs-label'
};

const FINISH_ELEMENTS = {
  step_label: 'finish-step-label',
  step_description: 'finish-step-description',
  title: 'finish-title',
  message: 'finish-message',
  copy_button: 'btn-copy',
  preview_label: 'finish-preview-label',
  preview_hint: 'finish-preview-hint'
};

const COPY_SUCCESS_ELEMENTS = {
  eyebrow: 'copy-modal-eyebrow',
  title: 'copy-modal-title',
  description: 'copy-modal-description',
  next_step_title: 'copy-modal-next-step-title',
  next_step_description: 'copy-modal-next-step-description',
  action: 'copy-modal-action'
};

const FOOTER_ELEMENTS = {
  source: ['footer-source', 'footer-source-label'],
  report_issue: ['footer-report-issue', 'footer-report-issue'],
  terms: ['footer-terms', 'footer-terms'],
  privacy: ['footer-privacy', 'footer-privacy'],
  security: ['footer-security', 'footer-security']
};

function setText(id, value) {
  const element = document.getElementById(id);
  if (element && typeof value === 'string') element.textContent = value;
}

function safeUrl(url, configUrl) {
  const resolved = resolveWizardAssetUrl(url, configUrl);
  if (!resolved) return null;
  try {
    const parsed = new URL(resolved, document.baseURI);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

const ASSISTANT_ELEMENTS = {
  label: 'wizard-assist-label',
  run_button: 'wizard-assist',
  result_request_label: 'assist-modal-request-label',
  result_action: 'assist-modal-action'
};

const INTENT_ELEMENTS = {
  label: 'intent-label',
  hint: 'intent-hint'
};

export function applyPageContent(config, configUrl) {
  const landing = config && config.landing ? config.landing : {};
  Object.entries(LANDING_ELEMENTS).forEach(([key, id]) => setText(id, landing[key]));

  const finish = config && config.finish ? config.finish : {};
  Object.entries(FINISH_ELEMENTS).forEach(([key, id]) => setText(id, finish[key]));
  const copyButton = document.getElementById('btn-copy');
  if (copyButton) {
    if (typeof finish.copy_button === 'string') {
      copyButton.dataset.defaultLabel = finish.copy_button;
    }
    if (typeof finish.copy_failure_button === 'string') {
      copyButton.dataset.failureLabel = finish.copy_failure_button;
    }
  }
  const copyStatus = document.getElementById('copy-status');
  if (copyStatus && typeof finish.copy_failure_status === 'string') {
    copyStatus.dataset.failureMessage = finish.copy_failure_status;
  }
  const preview = document.getElementById('finish-preview');
  if (preview && typeof finish.preview_aria_label === 'string') {
    preview.setAttribute('aria-label', finish.preview_aria_label);
  }

  const intent = wizardStep(config, 'intent');
  Object.entries(INTENT_ELEMENTS).forEach(([key, id]) => setText(id, intent[key]));
  const intentField = document.getElementById('intent-description');
  if (intentField && typeof intent.field_placeholder === 'string') {
    intentField.setAttribute('placeholder', intent.field_placeholder);
  }

  const assistant = config && config.assistant ? config.assistant : {};
  Object.entries(ASSISTANT_ELEMENTS).forEach(([key, id]) => setText(id, assistant[key]));
  const assistantField = document.getElementById('wizard-assist-input');
  if (assistantField && typeof assistant.field_placeholder === 'string') {
    assistantField.setAttribute('placeholder', assistant.field_placeholder);
  }
  const assistantClose = document.getElementById('assist-modal-close');
  if (assistantClose && typeof assistant.result_close_label === 'string') {
    assistantClose.setAttribute('aria-label', assistant.result_close_label);
  }

  const copySuccess = config && config.copy_success ? config.copy_success : {};
  Object.entries(COPY_SUCCESS_ELEMENTS).forEach(([key, id]) => setText(id, copySuccess[key]));
  const closeButton = document.getElementById('copy-modal-close');
  if (closeButton && typeof copySuccess.close_label === 'string') {
    closeButton.setAttribute('aria-label', copySuccess.close_label);
  }

  const footer = config && config.footer ? config.footer : {};
  Object.entries(FOOTER_ELEMENTS).forEach(([key, ids]) => {
    const item = footer[key] || {};
    const link = document.getElementById(ids[0]);
    const url = safeUrl(item.url, configUrl);
    if (link && url) link.href = url;
    setText(ids[1], item.label);
  });
}

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

export function applyPageContent(config, configUrl) {
  const landing = config && config.landing ? config.landing : {};
  Object.entries(LANDING_ELEMENTS).forEach(([key, id]) => setText(id, landing[key]));

  const footer = config && config.footer ? config.footer : {};
  Object.entries(FOOTER_ELEMENTS).forEach(([key, ids]) => {
    const item = footer[key] || {};
    const link = document.getElementById(ids[0]);
    const url = safeUrl(item.url, configUrl);
    if (link && url) link.href = url;
    setText(ids[1], item.label);
  });
}

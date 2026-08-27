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

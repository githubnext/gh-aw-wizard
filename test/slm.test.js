import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SLM_CONFIG,
  buildScenarioMessages,
  keywordScenarioMatch,
  modelIdFor,
  parseScenarioSelection,
  progressLabel,
  progressTracker,
  scenarioCatalog,
  scenarioCatalogText,
  isIOS,
  isSafari,
  runtimeUrls,
  scenarioLabel,
  selectScenario,
  slmConfig,
  webgpuDtypeFor
} from '../src/js/slm.js';
import { cacheKeyFor, serializeHeaders } from '../src/js/slm-cache.js';
import { extractAssistantText, preferredDevice, supportsWebGPU } from '../src/js/slm-runner.js';
import { PACKAGES, vendoredFiles } from '../scripts/fetch-vendor-assets.mjs';

const html = readFileSync(fileURLToPath(new URL('../src/index.html', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../src/styles/style.css', import.meta.url)), 'utf8');
const wizardConfig = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src/wizard.json', import.meta.url)), 'utf8')
);

const scenarios = [
  { id: 'issue-triage', label: 'Issue Triage', description: 'Categorize and label incoming issues' },
  { id: 'status-report', label: 'Status Report', description: 'Post periodic repository summaries' },
  { id: 'custom', label: 'Custom', description: 'Describe your own workflow' }
];

describe('scenario catalog', () => {
  it('builds the catalog from the pattern archetypes plus extra scenarios', () => {
    const catalog = scenarioCatalog(
      { archetypes: [{ id: 'issue-triage', label: 'Issue Triage', description: 'Label issues' }] },
      [{ id: 'custom', label: 'Custom', description: 'Start from scratch' }]
    );
    expect(catalog).toEqual([
      { id: 'issue-triage', label: 'Issue Triage', description: 'Label issues' },
      { id: 'custom', label: 'Custom', description: 'Start from scratch' }
    ]);
  });

  it('ignores duplicates and malformed entries', () => {
    const catalog = scenarioCatalog({ archetypes: [{ id: 'a', label: 'A' }, { id: 'a' }, null, {}] });
    expect(catalog).toEqual([{ id: 'a', label: 'A', description: '' }]);
  });

  it('renders each scenario as an id, label, and description line', () => {
    expect(scenarioCatalogText(scenarios)).toContain('- issue-triage: Issue Triage — Categorize and label incoming issues');
  });

  it('resolves a scenario label by id', () => {
    expect(scenarioLabel(scenarios, 'status-report')).toBe('Status Report');
    expect(scenarioLabel(scenarios, 'unknown')).toBe('unknown');
  });
});

describe('scenario prompt', () => {
  it('describes the wizard options and constrains the answer', () => {
    const messages = buildScenarioMessages(scenarios, '  label my issues  ');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('- status-report: Status Report');
    expect(messages[0].content).toContain('Answer with exactly one scenario id');
    expect(messages[1]).toEqual({ role: 'user', content: 'label my issues' });
  });
});

describe('answer parsing', () => {
  it('accepts a bare scenario id', () => {
    expect(parseScenarioSelection('issue-triage', scenarios)).toBe('issue-triage');
  });

  it('accepts a scenario label', () => {
    expect(parseScenarioSelection('Status Report', scenarios)).toBe('status-report');
  });

  it('finds the first scenario mentioned in a chatty answer', () => {
    expect(parseScenarioSelection('The best fit is status-report for this.', scenarios)).toBe('status-report');
  });

  it('returns null when no scenario is named', () => {
    expect(parseScenarioSelection('I am not sure', scenarios)).toBeNull();
    expect(parseScenarioSelection('', scenarios)).toBeNull();
  });
});

describe('keyword fallback', () => {
  it('matches the closest scenario by shared words', () => {
    expect(keywordScenarioMatch('please label our incoming issues', scenarios)).toBe('issue-triage');
  });

  it('never falls back to the custom scenario', () => {
    expect(keywordScenarioMatch('describe workflow', scenarios)).toBeNull();
  });

  it('is used when the model answer names no scenario', () => {
    expect(selectScenario('no idea', 'post periodic summaries', scenarios)).toBe('status-report');
    expect(selectScenario('no idea', 'zzz', scenarios)).toBeNull();
  });
});

describe('loading progress', () => {
  it('averages per-file download ratios', () => {
    const tracker = progressTracker();
    expect(tracker.update({ status: 'initiate', file: 'a.onnx' })).toBe(0);
    tracker.update({ status: 'progress', file: 'b.json', progress: 50 });
    expect(tracker.percent()).toBe(25);
    tracker.update({ status: 'done', file: 'a.onnx' });
    tracker.update({ status: 'done', file: 'b.json' });
    expect(tracker.percent()).toBe(100);
  });

  it('labels the current loading phase', () => {
    expect(progressLabel({ status: 'progress', file: 'model.onnx' }, 42)).toBe('Downloading model model.onnx — 42%');
    expect(progressLabel({ status: 'ready' }, 100)).toBe('Model ready');
  });
});

describe('model configuration', () => {
  it('falls back to the built-in defaults', () => {
    expect(slmConfig(null).model_id).toBe(DEFAULT_SLM_CONFIG.model_id);
  });

  it('is overridable from the wizard configuration', () => {
    expect(slmConfig({ assistant: { model: { model_id: 'x', enabled: false } } })).toMatchObject({
      model_id: 'x',
      enabled: false,
      max_new_tokens: DEFAULT_SLM_CONFIG.max_new_tokens
    });
  });

  it('ships assistant copy and model settings in the wizard configuration', () => {
    expect(wizardConfig.assistant.button).toBeTruthy();
    expect(wizardConfig.assistant.model.module_url).toBe(DEFAULT_SLM_CONFIG.module_url);
    expect(wizardConfig.assistant.model.model_id).toBeTruthy();
  });

  it('picks the smaller model and dtype on iOS to fit its tighter WebGPU memory limits', () => {
    const iPhoneNavigator = {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'
    };
    expect(modelIdFor(DEFAULT_SLM_CONFIG, iPhoneNavigator)).toBe(DEFAULT_SLM_CONFIG.ios_model_id);
    expect(webgpuDtypeFor(DEFAULT_SLM_CONFIG, iPhoneNavigator)).toBe(DEFAULT_SLM_CONFIG.ios_webgpu_dtype);
    expect(modelIdFor(DEFAULT_SLM_CONFIG, iPhoneNavigator)).not.toBe(DEFAULT_SLM_CONFIG.model_id);
  });

  it('uses the default model and dtype off iOS', () => {
    const desktopNavigator = { userAgent: 'Mozilla/5.0 Chrome/120 Safari/537.36' };
    expect(modelIdFor(DEFAULT_SLM_CONFIG, desktopNavigator)).toBe(DEFAULT_SLM_CONFIG.model_id);
    expect(webgpuDtypeFor(DEFAULT_SLM_CONFIG, desktopNavigator)).toBe(DEFAULT_SLM_CONFIG.webgpu_dtype);
  });
});

describe('runtime assets', () => {
  it('serves the runtime from the site instead of a CDN', () => {
    const configured = [
      wizardConfig.assistant.model.module_url,
      wizardConfig.assistant.model.wasm_paths.mjs,
      wizardConfig.assistant.model.wasm_paths.wasm,
      wizardConfig.assistant.model.safari_wasm_paths.mjs,
      wizardConfig.assistant.model.safari_wasm_paths.wasm
    ];
    configured.forEach((url) => {
      expect(url).not.toMatch(/^https?:/);
      expect(url.startsWith('slm/')).toBe(true);
    });
  });

  it('vendors every runtime file the wizard configuration points at', () => {
    const vendored = vendoredFiles();
    [
      wizardConfig.assistant.model.module_url,
      wizardConfig.assistant.model.wasm_paths.mjs,
      wizardConfig.assistant.model.wasm_paths.wasm,
      wizardConfig.assistant.model.safari_wasm_paths.mjs,
      wizardConfig.assistant.model.safari_wasm_paths.wasm
    ].forEach((url) => {
      expect(vendored).toContain(url);
    });
    expect(PACKAGES.map((pkg) => pkg.name)).toContain('@huggingface/transformers');
    expect(PACKAGES.map((pkg) => pkg.name)).toContain('onnxruntime-web');
  });

  it('resolves runtime urls against the page so sub-path deployments work', () => {
    const urls = runtimeUrls(DEFAULT_SLM_CONFIG, { baseUrl: 'https://example.github.io/gh-aw-wizard/' });
    expect(urls.module).toBe('https://example.github.io/gh-aw-wizard/slm/transformers.min.js');
    expect(urls.wasmPaths).toEqual({
      mjs: 'https://example.github.io/gh-aw-wizard/slm/ort/ort-wasm-simd-threaded.asyncify.mjs',
      wasm: 'https://example.github.io/gh-aw-wizard/slm/ort/ort-wasm-simd-threaded.asyncify.wasm'
    });
  });

  it('uses the non-asyncify runtime on Safari', () => {
    const navigatorImpl = {
      userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'
    };
    expect(isSafari(navigatorImpl)).toBe(true);
    expect(isSafari({ userAgent: 'Mozilla/5.0 Chrome/120 Safari/537.36' })).toBe(false);
    const urls = runtimeUrls(DEFAULT_SLM_CONFIG, { navigator: navigatorImpl, baseUrl: 'https://example.com/' });
    expect(urls.wasmPaths.wasm).toBe('https://example.com/slm/ort/ort-wasm-simd-threaded.wasm');
  });

  it('detects iOS (including iPadOS reporting as Macintosh)', () => {
    expect(isIOS({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1' })).toBe(true);
    expect(isIOS({ platform: 'MacIntel', maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (Macintosh)' })).toBe(true);
    expect(isIOS({ platform: 'MacIntel', maxTouchPoints: 0, userAgent: 'Mozilla/5.0 (Macintosh)' })).toBe(false);
    expect(isIOS(null)).toBe(false);
  });
});

describe('runtime helpers', () => {
  it('prefers WebGPU when the browser exposes it', () => {
    expect(preferredDevice({ gpu: {} })).toBe('webgpu');
    expect(preferredDevice({})).toBe('wasm');
  });

  it('detects WebGPU support', () => {
    expect(supportsWebGPU({ gpu: {} })).toBe(true);
    expect(supportsWebGPU({})).toBe(false);
    expect(supportsWebGPU(null)).toBe(false);
  });

  it('supports iOS Safari when navigator.gpu is present, since a smaller model is used there', () => {
    const iPhoneNavigator = {
      gpu: {},
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'
    };
    expect(supportsWebGPU(iPhoneNavigator)).toBe(true);
    expect(preferredDevice(iPhoneNavigator)).toBe('webgpu');
  });

  it('reads the assistant message out of the generated output', () => {
    expect(extractAssistantText([{ generated_text: 'issue-triage' }])).toBe('issue-triage');
    expect(extractAssistantText([{
      generated_text: [
        { role: 'user', content: 'label issues' },
        { role: 'assistant', content: 'issue-triage' }
      ]
    }])).toBe('issue-triage');
    expect(extractAssistantText(null)).toBe('');
  });
});

describe('model weight cache', () => {
  it('derives a cache key from a string or request', () => {
    expect(cacheKeyFor('https://example.com/model.onnx')).toBe('https://example.com/model.onnx');
    expect(cacheKeyFor({ url: 'https://example.com/config.json' })).toBe('https://example.com/config.json');
  });

  it('serializes headers with lowercase names', () => {
    const headers = { forEach: (fn) => { fn('application/json', 'Content-Type'); } };
    expect(serializeHeaders(headers)).toEqual({ 'content-type': 'application/json' });
    expect(serializeHeaders(null)).toEqual({});
  });
});

describe('assistant markup', () => {
  it('stays hidden until a WebGPU-capable browser reveals it', () => {
    expect(html).toContain('id="wizard-assist" hidden');
    const start = css.indexOf('.assistant[hidden] {');
    expect(start).toBeGreaterThan(-1);
    expect(css.slice(start, css.indexOf('}', start))).toMatch(/display:\s*none/);
  });

  it('renders the wizard button and progress bar, reusing the intent textarea', () => {
    expect(html).toContain('id="btn-wizard-assist"');
    expect(html).not.toContain('id="wizard-assist-input"');
    expect(html).toContain('id="intent-description"');
    expect(html).toContain('id="btn-wizard-assist-run" type="button" disabled');
    expect(html).toContain('id="wizard-assist-progress"');
    expect(html).toContain('id="wizard-assist-status"');
  });

  it('announces status updates to assistive technology', () => {
    expect(html).toMatch(/id="wizard-assist-status"[^>]*aria-live="polite"/);
  });

  it('keeps a visible focus indicator on the wizard button', () => {
    const start = css.indexOf('.btn-assistant:focus-visible {');
    expect(start).toBeGreaterThan(-1);
    expect(css.slice(start, css.indexOf('}', start))).toMatch(/outline:/);
  });
});

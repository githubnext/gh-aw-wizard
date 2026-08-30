// Runtime glue for the in-browser scenario assistant.
//
// The model runs entirely on the visitor's machine: transformers.js is loaded on
// demand, uses WebGPU when available (falling back to wasm), and stores the
// downloaded weights in IndexedDB so later visits start instantly.

import { createModelCache } from './slm-cache.js';
import {
  buildScenarioMessages,
  progressLabel,
  progressTracker,
  runtimeUrls,
  selectScenario
} from './slm.js';

export function supportsWebGPU(navigatorImpl) {
  const nav = navigatorImpl || (typeof navigator !== 'undefined' ? navigator : null);
  return !!(nav && nav.gpu);
}

// The wizard only offers the assistant on WebGPU-capable browsers, so the wasm
// backend is a defensive fallback for embedders that call the runner directly.
export function preferredDevice(navigatorImpl) {
  return supportsWebGPU(navigatorImpl) ? 'webgpu' : 'wasm';
}

export function extractAssistantText(output) {
  const first = Array.isArray(output) ? output[0] : output;
  const generated = first && first.generated_text;
  if (typeof generated === 'string') return generated;
  if (Array.isArray(generated)) {
    for (let i = generated.length - 1; i >= 0; i--) {
      const message = generated[i];
      if (message && message.role === 'assistant' && typeof message.content === 'string') {
        return message.content;
      }
    }
  }
  return '';
}

// Creates a lazily-initialised assistant. `importModule` and `navigator` are
// injectable so the flow can be exercised without a browser.
export function createScenarioAssistant(options) {
  const opts = options || {};
  const config = opts.config || {};
  const importModule = opts.importModule || ((url) => import(/* @vite-ignore */ url));
  const cache = opts.cache || createModelCache({ indexedDB: opts.indexedDB });
  let generatorPromise = null;

  function loadGenerator(onProgress) {
    if (generatorPromise) return generatorPromise;
    const device = preferredDevice(opts.navigator);
    const urls = runtimeUrls(config, { navigator: opts.navigator, baseUrl: opts.baseUrl });
    generatorPromise = importModule(urls.module).then((module) => {
      const { env, pipeline } = module;
      if (env) {
        env.allowLocalModels = false;
        env.useBrowserCache = false;
        env.useCustomCache = true;
        env.customCache = cache;
        // transformers.js otherwise points onnxruntime-web at a CDN.
        const onnx = env.backends && env.backends.onnx;
        if (urls.wasmPaths && onnx && onnx.wasm) onnx.wasm.wasmPaths = urls.wasmPaths;
      }
      const tracker = progressTracker();
      return pipeline('text-generation', config.model_id, {
        device,
        dtype: device === 'webgpu' ? config.webgpu_dtype : config.wasm_dtype,
        progress_callback: (event) => {
          if (typeof onProgress !== 'function') return;
          const percent = tracker.update(event);
          onProgress({ percent, label: progressLabel(event, percent), status: event && event.status });
        }
      });
    }).catch((error) => {
      generatorPromise = null;
      throw error;
    });
    return generatorPromise;
  }

  return {
    device: () => preferredDevice(opts.navigator),
    async analyze(request, scenarios, onProgress) {
      const generator = await loadGenerator(onProgress);
      if (typeof onProgress === 'function') {
        onProgress({ percent: 100, label: 'Analyzing your request', status: 'generating' });
      }
      const messages = buildScenarioMessages(scenarios, request);
      const output = await generator(messages, {
        max_new_tokens: config.max_new_tokens || 24,
        do_sample: false,
        return_full_text: false
      });
      const answer = extractAssistantText(output);
      return { scenario: selectScenario(answer, request, scenarios), answer };
    }
  };
}

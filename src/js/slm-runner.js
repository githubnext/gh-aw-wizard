// Runtime glue for the in-browser scenario assistant.
//
// The model runs entirely on the visitor's machine: transformers.js is loaded on
// demand, uses WebGPU when available (falling back to wasm), and stores the
// downloaded weights in IndexedDB so later visits start instantly.

import { createModelCache } from './slm-cache.js';
import { createWebLlmLogger } from './slm-logger.js';
import {
  buildScenarioMessages,
  modelIdFor,
  progressLabel,
  progressTracker,
  runtimeUrls,
  selectScenario,
  webgpuDtypeFor
} from './slm.js';

// WebGPU support is all that is required to run the assistant. iOS Safari
// (and iPadOS Safari, which reports as desktop Safari) exposes navigator.gpu
// but has much less memory headroom than desktop browsers, so it is served a
// smaller model (see modelIdFor/webgpuDtypeFor) instead of being excluded.
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
  const logger = opts.logger || createWebLlmLogger({ context: { component: 'runner' } });
  const cache = opts.cache || createModelCache({
    indexedDB: opts.indexedDB,
    logger: logger.child({ component: 'cache' })
  });
  let generatorPromise = null;

  function loadGenerator(onProgress) {
    if (generatorPromise) {
      logger.debug('generator.reused');
      return generatorPromise;
    }
    const device = preferredDevice(opts.navigator);
    const urls = runtimeUrls(config, { navigator: opts.navigator, baseUrl: opts.baseUrl });
    const modelId = modelIdFor(config, opts.navigator);
    const dtype = device === 'webgpu' ? webgpuDtypeFor(config, opts.navigator) : config.wasm_dtype;
    const load = logger.operation('generator.load', {
      device,
      dtype,
      modelId,
      moduleUrl: urls.module,
      wasmPaths: urls.wasmPaths
    });
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
      return pipeline('text-generation', modelId, {
        device,
        dtype,
        progress_callback: (event) => {
          const percent = tracker.update(event);
          const update = { percent, label: progressLabel(event, percent), status: event && event.status };
          logger.debug('generator.progress', {
            status: update.status,
            percent,
            file: event && (event.file || event.name)
          });
          if (typeof onProgress === 'function') onProgress(update);
        }
      });
    }).then((generator) => {
      load.end('completed');
      return generator;
    }).catch((error) => {
      generatorPromise = null;
      load.end('failed', { error });
      throw error;
    });
    return generatorPromise;
  }

  return {
    device: () => preferredDevice(opts.navigator),
    async analyze(request, scenarios, onProgress) {
      const analysis = logger.operation('analysis', {
        requestLength: String(request || '').length,
        scenarioCount: Array.isArray(scenarios) ? scenarios.length : 0
      });
      try {
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
        const scenario = selectScenario(answer, request, scenarios);
        analysis.end('completed', { answerLength: answer.length, scenario });
        return { scenario, answer };
      } catch (error) {
        analysis.end('failed', { error });
        throw error;
      }
    }
  };
}

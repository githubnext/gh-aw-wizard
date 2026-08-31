// Runtime glue for the in-browser scenario assistant.
//
// The model runs entirely on the visitor's machine: WebLLM is loaded on demand,
// uses WebGPU, and caches downloaded model assets for later visits.

import { createWebLlmLogger } from './slm-logger.js';
import {
  buildScenarioMessages,
  isIOS,
  modelIdFor,
  progressLabel,
  progressTracker,
  runtimeUrls,
  scenarioAttemptTemperature,
  scenarioAttemptWinner,
  selectScenario
} from './slm.js';

// WebGPU support is all that is required to run the assistant. iOS Safari
// (and iPadOS Safari, which reports as desktop Safari) exposes navigator.gpu
// but has much less memory headroom than desktop browsers, so it is served the
// smaller WebLLM prebuilt selected by modelIdFor instead of being excluded.
export function supportsWebGPU(navigatorImpl) {
  const nav = navigatorImpl || (typeof navigator !== 'undefined' ? navigator : null);
  return !!(nav && nav.gpu);
}

export function extractAssistantText(output) {
  const message = output && output.choices && output.choices[0] && output.choices[0].message;
  return message && typeof message.content === 'string' ? message.content : '';
}

// Creates a lazily-initialised assistant. `importModule` and `navigator` are
// injectable so the flow can be exercised without a browser.
export function createScenarioAssistant(options) {
  const opts = options || {};
  const config = opts.config || {};
  const importModule = opts.importModule || ((url) => import(/* @vite-ignore */ url));
  const logger = opts.logger || createWebLlmLogger({ context: { component: 'runner' } });
  let enginePromise = null;

  function loadEngine(onProgress) {
    if (enginePromise) {
      logger.debug('engine.reused');
      return enginePromise;
    }
    const urls = runtimeUrls(config, { navigator: opts.navigator, baseUrl: opts.baseUrl });
    const modelId = modelIdFor(config, opts.navigator);
    const cacheBackend = config.cache_backend || 'cache';
    const load = logger.operation('engine.load', {
      device: 'webgpu',
      modelId,
      moduleUrl: urls.module,
      cacheBackend
    });
    enginePromise = importModule(urls.module).then((module) => {
      const { CreateMLCEngine, prebuiltAppConfig } = module;
      if (typeof CreateMLCEngine !== 'function' || !prebuiltAppConfig) {
        throw new Error('The WebLLM runtime is missing its prebuilt engine exports');
      }
      const tracker = progressTracker();
      return CreateMLCEngine(modelId, {
        appConfig: { ...prebuiltAppConfig, cacheBackend },
        initProgressCallback: (event) => {
          const percent = tracker.update(event);
          const update = { percent, label: progressLabel(event, percent), status: 'loading' };
          logger.debug('engine.progress', {
            percent,
            text: event && event.text
          });
          if (typeof onProgress === 'function') onProgress(update);
        }
      });
    }).then((engine) => {
      load.end('completed');
      return engine;
    }).catch((error) => {
      enginePromise = null;
      load.end('failed', { error });
      throw error;
    });
    return enginePromise;
  }

  return {
    device: () => 'webgpu',
    async analyze(request, scenarios, onProgress) {
      const analysis = logger.operation('analysis', {
        requestLength: String(request || '').length,
        scenarioCount: Array.isArray(scenarios) ? scenarios.length : 0
      });
      try {
        const engine = await loadEngine(onProgress);
        if (typeof onProgress === 'function') {
          onProgress({ percent: 100, label: 'Analyzing your request', status: 'generating' });
        }
        const messages = buildScenarioMessages(scenarios, request);
        logger.log('analysis.prompt', { messages });
        const configuredAttempts = isIOS(opts.navigator)
          ? config.ios_analysis_attempts || config.analysis_attempts
          : config.analysis_attempts;
        const attemptCount = Math.min(Math.max(Math.floor(configuredAttempts || 1), 1), 3);
        const attempts = [];
        for (let index = 0; index < attemptCount; index += 1) {
          const output = await engine.chat.completions.create({
            messages,
            max_tokens: config.max_tokens || 24,
            temperature: scenarioAttemptTemperature(index),
            stream: false
          });
          const answer = extractAssistantText(output);
          const scenario = selectScenario(answer, request, scenarios);
          logger.log('analysis.response', { answer, attempt: index + 1, scenario });
          attempts.push({ answer, scenario });
        }
        const winner = scenarioAttemptWinner(attempts);
        const answer = winner ? winner.answer : attempts.map((attempt) => attempt.answer).join('\n');
        const scenario = winner ? winner.scenario : null;
        analysis.end('completed', { answerLength: answer.length, scenario });
        return { scenario, answer, attempts };
      } catch (error) {
        analysis.end('failed', { error });
        throw error;
      }
    }
  };
}

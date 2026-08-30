import { scenarioCatalog, scenarioLabel, slmConfig } from './slm.js';
import { EVAL_SAMPLE_SIZE, EVAL_REPETITIONS, runEvals } from './slm-evals.js';
import { createScenarioAssistant, supportsWebGPU } from './slm-runner.js';

function cell(row, value) {
  const node = document.createElement('td');
  node.textContent = value;
  row.appendChild(node);
}

function renderResults(container, results, scenarios) {
  container.replaceChildren();
  const summary = document.createElement('p');
  summary.className = 'eval-summary';
  summary.textContent = `${results.successes}/${results.attempts} correct (${(results.successRate * 100).toFixed(1)}%) across ${results.queries} queries × ${results.repetitions} runs.`;
  container.appendChild(summary);

  const table = document.createElement('table');
  table.className = 'eval-table';
  const head = document.createElement('thead');
  head.innerHTML = '<tr><th scope="col">Scenario</th><th scope="col">Queries</th><th scope="col">Attempts</th><th scope="col">Correct</th><th scope="col">Errors</th><th scope="col">Success rate</th></tr>';
  table.appendChild(head);
  const body = document.createElement('tbody');
  results.rows.forEach((result) => {
    const row = document.createElement('tr');
    cell(row, scenarioLabel(scenarios, result.scenario));
    cell(row, String(result.queries));
    cell(row, String(result.attempts));
    cell(row, String(result.successes));
    cell(row, String(result.errors));
    cell(row, `${(result.successRate * 100).toFixed(1)}%`);
    body.appendChild(row);
  });
  table.appendChild(body);
  const scroller = document.createElement('div');
  scroller.className = 'eval-table-scroller';
  scroller.appendChild(table);
  container.appendChild(scroller);
}

export function initEvalMode(context) {
  const ctx = context || {};
  if (!supportsWebGPU(ctx.navigator)) return null;
  const analyzeButton = document.getElementById('wizard-assist');
  const actions = analyzeButton && analyzeButton.parentElement;
  if (!actions) return null;

  const button = document.createElement('button');
  button.className = 'btn btn-evals';
  button.id = 'wizard-evals';
  button.type = 'button';
  button.textContent = 'Run evals';
  actions.appendChild(button);

  const results = document.createElement('section');
  results.id = 'wizard-eval-results';
  results.className = 'eval-results';
  results.setAttribute('aria-live', 'polite');
  analyzeButton.closest('.wizard-step').appendChild(results);

  let assistant = null;
  button.addEventListener('click', async () => {
    const scenarios = scenarioCatalog(ctx.patterns(), ctx.extraScenarios ? ctx.extraScenarios() : []);
    button.disabled = true;
    results.textContent = `Running ${EVAL_SAMPLE_SIZE} queries × ${EVAL_REPETITIONS} runs…`;
    if (!assistant) {
      assistant = createScenarioAssistant({
        config: slmConfig(ctx.wizardConfig),
        navigator: ctx.navigator
      });
    }
    try {
      const outcome = await runEvals({
        sampleSize: EVAL_SAMPLE_SIZE,
        analyze: (query) => assistant.analyze(query, scenarios),
        onProgress: ({ completed, total }) => {
          results.textContent = `Running evals: ${completed}/${total}`;
        }
      });
      renderResults(results, outcome, scenarios);
    } catch {
      results.textContent = 'The model evaluation could not be completed.';
    } finally {
      button.disabled = false;
    }
  });
  return { button, results };
}

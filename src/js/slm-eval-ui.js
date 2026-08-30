import { scenarioCatalog, scenarioLabel, slmConfig } from './slm.js';
import { EVAL_SAMPLE_SIZE, EVAL_REPETITIONS, runEvals } from './slm-evals.js';
import { createScenarioAssistant, supportsWebGPU } from './slm-runner.js';

function cell(row, value) {
  const node = document.createElement('td');
  node.textContent = value;
  row.appendChild(node);
}

function createLiveResults(container) {
  container.replaceChildren();
  const summary = document.createElement('p');
  summary.className = 'eval-summary';
  container.appendChild(summary);

  const table = document.createElement('table');
  table.className = 'eval-table';
  const head = document.createElement('thead');
  head.innerHTML = '<tr><th scope="col">Query</th><th scope="col">Expected</th><th scope="col">Actual response</th><th scope="col">Result</th></tr>';
  table.appendChild(head);
  const body = document.createElement('tbody');
  table.appendChild(body);
  const scroller = document.createElement('div');
  scroller.className = 'eval-table-scroller';
  scroller.appendChild(table);
  container.appendChild(scroller);

  const totals = { attempts: 0, successes: 0, errors: 0 };

  function updateSummary() {
    const successRate = totals.attempts ? totals.successes / totals.attempts : 0;
    summary.textContent = `${totals.successes}/${totals.attempts} correct (${(successRate * 100).toFixed(1)}%)${totals.errors ? `, ${totals.errors} error(s)` : ''}.`;
  }

  return {
    addRow(scenarios, entry) {
      totals.attempts += 1;
      if (entry.correct) totals.successes += 1;
      if (entry.errored) totals.errors += 1;

      const row = document.createElement('tr');
      cell(row, entry.query);
      cell(row, scenarioLabel(scenarios, entry.golden));
      cell(row, entry.errored ? 'Error' : (entry.answer !== null ? entry.answer : scenarioLabel(scenarios, entry.scenario)));
      cell(row, entry.errored ? 'Error' : (entry.correct ? 'Correct' : 'Incorrect'));
      row.className = entry.errored ? 'eval-row-error' : (entry.correct ? 'eval-row-correct' : 'eval-row-incorrect');
      body.appendChild(row);

      updateSummary();
    },
    setStatus(text) {
      summary.textContent = text;
    }
  };
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
    if (!assistant) {
      assistant = createScenarioAssistant({
        config: slmConfig(ctx.wizardConfig),
        navigator: ctx.navigator
      });
    }
    const live = createLiveResults(results);
    live.setStatus(`Running ${EVAL_SAMPLE_SIZE} queries × ${EVAL_REPETITIONS} runs…`);
    try {
      await runEvals({
        sampleSize: EVAL_SAMPLE_SIZE,
        analyze: (query) => assistant.analyze(query, scenarios),
        onRow: (entry) => live.addRow(scenarios, entry)
      });
    } catch {
      live.setStatus('The model evaluation could not be completed.');
    } finally {
      button.disabled = false;
    }
  });
  return { button, results };
}

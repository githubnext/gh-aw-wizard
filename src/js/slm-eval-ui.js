import { scenarioCatalog, scenarioLabel, slmConfig } from './slm.js';
import { EVAL_SAMPLE_SIZE, EVAL_REPETITIONS, runEvals } from './slm-evals.js';
import { createScenarioAssistant, supportsWebGPU } from './slm-runner.js';

function cell(row, value) {
  const node = document.createElement('td');
  node.textContent = value;
  row.appendChild(node);
}

const EVAL_TABLE_HEADERS = ['Query', 'Expected', 'Actual response', 'Result'];

// Escapes a cell value so it survives round-tripping through a markdown
// table (pipes delimit columns, newlines would break the row).
function escapeMarkdownCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function tableToMarkdown(headers, rows) {
  const headerRow = `| ${headers.map(escapeMarkdownCell).join(' | ')} |`;
  const dividerRow = `| ${headers.map(() => '---').join(' | ')} |`;
  const bodyRows = rows.map((row) => `| ${row.map(escapeMarkdownCell).join(' | ')} |`);
  return [headerRow, dividerRow, ...bodyRows].join('\n');
}

function fallbackCopy(text, documentImpl) {
  const textarea = documentImpl.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  documentImpl.body.appendChild(textarea);
  textarea.select();
  try {
    if (!documentImpl.execCommand('copy')) throw new Error('Copy command was rejected');
  } finally {
    documentImpl.body.removeChild(textarea);
  }
}

async function copyText(text, options) {
  const opts = options || {};
  const navigatorImpl = opts.navigator || (typeof navigator !== 'undefined' ? navigator : null);
  const documentImpl = opts.document || document;
  if (navigatorImpl && navigatorImpl.clipboard && typeof navigatorImpl.clipboard.writeText === 'function') {
    try {
      await navigatorImpl.clipboard.writeText(text);
      return;
    } catch {
      // The legacy copy command remains useful where Clipboard API permission is denied.
    }
  }
  fallbackCopy(text, documentImpl);
}

export function createLiveResults(container, options) {
  container.replaceChildren();
  const summary = document.createElement('p');
  summary.className = 'eval-summary';
  container.appendChild(summary);

  const table = document.createElement('table');
  table.className = 'eval-table';
  const head = document.createElement('thead');
  head.innerHTML = `<tr>${EVAL_TABLE_HEADERS.map((h) => `<th scope="col">${h}</th>`).join('')}</tr>`;
  table.appendChild(head);
  const body = document.createElement('tbody');
  table.appendChild(body);
  const scroller = document.createElement('div');
  scroller.className = 'eval-table-scroller';
  scroller.appendChild(table);
  container.appendChild(scroller);

  const copyButton = document.createElement('button');
  copyButton.className = 'btn btn-sm btn-evals-copy';
  copyButton.type = 'button';
  copyButton.textContent = 'Copy results';
  copyButton.hidden = true;
  container.insertBefore(copyButton, scroller);

  const rows = [];

  const totals = { attempts: 0, successes: 0, errors: 0 };

  function updateSummary() {
    const successRate = totals.attempts ? totals.successes / totals.attempts : 0;
    summary.textContent = `${totals.successes}/${totals.attempts} correct (${(successRate * 100).toFixed(1)}%)${totals.errors ? `, ${totals.errors} error(s)` : ''}.`;
  }

  copyButton.addEventListener('click', () => {
    const markdown = tableToMarkdown(EVAL_TABLE_HEADERS, rows);
    copyText(markdown, options).then(() => {
      copyButton.textContent = 'Copied!';
    }).catch(() => {
      copyButton.textContent = 'Copy failed';
    }).finally(() => {
      setTimeout(() => {
        copyButton.textContent = 'Copy results';
      }, 2000);
    });
  });

  return {
    addRow(scenarios, entry) {
      totals.attempts += 1;
      if (entry.correct) totals.successes += 1;
      if (entry.errored) totals.errors += 1;

      const expected = scenarioLabel(scenarios, entry.golden);
      const actual = entry.errored ? 'Error' : (entry.answer !== null ? entry.answer : scenarioLabel(scenarios, entry.scenario));
      const result = entry.errored ? 'Error' : (entry.correct ? 'Correct' : 'Incorrect');

      const row = document.createElement('tr');
      cell(row, entry.query);
      cell(row, expected);
      cell(row, actual);
      cell(row, result);
      row.className = entry.errored ? 'eval-row-error' : (entry.correct ? 'eval-row-correct' : 'eval-row-incorrect');
      body.appendChild(row);
      rows.push([entry.query, expected, actual, result]);

      copyButton.hidden = false;
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
    const live = createLiveResults(results, { navigator: ctx.navigator });
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

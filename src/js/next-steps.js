// "Next steps" panel markup — pure string builders.

import { escapeHtml } from './highlight.js';
import { normalizeEngine } from './workflow.js';
import { formatEngineLabel } from './engines.js';

export function step(n, content) {
  return `<div class="next-step"><div class="next-step-num">${  n  }</div><div>${  content  }</div></div>`;
}

function engineLabel(engine) {
  const labels = {
    copilot: 'Copilot',
    claude: 'Claude',
    codex: 'Codex',
    gemini: 'Gemini',
    pi: 'Pi'
  };
  const normalized = normalizeEngine(engine);
  return labels[normalized] || formatEngineLabel(normalized);
}

export function nextStepsHtml(format, workflowName, engine) {
  const name = escapeHtml(workflowName);
  const normalizedEngine = normalizeEngine(engine);
  const label = engineLabel(normalizedEngine);
  const engineId = escapeHtml(normalizedEngine);
  let html = `<div class="next-steps-header"><div><p class="next-steps-eyebrow">What happens next</p><h3>${ 
    format === 'workflow' ? 'Set up your workflow' : 'Run the prompt in your agent' 
    }</h3></div><div class="next-steps-links">` +
    `<a href="https://github.github.com/gh-aw/setup/quick-start/" target="_blank">Quick start</a>` +
    `<a href="https://github.github.com/gh-aw/setup/creating-workflows/" target="_blank">Docs</a></div></div>`;

  if (format === 'workflow') {
    html += step(1, 'Make sure <a href="https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository" target="_blank">GitHub Actions is enabled</a> on your repository');
    html += step(2, 'Install the <a href="https://cli.github.com" target="_blank">GitHub CLI</a> and the Agentic Workflows extension, then upgrade gh-aw:<br><code>gh extension install github/gh-aw && gh aw upgrade</code>');
    html += step(3, `Download the <code>.md</code> file and save it to <code>.github/workflows/${  name  }.md</code>`);
    html += step(4, `Set up the <strong>${  label  }</strong> engine — run <code>gh aw init --engine ${  engineId  }</code>`);
    html += step(5, 'Compile the workflow to generate the Actions YAML:<br><code>gh aw compile</code>');
    html += step(6, `Commit both files and push:<br><code>git add .github/workflows/${  name  }.md .github/workflows/${  name  }.lock.yml && git push</code>`);
    html += step(7, `Trigger a run from the Actions tab or with:<br><code>gh aw run ${  name  }</code>`);
  } else {
    html += step(1, `Open <strong>${  label  }</strong> in your repository and run the copied prompt`);
  }

  return html;
}

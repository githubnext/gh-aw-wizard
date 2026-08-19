// "Next steps" panel markup — pure string builders.

import { escapeHtml } from './highlight.js';
import { normalizeEngine } from './workflow.js';

export function step(n, content) {
  return '<div class="next-step"><div class="next-step-num">' + n + '</div><div>' + content + '</div></div>';
}

function engineLabel(engine) {
  var labels = {
    copilot: 'Copilot',
    claude: 'Claude',
    codex: 'Codex',
    gemini: 'Gemini',
    pi: 'Pi'
  };
  return labels[normalizeEngine(engine)];
}

export function nextStepsHtml(format, workflowName, engine) {
  var name = escapeHtml(workflowName);
  var label = engineLabel(engine);
  var html = '<h3>Next steps</h3>';

  if (format === 'workflow') {
    html += step(1, 'Make sure <a href="https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository" target="_blank">GitHub Actions is enabled</a> on your repository');
    html += step(2, 'Install the <a href="https://cli.github.com" target="_blank">GitHub CLI</a> and the Agentic Workflows extension:<br><code>gh extension install github/gh-aw</code>');
    html += step(3, 'Download the <code>.md</code> file and save it to <code>.github/workflows/' + name + '.md</code>');
    html += step(4, 'Set up the <strong>' + label + '</strong> engine — run <code>gh aw add-wizard</code>');
    html += step(5, 'Compile the workflow to generate the Actions YAML:<br><code>gh aw compile</code>');
    html += step(6, 'Commit both files and push:<br><code>git add .github/workflows/' + name + '.md .github/workflows/' + name + '.lock.yml && git push</code>');
    html += step(7, 'Trigger a run from the Actions tab or with:<br><code>gh aw run ' + name + '</code>');
  } else {
    html += step(1, 'Open <strong>' + label + '</strong> in your repository and run this prompt');
  }

  html += '<div style="margin-top:0.75rem;font-size:0.8rem;color:var(--text-muted);">' +
    '📖 <a href="https://github.github.com/gh-aw/setup/quick-start/" target="_blank" style="color:var(--text-secondary);">Quick start guide</a>' +
    ' · <a href="https://github.github.com/gh-aw/setup/creating-workflows/" target="_blank" style="color:var(--text-secondary);">Creating workflows</a></div>';

  return html;
}

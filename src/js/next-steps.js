// "Next steps" panel markup — pure string builders.

import { escapeHtml } from './highlight.js';
import { normalizeEngine } from './workflow.js';

export function step(n, content) {
  return '<div class="next-step"><div class="next-step-num">' + n + '</div><div>' + content + '</div></div>';
}

function getEngineMeta(engine) {
  var selected = normalizeEngine(engine);
  var engines = {
    copilot: {
      label: 'Copilot',
      quickDocs: 'https://github.github.com/gh-aw/reference/engines/#copilot',
      setup: 'https://github.github.com/gh-aw/setup/quick-start/'
    },
    claude: {
      label: 'Claude',
      quickDocs: 'https://github.github.com/gh-aw/reference/engines/#claude',
      setup: 'https://github.github.com/gh-aw/setup/quick-start/'
    },
    codex: {
      label: 'Codex',
      quickDocs: 'https://github.github.com/gh-aw/reference/engines/#codex',
      setup: 'https://github.github.com/gh-aw/setup/quick-start/'
    }
  };
  return engines[selected];
}

export function nextStepsHtml(format, workflowName, engine) {
  var name = escapeHtml(workflowName);
  var engineMeta = getEngineMeta(engine);
  var engineLabel = engineMeta.label;
  var quickDocsLink = '<a href="' + engineMeta.quickDocs + '" target="_blank">Quick docs</a>';
  var setupLink = '<a href="' + engineMeta.setup + '" target="_blank">Setup guide</a>';
  var html = '<h3>Next steps</h3>';

  if (format === 'workflow') {
    html += step(1, 'Make sure <a href="https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository" target="_blank">GitHub Actions is enabled</a> on your repository');
    html += step(2, 'Install the <a href="https://cli.github.com" target="_blank">GitHub CLI</a> and the Agentic Workflows extension:<br><code>gh extension install github/gh-aw</code>');
    html += step(3, 'Download the <code>.md</code> file and save it to <code>.github/workflows/' + name + '.md</code>');
    html += step(4, 'Set up the <strong>' + engineLabel + '</strong> engine — run <code>gh aw add-wizard</code>. ' + quickDocsLink + ' · ' + setupLink);
    html += step(5, 'Compile the workflow to generate the Actions YAML:<br><code>gh aw compile</code>');
    html += step(6, 'Commit both files and push:<br><code>git add .github/workflows/' + name + '.md .github/workflows/' + name + '.lock.yml && git push</code>');
    html += step(7, 'Trigger a run from the Actions tab or with:<br><code>gh aw run ' + name + '</code>');
  } else {
    html += step(1, 'Open <strong>' + engineLabel + '</strong> in your repository and use this prompt. ' + quickDocsLink + ' · ' + setupLink);
    html += step(2, 'Run this prompt');
  }

  html += '<div style="margin-top:0.75rem;font-size:0.8rem;color:var(--text-muted);">' +
    '📖 <a href="https://github.github.com/gh-aw/setup/quick-start/" target="_blank" style="color:var(--text-secondary);">Quick start guide</a>' +
    ' · <a href="https://github.github.com/gh-aw/setup/creating-workflows/" target="_blank" style="color:var(--text-secondary);">Creating workflows</a></div>';

  return html;
}

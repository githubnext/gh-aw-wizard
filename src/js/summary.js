// Readable, progressive summary of the workflow being configured.

import { getArchetype } from './patterns.js';

var triggerLabels = {
  issues: 'a new issue is opened',
  pull_request: 'a pull request is opened',
  schedule: 'the schedule runs',
  workflow_dispatch: 'it is started manually',
  slash_command: 'a slash command is posted (not recommended)',
  label_command: 'a matching label is added',
  push: 'code is pushed to main'
};

var outputLabels = {
  comments: 'post comments',
  labels: 'manage labels',
  'new-issues': 'create issues',
  'pull-requests': 'open pull requests',
  commits: 'commit changes'
};

var engineLabels = {
  copilot: 'Copilot',
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  pi: 'Pi'
};

var extraLabels = {
  memory: 'memory between runs',
  charts: 'chart generation',
  browser: 'browser access'
};

function readableList(values, conjunction) {
  conjunction = conjunction || 'and';
  if (values.length < 2) return values[0] || '';
  if (values.length === 2) return values[0] + ' ' + conjunction + ' ' + values[1];
  return values.slice(0, -1).join(', ') + ', ' + conjunction + ' ' + values[values.length - 1];
}

function mapLabels(values, labels) {
  return readableList(values.map(function (value) { return labels[value] || value; }));
}

export function buildWorkflowSummary(answers, patterns) {
  var archetype = getArchetype(patterns, answers.archetype);
  var purpose = answers.archetype === 'custom'
    ? answers.customDescription
    : archetype && archetype.description;
  var engine = answers.engine ? (engineLabels[answers.engine] || 'Copilot') : null;
  var agent = engine && readableList([engine].concat(
    (answers.extras || []).map(function (extra) { return extraLabels[extra] || extra; })
  ), 'with');

  return {
    trigger: {
      value: answers.triggers.length
        ? readableList(answers.triggers.map(function (trigger) {
          if (trigger === 'pull_request' && answers.archetype === 'pr-review') {
            return 'a pull request is ready for review';
          }
          return triggerLabels[trigger] || trigger;
        }), 'or')
        : 'choose when it runs',
      complete: answers.triggers.length > 0
    },
    purpose: {
      value: purpose || 'choose what the agent should do',
      complete: Boolean(purpose)
    },
    output: {
      value: answers.outputs.length
        ? mapLabels(answers.outputs, outputLabels)
        : 'choose what it can write',
      complete: answers.outputs.length > 0
    },
    engine: {
      value: agent || 'choose an agent',
      complete: Boolean(engine)
    }
  };
}

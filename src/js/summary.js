// Readable, progressive summary of the workflow being configured.

import { getArchetype } from './patterns.js';

var triggerLabels = {
  issues: 'a new issue is opened',
  pull_request: 'a pull request is opened',
  schedule: 'the schedule runs',
  workflow_dispatch: 'it is started manually',
  slash_command: 'a slash command is posted',
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

function readableList(values) {
  if (values.length < 2) return values[0] || '';
  if (values.length === 2) return values[0] + ' and ' + values[1];
  return values.slice(0, -1).join(', ') + ', and ' + values[values.length - 1];
}

function mapLabels(values, labels) {
  return readableList(values.map(function (value) { return labels[value] || value; }));
}

export function buildWorkflowSummary(answers, patterns) {
  var archetype = getArchetype(patterns, answers.archetype);
  var purpose = answers.archetype === 'custom'
    ? answers.customDescription
    : archetype && archetype.description;
  var engine = engineLabels[answers.engine] || 'Copilot';
  var context = [];

  if ((answers.extras || []).indexOf('memory') !== -1) {
    context.push('memory between runs');
  }
  if (answers.dataDescription) {
    context.push('project-specific context');
  }

  return {
    trigger: {
      value: answers.triggers.length
        ? mapLabels(answers.triggers, triggerLabels)
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
      value: engine,
      complete: true
    },
    context: readableList(context)
  };
}

// Readable, progressive summary of the workflow being configured.

import { getArchetype } from './patterns.js';
import { formatEngineLabel } from './engines.js';

const triggerLabels = {
  issues: 'a new issue is opened',
  pull_request: 'a pull request is opened',
  pull_request_ready_for_review: 'a pull request is ready for review',
  schedule: 'the schedule runs',
  slash_command: 'a slash command is posted (not recommended)',
  label_command: 'a matching label is added',
  push: 'code is pushed to main'
};

const outputLabels = {
  'add-comment': 'add comment',
  'add-labels': 'add label',
  'create-issue': 'create issue',
  'create-pull-request': 'create pull request',
  'create-pull-request-review-comment': 'add review comment',
  comments: 'add comment',
  labels: 'add label',
  'new-issues': 'create issue',
  'pull-requests': 'create pull request',
  commits: 'commit changes'
};

const engineLabels = {
  copilot: 'Copilot',
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  pi: 'Pi'
};

const extraLabels = {
  memory: 'memory between runs',
  charts: 'chart generation',
  browser: 'browser access'
};

function readableList(values, conjunction) {
  conjunction = conjunction || 'and';
  if (values.length < 2) return values[0] || '';
  if (values.length === 2) return `${values[0]  } ${  conjunction  } ${  values[1]}`;
  return `${values.slice(0, -1).join(', ')  }, ${  conjunction  } ${  values[values.length - 1]}`;
}

function mapLabels(values, labels) {
  return readableList(values.map((value) => { return labels[value] || value; }));
}

export function buildWorkflowSummary(answers, patterns) {
  const archetype = getArchetype(patterns, answers.archetype);
  const purpose = answers.archetype === 'custom'
    ? answers.customDescription
    : archetype && archetype.description;
  const engine = answers.engine ? (engineLabels[answers.engine] || formatEngineLabel(answers.engine)) : null;
  const capabilities = (answers.extras || []).map((extra) => { return extraLabels[extra] || extra; });

  return {
    trigger: {
      value: answers.triggers.length
        ? readableList(answers.triggers.map((trigger) => {
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
    extras: {
      value: capabilities.length ? readableList(capabilities) : 'choose optional capabilities',
      complete: capabilities.length > 0
    },
    engine: {
      value: engine || 'choose an agent',
      complete: Boolean(engine)
    }
  };
}

// Workflow file generation — pure functions, no DOM access.

import { getArchetype } from './patterns.js';
import {
  buildIssueTriage,
  buildCodeImprovement,
  buildStatusReport,
  buildDependencyMonitor,
  buildContentModeration,
  buildUpstreamMonitor,
  buildDocumentationUpdater,
  buildPrReview,
  buildCustom
} from './bodies.js';

export function workflowName(archetype, customDesc) {
  if (archetype === 'custom' && customDesc) {
    return customDesc.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'custom-workflow';
  }
  return archetype;
}

export function inferNeedsPreSteps(archetype) {
  // These archetypes deal with lots of data — auto-add pre-steps
  return ['status-report', 'dependency-monitor', 'upstream-monitor'].indexOf(archetype) !== -1;
}

export function inferCapabilities(archetype) {
  // Auto-infer what tools/capabilities the archetype needs
  var caps = { preSteps: false, bash: false, githubToolsets: false };
  switch (archetype) {
    case 'status-report':
      caps.preSteps = true; caps.githubToolsets = true; break;
    case 'dependency-monitor':
    case 'upstream-monitor':
      caps.preSteps = true; caps.bash = true; break;
    case 'code-improvement':
    case 'documentation-updater':
      caps.bash = true; break;
  }
  return caps;
}

export function buildTriggerYaml(triggers, commandName) {
  var lines = '';
  var name = commandName || 'agentic-workflow';
  triggers.forEach(function (t) {
    switch (t) {
      case 'issues':
        lines += '  issues:\n    types: [opened]\n'; break;
      case 'pull_request':
        lines += '  pull_request:\n    types: [opened]\n'; break;
      case 'schedule':
        lines += '  schedule:\n    - cron: "0 9 * * 1-5"\n'; break;
      case 'workflow_dispatch':
        lines += '  workflow_dispatch:\n'; break;
      case 'slash_command':
      case 'issue_comment':
        lines += '  slash_command:\n    name: ' + name + '\n'; break;
      case 'label_command':
        lines += '  label_command:\n    name: ' + name + '\n'; break;
      case 'push':
        lines += '  push:\n    branches: [main]\n'; break;
    }
  });
  return lines;
}

export function generateWorkflowFile(answers, patterns) {
  var arch = getArchetype(patterns, answers.archetype);
  var name = workflowName(answers.archetype, answers.customDescription);
  var label = arch ? arch.label : 'Custom Workflow';
  var desc = arch ? arch.description : answers.customDescription || 'Custom agentic workflow';

  // Build tools and safe-outputs
  var toolSet = new Set();
  var safeSet = new Set();
  answers.outputs.forEach(function (o) {
    switch (o) {
      case 'comments':
        toolSet.add('add-comment'); safeSet.add('issues'); safeSet.add('pull-requests'); break;
      case 'labels':
        toolSet.add('add-label'); safeSet.add('issues'); break;
      case 'new-issues':
        toolSet.add('create-issue'); safeSet.add('issues'); break;
      case 'pull-requests':
        toolSet.add('create-pull-request'); safeSet.add('pull-requests'); break;
      case 'commits':
        toolSet.add('commit-files'); safeSet.add('contents'); break;
    }
  });
  var tools = Array.from(toolSet);
  var safeOutputs = Array.from(safeSet);

  // Timeout
  var timeout = (arch && arch.timeout_minutes) ? arch.timeout_minutes : 30;
  if (patterns && patterns.config_defaults && patterns.config_defaults.timeout_by_trigger) {
    answers.triggers.forEach(function (t) {
      var val = patterns.config_defaults.timeout_by_trigger[t];
      if (val && val > timeout) timeout = val;
    });
  }

  // Trigger config YAML
  var triggerYaml = buildTriggerYaml(answers.triggers, name);

  // Frontmatter — auto-infer capabilities from archetype
  var inferred = inferCapabilities(answers.archetype);
  var extras = answers.extras || [];
  var fm = '---\n';
  fm += 'name: ' + name + '\n';
  fm += 'description: ' + desc + '\n';
  fm += 'on:\n' + triggerYaml;

  // Tools section
  fm += 'tools:\n';
  tools.forEach(function (t) { fm += '  - ' + t + '\n'; });
  if (inferred.bash) {
    fm += '  bash: true\n';
  }
  if (inferred.githubToolsets) {
    fm += '  github:\n';
    fm += '    toolsets: [repos, issues, pull_requests, actions, code_security, discussions]\n';
  }
  if (extras.indexOf('memory') !== -1) {
    fm += '  cache-memory:\n';
  }

  fm += 'safe-outputs:\n';
  safeOutputs.forEach(function (s) { fm += '  - ' + s + '\n'; });
  fm += 'timeout-minutes: ' + timeout + '\n';

  fm += '---\n\n';

  // Add project context if provided
  var context = answers.dataDescription;
  var contextSection = '';
  if (context) {
    contextSection = '## Project Context\n\n' + context + '\n\n';
  }

  // Body — varies by archetype
  var body = '';
  switch (answers.archetype) {
    case 'issue-triage':
      body = buildIssueTriage(answers, label);
      break;
    case 'code-improvement':
      body = buildCodeImprovement(answers, label);
      break;
    case 'status-report':
      body = buildStatusReport(answers, label);
      break;
    case 'dependency-monitor':
      body = buildDependencyMonitor(answers, label);
      break;
    case 'content-moderation':
      body = buildContentModeration(answers, label);
      break;
    case 'upstream-monitor':
      body = buildUpstreamMonitor(answers, label);
      break;
    case 'documentation-updater':
      body = buildDocumentationUpdater(answers, label);
      break;
    case 'pr-review':
      body = buildPrReview(answers, label);
      break;
    default:
      body = buildCustom(answers, label);
  }

  return fm + body + contextSection;
}

export function generateAgentPrompt(answers, patterns) {
  var arch = getArchetype(patterns, answers.archetype);
  var name = workflowName(answers.archetype, answers.customDescription);
  var desc = arch ? arch.description : answers.customDescription || 'Custom agentic workflow';

  var triggersReadable = answers.triggers.map(function (t) {
    var map = {
      'issues': 'when a new issue is opened',
      'pull_request': 'when a pull request is opened',
      'schedule': 'on a daily/weekly schedule',
      'workflow_dispatch': 'on manual dispatch',
      'slash_command': 'on slash commands in comments',
      'label_command': 'when a matching label is added',
      'issue_comment': 'on slash commands in comments',
      'push': 'on push to main'
    };
    return map[t] || t;
  }).join(', ');

  var outputsReadable = answers.outputs.map(function (o) {
    var map = {
      'comments': 'post comments on issues/PRs',
      'labels': 'add/remove labels',
      'new-issues': 'create new issues',
      'pull-requests': 'open pull requests',
      'commits': 'commit file changes'
    };
    return map[o] || o;
  }).join(', ');

  var prompt = 'Create a workflow for GitHub Agentic Workflows using https://raw.githubusercontent.com/github/gh-aw/main/create.md\n\n';
  prompt += 'The purpose of the workflow is: ' + desc + '\n\n';
  prompt += 'Requirements:\n';
  prompt += '- Name: ' + name + '\n';
  prompt += '- Triggers: ' + triggersReadable + '\n';
  prompt += '- Allowed outputs: ' + outputsReadable + '\n';

  // Auto-inferred capabilities communicated to the agent
  if (answers.needsData) {
    prompt += '- Add a pre-step to fetch external data before the agent runs\n';
  }
  var extras = answers.extras || [];
  if (extras.indexOf('memory') !== -1) {
    prompt += '- Add cache-memory tool for persistent memory across runs\n';
  }
  if (answers.dataDescription) {
    prompt += '- Additional project context: ' + answers.dataDescription + '\n';
  }

  prompt += '\nThe workflow should be saved to .github/workflows/' + name + '.md';
  return prompt;
}

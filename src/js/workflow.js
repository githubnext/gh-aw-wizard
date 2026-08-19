// Workflow file generation — pure functions, no DOM access.

import { getArchetype } from './patterns.js';
import {
  buildIssueTriage,
  buildCodeImprovement,
  buildStatusReport,
  buildDependencyMonitor,
  buildContentModeration,
  buildDocumentationUpdater,
  buildPrReview,
  buildDailyTestImprover,
  buildRepoMaintainer,
  buildLinterMiner,
  buildLinterRefiner,
  buildLinterApplier,
  buildSkillPrReviewer,
  buildCustom
} from './bodies.js';

export function normalizeEngine(engine) {
  return ['copilot', 'claude', 'codex', 'gemini', 'pi'].includes(engine) ? engine : 'copilot';
}

export function workflowName(archetype, customDesc) {
  if (archetype === 'custom' && customDesc) {
    return customDesc.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'custom-workflow';
  }
  return archetype;
}

export function inferNeedsPreSteps(archetype) {
  // These archetypes deal with lots of data — auto-add pre-steps
  return ['status-report', 'dependency-monitor', 'repo-maintainer', 'linter-miner'].indexOf(archetype) !== -1;
}

export function inferCapabilities(archetype) {
  // Auto-infer what tools/capabilities the archetype needs
  var caps = { preSteps: false, bash: false, githubToolsets: false };
  switch (archetype) {
    case 'status-report':
      caps.preSteps = true; caps.githubToolsets = true; break;
    case 'dependency-monitor':
      caps.preSteps = true; caps.bash = true; break;
    case 'code-improvement':
    case 'documentation-updater':
    case 'daily-test-improver':
    case 'linter-refiner':
    case 'linter-applier':
      caps.bash = true; break;
    case 'pr-review':
    case 'skill-pr-reviewer':
      caps.githubToolsets = true; break;
    case 'repo-maintainer':
    case 'linter-miner':
      caps.preSteps = true; caps.bash = true; caps.githubToolsets = true; break;
  }
  return caps;
}

// Per-archetype GitHub toolset scope — narrower than the default set so
// reviewers only get the read access they actually need to see PR diffs.
var GITHUB_TOOLSETS_BY_ARCHETYPE = {
  'pr-review': ['repos', 'issues', 'pull_requests'],
  'skill-pr-reviewer': ['repos', 'issues', 'pull_requests']
};
var DEFAULT_GITHUB_TOOLSETS = ['repos', 'issues', 'pull_requests', 'actions', 'code_security', 'discussions'];

// Per-archetype read permissions — pr-review only needs enough to read the
// PR diff/metadata, not the full status-report surface (actions, security, discussions).
var PERMISSIONS_BY_ARCHETYPE = {
  'pr-review': ['contents', 'issues', 'pull-requests'],
  'skill-pr-reviewer': ['contents', 'issues', 'pull-requests']
};
var DEFAULT_PERMISSIONS = ['actions', 'contents', 'discussions', 'issues', 'pull-requests', 'security-events'];

export function buildTriggerYaml(triggers, commandName, archetype) {
  var lines = '';
  var name = commandName || 'agentic-workflow';
  triggers.forEach(function (t) {
    switch (t) {
      case 'issues':
        lines += '  issues:\n    types: [opened]\n'; break;
      case 'pull_request':
        // PR reviewers should act once a PR is actually ready (not while still a draft).
        lines += (archetype === 'pr-review' || archetype === 'skill-pr-reviewer')
          ? '  pull_request:\n    types: [ready_for_review]\n'
          : '  pull_request:\n    types: [opened]\n';
        break;
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

  // Build safe outputs
  var safeSet = new Set();
  answers.outputs.forEach(function (o) {
    switch (o) {
      case 'add-comment':
      case 'add-labels':
      case 'create-issue':
      case 'create-pull-request':
      case 'create-pull-request-review-comment':
        safeSet.add(o); break;
      // Keep older stored wizard values working for users with saved selections.
      case 'comments':
        safeSet.add('add-comment'); break;
      case 'labels':
        safeSet.add('add-labels'); break;
      case 'new-issues':
        safeSet.add('create-issue'); break;
      case 'pull-requests':
        safeSet.add('create-pull-request'); break;
      case 'commits':
        safeSet.add('create-pull-request'); break;
    }
  });
  if ((answers.extras || []).indexOf('charts') !== -1) {
    safeSet.add('upload-assets');
  }
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
  var triggerYaml = buildTriggerYaml(answers.triggers, name, answers.archetype);

  // Frontmatter — auto-infer capabilities from archetype
  var inferred = inferCapabilities(answers.archetype);
  var extras = answers.extras || [];
  var engine = normalizeEngine(answers.engine);
  var fm = '---\n';
  fm += 'name: ' + name + '\n';
  fm += 'description: ' + desc + '\n';
  fm += 'on:\n' + triggerYaml;
  if (inferred.githubToolsets) {
    var perms = PERMISSIONS_BY_ARCHETYPE[answers.archetype] || DEFAULT_PERMISSIONS;
    fm += 'permissions:\n';
    perms.forEach(function (p) { fm += '  ' + p + ': read\n'; });
  }
  fm += 'engine: ' + engine + '\n';

  // Tools section
  if (inferred.bash || inferred.githubToolsets || extras.indexOf('memory') !== -1 || extras.indexOf('browser') !== -1) {
    fm += 'tools:\n';
    if (inferred.bash) {
      fm += '  bash: true\n';
    }
    if (inferred.githubToolsets) {
      var toolsets = GITHUB_TOOLSETS_BY_ARCHETYPE[answers.archetype] || DEFAULT_GITHUB_TOOLSETS;
      fm += '  github:\n';
      fm += '    toolsets: [' + toolsets.join(', ') + ']\n';
    }
    if (extras.indexOf('memory') !== -1) {
      fm += '  cache-memory:\n';
    }
    if (extras.indexOf('browser') !== -1) {
      fm += '  playwright:\n    mode: cli\n';
    }
  }

  if (safeOutputs.length) {
    fm += 'safe-outputs:\n';
    safeOutputs.forEach(function (safeOutput) { fm += '  ' + safeOutput + ':\n'; });
  }
  fm += 'timeout-minutes: ' + timeout + '\n';

  fm += '---\n\n';

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
    case 'documentation-updater':
      body = buildDocumentationUpdater(answers, label);
      break;
    case 'pr-review':
      body = buildPrReview(answers, label);
      break;
    case 'daily-test-improver':
      body = buildDailyTestImprover(answers, label);
      break;
    case 'repo-maintainer':
      body = buildRepoMaintainer(answers, label);
      break;
    case 'linter-miner':
      body = buildLinterMiner(answers, label);
      break;
    case 'linter-refiner':
      body = buildLinterRefiner(answers, label);
      break;
    case 'linter-applier':
      body = buildLinterApplier(answers, label);
      break;
    case 'skill-pr-reviewer':
      body = buildSkillPrReviewer(answers, label);
      break;
    default:
      body = buildCustom(answers, label);
  }

  return fm + body;
}

export function fencedBlock(content, lang) {
  // Use a fence longer than the longest backtick run inside the content so
  // nested code blocks in the generated markdown stay intact.
  var body = String(content).replace(/\s+$/, '');
  var longest = 0;
  var matches = body.match(/`+/g) || [];
  matches.forEach(function (m) { if (m.length > longest) longest = m.length; });
  var fence = '`'.repeat(Math.max(3, longest + 1));
  return fence + (lang || '') + '\n' + body + '\n' + fence;
}

var GH_AW_INSTRUCTIONS_BASE = 'https://raw.githubusercontent.com/github/gh-aw/main/.github/aw/';
var SCENARIO_INSTRUCTIONS = {
  'issue-triage': ['maintainer.md'],
  'code-improvement': ['maintainer.md'],
  'status-report': ['report.md'],
  'dependency-monitor': ['maintainer.md'],
  'documentation-updater': ['maintainer.md'],
  'pr-review': ['pr-reviewer.md'],
  'daily-test-improver': ['test-coverage.md'],
  'repo-maintainer': ['maintainer.md'],
  'linter-miner': ['linter-workflows.md'],
  'linter-refiner': ['linter-workflows.md'],
  'linter-applier': ['linter-workflows.md'],
  'skill-pr-reviewer': ['pr-reviewer.md', 'skills.md']
};

function instructionUrls(archetype) {
  var urls = [GH_AW_INSTRUCTIONS_BASE + 'create-agentic-workflow.md'];
  var scenarioInstructions = SCENARIO_INSTRUCTIONS[archetype] || [];
  scenarioInstructions.forEach(function (instruction) {
    urls.push(GH_AW_INSTRUCTIONS_BASE + instruction);
  });
  return urls;
}

function sampleWorkflowFile(answers, patterns, label) {
  var workflow = generateWorkflowFile(answers, patterns);
  var frontmatterEnd = workflow.indexOf('\n---\n\n');
  var frontmatter = workflow.slice(0, frontmatterEnd + 6);
  return frontmatter + 'Let the agent generate the detailed ' + label.toLowerCase() + ' prompt for this repository...\n';
}

export function generateAgentPrompt(answers, patterns) {
  var arch = getArchetype(patterns, answers.archetype);
  var name = workflowName(answers.archetype, answers.customDescription);
  var label = arch ? arch.label : 'Custom Workflow';
  var desc = arch ? arch.description : answers.customDescription || 'Custom agentic workflow';
  var engine = normalizeEngine(answers.engine);

  var triggersReadable = answers.triggers.map(function (t) {
    var map = {
      'issues': 'when a new issue is opened',
      'pull_request': (answers.archetype === 'pr-review' || answers.archetype === 'skill-pr-reviewer')
        ? 'when a pull request is marked ready for review'
        : 'when a pull request is opened',
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
      'add-comment': 'add comments on issues/PRs',
      'add-labels': 'add labels',
      'create-issue': 'create new issues',
      'create-pull-request': 'open pull requests',
      'create-pull-request-review-comment': 'add review comments on pull request diffs',
      // Keep older stored wizard values readable for users with saved selections.
      'comments': 'add comments on issues/PRs',
      'labels': 'add labels',
      'new-issues': 'create new issues',
      'pull-requests': 'open pull requests',
      'commits': 'commit file changes'
    };
    return map[o] || o;
  }).join(', ');

  var prompt = 'Create a workflow for GitHub Agentic Workflows using these instructions:\n';
  instructionUrls(answers.archetype).forEach(function (url) {
    prompt += '- ' + url + '\n';
  });
  prompt += '\n';
  prompt += 'The purpose of the workflow is: ' + desc + '\n\n';
  prompt += 'First, analyze this repository so the workflow is optimized for it:\n';
  prompt += '- Read the README, AGENTS.md (and any CONTRIBUTING or docs files) to understand the project purpose and conventions\n';
  prompt += '- Identify the languages, package managers, build/test/lint commands and CI setup actually used\n';
  prompt += '- Note repository conventions such as labels, issue/PR templates and branch naming\n';
  prompt += '- Use those findings to tailor the workflow prompt, tools, and instructions to this repository\n\n';
  prompt += 'Requirements:\n';
  prompt += '- Name: ' + name + '\n';
  prompt += '- Engine: ' + engine + '\n';
  prompt += '- Triggers: ' + triggersReadable + '\n';
  prompt += '- Allowed outputs: ' + outputsReadable + '\n';
  prompt += '- Choose an appropriate kebab-case filename for the new .github/workflows/*.md file\n';

  // Auto-inferred capabilities communicated to the agent
  if (answers.needsData) {
    prompt += '- Add a pre-step to fetch external data before the agent runs\n';
  }
  var extras = answers.extras || [];
  if (extras.indexOf('memory') !== -1) {
    prompt += '- Add cache-memory tool for persistent memory across runs\n';
  }
  if (extras.indexOf('charts') !== -1) {
    prompt += '- Add upload-assets safe output to publish generated charts\n';
  }
  if (extras.indexOf('browser') !== -1) {
    prompt += '- Enable Playwright CLI for browser automation\n';
  }

  prompt += '\nThe workflow should be saved as a new Markdown file in .github/workflows/.';
  prompt += '\nCreate a pull request with the generated agentic workflow files.';

  // Inline the generated workflow markdown as a starting-point suggestion.
  var suggestion = sampleWorkflowFile(answers, patterns, label);
  prompt += '\n\n## Suggested workflow file\n\n' +
    'Use this generated draft as a starting point for the new `.github/workflows/*.md` file, ' +
    'adapting it to the repository as needed:\n\n' +
    fencedBlock(suggestion, 'markdown') + '\n';

  return prompt;
}

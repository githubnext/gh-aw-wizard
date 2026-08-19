// Workflow file generation — pure functions, no DOM access.

import { getArchetype } from './patterns.js';
import { isKnownEngine } from './engines.js';
import {
  buildIssueTriage,
  buildCodeImprovement,
  buildStatusReport,
  buildDependencyMonitor,
  buildContentModeration,
  buildDocumentationUpdater,
  buildAccessibilityExpert,
  buildPerformanceNut,
  buildUserSimulator,
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
  return isKnownEngine(engine) ? engine : 'copilot';
}

export function workflowName(archetype, customDesc) {
  if (archetype === 'custom' && customDesc) {
    return customDesc.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'custom-workflow';
  }
  return archetype;
}

export function inferNeedsPreSteps(archetype) {
  // These archetypes deal with lots of data — auto-add pre-steps
  return ['status-report', 'dependency-monitor', 'repo-maintainer', 'linter-workflows', 'linter-miner'].indexOf(archetype) !== -1;
}

export function inferCapabilities(archetype) {
  // Auto-infer what tools/capabilities the archetype needs
  var caps = { preSteps: false, bash: false, githubToolsets: false, browser: false };
  switch (archetype) {
    case 'status-report':
      caps.preSteps = true; caps.githubToolsets = true; break;
    case 'dependency-monitor':
      caps.preSteps = true; caps.bash = true; break;
    case 'code-improvement':
    case 'documentation-updater':
    case 'performance-nut':
    case 'daily-test-improver':
    case 'linter-refiner':
    case 'linter-applier':
      caps.bash = true; break;
    case 'accessibility-expert':
      caps.bash = true; caps.githubToolsets = true; caps.browser = true; break;
    case 'user-simulator':
      caps.githubToolsets = true; break;
    case 'pr-review':
    case 'skill-pr-reviewer':
      caps.githubToolsets = true; break;
    case 'repo-maintainer':
    case 'linter-workflows':
    case 'linter-miner':
      caps.preSteps = true; caps.bash = true; caps.githubToolsets = true; break;
  }
  return caps;
}

// Per-archetype GitHub toolset scope — narrower than the default set so
// reviewers only get the read access they actually need to see PR diffs.
var GITHUB_TOOLSETS_BY_ARCHETYPE = {
  'pr-review': ['repos', 'issues', 'pull_requests'],
  'skill-pr-reviewer': ['repos', 'issues', 'pull_requests'],
  'accessibility-expert': ['repos', 'issues', 'pull_requests'],
  'user-simulator': ['repos', 'issues', 'pull_requests']
};
var DEFAULT_GITHUB_TOOLSETS = ['repos', 'issues', 'pull_requests', 'actions', 'code_security', 'discussions'];

// Per-archetype read permissions — pr-review only needs enough to read the
// PR diff/metadata, not the full status-report surface (actions, security, discussions).
var PERMISSIONS_BY_ARCHETYPE = {
  'pr-review': ['contents', 'issues', 'pull-requests'],
  'skill-pr-reviewer': ['contents', 'issues', 'pull-requests'],
  'accessibility-expert': ['contents', 'issues', 'pull-requests'],
  'user-simulator': ['contents', 'issues', 'pull-requests']
};
var DEFAULT_PERMISSIONS = ['actions', 'contents', 'discussions', 'issues', 'pull-requests', 'security-events'];
// Bash-only archetypes (no github toolset) still need read access to check out and
// inspect the repo — without this they were emitting no `permissions:` block at all,
// leaving the job on the default (often broader) GITHUB_TOKEN scope.
var BASH_ONLY_PERMISSIONS = ['contents'];

export function buildTriggerYaml(triggers, commandName, archetype) {
  var lines = '';
  var name = commandName || 'agentic-workflow';
  var pullRequestWritten = false;
  triggers.forEach(function (t) {
    switch (t) {
      case 'issues':
        lines += '  issues:\n    types: [opened]\n'; break;
      case 'pull_request':
      case 'pull_request_ready_for_review':
        if (pullRequestWritten) break;
        var pullRequestTypes = [];
        if (triggers.indexOf('pull_request') !== -1 &&
            archetype !== 'pr-review' && archetype !== 'skill-pr-reviewer') {
          pullRequestTypes.push('opened');
        }
        if (triggers.indexOf('pull_request_ready_for_review') !== -1 ||
            archetype === 'pr-review' || archetype === 'skill-pr-reviewer') {
          pullRequestTypes.push('ready_for_review');
        }
        lines += '  pull_request:\n    types: [' + pullRequestTypes.join(', ') + ']\n';
        pullRequestWritten = true;
        break;
      case 'schedule':
        lines += '  schedule:\n    - cron: "0 9 * * 1-5"\n'; break;
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
  if (answers.archetype === 'linter-workflows') {
    throw new Error('Linter Workflows generates multiple files; use the prompt format.');
  }
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
  } else if (inferred.bash) {
    // Bash-only archetypes still check out and read the repo, so declare the
    // minimal read permission explicitly rather than relying on defaults.
    fm += 'permissions:\n';
    BASH_ONLY_PERMISSIONS.forEach(function (p) { fm += '  ' + p + ': read\n'; });
  }
  fm += 'engine: ' + engine + '\n';

  // Tools section
  if (inferred.bash || inferred.githubToolsets || inferred.browser || extras.indexOf('memory') !== -1 || extras.indexOf('browser') !== -1) {
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
    if (inferred.browser || extras.indexOf('browser') !== -1) {
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
    case 'accessibility-expert':
      body = buildAccessibilityExpert(answers, label);
      break;
    case 'performance-nut':
      body = buildPerformanceNut(answers, label);
      break;
    case 'user-simulator':
      body = buildUserSimulator(answers, label);
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
  'accessibility-expert': [
    'https://raw.githubusercontent.com/github/gh-aw/main/docs/src/content/docs/reference/playwright.md',
    'syntax-tools-imports.md',
    'create-agentic-workflow-trigger-details.md'
  ],
  'performance-nut': [
    'https://raw.githubusercontent.com/github/gh-aw/main/.github/copilot/instructions/cli-performance.md',
    'https://raw.githubusercontent.com/github/gh-aw/main/.github/copilot/instructions/build-performance.md',
    'maintainer.md',
    'memory-stateful-patterns.md'
  ],
  'user-simulator': ['github-agentic-workflows.md'],
  'pr-review': ['pr-reviewer.md'],
  'daily-test-improver': ['test-coverage.md'],
  'repo-maintainer': ['maintainer.md'],
  'linter-workflows': ['linter-workflows.md'],
  'linter-miner': ['linter-workflows.md'],
  'linter-refiner': ['linter-workflows.md'],
  'linter-applier': ['linter-workflows.md'],
  'skill-pr-reviewer': ['pr-reviewer.md', 'skills.md']
};

function instructionUrls(archetype) {
  var urls = [GH_AW_INSTRUCTIONS_BASE + 'create-agentic-workflow.md'];
  var scenarioInstructions = SCENARIO_INSTRUCTIONS[archetype] || [];
  scenarioInstructions.forEach(function (instruction) {
    urls.push(instruction.indexOf('https://') === 0 ? instruction : GH_AW_INSTRUCTIONS_BASE + instruction);
  });
  return urls;
}

function sampleWorkflowFile(answers, patterns, label) {
  var workflow = generateWorkflowFile(answers, patterns);
  var frontmatterEnd = workflow.indexOf('\n---\n\n');
  var frontmatter = workflow.slice(0, frontmatterEnd + 6);
  return frontmatter + 'Let the agent generate the detailed ' + label.toLowerCase() + ' prompt for this repository...\n';
}

var MULTI_WORKFLOW_ARCHETYPES = {
  'linter-workflows': ['linter-miner', 'linter-refiner', 'linter-applier']
};

function requestedWorkflows(answers, patterns) {
  var archetypes = MULTI_WORKFLOW_ARCHETYPES[answers.archetype];
  if (!archetypes) {
    var arch = getArchetype(patterns, answers.archetype);
    return [{
      answers: answers,
      archetype: arch,
      label: arch ? arch.label : 'Custom Workflow',
      description: arch ? arch.description : answers.customDescription || 'Custom agentic workflow'
    }];
  }
  return archetypes.map(function (archetype) {
    var arch = getArchetype(patterns, archetype);
    return {
      answers: Object.assign({}, answers, {
        archetype: archetype,
        needsData: inferNeedsPreSteps(archetype)
      }),
      archetype: arch,
      label: arch ? arch.label : 'Custom Workflow',
      description: arch ? arch.description : answers.customDescription || 'Custom agentic workflow'
    };
  });
}

export function generateAgentPrompt(answers, patterns) {
  var arch = getArchetype(patterns, answers.archetype);
  var name = workflowName(answers.archetype, answers.customDescription);
  var label = arch ? arch.label : 'Custom Workflow';
  var desc = arch ? arch.description : answers.customDescription || 'Custom agentic workflow';
  var engine = normalizeEngine(answers.engine);
  var inferred = inferCapabilities(answers.archetype);
  var workflows = requestedWorkflows(answers, patterns);
  var multiple = workflows.length > 1;

  var triggersReadable = answers.triggers.map(function (t) {
    var map = {
      'issues': 'when a new issue is opened',
      'pull_request': (answers.archetype === 'pr-review' || answers.archetype === 'skill-pr-reviewer')
        ? 'when a pull request is marked ready for review'
        : 'when a pull request is opened',
      'pull_request_ready_for_review': 'when a pull request is marked ready for review',
      'schedule': 'on a daily/weekly schedule',
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

  var prompt = 'Create a draft PR that adds ' + (multiple ? workflows.length + ' agentic workflows' : 'an agentic workflow') +
    ' using these instructions:\n';
  var instructionSet = new Set();
  workflows.forEach(function (workflow) {
    instructionUrls(workflow.answers.archetype).forEach(function (url) { instructionSet.add(url); });
  });
  instructionSet.forEach(function (url) {
    prompt += '- ' + url + '\n';
  });
  prompt += '\n';
  prompt += 'The purpose of ' + (multiple ? 'the workflows' : 'the workflow') + ' is: ' + desc + '\n\n';
  prompt += 'First, analyze this repository so the ' + (multiple ? 'workflows are' : 'workflow is') + ' optimized for it:\n';
  prompt += '- Read the README, AGENTS.md (and any CONTRIBUTING or docs files) to understand the project purpose and conventions\n';
  prompt += '- Identify the languages, package managers, build/test/lint commands and CI setup actually used\n';
  prompt += '- Note repository conventions such as labels, issue/PR templates and branch naming\n';
  prompt += '- Use those findings to tailor the workflow prompt, tools, and instructions to this repository\n\n';
  prompt += 'Requirements:\n';
  if (multiple) {
    prompt += '- Generate exactly ' + workflows.length + ' independent workflow files:\n';
    workflows.forEach(function (workflow) {
      prompt += '  - ' + workflow.label + ': name it ' +
        workflowName(workflow.answers.archetype, workflow.answers.customDescription) +
        ' and use it to ' + workflow.description.charAt(0).toLowerCase() + workflow.description.slice(1) + '\n';
    });
  } else {
    prompt += '- Name: ' + name + '\n';
  }
  prompt += '- Engine: ' + engine + '\n';
  prompt += '- Triggers: ' + triggersReadable + '\n';
  prompt += '- Allowed outputs: ' + outputsReadable + '\n';
  prompt += multiple
    ? '- Save each workflow in its own appropriately named .github/workflows/*.md file\n'
    : '- Choose an appropriate kebab-case filename for the new .github/workflows/*.md file\n';

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
  if (inferred.browser || extras.indexOf('browser') !== -1) {
    prompt += '- Enable Playwright CLI for browser automation\n';
  }

  prompt += multiple
    ? '\nAll workflows should be saved as separate Markdown files in .github/workflows/.'
    : '\nThe workflow should be saved as a new Markdown file in .github/workflows/.';
  prompt += '\nCreate a pull request with the generated agentic workflow files.';

  // Inline generated workflow markdown as starting-point suggestions.
  prompt += '\n\n## Suggested workflow ' + (multiple ? 'files' : 'file') + '\n\n';
  if (!multiple) {
    prompt += 'Use this generated draft as a starting point for the new `.github/workflows/*.md` file, ' +
      'adapting it to the repository as needed:\n\n';
  }
  workflows.forEach(function (workflow) {
    if (multiple) {
      prompt += '### ' + workflow.label + '\n\n';
    }
    prompt += fencedBlock(
      sampleWorkflowFile(workflow.answers, patterns, workflow.label),
      'markdown'
    ) + '\n';
    if (multiple) prompt += '\n';
  });

  return prompt;
}

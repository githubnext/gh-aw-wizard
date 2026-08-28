import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

import {
  buildTriggerYaml as buildTriggerYamlFromPatterns,
  fencedBlock,
  generateAgentPrompt,
  generateWorkflowFile,
  inferCapabilities as inferCapabilitiesFromPatterns,
  inferNeedsPreSteps as inferNeedsPreStepsFromPatterns,
  workflowName
} from '../src/js/workflow.js';
import { registerDefinitionEngines } from '../src/js/engines.js';
import { loadPatternsFromDir } from '../src/js/patterns-node.js';

const patterns = await loadPatternsFromDir(fileURLToPath(new URL('../patterns', import.meta.url)));
const inferCapabilities = (archetype) => inferCapabilitiesFromPatterns(archetype, patterns);
const inferNeedsPreSteps = (archetype) => inferNeedsPreStepsFromPatterns(archetype, patterns);
const buildTriggerYaml = (triggers, commandName, archetype) => {
  return buildTriggerYamlFromPatterns(triggers, commandName, archetype, patterns);
};

function answers(overrides) {
  return {
    archetype: 'issue-triage',
    customDescription: '',
    triggers: ['issues', 'push'],
    outputs: ['add-labels', 'add-comment'],
    engine: 'copilot',
    extras: [],
    needsData: false,
    dataDescription: '',
    ...overrides
  };
}

describe('workflowName', () => {
  it('returns the archetype id for known archetypes', () => {
    expect(workflowName('issue-triage', '')).toBe('issue-triage');
  });

  it('slugifies the description for custom workflows', () => {
    expect(workflowName('custom', 'Review PRs for Security!')).toBe('review-prs-for-security');
  });

  it('falls back to a default name when the slug is empty', () => {
    expect(workflowName('custom', '!!!')).toBe('custom-workflow');
  });

  it('truncates long custom names', () => {
    const name = workflowName('custom', 'a'.repeat(80));
    expect(name).toHaveLength(40);
  });
});

describe('inferNeedsPreSteps', () => {
  it('enables pre-steps for data heavy archetypes', () => {
    expect(inferNeedsPreSteps('status-report')).toBe(true);
    expect(inferNeedsPreSteps('dependency-monitor')).toBe(true);
    expect(inferNeedsPreSteps('repo-maintainer')).toBe(true);
    expect(inferNeedsPreSteps('linter-workflows')).toBe(true);
    expect(inferNeedsPreSteps('linter-miner')).toBe(true);
  });

  it('leaves other archetypes without pre-steps', () => {
    expect(inferNeedsPreSteps('issue-triage')).toBe(false);
  });
});

describe('inferCapabilities', () => {
  it('adds github toolsets for status reports', () => {
    expect(inferCapabilities('status-report')).toEqual({
      preSteps: true,
      bash: false,
      githubToolsets: true,
      browser: false,
      network: false
    });
  });

  it('adds bash for code improvement', () => {
    expect(inferCapabilities('code-improvement').bash).toBe(true);
  });

  it('enables network access for dependency-monitor so upstream release data can be fetched', () => {
    const caps = inferCapabilities('dependency-monitor');
    expect(caps.network).toBe(true);
    expect(caps.bash).toBe(true);
    expect(caps.preSteps).toBe(true);
  });

  it('returns no capabilities for unknown archetypes', () => {
    expect(inferCapabilities('custom')).toEqual({
      preSteps: false,
      bash: false,
      githubToolsets: false,
      browser: false,
      network: false
    });
  });

  it('adds github toolsets for pr-review so the agent can read PR diffs', () => {
    expect(inferCapabilities('pr-review')).toEqual({
      preSteps: false,
      bash: false,
      githubToolsets: true,
      browser: false,
      network: false
    });
  });

  it('infers capabilities for the new maintenance and review archetypes', () => {
    expect(inferCapabilities('daily-test-improver').bash).toBe(true);
    expect(inferCapabilities('repo-maintainer')).toEqual({
      preSteps: true,
      bash: true,
      githubToolsets: true,
      browser: false,
      network: false
    });
    expect(inferCapabilities('linter-miner')).toEqual({
      preSteps: true,
      bash: true,
      githubToolsets: true,
      browser: false,
      network: false
    });
    expect(inferCapabilities('linter-workflows')).toEqual({
      preSteps: true,
      bash: true,
      githubToolsets: true,
      browser: false,
      network: false
    });
    expect(inferCapabilities('linter-refiner').bash).toBe(true);
    expect(inferCapabilities('linter-applier').bash).toBe(true);
    expect(inferCapabilities('skill-pr-reviewer').githubToolsets).toBe(true);
  });

  it('infers capabilities for the expert and simulation archetypes', () => {
    expect(inferCapabilities('accessibility-expert')).toEqual({
      preSteps: false,
      bash: true,
      githubToolsets: true,
      browser: true,
      network: false
    });
    expect(inferCapabilities('user-simulator')).toEqual({
      preSteps: false,
      bash: false,
      githubToolsets: true,
      browser: false,
      network: false
    });
    expect(inferCapabilities('performance-nut')).toEqual({
      preSteps: false,
      bash: true,
      githubToolsets: false,
      browser: false,
      network: false
    });
  });

  it('configures TypeScript LSP for code health audits', () => {
    const md = generateWorkflowFile(
      answers({ archetype: 'code-health-auditor', triggers: ['schedule'], outputs: ['create-issue'] }),
      patterns
    );
    expect(md).toContain('lsp:\n  typescript:\n    command: typescript-language-server\n    args: ["--stdio"]\n');
    expect(md).toContain('      ".ts": typescript\n');
    expect(md).toContain('network:\n  allowed:\n    - defaults\n    - github\n    - node\n');
  });

  it('does not configure LSP for a non-Copilot engine', () => {
    const md = generateWorkflowFile(
      answers({
        archetype: 'code-health-auditor',
        triggers: ['schedule'],
        outputs: ['create-issue'],
        engine: 'claude'
      }),
      patterns
    );
    expect(md).not.toContain('lsp:\n');
  });

  it('adds selected agentic-workflows and LSP extras for Copilot workflows', () => {
    const md = generateWorkflowFile(
      answers({
        extras: ['agentic-workflows', 'lsp'],
        triggers: ['schedule'],
        outputs: ['create-issue']
      }),
      patterns
    );

    expect(md).toContain('  agentic-workflows: true\n');
    expect(md).toContain('lsp:\n  typescript:\n    command: typescript-language-server\n');
    expect(md).toContain('      ".tsx": typescriptreact\n');
    expect(md).toContain('network:\n  allowed:\n    - defaults\n    - github\n    - node\n');
  });
});

describe('buildTriggerYaml', () => {
  it('maps every supported trigger', () => {
    const yaml = buildTriggerYaml([
      'issues',
      'pull_request',
      'schedule',
      'slash_command',
      'label_command',
      'push'
    ], 'triage-agent');
    expect(yaml).toContain('  issues:\n    types: [opened]\n');
    expect(yaml).toContain('  pull_request:\n    types: [opened]\n');
    expect(yaml).toContain('  schedule:\n    - cron: "0 9 * * 1-5"\n');
    expect(yaml).toContain('  slash_command:\n    name: triage-agent\n');
    expect(yaml).toContain('  label_command:\n    name: triage-agent\n');
    expect(yaml).toContain('  push:\n    branches: [main]\n');
  });

  it('maps the old issue comment trigger to slash command syntax', () => {
    expect(buildTriggerYaml(['issue_comment'], 'triage-agent')).toBe('  slash_command:\n    name: triage-agent\n');
  });

  it('ignores unknown triggers', () => {
    expect(buildTriggerYaml(['unknown_trigger'])).toBe('');
  });

  it('uses ready_for_review for pull_request on the pr-review archetype', () => {
    const yaml = buildTriggerYaml(['pull_request'], 'pr-review-agent', 'pr-review');
    expect(yaml).toBe('  pull_request:\n    types: [ready_for_review]\n');
  });

  it('uses ready_for_review for pull_request on the skill reviewer archetype', () => {
    const yaml = buildTriggerYaml(['pull_request'], 'skill-pr-reviewer', 'skill-pr-reviewer');
    expect(yaml).toBe('  pull_request:\n    types: [ready_for_review]\n');
  });

  it('maps the explicit ready-for-review trigger', () => {
    const yaml = buildTriggerYaml(['pull_request_ready_for_review']);
    expect(yaml).toBe('  pull_request:\n    types: [ready_for_review]\n');
  });

  it('combines pull request activity types into one trigger', () => {
    const yaml = buildTriggerYaml(['pull_request', 'pull_request_ready_for_review']);
    expect(yaml).toBe('  pull_request:\n    types: [opened, ready_for_review]\n');
  });
});

describe('generateWorkflowFile', () => {
  it('generates frontmatter with tools, safe outputs and timeout', () => {
    const md = generateWorkflowFile(answers(), patterns);
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('name: issue-triage\n');
    expect(md).toContain('description: Classify and label new issues\n');
    expect(md).toContain('engine: copilot\n');
    expect(md).toContain('safe-outputs:\n  add-labels:\n  add-comment:\n');
    expect(md).not.toContain('tools:\n');
    expect(md).toContain('timeout-minutes: 30\n');
    expect(md).toContain('# Issue Triage');
  });

  it('gives archetypes with no inferred bash/github toolset a minimal read permissions block', () => {
    // issue-triage relies solely on safe-outputs (add-labels/add-comment) and infers
    // neither bash nor a github toolset, but it still checks out and reads the
    // triggering issue — it should not be left with the default (broader) token scope.
    const md = generateWorkflowFile(answers(), patterns);
    expect(md).toContain('permissions:\n  contents: read\n');
  });

  it('adds a network allowlist for dependency-monitor so upstream release data can be fetched', () => {
    const md = generateWorkflowFile(
      answers({ archetype: 'dependency-monitor', triggers: ['schedule'], outputs: ['create-issue', 'create-pull-request'] }),
      patterns
    );
    expect(md).toContain('network:\n  allowed:\n    - defaults\n    - github\n');
  });

  it('raises the timeout when a trigger requires more time', () => {
    const configuredPatterns = {
      ...patterns,
      config_defaults: {
        ...patterns.config_defaults,
        timeout_by_trigger: {
          ...patterns.config_defaults.timeout_by_trigger,
          schedule: 45
        }
      }
    };
    const md = generateWorkflowFile(
      answers({ triggers: ['schedule', 'push'] }),
      configuredPatterns
    );
    expect(md).toContain('timeout-minutes: 45\n');
  });

  it('gives pr-review read access to the PR diff via scoped permissions and github toolsets', () => {
    const md = generateWorkflowFile(
      answers({
        archetype: 'pr-review',
        triggers: ['pull_request', 'push'],
        outputs: ['create-pull-request-review-comment']
      }),
      patterns
    );
    expect(md).toContain('permissions:\n  contents: read\n  issues: read\n  pull-requests: read\n');
    expect(md).toContain('  github:\n    toolsets: [repos, issues, pull_requests]\n');
  });

  it('gives bash-only archetypes a minimal read permissions block', () => {
    const md = generateWorkflowFile(
      answers({
        archetype: 'code-improvement',
        triggers: ['schedule', 'push'],
        outputs: ['create-pull-request']
      }),
      patterns
    );
    expect(md).toContain('permissions:\n  contents: read\n');
    expect(md).toContain('  bash: true\n');
  });

  it('adds inferred capabilities and optional agent capabilities', () => {
    const md = generateWorkflowFile(
      answers({
        archetype: 'status-report',
        triggers: ['schedule'],
        outputs: ['create-issue'],
        extras: ['memory', 'charts', 'browser'],
        needsData: true
      }),
      patterns
    );
    expect(md).toContain('permissions:\n  actions: read\n  contents: read\n');
    expect(md).toContain('  github:\n');
    expect(md).toContain('  cache-memory:\n');
    expect(md).toContain('  playwright:\n    mode: cli\n');
    expect(md).toContain('safe-outputs:\n  create-issue:\n  upload-assets:\n');
    expect(md).toContain('## Pre-steps');
  });

  it('does not add project context from removed free-text input', () => {
    const md = generateWorkflowFile(answers({ dataDescription: 'Monorepo layout' }), patterns);
    expect(md).not.toContain('## Project Context');
  });

  it('reports when runtime workflow pattern data is unavailable', () => {
    expect(() => generateWorkflowFile(
      answers({ archetype: 'custom', customDescription: 'Do a thing' }),
      null
    )).toThrow('Workflow generation pattern data is unavailable.');
  });

  it('renders capabilities and body content from the workflow generation model', () => {
    const configuredPatterns = structuredClone(patterns);
    configuredPatterns.workflow_generation.archetypes['issue-triage'] = {
      capabilities: { bash: true },
      body: ['# {{label}}', '', 'Configured entirely in JSON']
    };

    const md = generateWorkflowFile(answers(), configuredPatterns);

    expect(md).toContain('  bash: true\n');
    expect(md).toContain('# Issue Triage\n\nConfigured entirely in JSON\n');
    expect(md).not.toContain('You are an **issue triage specialist**');
  });

  it('rejects direct file generation for a multi-workflow archetype', () => {
    expect(() => generateWorkflowFile(
      answers({ archetype: 'linter-workflows' }),
      patterns
    )).toThrow('Linter Workflows generates multiple files; use the prompt format.');
  });

  it('falls back to copilot engine for malformed ids', () => {
    const md = generateWorkflowFile(answers({ engine: 'Invalid engine' }), patterns);
    expect(md).toContain('engine: copilot\n');
  });

  it('supports definition-based engines', () => {
    registerDefinitionEngines([{ id: 'pydantic-ai' }]);
    try {
      const md = generateWorkflowFile(answers({ engine: 'pydantic-ai' }), patterns);
      expect(md).toContain('engine: pydantic-ai\n');
    } finally {
      registerDefinitionEngines([]);
    }
  });

  it('accepts all supported built-in engines', () => {
    const geminiMd = generateWorkflowFile(answers({ engine: 'gemini' }), patterns);
    const piMd = generateWorkflowFile(answers({ engine: 'pi' }), patterns);
    expect(geminiMd).toContain('engine: gemini\n');
    expect(piMd).toContain('engine: pi\n');
  });

  it('deduplicates safe outputs', () => {
    const md = generateWorkflowFile(answers({ outputs: ['add-comment', 'add-labels'] }), patterns);
    const commentsCount = md.split('\n').filter((line) => line === '  add-comment:').length;
    expect(commentsCount).toBe(1);
  });

  it('routes file changes through pull requests instead of direct commits', () => {
    const md = generateWorkflowFile(answers({ outputs: ['create-pull-request', 'commits'] }), patterns);
    const pullRequestCount = md.split('\n').filter((line) => line === '  create-pull-request:').length;
    expect(pullRequestCount).toBe(1);
    expect(md).not.toContain('commit-files');
  });

  it.each([
    ['accessibility-expert', 'web accessibility expert'],
    ['performance-nut', 'performance optimization expert'],
    ['user-simulator', 'user persona simulator'],
    ['daily-test-improver', 'test improvement engineer'],
    ['repo-maintainer', 'proactive repository maintainer'],
    ['linter-miner', 'static-analysis rule miner'],
    ['linter-refiner', 'lint rule quality engineer'],
    ['linter-applier', 'lint remediation engineer'],
    ['skill-pr-reviewer', 'skills-based pull request reviewer']
  ])('generates the tailored %s workflow body', (archetype, role) => {
    const md = generateWorkflowFile(
      answers({
        archetype,
        triggers: ['schedule'],
        outputs: ['create-pull-request']
      }),
      patterns
    );
    expect(md).toContain(`You are a **${role}**`);
    expect(md).not.toContain('# Custom Workflow');
  });
});

describe('generateAgentPrompt', () => {
  it('describes triggers and outputs in plain language', () => {
    const prompt = generateAgentPrompt(answers(), patterns);
    expect(prompt).toContain('Create a draft PR that adds an agentic workflow using these instructions:');
    expect(prompt).toContain('- Name: issue-triage\n');
    expect(prompt).toContain('- Engine: copilot\n');
    expect(prompt).toContain('when a new issue is opened, on push to main');
    expect(prompt).toContain('add labels, add comments on issues/PRs');
    expect(prompt).toContain('Choose an appropriate kebab-case filename');
    expect(prompt).toContain('The workflow should be saved as a new Markdown file in .github/workflows/.');
    expect(prompt).not.toContain('.github/workflows/issue-triage.md');
    expect(prompt).toContain('Create a pull request with the generated agentic workflow files.');
  });

  it('asks the agent to analyze the repository first', () => {
    const prompt = generateAgentPrompt(answers(), patterns);
    expect(prompt).toContain('First, analyze this repository so the workflow is optimized for it:');
    expect(prompt).toContain('AGENTS.md');
    expect(prompt).toContain('build/test/lint commands');
    expect(prompt.indexOf('First, analyze this repository')).toBeLessThan(prompt.indexOf('Requirements:'));
  });

  it('mentions pre-steps and selected agent capabilities when requested', () => {
    const prompt = generateAgentPrompt(
      answers({ needsData: true, extras: ['memory', 'charts', 'browser'] }),
      patterns
    );
    expect(prompt).toContain('- Add a pre-step to fetch external data before the agent runs\n');
    expect(prompt).toContain('- Add cache-memory tool for persistent memory across runs\n');
    expect(prompt).toContain('- Add upload-assets safe output to publish generated charts\n');
    expect(prompt).toContain('- Enable Playwright CLI for browser automation\n');
  });

  it('directs LSP workflows to detect relevant languages and install matching tooling', () => {
    const prompt = generateAgentPrompt(answers({ extras: ['lsp'] }), patterns);

    expect(prompt).toContain(
      '- Detect the programming languages used in the repository and targeted by the workflow, then configure matching Language Server Protocol tools and add steps to install them\n'
    );
  });

  it('includes the selected engine requirement', () => {
    const prompt = generateAgentPrompt(answers({ engine: 'claude' }), patterns);
    expect(prompt).toContain('- Engine: claude\n');
  });

  it('surfaces the archetype DO NOT tip as an explicit boundary constraint', () => {
    const prompt = generateAgentPrompt(answers({ archetype: 'issue-triage' }), patterns);
    expect(prompt).toContain('Include explicit boundary constraints in the workflow prompt');
    expect(prompt).toContain('Do NOT close issues');
  });

  it('surfaces a DO NOT boundary constraint for the highest-risk code-improvement archetype', () => {
    // code-improvement has the lowest historical success rate (37%) and opens code-modifying
    // PRs autonomously, so it must never generate a prompt with zero scope-limiting guardrails.
    const prompt = generateAgentPrompt(answers({ archetype: 'code-improvement' }), patterns);
    expect(prompt).toContain('Include explicit boundary constraints in the workflow prompt');
    expect(prompt).toContain('DO NOT constraints to keep changes scoped');
  });

  it('surfaces a DO NOT boundary constraint for dependency-monitor and status-report', () => {
    const depPrompt = generateAgentPrompt(answers({ archetype: 'dependency-monitor' }), patterns);
    expect(depPrompt).toContain('Include explicit boundary constraints in the workflow prompt');

    const reportPrompt = generateAgentPrompt(answers({ archetype: 'status-report' }), patterns);
    expect(reportPrompt).toContain('Include explicit boundary constraints in the workflow prompt');
  });

  it('surfaces duplicate-prevention guidance for scheduled findings archetypes', () => {
    // dependency-monitor creates issues/PRs on a daily schedule; without skip-if-match/expires
    // guidance reaching the prompt, a downstream agent has no reason to prevent the same
    // finding from reopening as a new issue every single day.
    const depPrompt = generateAgentPrompt(answers({ archetype: 'dependency-monitor' }), patterns);
    expect(depPrompt).toContain('Prevent duplicate scheduled findings');
    expect(depPrompt).toContain('skip-if-match');

    // status-report also runs on a schedule and creates issues, so it needs the same
    // dedup guidance to avoid reopening the same status report as a new issue every run.
    const reportPrompt = generateAgentPrompt(answers({ archetype: 'status-report' }), patterns);
    expect(reportPrompt).toContain('Prevent duplicate scheduled findings');
    expect(reportPrompt).toContain('skip-if-match');
  });

  it('surfaces protected-files guidance for archetypes that open unattended PRs', () => {
    // code-improvement and documentation-updater both open pull requests autonomously,
    // and their pattern tips recommend protected-files: fallback-to-issue so edits to
    // manifests/CI configs/agent instructions get reviewed instead of merged unattended.
    // This guidance must reach the generated prompt, not just live in the pattern JSON.
    const codePrompt = generateAgentPrompt(answers({ archetype: 'code-improvement' }), patterns);
    expect(codePrompt).toContain('Guard sensitive files');
    expect(codePrompt).toContain('protected-files');

    const docsPrompt = generateAgentPrompt(answers({ archetype: 'documentation-updater' }), patterns);
    expect(docsPrompt).toContain('Guard sensitive files');
    expect(docsPrompt).toContain('protected-files');

    // status-report has no such tip and should not fabricate one.
    const reportPrompt = generateAgentPrompt(answers({ archetype: 'status-report' }), patterns);
    expect(reportPrompt).not.toContain('Guard sensitive files');
  });

  it('generates all grouped linter workflows in one prompt', () => {
    const prompt = generateAgentPrompt(answers({ archetype: 'linter-workflows' }), patterns);

    expect(prompt).toContain('Create a draft PR that adds 3 agentic workflows using these instructions:');
    expect(prompt).toContain('- Generate exactly 3 independent workflow files:');
    expect(prompt).toContain('Linter Miner: name it linter-miner');
    expect(prompt).toContain('Linter Refiner: name it linter-refiner');
    expect(prompt).toContain('Linter Applier: name it linter-applier');
    expect(prompt).toContain('All workflows should be saved as separate Markdown files');
    expect(prompt).toContain('## Suggested workflow files');
    expect(prompt).toContain('### Linter Miner');
    expect(prompt).toContain('### Linter Refiner');
    expect(prompt).toContain('### Linter Applier');
    expect(prompt.match(/name: linter-/g)).toHaveLength(3);
    expect(prompt.match(/linter-workflows\.md/g)).toHaveLength(1);
    expect(prompt).not.toContain('name: linter-workflows');
  });

  it.each([
    ['issue-triage', 'maintainer.md'],
    ['code-improvement', 'maintainer.md'],
    ['status-report', 'report.md'],
    ['dependency-monitor', 'maintainer.md'],
    ['documentation-updater', 'maintainer.md'],
    ['accessibility-expert', [
      'https://raw.githubusercontent.com/github/gh-aw/main/docs/src/content/docs/reference/playwright.md',
      'syntax-tools-imports.md',
      'create-agentic-workflow-trigger-details.md'
    ]],
    ['performance-nut', [
      'https://raw.githubusercontent.com/github/gh-aw/main/.github/copilot/instructions/cli-performance.md',
      'https://raw.githubusercontent.com/github/gh-aw/main/.github/copilot/instructions/build-performance.md',
      'maintainer.md',
      'memory-stateful-patterns.md'
    ]],
    ['user-simulator', 'github-agentic-workflows.md'],
    ['pr-review', 'pr-reviewer.md'],
    ['daily-test-improver', 'test-coverage.md'],
    ['repo-maintainer', 'maintainer.md'],
    ['linter-miner', 'linter-workflows.md'],
    ['linter-refiner', 'linter-workflows.md'],
    ['linter-applier', 'linter-workflows.md'],
    ['skill-pr-reviewer', ['pr-reviewer.md', 'skills.md']]
  ])('links the %s scenario instructions directly', (archetype, instructionFiles) => {
    const prompt = generateAgentPrompt(answers({ archetype }), patterns);
    const base = 'https://raw.githubusercontent.com/github/gh-aw/main/.github/aw/';
    expect(prompt).toContain(`${base  }create-agentic-workflow.md`);
    const expectedFiles = Array.isArray(instructionFiles) ? instructionFiles : [instructionFiles];
    expectedFiles.forEach((instructionFile) => {
      expect(prompt).toContain(instructionFile.indexOf('https://') === 0 ? instructionFile : base + instructionFile);
    });
    expect(prompt).not.toContain('github/gh-aw/main/create.md');
  });

  it('uses only the general instructions for scenarios without a topic guide', () => {
    const prompt = generateAgentPrompt(answers({ archetype: 'custom' }), patterns);
    expect(prompt.match(/https:\/\/raw\.githubusercontent\.com\/github\/gh-aw\//g)).toHaveLength(1);
    expect(prompt).toContain('/.github/aw/create-agentic-workflow.md');
  });

  it('inlines a minimal workflow markdown suggestion at the bottom', () => {
    const prompt = generateAgentPrompt(answers(), patterns);
    expect(prompt).toContain('## Suggested workflow file');
    expect(prompt.indexOf('## Suggested workflow file')).toBeGreaterThan(
      prompt.indexOf('The workflow should be saved as a new Markdown file in .github/workflows/.')
    );
    expect(prompt).toContain('the new `.github/workflows/*.md` file');
    expect(prompt).toContain('```markdown\n');
    expect(prompt).toContain('Let the agent generate the detailed issue triage prompt for this repository...\n');
    expect(prompt).not.toContain('## Instructions\n');
    expect(prompt).not.toContain('Your job is to read every newly opened issue');
  });

  it('preserves explicit data-fetch settings in single-workflow suggestions', () => {
    const prompt = generateAgentPrompt(
      answers({ archetype: 'status-report', needsData: false }),
      patterns
    );
    const sample = prompt.split('```markdown\n')[1].split('\n```')[0];

    expect(sample).not.toContain('## Pre-steps');
  });

  it.each([
    'issue-triage',
    'code-improvement',
    'status-report',
    'dependency-monitor',
    'content-moderation',
    'documentation-updater',
    'accessibility-expert',
    'performance-nut',
    'user-simulator',
    'pr-review',
    'daily-test-improver',
    'repo-maintainer',
    'linter-miner',
    'linter-refiner',
    'linter-applier',
    'skill-pr-reviewer',
    'custom'
  ])('limits the %s sample prompt body to one line plus ellipsis', (archetype) => {
    const prompt = generateAgentPrompt(answers({ archetype }), patterns);
    const sample = prompt.split('```markdown\n')[1].split('\n```')[0];
    const body = sample.split('\n---\n\n')[1];
    expect(body.split('\n')).toHaveLength(1);
    expect(body).toMatch(/\.\.\.$/);
  });
});

describe('fencedBlock', () => {
  it('uses a longer fence when the content contains code fences', () => {
    const block = fencedBlock('a\n```yaml\nb: 1\n```', 'markdown');
    expect(block.startsWith('````markdown\n')).toBe(true);
    expect(block.endsWith('\n````')).toBe(true);
  });

  it('widens the fence past longer nested runs', () => {
    const block = fencedBlock('a\n````yaml\nb: 1\n````', 'markdown');
    expect(block.startsWith('`````markdown\n')).toBe(true);
    expect(block.endsWith('\n`````')).toBe(true);
  });

  it('uses a three-backtick fence for plain content', () => {
    expect(fencedBlock('hello', 'markdown')).toBe('```markdown\nhello\n```');
  });

  it('trims trailing whitespace from the content', () => {
    expect(fencedBlock('hello\n\n', 'markdown')).toBe('```markdown\nhello\n```');
  });
});

import { describe, expect, it } from 'vitest';

import {
  buildTriggerYaml,
  fencedBlock,
  generateAgentPrompt,
  generateWorkflowFile,
  inferCapabilities,
  inferNeedsPreSteps,
  workflowName
} from '../src/js/workflow.js';

const patterns = {
  archetypes: [
    {
      id: 'issue-triage',
      label: 'Issue Triage',
      description: 'Classify and label incoming issues',
      timeout_minutes: 15
    },
    {
      id: 'status-report',
      label: 'Status Report',
      description: 'Summarize repository activity',
      timeout_minutes: 20
    }
  ],
  config_defaults: {
    timeout_by_trigger: { schedule: 45 }
  }
};

function answers(overrides) {
  return {
    archetype: 'issue-triage',
    customDescription: '',
    triggers: ['issues', 'workflow_dispatch'],
    outputs: ['labels', 'comments'],
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
      githubToolsets: true
    });
  });

  it('adds bash for code improvement', () => {
    expect(inferCapabilities('code-improvement').bash).toBe(true);
  });

  it('returns no capabilities for unknown archetypes', () => {
    expect(inferCapabilities('custom')).toEqual({
      preSteps: false,
      bash: false,
      githubToolsets: false
    });
  });
});

describe('buildTriggerYaml', () => {
  it('maps every supported trigger', () => {
    const yaml = buildTriggerYaml([
      'issues',
      'pull_request',
      'schedule',
      'workflow_dispatch',
      'slash_command',
      'label_command',
      'push'
    ], 'triage-agent');
    expect(yaml).toContain('  issues:\n    types: [opened]\n');
    expect(yaml).toContain('  pull_request:\n    types: [opened]\n');
    expect(yaml).toContain('  schedule:\n    - cron: "0 9 * * 1-5"\n');
    expect(yaml).toContain('  workflow_dispatch:\n');
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
});

describe('generateWorkflowFile', () => {
  it('generates frontmatter with tools, safe outputs and timeout', () => {
    const md = generateWorkflowFile(answers(), patterns);
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('name: issue-triage\n');
    expect(md).toContain('description: Classify and label incoming issues\n');
    expect(md).toContain('engine: copilot\n');
    expect(md).toContain('safe-outputs:\n  add-labels:\n  add-comment:\n');
    expect(md).not.toContain('tools:\n');
    expect(md).toContain('timeout-minutes: 15\n');
    expect(md).toContain('# Issue Triage');
  });

  it('raises the timeout when a trigger requires more time', () => {
    const md = generateWorkflowFile(
      answers({ triggers: ['schedule', 'workflow_dispatch'] }),
      patterns
    );
    expect(md).toContain('timeout-minutes: 45\n');
  });

  it('adds inferred capabilities and cache-memory extras', () => {
    const md = generateWorkflowFile(
      answers({
        archetype: 'status-report',
        triggers: ['workflow_dispatch'],
        outputs: ['new-issues'],
        extras: ['memory'],
        needsData: true
      }),
      patterns
    );
    expect(md).toContain('permissions:\n  actions: read\n  contents: read\n');
    expect(md).toContain('  github:\n');
    expect(md).toContain('  cache-memory:\n');
    expect(md).toContain('## Pre-steps');
  });

  it('appends the project context section when provided', () => {
    const md = generateWorkflowFile(answers({ dataDescription: 'Monorepo layout' }), patterns);
    expect(md).toContain('## Project Context\n\nMonorepo layout\n');
  });

  it('falls back to a custom body and default timeout without patterns', () => {
    const md = generateWorkflowFile(
      answers({ archetype: 'custom', customDescription: 'Do a thing' }),
      null
    );
    expect(md).toContain('# Custom Workflow');
    expect(md).toContain('Your job is: Do a thing');
    expect(md).toContain('timeout-minutes: 30\n');
  });

  it('falls back to copilot engine for unknown values', () => {
    const md = generateWorkflowFile(answers({ engine: 'invalid' }), patterns);
    expect(md).toContain('engine: copilot\n');
  });

  it('accepts all supported built-in engines', () => {
    const geminiMd = generateWorkflowFile(answers({ engine: 'gemini' }), patterns);
    const piMd = generateWorkflowFile(answers({ engine: 'pi' }), patterns);
    expect(geminiMd).toContain('engine: gemini\n');
    expect(piMd).toContain('engine: pi\n');
  });

  it('deduplicates safe outputs', () => {
    const md = generateWorkflowFile(answers({ outputs: ['comments', 'labels'] }), patterns);
    const commentsCount = md.split('\n').filter((line) => line === '  add-comment:').length;
    expect(commentsCount).toBe(1);
  });

  it('routes file changes through pull requests instead of direct commits', () => {
    const md = generateWorkflowFile(answers({ outputs: ['pull-requests', 'commits'] }), patterns);
    const pullRequestCount = md.split('\n').filter((line) => line === '  create-pull-request:').length;
    expect(pullRequestCount).toBe(1);
    expect(md).not.toContain('commit-files');
  });
});

describe('generateAgentPrompt', () => {
  it('describes triggers and outputs in plain language', () => {
    const prompt = generateAgentPrompt(answers(), patterns);
    expect(prompt).toContain('- Name: issue-triage\n');
    expect(prompt).toContain('- Engine: copilot\n');
    expect(prompt).toContain('when a new issue is opened, on manual dispatch');
    expect(prompt).toContain('add/remove labels, post comments on issues/PRs');
    expect(prompt).toContain('.github/workflows/issue-triage.md');
    expect(prompt).toContain('Create a pull request with the generated agentic workflow files.');
  });

  it('asks the agent to analyze the repository first', () => {
    const prompt = generateAgentPrompt(answers(), patterns);
    expect(prompt).toContain('First, analyze this repository so the workflow is optimized for it:');
    expect(prompt).toContain('AGENTS.md');
    expect(prompt).toContain('build/test/lint commands');
    expect(prompt.indexOf('First, analyze this repository')).toBeLessThan(prompt.indexOf('Requirements:'));
  });

  it('mentions pre-steps, memory and project context when requested', () => {
    const prompt = generateAgentPrompt(
      answers({ needsData: true, extras: ['memory'], dataDescription: 'Uses pnpm' }),
      patterns
    );
    expect(prompt).toContain('- Add a pre-step to fetch external data before the agent runs\n');
    expect(prompt).toContain('- Add cache-memory tool for persistent memory across runs\n');
    expect(prompt).toContain('- Additional project context: Uses pnpm\n');
  });

  it('includes the selected engine requirement', () => {
    const prompt = generateAgentPrompt(answers({ engine: 'claude' }), patterns);
    expect(prompt).toContain('- Engine: claude\n');
  });

  it.each([
    ['issue-triage', 'maintainer.md'],
    ['code-improvement', 'maintainer.md'],
    ['status-report', 'report.md'],
    ['dependency-monitor', 'maintainer.md'],
    ['documentation-updater', 'maintainer.md'],
    ['pr-review', 'pr-reviewer.md']
  ])('links the %s scenario instructions directly', (archetype, instructionFile) => {
    const prompt = generateAgentPrompt(answers({ archetype }), patterns);
    const base = 'https://raw.githubusercontent.com/github/gh-aw/main/.github/aw/';
    expect(prompt).toContain(base + 'create-agentic-workflow.md');
    expect(prompt).toContain(base + instructionFile);
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
      prompt.indexOf('.github/workflows/issue-triage.md')
    );
    expect(prompt).toContain('```markdown\n');
    expect(prompt).toContain('Let the agent generate the detailed issue triage prompt for this repository...\n');
    expect(prompt).not.toContain('## Instructions\n');
    expect(prompt).not.toContain('Your job is to read every newly opened issue');
  });

  it.each([
    'issue-triage',
    'code-improvement',
    'status-report',
    'dependency-monitor',
    'content-moderation',
    'documentation-updater',
    'pr-review',
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

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
    expect(inferNeedsPreSteps('upstream-monitor')).toBe(true);
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
});

describe('generateWorkflowFile', () => {
  it('generates frontmatter with tools, safe outputs and timeout', () => {
    const md = generateWorkflowFile(answers(), patterns);
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('name: issue-triage\n');
    expect(md).toContain('description: Classify and label incoming issues\n');
    expect(md).toContain('  - add-label\n');
    expect(md).toContain('  - add-comment\n');
    expect(md).toContain('safe-outputs:\n');
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

  it('deduplicates safe outputs', () => {
    const md = generateWorkflowFile(answers({ outputs: ['comments', 'labels'] }), patterns);
    const issuesCount = md.split('\n').filter((line) => line === '  - issues').length;
    expect(issuesCount).toBe(1);
  });
});

describe('generateAgentPrompt', () => {
  it('describes triggers and outputs in plain language', () => {
    const prompt = generateAgentPrompt(answers(), patterns);
    expect(prompt).toContain('- Name: issue-triage\n');
    expect(prompt).toContain('when a new issue is opened, on manual dispatch');
    expect(prompt).toContain('add/remove labels, post comments on issues/PRs');
    expect(prompt).toContain('.github/workflows/issue-triage.md');
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

  it('inlines the generated workflow markdown as a suggestion at the bottom', () => {
    const a = answers();
    const prompt = generateAgentPrompt(a, patterns);
    const md = generateWorkflowFile(a, patterns);
    expect(prompt).toContain('## Suggested workflow file');
    expect(prompt.indexOf('## Suggested workflow file')).toBeGreaterThan(
      prompt.indexOf('.github/workflows/issue-triage.md')
    );
    expect(prompt).toContain('```markdown\n');
    expect(prompt).toContain(md.trimEnd());
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

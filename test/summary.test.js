import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildWorkflowSummary } from '../src/js/summary.js';

const patterns = {
  archetypes: [
    {
      id: 'issue-triage',
      description: 'Classify and label new issues'
    }
  ]
};
const wizardConfig = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src/wizard.json', import.meta.url)), 'utf8')
);

function answers(overrides = {}) {
  return {
    archetype: 'custom',
    customDescription: '',
    triggers: [],
    outputs: [],
    engine: null,
    extras: [],
    dataDescription: '',
    ...overrides
  };
}

describe('buildWorkflowSummary', () => {
  it('starts with prompts for choices that have not been made', () => {
    const summary = buildWorkflowSummary(answers(), patterns, wizardConfig);

    expect(summary.trigger).toEqual({ value: 'choose when it runs', complete: false });
    expect(summary.purpose).toEqual({ value: 'choose what the agent should do', complete: false });
    expect(summary.output).toEqual({ value: 'choose what it can write', complete: false });
    expect(summary.engine).toEqual({ value: 'choose an agent', complete: false });
    expect(summary.intent).toEqual({ value: 'tell us your intent', complete: false });
  });

  it('summarizes a provided intent', () => {
    const summary = buildWorkflowSummary(answers({ intent: 'Keep release notes accurate' }), patterns, wizardConfig);

    expect(summary.intent).toEqual({ value: 'Keep release notes accurate', complete: true });
    expect(summary.purpose).toEqual({ value: 'Keep release notes accurate', complete: true });
  });

  it('ellipsizes long intent previews to 42 characters', () => {
    const summary = buildWorkflowSummary(answers({
      intent: 'Keep release notes accurate so responders can triage incidents faster'
    }), patterns, wizardConfig);

    expect(summary.intent).toEqual({
      value: 'Keep release notes accurate so responders…',
      complete: true
    });
  });

  it('turns selected answers into a readable recipe', () => {
    const summary = buildWorkflowSummary(answers({
      archetype: 'issue-triage',
      triggers: ['issues', 'schedule'],
      outputs: ['add-labels', 'add-comment'],
      engine: 'claude'
    }), patterns, wizardConfig);

    expect(summary.trigger.value).toBe('a new issue is opened or the schedule runs');
    expect(summary.purpose).toEqual({ value: 'Classify and label new issues', complete: true });
    expect(summary.output.value).toBe('add label and add comment');
    expect(summary.engine.value).toBe('Claude');
  });

  it('summarizes optional extras separately from the selected engine', () => {
    const summary = buildWorkflowSummary(answers({
      engine: 'copilot',
      extras: ['memory', 'charts', 'browser', 'agentic-workflows', 'lsp']
    }), patterns, wizardConfig);

    expect(summary.extras.value).toBe(
      'memory between runs, chart generation, browser access, agentic workflow analysis, and language service access'
    );
    expect(summary.extras.complete).toBe(true);
    expect(summary.engine.value).toBe('Copilot');
  });

  it('shows a placeholder for extras when none are selected', () => {
    const summary = buildWorkflowSummary(answers({ engine: 'copilot', extras: [] }), patterns, wizardConfig);

    expect(summary.extras).toEqual({ value: 'choose optional capabilities', complete: false });
  });

  it('describes the pull request review trigger accurately', () => {
    const summary = buildWorkflowSummary(answers({
      archetype: 'pr-review',
      triggers: ['pull_request']
    }), patterns, wizardConfig);

    expect(summary.trigger.value).toBe('a pull request is ready for review');
  });

  it('describes the explicit ready-for-review trigger accurately', () => {
    const summary = buildWorkflowSummary(answers({
      triggers: ['pull_request_ready_for_review']
    }), patterns, wizardConfig);

    expect(summary.trigger.value).toBe('a pull request is ready for review');
  });

  it('joins three trigger conditions with OR', () => {
    const summary = buildWorkflowSummary(answers({
      triggers: ['issues', 'schedule', 'push']
    }), patterns, wizardConfig);

    expect(summary.trigger.value).toBe(
      'a new issue is opened, the schedule runs, or code is pushed to main'
    );
  });

  it('uses custom descriptions as they are entered', () => {
    const summary = buildWorkflowSummary(answers({
      customDescription: 'Check release notes for breaking changes'
    }), patterns, wizardConfig);

    expect(summary.purpose).toEqual({
      value: 'Check release notes for breaking changes',
      complete: true
    });
  });

  it('summarizes all safe outputs in the wizard order', () => {
    const summary = buildWorkflowSummary(answers({
      outputs: [
        'create-issue',
        'add-comment',
        'add-labels',
        'create-pull-request',
        'push-to-pull-request-branch',
        'merge-pull-request',
        'create-pull-request-review-comment'
      ]
    }), patterns, wizardConfig);

    expect(summary.output.value).toBe(
      'create issue, add comment, add label, create pull request, push to pull request branch, merge pull request, and create pull request review comment'
    );
  });
});

import { describe, expect, it } from 'vitest';

import { buildWorkflowSummary } from '../src/js/summary.js';

const patterns = {
  archetypes: [
    {
      id: 'issue-triage',
      description: 'Classify and label new issues'
    }
  ]
};

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
    const summary = buildWorkflowSummary(answers(), patterns);

    expect(summary.trigger).toEqual({ value: 'choose when it runs', complete: false });
    expect(summary.purpose).toEqual({ value: 'choose what the agent should do', complete: false });
    expect(summary.output).toEqual({ value: 'choose what it can write', complete: false });
    expect(summary.engine).toEqual({ value: 'choose an agent', complete: false });
  });

  it('turns selected answers into a readable recipe', () => {
    const summary = buildWorkflowSummary(answers({
      archetype: 'issue-triage',
      triggers: ['issues', 'workflow_dispatch'],
      outputs: ['add-labels', 'add-comment'],
      engine: 'claude'
    }), patterns);

    expect(summary.trigger.value).toBe('a new issue is opened or it is started manually');
    expect(summary.purpose).toEqual({ value: 'Classify and label new issues', complete: true });
    expect(summary.output.value).toBe('add label and add comment');
    expect(summary.engine.value).toBe('Claude');
  });

  it('summarizes optional agent capabilities with the selected engine', () => {
    const summary = buildWorkflowSummary(answers({
      engine: 'copilot',
      extras: ['memory', 'charts', 'browser']
    }), patterns);

    expect(summary.engine.value).toBe(
      'Copilot with memory between runs, chart generation, and browser access'
    );
  });

  it('describes the pull request review trigger accurately', () => {
    const summary = buildWorkflowSummary(answers({
      archetype: 'pr-review',
      triggers: ['pull_request']
    }), patterns);

    expect(summary.trigger.value).toBe('a pull request is ready for review');
  });

  it('joins three trigger conditions with OR', () => {
    const summary = buildWorkflowSummary(answers({
      triggers: ['issues', 'schedule', 'workflow_dispatch']
    }), patterns);

    expect(summary.trigger.value).toBe(
      'a new issue is opened, the schedule runs, or it is started manually'
    );
  });

  it('uses custom descriptions as they are entered', () => {
    const summary = buildWorkflowSummary(answers({
      customDescription: 'Check release notes for breaking changes'
    }), patterns);

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
        'create-pull-request-review-comment'
      ]
    }), patterns);

    expect(summary.output.value).toBe(
      'create issue, add comment, add label, create pull request, and add review comment'
    );
  });
});

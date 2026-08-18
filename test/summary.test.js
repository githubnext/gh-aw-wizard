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
    engine: 'copilot',
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
    expect(summary.engine).toEqual({ value: 'Copilot', complete: true });
  });

  it('turns selected answers into a readable recipe', () => {
    const summary = buildWorkflowSummary(answers({
      archetype: 'issue-triage',
      triggers: ['issues', 'workflow_dispatch'],
      outputs: ['labels', 'comments'],
      engine: 'claude'
    }), patterns);

    expect(summary.trigger.value).toBe('a new issue is opened and it is started manually');
    expect(summary.purpose).toEqual({ value: 'Classify and label new issues', complete: true });
    expect(summary.output.value).toBe('manage labels and post comments');
    expect(summary.engine.value).toBe('Claude');
  });

  it('summarizes optional memory and project context', () => {
    const summary = buildWorkflowSummary(answers({
      extras: ['memory'],
      dataDescription: 'The API lives in src/api.'
    }), patterns);

    expect(summary.context).toBe('memory between runs and project-specific context');
  });

  it('describes the pull request review trigger accurately', () => {
    const summary = buildWorkflowSummary(answers({
      archetype: 'pr-review',
      triggers: ['pull_request']
    }), patterns);

    expect(summary.trigger.value).toBe('a pull request is ready for review');
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
});

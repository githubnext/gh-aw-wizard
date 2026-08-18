import { describe, expect, it } from 'vitest';

import { getArchetype, getRecommendedConfiguration } from '../src/js/patterns.js';
import { nextStepsHtml } from '../src/js/next-steps.js';

describe('getArchetype', () => {
  const patterns = { archetypes: [{ id: 'pr-review', label: 'PR Review' }] };

  it('finds an archetype by id', () => {
    expect(getArchetype(patterns, 'pr-review').label).toBe('PR Review');
  });

  it('returns null for unknown ids or missing patterns', () => {
    expect(getArchetype(patterns, 'nope')).toBeNull();
    expect(getArchetype(null, 'pr-review')).toBeNull();
    expect(getArchetype({}, 'pr-review')).toBeNull();
  });
});

describe('getRecommendedConfiguration', () => {
  it('selects the highest-confidence trigger and safe-output profile', () => {
    const patterns = {
      archetypes: [{
        id: 'status-report',
        recommended_triggers: [{ type: 'schedule' }],
        recommended_tools: ['create-issue']
      }],
      configuration_profiles: [
        {
          archetype: 'status-report',
          triggers: ['slash_command'],
          safe_outputs: ['create-issue'],
          confidence_score: 0.95,
          total_runs: 400
        },
        {
          archetype: 'status-report',
          triggers: ['discussion', 'schedule'],
          safe_outputs: ['create-discussion'],
          confidence_score: 0.9,
          total_runs: 300
        },
        {
          archetype: 'status-report',
          triggers: ['schedule'],
          safe_outputs: ['create-issue'],
          confidence_score: 0.65,
          total_runs: 200
        },
        {
          archetype: 'status-report',
          triggers: ['schedule', 'workflow_dispatch'],
          safe_outputs: ['create-issue', 'add-comment'],
          confidence_score: 0.72,
          total_runs: 80
        }
      ]
    };

    expect(getRecommendedConfiguration(patterns, 'status-report')).toEqual({
      triggers: ['slash_command'],
      outputs: ['new-issues'],
      profile: patterns.configuration_profiles[0]
    });
  });

  it('keeps a slash-command profile regardless of performance', () => {
    const patterns = {
      archetypes: [{ id: 'issue-triage' }],
      configuration_profiles: [{
        archetype: 'issue-triage',
        triggers: ['slash_command'],
        safe_outputs: ['add-comment'],
        confidence_score: 0,
        total_runs: 38
      }]
    };

    expect(getRecommendedConfiguration(patterns, 'issue-triage')).toEqual({
      triggers: ['slash_command'],
      outputs: ['comments'],
      profile: patterns.configuration_profiles[0]
    });
  });

  it('falls back to exact recommended tools when no profile is available', () => {
    const patterns = {
      archetypes: [{
        id: 'issue-triage',
        recommended_triggers: [{ type: 'issues' }, { type: 'workflow_dispatch' }],
        recommended_tools: ['add-labels', 'add-comment']
      }]
    };

    expect(getRecommendedConfiguration(patterns, 'issue-triage')).toEqual({
      triggers: ['issues', 'workflow_dispatch'],
      outputs: ['labels', 'comments'],
      profile: null
    });
  });

  it('returns an empty recommendation for an unknown archetype', () => {
    expect(getRecommendedConfiguration({ archetypes: [] }, 'unknown')).toEqual({
      triggers: [],
      outputs: [],
      profile: null
    });
  });
});

describe('nextStepsHtml', () => {
  it('renders workflow download instructions', () => {
    const html = nextStepsHtml('workflow', 'issue-triage', 'claude');
    expect(html).toContain('.github/workflows/issue-triage.md');
    expect(html).toContain('gh aw compile');
    expect(html).toContain('gh aw run issue-triage');
    expect(html).toContain('Set up the <strong>Claude</strong> engine');
    expect(html).toContain('reference/engines/#claude');
  });

  it('renders coding agent instructions for the prompt format', () => {
    const html = nextStepsHtml('prompt', 'issue-triage', 'codex');
    expect(html).toContain('Open <strong>Codex</strong> in your repository');
    expect(html).toContain('Run this prompt');
    expect(html).not.toContain('Download the <code>.md</code> file');
    expect(html).not.toContain('gh aw compile');
  });

  it('escapes the workflow name', () => {
    expect(nextStepsHtml('workflow', '<img>', 'copilot')).toContain('&lt;img&gt;');
  });

  it('defaults to copilot when engine is invalid', () => {
    const html = nextStepsHtml('workflow', 'issue-triage', 'invalid');
    expect(html).toContain('Set up the <strong>Copilot</strong> engine');
    expect(html).toContain('reference/engines/#copilot');
  });

  it('renders setup links for additional supported engines', () => {
    const geminiHtml = nextStepsHtml('workflow', 'issue-triage', 'gemini');
    const piHtml = nextStepsHtml('workflow', 'issue-triage', 'pi');
    expect(geminiHtml).toContain('Set up the <strong>Gemini</strong> engine');
    expect(geminiHtml).toContain('reference/engines/#gemini');
    expect(piHtml).toContain('Set up the <strong>Pi</strong> engine');
    expect(piHtml).toContain('reference/engines/#pi');
  });
});

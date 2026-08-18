import { describe, expect, it } from 'vitest';

import { getArchetype } from '../src/js/patterns.js';
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

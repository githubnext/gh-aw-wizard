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
    const html = nextStepsHtml('workflow', 'issue-triage');
    expect(html).toContain('.github/workflows/issue-triage.md');
    expect(html).toContain('gh aw compile');
    expect(html).toContain('gh aw run issue-triage');
  });

  it('renders coding agent instructions for the prompt format', () => {
    const html = nextStepsHtml('prompt', 'issue-triage');
    expect(html).toContain('Copy the prompt above');
    expect(html).not.toContain('Download the <code>.md</code> file');
  });

  it('escapes the workflow name', () => {
    expect(nextStepsHtml('workflow', '<img>')).toContain('&lt;img&gt;');
  });
});

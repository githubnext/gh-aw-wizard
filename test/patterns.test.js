import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

import {
  getArchetype,
  getRecommendedConfiguration,
  getWorkflowDefinition,
  getWorkflowGeneration,
  loadPatterns
} from '../src/js/patterns.js';
import { loadPatternsFromDir } from '../src/js/patterns-node.js';
import { nextStepsHtml } from '../src/js/next-steps.js';

const generatedPatterns = await loadPatternsFromDir(fileURLToPath(new URL('../patterns', import.meta.url)));
const wizardConfig = JSON.parse(
  await import('node:fs/promises').then(({ readFile }) => {
    return readFile(fileURLToPath(new URL('../src/wizard.json', import.meta.url)), 'utf8');
  })
);

describe('getArchetype', () => {
  const patterns = { archetypes: [{ id: 'pr-review', label: 'PR Review' }] };

  it('finds an archetype by id', () => {
    expect(getArchetype(patterns, 'pr-review').label).toBe('PR Review');
  });

  describe('workflow generation model', () => {
    it('loads the runtime generation data referenced by the manifest', () => {
      expect(getWorkflowGeneration(generatedPatterns)).not.toBeNull();
      expect(getWorkflowDefinition(generatedPatterns, 'status-report')).toMatchObject({
        icon: 'graph',
        capabilities: {
          pre_steps: true,
          github_toolsets: true
        }
      });
    });

    it('defines generation metadata for every archetype', () => {
      generatedPatterns.archetypes.forEach((archetype) => {
        expect(
          getWorkflowDefinition(generatedPatterns, archetype.id),
          `missing workflow generation definition for ${archetype.id}`
        ).not.toBeNull();
      });
    });

    it('loads archetypes and workflow generation data from the manifest at runtime', async () => {
      const originalFetch = globalThis.fetch;
      const requestedUrls = [];
      globalThis.fetch = async (url) => {
        requestedUrls.push(url);
        const responses = {
          '/patterns/manifest.json': {
            archetypes: ['example'],
            workflow_generation: 'workflow-generation.json'
          },
          '/patterns/archetypes/example.json': {
            id: 'example',
            label: 'Example'
          },
          '/patterns/workflow-generation.json': {
            archetypes: {
              example: {
                capabilities: { bash: true }
              }
            }
          }
        };
        return {
          json: async () => responses[url]
        };
      };

      try {
        const loaded = await loadPatterns('/patterns/manifest.json');
        expect(requestedUrls).toEqual([
          '/patterns/manifest.json',
          '/patterns/archetypes/example.json',
          '/patterns/workflow-generation.json'
        ]);
        expect(getWorkflowDefinition(loaded, 'example').capabilities.bash).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('curated archetypes', () => {
    it.each([
      'daily-test-improver',
      'pr-iteration-loop',
      'accessibility-expert',
      'performance-nut',
      'user-simulator',
      'repo-maintainer',
      'linter-workflows',
      'linter-miner',
      'linter-refiner',
      'linter-applier',
      'skill-pr-reviewer',
      'security-scanner',
      'ci-failure-triage',
      'agent-cost-tracker'
    ])('includes %s with triggers and safe outputs', (id) => {
      const archetype = getArchetype(generatedPatterns, id);
      expect(archetype).not.toBeNull();
      expect(archetype.recommended_triggers.length).toBeGreaterThan(0);
      expect(archetype.recommended_tools.length).toBeGreaterThan(0);
    });
  });

  it('returns null for unknown ids or missing patterns', () => {
    expect(getArchetype(patterns, 'nope')).toBeNull();
    expect(getArchetype(null, 'pr-review')).toBeNull();
    expect(getArchetype({}, 'pr-review')).toBeNull();
  });
});

describe('getRecommendedConfiguration', () => {
  it('selects the most relevant trigger from the highest-confidence safe-output profile', () => {
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
          confidence_score: 0.1,
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
          triggers: ['push', 'schedule'],
          safe_outputs: ['create-issue', 'add-comment'],
          confidence_score: 0.72,
          total_runs: 80
        }
      ]
    };

    expect(getRecommendedConfiguration(patterns, 'status-report', wizardConfig)).toEqual({
      triggers: ['schedule'],
      outputs: ['create-issue', 'add-comment'],
      profile: patterns.configuration_profiles[3]
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

    expect(getRecommendedConfiguration(patterns, 'issue-triage', wizardConfig)).toEqual({
      triggers: ['slash_command'],
      outputs: ['add-comment'],
      profile: patterns.configuration_profiles[0]
    });
  });

  it('falls back to the single most relevant trigger and exact recommended tools', () => {
    const patterns = {
      archetypes: [{
        id: 'issue-triage',
        recommended_triggers: [{ type: 'issues' }, { type: 'schedule' }],
        recommended_tools: ['add-labels', 'add-comment']
      }]
    };

    expect(getRecommendedConfiguration(patterns, 'issue-triage', wizardConfig)).toEqual({
      triggers: ['issues'],
      outputs: ['add-labels', 'add-comment'],
      profile: null
    });
  });

  it('returns an empty recommendation for an unknown archetype', () => {
    expect(getRecommendedConfiguration({ archetypes: [] }, 'unknown', wizardConfig)).toEqual({
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
    expect(html).not.toContain('reference/engines/#claude');
  });

  it('renders coding agent instructions for the prompt format', () => {
    const html = nextStepsHtml('prompt', 'issue-triage', 'codex');
    expect(html).toContain('Run the prompt in your agent');
    expect(html).toContain('Open <strong>Codex</strong> in your repository and run the copied prompt');
    expect(html).not.toContain('reference/engines/');
    expect(html).not.toContain('Download the <code>.md</code> file');
    expect(html).not.toContain('gh aw compile');
  });

  it('escapes the workflow name', () => {
    expect(nextStepsHtml('workflow', '<img>', 'copilot')).toContain('&lt;img&gt;');
  });

  it('defaults to copilot when engine is invalid', () => {
    const html = nextStepsHtml('workflow', 'issue-triage', 'invalid');
    expect(html).toContain('Set up the <strong>Copilot</strong> engine');
  });

  it('labels additional supported engines without per-engine links', () => {
    const geminiHtml = nextStepsHtml('workflow', 'issue-triage', 'gemini');
    const piHtml = nextStepsHtml('workflow', 'issue-triage', 'pi');
    expect(geminiHtml).toContain('Set up the <strong>Gemini</strong> engine');
    expect(piHtml).toContain('Set up the <strong>Pi</strong> engine');
    expect(geminiHtml).not.toContain('reference/engines/');
    expect(piHtml).not.toContain('reference/engines/');
  });
});

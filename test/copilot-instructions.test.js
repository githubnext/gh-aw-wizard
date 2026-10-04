import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const instructions = await readFile(new URL('../.github/copilot-instructions.md', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../patterns/manifest.json', import.meta.url), 'utf8'));
const archetype = async (id) => JSON.parse(await readFile(new URL(`../patterns/archetypes/${id}.json`, import.meta.url), 'utf8'));

describe('copilot instructions pattern guidance', () => {
  it('describes the committed pattern-library corpus, not stale scan data', () => {
    const generatedDate = manifest.metadata.generated_at.slice(0, 10);

    expect(instructions).toContain(`generated on ${generatedDate}`);
    expect(instructions).toContain(`${manifest.metadata.source_repos} source repos`);
    expect(instructions).toContain(`${manifest.metadata.active_workflows} active workflows`);
    expect(instructions).toContain(`${manifest.metadata.total_workflows} total workflows scanned`);
    expect(instructions).toContain(`${manifest.archetypes.length} user-facing archetypes`);
    expect(instructions).not.toContain('679 workflows across 269 repos');
    expect(instructions).not.toContain('one of the 7 archetypes');
  });

  it('lists every manifest archetype by empirical or curated status', async () => {
    const empirical = [];
    const curated = [];
    for (const id of manifest.archetypes) {
      const data = await archetype(id);
      if (data.count > 0) empirical.push(id);
      else curated.push(id);
    }

    const empiricalGuidance = instructions.split('**Archetypes with empirical data:**')[1]?.split('**Supporting empirical profile:**')[0];
    const curatedGuidance = instructions.split('**Curated archetypes without empirical runs yet (`count: 0`):**')[1]?.split('**Trigger combo risk:**')[0];

    expect(empirical.length + curated.length).toBe(manifest.archetypes.length);
    for (const id of empirical) {
      const data = await archetype(id);
      expect(empiricalGuidance).toContain(`\`${id}\`: ${Math.round(data.success_rate * 100)}% success (n=${data.count})`);
      expect(curatedGuidance).not.toContain(id);
    }
    for (const id of curated) {
      expect(curatedGuidance).toContain(id);
      expect(empiricalGuidance).not.toContain(`\`${id}\``);
    }
    expect(instructions).toContain('`custom` is hidden from the wizard archetype cards');
  });

  it('preserves the high-risk findings from the manifest', () => {
    expect(instructions).toContain(manifest.research_findings.do_not_constraints);
    expect(instructions).toContain(manifest.research_findings.workflow_run_risky);
    expect(instructions).toContain('20 named anti-patterns');
    expect(instructions).toContain('model: null');
  });
});

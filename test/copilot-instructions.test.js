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

    expect(empirical).toHaveLength(9);
    expect(curated).toHaveLength(19);
    for (const id of empirical) expect(instructions).toContain(`\`${id}\``);
    for (const id of curated) expect(instructions).toContain(id);
    expect(instructions).toContain('`custom` is hidden from the wizard archetype cards');
  });

  it('preserves the high-risk findings from the manifest', () => {
    expect(instructions).toContain(manifest.research_findings.do_not_constraints);
    expect(instructions).toContain(manifest.research_findings.workflow_run_risky);
    expect(instructions).toContain('20 named anti-patterns');
    expect(instructions).toContain('model: null');
  });
});

// Node-only helper to load the split pattern library (patterns/manifest.json
// + patterns/archetypes/<id>.json) from disk into the merged shape the rest
// of the app expects. Used by the CLI, Vite dev/build, and tests.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { mergePatterns } from './patterns.js';

export async function loadPatternsFromDir(patternsDir) {
  const manifest = JSON.parse(await readFile(join(patternsDir, 'manifest.json'), 'utf8'));
  const ids = Array.isArray(manifest.archetypes) ? manifest.archetypes : [];
  const archetypes = await Promise.all(ids.map(async (id) => {
    const contents = await readFile(join(patternsDir, 'archetypes', `${id}.json`), 'utf8');
    return JSON.parse(contents);
  }));
  const workflowGeneration = manifest.workflow_generation
    ? JSON.parse(await readFile(join(patternsDir, manifest.workflow_generation), 'utf8'))
    : null;
  return mergePatterns(manifest, archetypes, workflowGeneration);
}

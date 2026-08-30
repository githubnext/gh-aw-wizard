import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const goldenIntents = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/web-llm-golden-intents.json', import.meta.url)),
  'utf8'
));
const manifest = JSON.parse(readFileSync(
  fileURLToPath(new URL('../patterns/manifest.json', import.meta.url)),
  'utf8'
));

describe('WebLLM golden intent corpus', () => {
  it('defines exactly 100 unique intents with valid golden archetypes', () => {
    expect(goldenIntents).toHaveLength(100);
    expect(new Set(goldenIntents.map(({ id }) => id)).size).toBe(100);
    expect(new Set(goldenIntents.map(({ intent }) => intent)).size).toBe(100);
    goldenIntents.forEach(({ id, intent, archetype }) => {
      expect(id).toMatch(/^intent-\d{3}$/);
      expect(intent.trim().length).toBeGreaterThan(20);
      expect(manifest.archetypes).toContain(archetype);
    });
  });

  it('covers every archetype available to the model', () => {
    const covered = new Set(goldenIntents.map(({ archetype }) => archetype));
    expect([...manifest.archetypes].filter((id) => !covered.has(id))).toEqual([]);
  });
});

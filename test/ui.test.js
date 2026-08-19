import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { maxReachableStep } from '../src/js/ui.js';

const ui = readFileSync(fileURLToPath(new URL('../src/js/ui.js', import.meta.url)), 'utf8');

describe('wizard navigation', () => {
  it('keeps only the What tab required', () => {
    expect(maxReachableStep(false)).toBe(1);
    expect(maxReachableStep(true)).toBe(6);
  });

  it('resets the navigation pane to the opened What pane when the landing CTA reveals the wizard', () => {
    expect(ui).toContain('initLanding(revealWhatPane)');
    expect(ui).toMatch(/function revealWhatPane\(\) \{\s+resetNavigationPane\(\);\s+focusFirstArchetype\(\);/);
    expect(ui).toMatch(/export function resetNavigationPane\(\)/);
    expect(ui).toMatch(/currentStep = 1/);
    expect(ui).toMatch(/step\.classList\.toggle\('active', step\.id === 'step-1'\)/);
  });
});

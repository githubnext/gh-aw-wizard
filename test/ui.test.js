import { describe, expect, it } from 'vitest';

import { maxReachableStep } from '../src/js/ui.js';

describe('wizard navigation', () => {
  it('keeps only the What tab required', () => {
    expect(maxReachableStep(false)).toBe(1);
    expect(maxReachableStep(true)).toBe(6);
  });
});

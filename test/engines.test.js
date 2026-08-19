import { describe, expect, it, vi } from 'vitest';

import {
  ENGINES_URL,
  engineIconMarkup,
  formatEngineLabel,
  formatEngineOptionLabel,
  loadDefinitionEngines,
  parseDefinitionEngines
} from '../src/js/engines.js';

describe('definition-based engines', () => {
  it('loads engines.json from gh-aw', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        engines: [{ id: 'pydantic-ai', import: 'github/gh-aw/.github/workflows/shared/pydantic.md' }]
      })
    });

    await expect(loadDefinitionEngines(fetchImpl)).resolves.toEqual([
      { id: 'pydantic-ai', import: 'github/gh-aw/.github/workflows/shared/pydantic.md' }
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(ENGINES_URL);
  });

  it('ignores malformed and duplicate definitions', () => {
    expect(parseDefinitionEngines({
      engines: [
        { id: 'aider', import: 'github/gh-aw/.github/workflows/shared/aider.md' },
        { id: 'aider', import: 'duplicate' },
        { id: 'Invalid engine', import: 'invalid' },
        { id: 'missing-import' }
      ]
    })).toEqual([
      { id: 'aider', import: 'github/gh-aw/.github/workflows/shared/aider.md' }
    ]);
  });

  it('falls back to no additional engines when downloading fails', async () => {
    await expect(loadDefinitionEngines(() => Promise.reject(new Error('offline')))).resolves.toEqual([]);
  });

  it('formats engine ids for display', () => {
    expect(formatEngineLabel('pydantic-ai')).toBe('Pydantic AI');
  });

  it('labels built-in engines with company names and extension engines as extensions', () => {
    expect(formatEngineOptionLabel('copilot')).toBe('Copilot (GitHub)');
    expect(formatEngineOptionLabel('pydantic-ai')).toBe('Pydantic AI (Extension)');
  });

  it('uses updated marks for known extension engines', () => {
    expect(engineIconMarkup('pydantic-ai')).toContain('engine-logo-mark');
    expect(engineIconMarkup('pydantic-ai')).toContain('PY');
    expect(engineIconMarkup('aider')).toContain('AI');
    expect(engineIconMarkup('foo')).toContain('FO');
    expect(engineIconMarkup('x')).toContain('XX');
    expect(engineIconMarkup('my-engine')).toContain('ME');
  });
});

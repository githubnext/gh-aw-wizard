import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import config from '../vite.config.js';
import { loadWizardData } from '../scripts/wizard-data.mjs';

const wizardConfigPath = fileURLToPath(new URL('../src/wizard.json', import.meta.url));
const patternsDir = fileURLToPath(new URL('../patterns', import.meta.url));
const plugin = config.plugins.find((plugin) => plugin.name === 'gh-aw-wizard:patterns-json');
const engines = {
  engines: [{ id: 'example', import: 'owner/repo/shared/example.md' }]
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('wizard data export', () => {
  it('publishes the complete current wizard and pattern data alongside the existing files', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => engines
    });
    vi.stubGlobal('fetch', fetchImpl);
    const emitFile = vi.fn();

    await plugin.generateBundle.call({ emitFile });

    const assets = emitFile.mock.calls.map(([asset]) => asset);
    const exported = JSON.parse(assets.find((asset) => asset.fileName === 'wizard-data.json').source);
    const wizard = JSON.parse(await readFile(wizardConfigPath, 'utf8'));
    const manifest = JSON.parse(await readFile(`${patternsDir}/manifest.json`, 'utf8'));
    expect(exported).toMatchObject({ schema_version: 1, wizard, engines });
    expect(exported.wizard).toEqual(wizard);
    expect(JSON.stringify(exported.patterns)).toBe(JSON.stringify({
      ...manifest,
      archetypes: await Promise.all(manifest.archetypes.map(async (id) => {
        return JSON.parse(await readFile(`${patternsDir}/archetypes/${id}.json`, 'utf8'));
      })),
      workflow_generation: JSON.parse(
        await readFile(`${patternsDir}/${manifest.workflow_generation}`, 'utf8')
      )
    }));
    expect(fetchImpl).toHaveBeenCalledWith(wizard.engines_url, { signal: expect.any(AbortSignal) });
    expect(assets.find((asset) => asset.fileName === 'wizard.json').source).toBe(
      await readFile(wizardConfigPath, 'utf8')
    );
    expect(assets.map((asset) => asset.fileName)).toContain('patterns/manifest.json');
  });

  it('refreshes the engine snapshot on each export', async () => {
    const updatedEngines = { engines: [...engines.engines, { id: 'new', import: 'owner/repo/new.md' }] };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => engines })
      .mockResolvedValueOnce({ ok: true, json: async () => updatedEngines });

    const first = await loadWizardData(wizardConfigPath, patternsDir, fetchImpl);
    const second = await loadWizardData(wizardConfigPath, patternsDir, fetchImpl);
    expect(first.engines).toEqual(engines);
    expect(second.engines).toEqual(updatedEngines);
  });

  it('fails the build rather than publishing an incomplete engine catalog', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const emitFile = vi.fn();

    await expect(plugin.generateBundle.call({ emitFile })).rejects.toThrow(
      'Unable to export wizard engine catalog: HTTP 503'
    );
    expect(emitFile).not.toHaveBeenCalled();
  });

  it('rejects an invalid engine catalog', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

    await expect(loadWizardData(wizardConfigPath, patternsDir, fetchImpl)).rejects.toThrow(
      'expected an engines array'
    );
  });
});

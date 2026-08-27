import { describe, expect, it, vi } from 'vitest';

import {
  loadWizardConfig,
  resolveWizardAssetUrl,
  wizardOptions,
  wizardStep
} from '../src/js/wizard-config.js';

describe('wizard configuration', () => {
  it('loads configuration from a caller-provided URL', async () => {
    const config = { steps: { trigger: { options: [] } } };
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(config)
    });

    await expect(loadWizardConfig('/custom/wizard.json', fetchImpl)).resolves.toBe(config);
    expect(fetchImpl).toHaveBeenCalledWith('/custom/wizard.json');
  });

  it('resolves data files relative to an external configuration', () => {
    expect(resolveWizardAssetUrl(
      'data/manifest.json',
      'https://custom.example/config/wizard.json',
      'https://wizard.example/app/'
    )).toBe('https://custom.example/config/data/manifest.json');
  });

  it('leaves relative URLs usable without a browser base URL', () => {
    expect(resolveWizardAssetUrl('patterns/manifest.json', 'wizard.json')).toBe(
      'patterns/manifest.json'
    );
  });

  it('reads configured steps and returns empty values for missing steps', () => {
    const config = {
      steps: {
        output: {
          placeholder: 'pick an output',
          options: [{ id: 'publish' }]
        }
      }
    };

    expect(wizardStep(config, 'output').placeholder).toBe('pick an output');
    expect(wizardOptions(config, 'output')).toEqual([{ id: 'publish' }]);
    expect(wizardStep(config, 'unknown')).toEqual({});
    expect(wizardOptions(config, 'unknown')).toEqual([]);
  });
});

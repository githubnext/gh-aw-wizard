import { describe, expect, it, vi } from 'vitest';

import {
  applyPageContent,
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

  it('applies configured landing text and footer links safely', () => {
    const elements = {
      'landing-title': { textContent: '' },
      'landing-button-label': { textContent: '' },
      'finish-title': { textContent: '' },
      'btn-copy': { textContent: '', dataset: {} },
      'copy-status': { textContent: '', dataset: {} },
      'finish-preview': { setAttribute: vi.fn() },
      'copy-modal-title': { textContent: '' },
      'copy-modal-close': { setAttribute: vi.fn() },
      'footer-source': { href: '' },
      'footer-source-label': { textContent: '' },
      'footer-copy-logs': { textContent: '', dataset: {} },
      'footer-security': { href: '', textContent: '' }
    };
    globalThis.document = {
      baseURI: 'https://wizard.example/app/',
      getElementById(id) {
        return elements[id] || null;
      }
    };

    applyPageContent({
      landing: {
        title: 'Build an automation',
        button: 'Start building'
      },
      finish: {
        title: 'Your custom prompt is ready',
        copy_button: 'Copy custom prompt',
        copy_failure_button: 'Try copying again',
        copy_failure_status: 'The custom prompt was not copied.',
        preview_aria_label: 'Custom prompt preview'
      },
      copy_success: {
        close_label: 'Dismiss',
        title: 'Custom prompt copied'
      },
      footer: {
        source: {
          url: './source',
          label: 'Source code'
        },
        copy_logs: {
          label: 'Copy support logs',
          success: 'Support logs copied.',
          failure: 'Support logs were not copied.'
        },
        security: {
          url: 'javascript:alert(1)',
          label: 'Security'
        }
      }
    }, 'https://custom.example/config/wizard.json');

    expect(elements['landing-title'].textContent).toBe('Build an automation');
    expect(elements['landing-button-label'].textContent).toBe('Start building');
    expect(elements['finish-title'].textContent).toBe('Your custom prompt is ready');
    expect(elements['btn-copy']).toMatchObject({
      textContent: 'Copy custom prompt',
      dataset: {
        defaultLabel: 'Copy custom prompt',
        failureLabel: 'Try copying again'
      }
    });
    expect(elements['copy-status'].dataset.failureMessage).toBe('The custom prompt was not copied.');
    expect(elements['finish-preview'].setAttribute).toHaveBeenCalledWith(
      'aria-label',
      'Custom prompt preview'
    );
    expect(elements['copy-modal-title'].textContent).toBe('Custom prompt copied');
    expect(elements['copy-modal-close'].setAttribute).toHaveBeenCalledWith('aria-label', 'Dismiss');
    expect(elements['footer-source']).toMatchObject({
      href: 'https://custom.example/config/source'
    });
    expect(elements['footer-source-label'].textContent).toBe('Source code');
    expect(elements['footer-copy-logs']).toMatchObject({
      textContent: 'Copy support logs',
      dataset: {
        successLabel: 'Support logs copied.',
        failureLabel: 'Support logs were not copied.'
      }
    });
    expect(elements['footer-security'].href).toBe('');
    expect(elements['footer-security'].textContent).toBe('Security');
  });
});

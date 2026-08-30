import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  copyWebLlmDiagnostics,
  initDiagnosticLogCopy,
  initScenarioAssistant,
  showAssistantResult
} from '../src/js/slm-ui.js';
import { clearWebLlmDiagnostics, createWebLlmLogger } from '../src/js/slm-logger.js';

const html = readFileSync(fileURLToPath(new URL('../src/index.html', import.meta.url)), 'utf8');
const wizard = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src/wizard.json', import.meta.url)), 'utf8')
);

const originalDocument = globalThis.document;

afterEach(() => {
  globalThis.document = originalDocument;
  vi.unstubAllGlobals();
});

function stubModal() {
  const nodes = {
    'assist-modal-eyebrow': { textContent: '' },
    'assist-modal-title': { textContent: '' },
    'assist-modal-description': { textContent: '' },
    'assist-modal-request-label': { textContent: '' },
    'assist-modal-request': { textContent: '' }
  };
  const modal = {
    open: false,
    showModal() { this.open = true; }
  };
  globalThis.document = {
    getElementById(id) {
      if (id === 'assist-modal') return modal;
      return nodes[id] || null;
    }
  };
  return { modal, nodes };
}

describe('assistant result dialog markup', () => {
  it('declares a native dialog with an accessible name and description', () => {
    const start = html.indexOf('<dialog class="copy-modal assist-modal"');
    expect(start).toBeGreaterThan(-1);
    const dialogTag = html.slice(start, html.indexOf('>', start) + 1);
    expect(dialogTag).toMatch(/id="assist-modal"/);
    expect(dialogTag).toMatch(/aria-labelledby="assist-modal-title"/);
    expect(dialogTag).toMatch(/aria-describedby="assist-modal-description"/);
    expect(html).toContain('data-assist-modal-close aria-label="Close"');
  });

  it('ships configurable copy for the dialog', () => {
    expect(wizard.assistant.result_eyebrow).toBeTruthy();
    expect(wizard.assistant.result_request_label).toBeTruthy();
    expect(wizard.assistant.result_action).toBeTruthy();
  });
});

describe('showAssistantResult', () => {
  it('fills the summary and opens the dialog', () => {
    const { modal, nodes } = stubModal();

    expect(showAssistantResult({
      eyebrow: 'Scenario selected',
      label: 'Issue Triage',
      description: 'Categorize and label issues',
      requestLabel: 'Your request',
      request: 'label incoming issues'
    })).toBe(true);

    expect(modal.open).toBe(true);
    expect(nodes['assist-modal-eyebrow'].textContent).toBe('Scenario selected');
    expect(nodes['assist-modal-title'].textContent).toBe('Issue Triage');
    expect(nodes['assist-modal-description'].textContent).toBe('Categorize and label issues');
    expect(nodes['assist-modal-request-label'].textContent).toBe('Your request');
    expect(nodes['assist-modal-request'].textContent).toBe('label incoming issues');
  });

  describe('diagnostic log copy', () => {
    it('copies retained sanitized records with the Clipboard API', async () => {
      clearWebLlmDiagnostics();
      createWebLlmLogger({ console: null, diagnosticSession: 'copy-test' })
        .error('load.failed', { password: 'private' });
      const writeText = vi.fn().mockResolvedValue();

      await copyWebLlmDiagnostics({
        navigator: { clipboard: { writeText } },
        document: {}
      });

      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"event":"load.failed"'));
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"password":"[redacted]"'));
      expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('private'));
    });

    it('announces successful copies from the footer control', async () => {
      const button = fakeButton();
      button.dataset = { successLabel: 'Logs copied.' };
      const status = { textContent: '' };
      globalThis.document = {
        getElementById: (id) => ({
          'footer-copy-logs': button,
          'footer-copy-logs-status': status
        })[id] || null
      };
      const writeText = vi.fn().mockResolvedValue();

      expect(initDiagnosticLogCopy({ navigator: { clipboard: { writeText } }, document: {} })).toBe(button);
      button.trigger('click');
      await vi.waitFor(() => expect(status.textContent).toBe('Logs copied.'));
    });

    it('falls back to the legacy copy command when the Clipboard API is unavailable', async () => {
      const textarea = { style: {}, select: vi.fn(), value: '' };
      const documentImpl = {
        body: {
          appendChild: vi.fn(),
          removeChild: vi.fn()
        },
        createElement: vi.fn(() => textarea),
        execCommand: vi.fn(() => true)
      };

      await copyWebLlmDiagnostics({ navigator: {}, document: documentImpl });

      expect(documentImpl.execCommand).toHaveBeenCalledWith('copy');
      expect(textarea.select).toHaveBeenCalled();
      expect(documentImpl.body.removeChild).toHaveBeenCalledWith(textarea);
    });
  });

  it('does nothing when the dialog is missing', () => {
    globalThis.document = { getElementById: () => null };
    expect(showAssistantResult({ label: 'Issue Triage' })).toBe(false);
  });
});

function fakeButton() {
  const listeners = {};
  return {
    disabled: false,
    attrs: {},
    addEventListener(type, handler) { listeners[type] = handler; },
    trigger(type) { if (listeners[type]) listeners[type](); },
    setAttribute(name, value) { this.attrs[name] = value; },
    removeAttribute(name) { delete this.attrs[name]; },
    hasAttribute(name) { return name in this.attrs; },
    focus() {}
  };
}

function fakeTextarea() {
  const listeners = {};
  return {
    value: '',
    addEventListener(type, handler) { listeners[type] = handler; },
    trigger(type) { if (listeners[type]) listeners[type](); },
    focus() {}
  };
}

describe('initScenarioAssistant run button', () => {
  it('reuses the intent textarea and stays disabled until it has text', () => {
    const intent = fakeTextarea();
    const run = fakeButton();
    run.setAttribute('hidden', '');
    const nodes = {
      'wizard-assist': run,
      'intent-description': intent,
      'wizard-assist-status': null,
      'wizard-assist-progress-field': null,
      'wizard-assist-progress': null,
      'assist-modal': null
    };
    globalThis.document = {
      getElementById: (id) => (id in nodes ? nodes[id] : null),
      querySelectorAll: () => []
    };
    vi.stubGlobal('navigator', { gpu: {} });

    const logger = {
      log() {},
      warn() {},
      child() { return this; }
    };
    const result = initScenarioAssistant({ wizardConfig: null, patterns: () => null, logger });
    expect(result).not.toBeNull();
    expect(run.hasAttribute('hidden')).toBe(false);
    expect(run.disabled).toBe(true);

    intent.value = 'summarize issues every morning';
    intent.trigger('input');
    expect(run.disabled).toBe(false);

    intent.value = '   ';
    intent.trigger('input');
    expect(run.disabled).toBe(true);
  });
});

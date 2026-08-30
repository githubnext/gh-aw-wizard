import { afterEach, describe, expect, it, vi } from 'vitest';

import { tableToMarkdown } from '../src/js/slm-eval-ui.js';

const originalDocument = globalThis.document;

afterEach(() => {
  globalThis.document = originalDocument;
});

describe('tableToMarkdown', () => {
  it('renders headers, a divider row, and body rows as a markdown table', () => {
    const markdown = tableToMarkdown(
      ['Query', 'Expected', 'Actual response', 'Result'],
      [
        ['What is X?', 'status-report', 'status-report', 'Correct'],
        ['What is Y?', 'pr-review', 'issue-triage', 'Incorrect']
      ]
    );

    expect(markdown.split('\n')).toEqual([
      '| Query | Expected | Actual response | Result |',
      '| --- | --- | --- | --- |',
      '| What is X? | status-report | status-report | Correct |',
      '| What is Y? | pr-review | issue-triage | Incorrect |'
    ]);
  });

  it('escapes pipes and strips newlines so rows stay well-formed', () => {
    const markdown = tableToMarkdown(['Query', 'Actual'], [['a | b', 'line1\nline2']]);
    expect(markdown).toContain('| a \\| b | line1 line2 |');
  });

  it('handles an empty result set', () => {
    const markdown = tableToMarkdown(['Query'], []);
    expect(markdown).toBe('| Query |\n| --- |');
  });
});

function createElement() {
  const element = {
    children: [],
    className: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    listeners: {},
    appendChild(node) {
      this.children.push(node);
      return node;
    },
    insertBefore(node, ref) {
      const index = ref ? this.children.indexOf(ref) : this.children.length;
      this.children.splice(index === -1 ? this.children.length : index, 0, node);
      return node;
    },
    replaceChildren() {
      this.children = [];
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    setAttribute() {},
    click() {
      if (this.listeners.click) this.listeners.click();
    }
  };
  return element;
}

describe('eval results copy button', () => {
  it('stays hidden until a run row is added, then copies a markdown table of the results', async () => {
    globalThis.document = {
      createElement() {
        return createElement();
      }
    };
    const writeText = vi.fn().mockResolvedValue(undefined);

    const { createLiveResults } = await import('../src/js/slm-eval-ui.js');
    const container = createElement();
    const live = createLiveResults(container, { navigator: { clipboard: { writeText } } });

    const copyButton = container.children.find((child) => child.className.includes('btn-evals-copy'));
    expect(copyButton.hidden).toBe(true);

    const scenarios = [{ id: 'status-report', label: 'Status report' }];
    live.addRow(scenarios, {
      query: 'Post a weekly summary',
      golden: 'status-report',
      scenario: 'status-report',
      answer: null,
      correct: true,
      errored: false
    });

    expect(copyButton.hidden).toBe(false);

    copyButton.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledTimes(1);
    const [copiedText] = writeText.mock.calls[0];
    expect(copiedText).toContain('| Query | Expected | Actual response | Result |');
    expect(copiedText).toContain('Post a weekly summary');
    expect(copiedText).toContain('Status report');
    expect(copiedText).toContain('Correct');
  });
});


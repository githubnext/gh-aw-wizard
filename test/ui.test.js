import { afterEach, describe, expect, it } from 'vitest';

import { maxReachableStep, renderArchetypeOptions, resetNavigationPane, showCopySuccess } from '../src/js/ui.js';

const originalDocument = globalThis.document;

afterEach(() => {
  globalThis.document = originalDocument;
});

describe('wizard navigation', () => {
  it('keeps only the What tab required', () => {
    expect(maxReachableStep(false)).toBe(1);
    expect(maxReachableStep(true)).toBe(6);
  });

  describe('archetype option rendering', () => {
    it('renders archetype cards from pattern data and appends custom when missing', () => {
      const container = createElement();
      globalThis.document = {
        getElementById(id) {
          if (id === 'archetype-options') return container;
          return null;
        },
        createElement() {
          return createElement();
        },
        createElementNS() {
          return createElement();
        }
      };

      renderArchetypeOptions({
        archetypes: [
          { id: 'status-report', label: 'Status Report', description: 'Periodic status/activity reports' }
        ]
      });

      expect(container.children).toHaveLength(2);
      const values = container.children.map((card) => card.dataset.value);
      expect(values).toEqual(['status-report', 'custom']);
      const customCard = container.children[1];
      expect(customCard.style.gridColumn).toBe('1 / -1');
      expect(customCard.children[0].value).toBe('custom');
    });

    it('pins priority archetypes to the top in a fixed order', () => {
      const container = createElement();
      globalThis.document = {
        getElementById(id) {
          if (id === 'archetype-options') return container;
          return null;
        },
        createElement() {
          return createElement();
        },
        createElementNS() {
          return createElement();
        }
      };

      renderArchetypeOptions({
        archetypes: [
          { id: 'dependency-monitor', label: 'Dependency Monitor' },
          { id: 'documentation-updater', label: 'Documentation Updater' },
          { id: 'status-report', label: 'Status Report' },
          { id: 'daily-test-improver', label: 'Daily Test Improver' },
          { id: 'code-improvement', label: 'Code Improvement' },
          { id: 'skill-pr-reviewer', label: 'Skill PR Reviewer' }
        ]
      });

      const values = container.children.map((card) => card.dataset.value);
      expect(values).toEqual([
        'skill-pr-reviewer',
        'code-improvement',
        'daily-test-improver',
        'documentation-updater',
        'dependency-monitor',
        'status-report',
        'custom'
      ]);
      expect(container.children[0].classList.contains('priority-archetype')).toBe(true);
      expect(container.children[1].classList.contains('priority-archetype')).toBe(true);
      expect(container.children[2].classList.contains('priority-archetype')).toBe(true);
      expect(container.children[3].classList.contains('priority-archetype')).toBe(true);
      expect(container.children[4].classList.contains('priority-archetype')).toBe(false);
      expect(container.children[5].classList.contains('priority-archetype')).toBe(false);
      expect(container.children[6].classList.contains('priority-archetype')).toBe(false);
    });
  });

  describe('copy prompt success', () => {
    it('opens the success dialog after copying', () => {
      let showCount = 0;
      const removedClasses = [];
      const modal = {
        open: false,
        showModal() {
          showCount += 1;
          this.open = true;
        }
      };
      const button = {
        classList: {
          remove(name) {
            removedClasses.push(name);
          }
        },
        dataset: { defaultLabel: 'Copy prompt' },
        textContent: 'Copy failed — try again'
      };
      const status = { textContent: 'Prompt could not be copied. Please try again.' };
      globalThis.document = {
        getElementById(id) {
          if (id === 'copy-modal') return modal;
          if (id === 'btn-copy') return button;
          if (id === 'copy-status') return status;
          return null;
        }
      };

      showCopySuccess();
      showCopySuccess();

      expect(showCount).toBe(1);
      expect(button.textContent).toBe('Copy prompt');
      expect(removedClasses).toContain('copy-error');
      expect(status.textContent).toBe('');
    });
  });

  it('resets the navigation pane to the opened What pane', () => {
    const step1Pane = createElement({ id: 'step-1' });
    const step2Pane = createElement({ id: 'step-2', classes: ['active'] });
    const step1Item = createElement({ classes: ['completed'] });
    const step2Item = createElement({ classes: ['active'] });
    const step1Button = createProgressStep(1, step1Item, ['completed']);
    const step2Button = createProgressStep(2, step2Item, ['active']);

    globalThis.document = {
      getElementById(id) {
        if (id === 'step-1') return step1Pane;
        if (id === 'step-2') return step2Pane;
        return null;
      },
      querySelectorAll(selector) {
        if (selector === '.wizard-step') return [step1Pane, step2Pane];
        if (selector === '.progress-step') return [step1Button, step2Button];
        if (selector === 'input[name="archetype"]:checked') return [];
        return [];
      }
    };

    resetNavigationPane();

    expect(step1Pane.classList.contains('active')).toBe(true);
    expect(step2Pane.classList.contains('active')).toBe(false);
    expect(step1Button.classList.contains('active')).toBe(true);
    expect(step1Button.attributes.get('aria-expanded')).toBe('true');
    expect(step1Button.attributes.get('aria-current')).toBe('step');
    expect(step2Button.classList.contains('active')).toBe(false);
    expect(step2Button.disabled).toBe(true);
  });
});

function createProgressStep(step, item, classes) {
  const indicator = createElement();
  const button = createElement({ classes });
  button.attributes.set('data-step', String(step));
  button.closest = (selector) => selector === '.recipe-item' ? item : null;
  button.querySelector = (selector) => selector === '.step-indicator' ? indicator : null;
  return button;
}

function createElement(options = {}) {
  const attributes = new Map();
  const element = {
    id: options.id || '',
    attributes,
    classList: createClassList(options.classes || []),
    children: [],
    dataset: {},
    disabled: false,
    innerHTML: '',
    offsetHeight: 0,
    style: {},
    textContent: '',
    closest() {
      return null;
    },
    append(...nodes) {
      nodes.forEach((node) => this.appendChild(node));
    },
    appendChild(node) {
      this.children.push(node);
      return node;
    },
    querySelector() {
      return null;
    },
    getAttribute(name) {
      return attributes.get(name) || null;
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    }
  };
  return element;
}

function createClassList(initial) {
  const classes = new Set(initial);
  return {
    add(...names) {
      names.forEach((name) => classes.add(name));
    },
    contains(name) {
      return classes.has(name);
    },
    remove(...names) {
      names.forEach((name) => classes.delete(name));
    },
    toggle(name, force) {
      if (force === undefined ? !classes.has(name) : force) {
        classes.add(name);
        return true;
      }
      classes.delete(name);
      return false;
    }
  };
}

import { afterEach, describe, expect, it } from 'vitest';

import { maxReachableStep, renderArchetypeOptions, resetNavigationPane } from '../src/js/ui.js';

const originalDocument = globalThis.document;

afterEach(() => {
  globalThis.document = originalDocument;
});

describe('wizard navigation', () => {
  it('keeps only the What tab required', () => {
    expect(maxReachableStep(false)).toBe(1);
    expect(maxReachableStep(true)).toBe(6);
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

describe('What page options', () => {
  it('renders pattern-backed cards and their behavior metadata', () => {
    const container = createElement();
    globalThis.document = {
      createElement(tagName) {
        return createElement({ tagName });
      },
      createElementNS(_namespace, tagName) {
        return createElement({ tagName });
      },
      getElementById(id) {
        return id === 'archetype-options' ? container : null;
      }
    };

    renderArchetypeOptions({
      archetypes: [
        { id: 'pr-review', label: 'PR Review', description: 'Review pull requests' },
        { id: 'custom', label: 'Custom', description: 'Custom workflow' }
      ],
      wizard: {
        what_options: [
          {
            id: 'pr-review',
            icon: 'octicon-eye',
            requires_description: false,
            advance_on_select: true
          },
          {
            id: 'custom',
            icon: 'octicon-zap',
            description: 'Describe your own workflow',
            classes: ['archetype-option-full-width'],
            requires_description: true,
            advance_on_select: false
          }
        ]
      }
    });

    expect(container.children).toHaveLength(2);
    const reviewCard = container.children[0];
    expect(reviewCard.attributes.get('data-value')).toBe('pr-review');
    expect(reviewCard.children[0]).toMatchObject({
      type: 'radio',
      name: 'archetype',
      value: 'pr-review',
      dataset: {
        requiresDescription: 'false',
        advanceOnSelect: 'true'
      }
    });
    expect(reviewCard.children[1].children[0].children[0].attributes.get('href')).toBe('#octicon-eye');
    expect(reviewCard.children[2].children[0].textContent).toBe('PR Review');
    expect(reviewCard.children[2].children[1].textContent).toBe('Review pull requests');

    const customCard = container.children[1];
    expect(customCard.classList.contains('archetype-option-full-width')).toBe(true);
    expect(customCard.children[0].dataset).toEqual({
      requiresDescription: 'true',
      advanceOnSelect: 'false'
    });
    expect(customCard.children[2].children[1].textContent).toBe('Describe your own workflow');
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
    tagName: options.tagName || '',
    attributes,
    children: [],
    classList: createClassList(options.classes || []),
    className: '',
    dataset: {},
    disabled: false,
    innerHTML: '',
    name: '',
    offsetHeight: 0,
    style: {},
    textContent: '',
    type: '',
    value: '',
    append(...children) {
      this.children.push(...children);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    closest() {
      return null;
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
    replaceChildren(...children) {
      this.children.splice(0, this.children.length, ...children);
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

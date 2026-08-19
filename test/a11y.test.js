import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('../src/styles/style.css', import.meta.url)), 'utf8');
const html = readFileSync(fileURLToPath(new URL('../src/index.html', import.meta.url)), 'utf8');

function ruleBody(selector) {
  const start = css.indexOf(selector + ' {');
  expect(start, 'rule not found: ' + selector).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}

describe('archetype grid keyboard accessibility', () => {
  it('keeps the archetype radios in the tab order instead of display: none', () => {
    const body = ruleBody('.archetype-grid .option-card input[type="radio"]');
    expect(body).not.toMatch(/display:\s*none/);
    expect(body).toMatch(/opacity:\s*0/);
  });

  it('shows a focus indicator on the card when the radio is focused', () => {
    expect(ruleBody('.option-card:focus-within')).toMatch(/outline:/);
  });

  it('exposes the archetype options as a radio group', () => {
    expect(html).toMatch(/id="archetype-options"[^>]*role="radiogroup"/);
  });
});

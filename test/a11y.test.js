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

describe('Primer iconography', () => {
  it('uses hidden Octicons instead of emoji for decorative interface icons', () => {
    expect(html).toContain('id="octicon-eye"');
    expect(html).toContain('<use href="#octicon-eye"></use>');
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('adds decorative Octicons to every output option', () => {
    const outputOptions = html.slice(html.indexOf('id="output-options"'), html.indexOf('</section>', html.indexOf('id="output-options"')));
    expect(outputOptions.match(/<svg class="octicon" aria-hidden="true">/g)).toHaveLength(5);
    expect(outputOptions).toContain('<use href="#octicon-comment-discussion"></use>');
    expect(outputOptions).toContain('<use href="#octicon-tag"></use>');
    expect(outputOptions).toContain('<use href="#octicon-issue-opened"></use>');
    expect(outputOptions).toContain('<use href="#octicon-git-pull-request"></use>');
    expect(outputOptions).toContain('<use href="#octicon-eye"></use>');
  });

  it('adds decorative Octicons to every trigger option', () => {
    const triggerOptions = html.slice(html.indexOf('id="trigger-options"'), html.indexOf('</section>', html.indexOf('id="trigger-options"')));
    expect(triggerOptions.match(/<svg class="octicon" aria-hidden="true">/g)).toHaveLength(7);
    expect(triggerOptions).toContain('<use href="#octicon-issue-opened"></use>');
    expect(triggerOptions).toContain('<use href="#octicon-git-pull-request"></use>');
    expect(triggerOptions).toContain('<use href="#octicon-calendar"></use>');
    expect(triggerOptions).toContain('<use href="#octicon-play"></use>');
    expect(triggerOptions).toContain('<use href="#octicon-terminal"></use>');
    expect(triggerOptions).toContain('<use href="#octicon-tag"></use>');
    expect(triggerOptions).toContain('<use href="#octicon-git-commit"></use>');
  });
});

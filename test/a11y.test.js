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

describe('dark theme contrast', () => {
  function darkThemeBody() {
    const start = css.indexOf('[data-color-mode="dark"] {');
    expect(start, 'dark theme rule not found').toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('}', start));
  }

  function hexToLuminance(hex) {
    const n = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
    const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }

  function contrastRatio(hexA, hexB) {
    const l1 = hexToLuminance(hexA);
    const l2 = hexToLuminance(hexB);
    const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (lighter + 0.05) / (darker + 0.05);
  }

  function darkVar(name) {
    const match = darkThemeBody().match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
    expect(match, `${name} not found in dark theme`).not.toBeNull();
    return match[1];
  }

  it('keeps step/recipe badge label colors at or above 4.5:1 against white text', () => {
    for (const name of ['--label-blue', '--label-purple', '--label-green', '--label-pink', '--label-gray']) {
      const ratio = contrastRatio(darkVar(name), '#ffffff');
      expect(ratio, `${name} = ${darkVar(name)} contrast vs white`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the dark-theme muted text color at or above 4.5:1 against the card background', () => {
    const ratio = contrastRatio(darkVar('--text-muted'), darkVar('--bg-card'));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the dark-theme link/accent-blue text color at or above 4.5:1 against the card background', () => {
    const ratio = contrastRatio(darkVar('--accent-blue'), darkVar('--bg-card'));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the copy-prompt button background at or above 4.5:1 against white text', () => {
    const ratio = contrastRatio(darkVar('--accent-green-solid'), '#ffffff');
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Copy prompt button focus indicator', () => {
  it('shows a visible outline when the copy-prompt button is focused', () => {
    const body = ruleBody('.btn-copy-prompt:focus');
    expect(body).toMatch(/outline:\s*2px solid/);
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
    expect(outputOptions.match(/<svg class="octicon" aria-hidden="true">/g)).toHaveLength(4);
    expect(outputOptions).toContain('<use href="#octicon-comment-discussion"></use>');
    expect(outputOptions).toContain('<use href="#octicon-tag"></use>');
    expect(outputOptions).toContain('<use href="#octicon-issue-opened"></use>');
    expect(outputOptions).toContain('<use href="#octicon-git-pull-request"></use>');
  });

  it('uses Octicons for every extras option', () => {
    const extrasOptions = html.slice(html.indexOf('id="extras-options"'), html.indexOf('</section>', html.indexOf('id="extras-options"')));
    expect(extrasOptions.match(/<svg class="octicon" aria-hidden="true">/g)).toHaveLength(3);
    expect(extrasOptions).toContain('<use href="#octicon-cache"></use>');
    expect(extrasOptions).toContain('<use href="#octicon-graph"></use>');
    expect(extrasOptions).toContain('<use href="#octicon-device-desktop"></use>');
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

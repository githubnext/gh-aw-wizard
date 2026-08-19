import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('../src/styles/style.css', import.meta.url)), 'utf8');
const html = readFileSync(fileURLToPath(new URL('../src/index.html', import.meta.url)), 'utf8');
const ui = readFileSync(fileURLToPath(new URL('../src/js/ui.js', import.meta.url)), 'utf8');

function ruleBody(selector) {
  const start = css.indexOf(`${selector  } {`);
  expect(start, `rule not found: ${  selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}

describe('archetype grid keyboard accessibility', () => {
  it('starts with an empty archetype container for runtime pattern-driven rendering', () => {
    expect(html).toMatch(/id="archetype-options"[^>]*><\/div>/);
  });

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

describe('Copy prompt success modal', () => {
  it('uses a native dialog with an accessible name and description', () => {
    const dialogTag = html.slice(html.indexOf('<dialog'), html.indexOf('>', html.indexOf('<dialog')) + 1);
    expect(dialogTag).toMatch(/id="copy-modal"/);
    expect(dialogTag).toMatch(/aria-labelledby="copy-modal-title"/);
    expect(dialogTag).toMatch(/aria-describedby="copy-modal-description"/);
    expect(html).toContain('data-copy-modal-close aria-label="Close"');
  });

  it('tells users to run the copied prompt in their repository', () => {
    expect(html).toContain('Open your coding agent from the repository you want to automate');
    expect(html).toContain('<strong>Run it in your repository</strong>');
  });

  it('announces clipboard failures without opening the success modal', () => {
    const statusTag = html.slice(html.indexOf('id="copy-status"') - 40, html.indexOf('>', html.indexOf('id="copy-status"')) + 1);
    expect(statusTag).toMatch(/role="status"/);
    expect(statusTag).toMatch(/aria-live="polite"/);
  });
});

describe('Archetype radiogroup arrow-key focus', () => {
  it('tracks arrow-key navigation within the archetype radiogroup', () => {
    expect(ui).toMatch(/arrowKeyNav/);
    expect(ui).toMatch(/ArrowDown['"]|ArrowUp['"]|ArrowLeft['"]|ArrowRight['"]/);
  });

  it('does not auto-advance to step 2 from the change handler when navigating via arrow keys', () => {
    const changeHandlerStart = ui.indexOf("radio.addEventListener('change'");
    expect(changeHandlerStart).toBeGreaterThan(-1);
    const changeHandlerEnd = ui.indexOf('\n  });', changeHandlerStart);
    const changeHandlerBody = ui.slice(changeHandlerStart, changeHandlerEnd);
    expect(changeHandlerBody).toMatch(/if \(arrowKeyNav\)/);
    // The arrow-key branch should return before calling goToStep, leaving focus in place.
    const arrowBranchStart = changeHandlerBody.indexOf('if (arrowKeyNav)');
    const arrowBranchEnd = changeHandlerBody.indexOf('}', changeHandlerBody.indexOf('return;', arrowBranchStart));
    const arrowBranchBody = changeHandlerBody.slice(arrowBranchStart, arrowBranchEnd);
    expect(arrowBranchBody).toMatch(/return;/);
    expect(arrowBranchBody).not.toMatch(/goToStep/);
  });

  it('defers advancing to step 2 until focus leaves the radiogroup', () => {
    expect(ui).toMatch(/archetypeGroup\.addEventListener\('focusout'/);
  });
});

describe('Primer iconography', () => {
  it('uses hidden Octicons instead of emoji for decorative interface icons', () => {
    expect(html).toContain('id="octicon-eye"');
    expect(html).toContain('<use href="#octicon-eye"></use>');
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('subtly scales Octicons on hover while respecting reduced-motion preferences', () => {
    expect(ruleBody('.octicon')).toMatch(/transition:\s*transform var\(--transition-fast\)/);
    expect(ruleBody('.octicon:hover')).toMatch(/transform:\s*scale\(1\.08\)/);

    const reducedMotionStart = css.indexOf('@media (prefers-reduced-motion: reduce)');
    const reducedMotionRules = css.slice(reducedMotionStart, css.indexOf('/* Form elements */', reducedMotionStart));
    expect(reducedMotionRules).toMatch(/\.octicon:hover\s*\{\s*transform:\s*none;/);
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
    expect(triggerOptions).toContain('name="trigger" value="pull_request_ready_for_review"');
    expect(triggerOptions).toContain('PR ready for review');
    expect(triggerOptions).toContain('<use href="#octicon-calendar"></use>');
    expect(triggerOptions).toContain('<use href="#octicon-terminal"></use>');
    expect(triggerOptions).toContain('<use href="#octicon-tag"></use>');
    expect(triggerOptions).toContain('<use href="#octicon-git-commit"></use>');
  });

  it('keeps engine options to engine and company only', () => {
    const engineOptions = html.slice(html.indexOf('id="engine-options"'), html.indexOf('</section>', html.indexOf('id="engine-options"')));
    expect(engineOptions).toContain('Copilot (GitHub)');
    expect(engineOptions).not.toContain('option-desc');
    expect(engineOptions).not.toContain('default)');
  });
});

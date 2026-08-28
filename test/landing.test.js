import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('../src/styles/style.css', import.meta.url)), 'utf8');
const html = readFileSync(fileURLToPath(new URL('../src/index.html', import.meta.url)), 'utf8');
const landing = readFileSync(fileURLToPath(new URL('../src/js/landing.js', import.meta.url)), 'utf8');

describe('landing page', () => {
  it('shows a clear message and a get started button', () => {
    expect(html).toContain('id="landing"');
    expect(html).toContain('id="btn-get-started"');
    expect(html).toMatch(/class="landing-message"/);
  });

  it('only hides the wizard behind the landing page when scripting is available', () => {
    expect(html).toContain("document.documentElement.classList.add('is-landing')");
  });

  it('hides the wizard while the landing page is showing', () => {
    const start = css.indexOf('.is-landing .site-header,');
    expect(start).toBeGreaterThan(-1);
    expect(css.slice(start, css.indexOf('}', start))).toMatch(/display:\s*none/);
  });

  it('animates the landing page and the wizard reveal', () => {
    for (const name of ['landingRise', 'landingLeave', 'landingPulse', 'landingGlow']) {
      expect(css).toContain(`@keyframes ${name}`);
    }
  });

  it('reveals the wizard on the get started interaction', () => {
    expect(landing).toContain("getElementById('btn-get-started')");
    expect(landing).toMatch(/classList\.remove\('is-landing'\)/);
    expect(landing).toMatch(/classList\.add\('wizard-revealed'\)/);
  });

  it('keeps a visible focus indicator on the get started button', () => {
    const start = css.indexOf('.btn-get-started:focus-visible {');
    expect(start).toBeGreaterThan(-1);
    expect(css.slice(start, css.indexOf('}', start))).toMatch(/outline:/);
  });
});

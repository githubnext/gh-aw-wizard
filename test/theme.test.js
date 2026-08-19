import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { nextThemeMode, normalizeThemeMode, resolveColorMode, themeCopy } from '../src/js/theme.js';

const html = readFileSync(fileURLToPath(new URL('../src/index.html', import.meta.url)), 'utf8');

describe('normalizeThemeMode', () => {
  it('keeps supported modes', () => {
    expect(normalizeThemeMode('light')).toBe('light');
    expect(normalizeThemeMode('dark')).toBe('dark');
    expect(normalizeThemeMode('auto')).toBe('auto');
  });

  it('falls back to auto for unknown modes', () => {
    expect(normalizeThemeMode('sepia')).toBe('auto');
    expect(normalizeThemeMode(null)).toBe('auto');
  });
});

describe('nextThemeMode', () => {
  it('cycles auto to light to dark and back', () => {
    expect(nextThemeMode('auto')).toBe('light');
    expect(nextThemeMode('light')).toBe('dark');
    expect(nextThemeMode('dark')).toBe('auto');
  });
});

describe('resolveColorMode', () => {
  it('follows the system preference in auto mode', () => {
    expect(resolveColorMode('auto', true)).toBe('dark');
    expect(resolveColorMode('auto', false)).toBe('light');
  });

  it('ignores the system preference for explicit modes', () => {
    expect(resolveColorMode('light', true)).toBe('light');
    expect(resolveColorMode('dark', false)).toBe('dark');
  });
});

describe('themeCopy', () => {
  it('returns label and icon per mode', () => {
    expect(themeCopy('auto').label).toBe('Auto theme');
    expect(themeCopy('light').label).toBe('Light theme');
    expect(themeCopy('dark').label).toBe('Dark theme');
    expect(themeCopy('auto').icon).toBe('device-desktop');
    expect(themeCopy('nope')).toEqual(themeCopy('auto'));
  });
});

describe('theme selector placement', () => {
  it('places the selector in the footer link row', () => {
    const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
    expect(footer).not.toContain('footer-actions');
    expect(footer.indexOf('Report an issue')).toBeLessThan(footer.indexOf('id="theme-toggle"'));
    expect(footer.indexOf('id="theme-toggle"')).toBeLessThan(footer.indexOf('>Terms</a>'));
  });

  it('provides an accessible label for the icon-only selector', () => {
    expect(html).toMatch(/<span class="visually-hidden" id="theme-toggle-label">[^<]+<\/span>/);
  });
});

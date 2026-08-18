import { describe, expect, it } from 'vitest';

import { escapeHtml, highlightMarkdown, highlightYamlLine } from '../src/js/highlight.js';

describe('escapeHtml', () => {
  it('escapes html sensitive characters', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href="x"&gt;&amp;&lt;/a&gt;');
  });
});

describe('highlightYamlLine', () => {
  it('splits keys, delimiters and values', () => {
    expect(highlightYamlLine('  name: triage')).toBe(
      '  <span class="yaml-key">name</span><span class="yaml-delim">:</span><span class="yaml-value"> triage</span>'
    );
  });

  it('highlights list items', () => {
    expect(highlightYamlLine('  - add-label')).toBe('<span class="yaml-value">  - add-label</span>');
  });

  it('leaves unrecognized lines untouched', () => {
    expect(highlightYamlLine('plain text')).toBe('plain text');
  });
});

describe('highlightMarkdown', () => {
  it('highlights frontmatter delimiters and keys', () => {
    const html = highlightMarkdown('---\nname: triage\n---\n# Title');
    expect(html).toContain('<span class="yaml-delim">---</span>');
    expect(html).toContain('<span class="yaml-key">name</span>');
    expect(html).toContain('<span class="md-heading"># Title</span>');
  });

  it('highlights ordered and unordered lists', () => {
    const html = highlightMarkdown('1. first\n- second');
    expect(html).toContain('<span class="md-number">1.</span> first');
    expect(html).toContain('<span class="md-list">- second</span>');
  });

  it('highlights bold markers and escapes html in body text', () => {
    const html = highlightMarkdown('**bold** <script>');
    expect(html).toContain('<span class="md-bold">**bold**</span>');
    expect(html).toContain('&lt;script&gt;');
  });
});

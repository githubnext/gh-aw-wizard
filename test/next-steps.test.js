import { describe, expect, it } from 'vitest';

import { nextStepsHtml } from '../src/js/next-steps.js';

describe('next steps', () => {
  it('renders a focused handoff for generated prompts', () => {
    const html = nextStepsHtml('prompt', 'daily-report', 'copilot');

    expect(html).toContain('Run the prompt in your agent');
    expect(html).toContain('Open <strong>Copilot</strong>');
    expect(html).toContain('Quick start');
    expect(html).not.toContain('style=');
  });

  it('escapes workflow names in setup instructions', () => {
    const html = nextStepsHtml('workflow', '<script>', 'claude');

    expect(html).toContain('&lt;script&gt;.md');
    expect(html).not.toContain('<script>');
    expect(html).toContain('gh extension install github/gh-aw && gh aw upgrade');
    expect(html).toContain('gh aw init --engine claude');
  });
});

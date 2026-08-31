import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SCENARIO_INSTRUCTIONS, buildScenarioMessages } from '../src/js/slm.js';
import { chatCompletion } from '../scripts/prompt-optimizer.mjs';
import {
  DEFAULT_OPTIMIZER_CONFIG,
  MAX_PROPOSED_RULES,
  buildReflectionMessages,
  chooseCandidate,
  formatEvalReport,
  formatFailures,
  instructionsText,
  nextRunDelay,
  parseInstructionProposal,
  scoreOf,
  summarizeRound
} from '../src/js/prompt-optimizer.js';

const scenarios = [
  { id: 'issue-triage', label: 'Issue Triage', description: 'Label incoming issues' },
  { id: 'status-report', label: 'Status Report', description: 'Post periodic summaries' }
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chatCompletion', () => {
  it('sends a bearer token when an API key is configured', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'issue-triage' } }] })
    });
    vi.stubGlobal('fetch', fetch);

    await expect(chatCompletion('http://localhost/v1', { model: 'small' }, 'secret')).resolves.toBe('issue-triage');
    expect(fetch).toHaveBeenCalledWith('http://localhost/v1/chat/completions', expect.objectContaining({
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret'
      }
    }));
  });

  it('omits authorization when no API key is configured', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'custom' } }] })
    });
    vi.stubGlobal('fetch', fetch);

    await chatCompletion('http://localhost/v1', { model: 'small' });
    expect(fetch.mock.calls[0][1].headers).toEqual({ 'content-type': 'application/json' });
  });
});

describe('buildScenarioMessages instruction override', () => {
  it('keeps the shipped instructions by default', () => {
    const [system] = buildScenarioMessages(scenarios, 'triage issues');
    expect(system.content).toContain(DEFAULT_SCENARIO_INSTRUCTIONS.preamble);
    DEFAULT_SCENARIO_INSTRUCTIONS.rules.forEach((rule) => {
      expect(system.content).toContain(rule);
    });
  });

  it('substitutes optimized instructions around the same catalog', () => {
    const [system] = buildScenarioMessages(scenarios, 'triage issues', {
      preamble: 'Pick one id.',
      rules: ['Answer with the id only.']
    });
    expect(system.content).toBe([
      'Pick one id.',
      DEFAULT_SCENARIO_INSTRUCTIONS.catalogHeader,
      '- issue-triage: Issue Triage — Label incoming issues',
      '- status-report: Status Report — Post periodic summaries',
      'Answer with the id only.'
    ].join('\n'));
  });
});

describe('formatFailures', () => {
  const traces = [
    { query: 'a', golden: 'issue-triage', answer: 'status-report', scenario: 'status-report', correct: false },
    { query: 'b', golden: 'status-report', answer: 'status-report', scenario: 'status-report', correct: true },
    { query: 'c', golden: 'issue-triage', answer: null, scenario: null, correct: false, errored: true }
  ];

  it('only reports incorrect rows with their traces', () => {
    const text = formatFailures(traces, 10);
    expect(text).toContain('request: a');
    expect(text).toContain('expected: issue-triage');
    expect(text).toContain('model answered: "status-report"');
    expect(text).not.toContain('request: b');
    expect(text).toContain('<request failed>');
  });

  it('caps the number of examples', () => {
    expect(formatFailures(traces, 1).split('\n\n')).toHaveLength(1);
  });
});

describe('formatEvalReport', () => {
  const evaluation = {
    successRate: 0.5,
    successes: 1,
    attempts: 2,
    errors: 0,
    rows: [
      { scenario: 'status-report', successes: 1, attempts: 1, successRate: 1 },
      { scenario: 'issue-triage', successes: 0, attempts: 1, successRate: 0 }
    ],
    traces: [
      { query: 'label new issues', golden: 'issue-triage', answer: 'status-report', scenario: 'status-report', correct: false }
    ]
  };

  it('reports the score, the instructions, the weakest scenarios first and the traces', () => {
    const report = formatEvalReport({
      instructions: { preamble: 'P', rules: ['R'] },
      evaluation,
      evalModel: 'small-model'
    });
    expect(report).toContain('- eval model: small-model');
    expect(report).toContain('- success rate: 50% (1/2)');
    expect(report).toContain('"preamble": "P"');
    expect(report.indexOf('| issue-triage |')).toBeLessThan(report.indexOf('| status-report |'));
    expect(report).toContain('request: label new issues');
  });

  it('says so when nothing failed', () => {
    const report = formatEvalReport({ evaluation: { ...evaluation, traces: [] } });
    expect(report).toContain('None — every sampled request was answered correctly.');
  });
});

describe('buildReflectionMessages', () => {
  it('describes the task, the current instructions and the observed failures', () => {
    const [system, user] = buildReflectionMessages({
      instructions: DEFAULT_SCENARIO_INSTRUCTIONS,
      catalogText: '- issue-triage: Issue Triage',
      failures: 'request: a\nexpected: issue-triage',
      successRate: 0.5,
      attempts: 12
    });
    expect(system.content).toContain('```json');
    expect(user.content).toContain('50%');
    expect(user.content).toContain('12 attempts');
    expect(user.content).toContain(DEFAULT_SCENARIO_INSTRUCTIONS.preamble);
    expect(user.content).toContain('expected: issue-triage');
  });

  it('states when the batch had no failures', () => {
    const [, user] = buildReflectionMessages({ instructions: DEFAULT_SCENARIO_INSTRUCTIONS });
    expect(user.content).toContain('every sampled request was answered correctly');
  });
});

describe('parseInstructionProposal', () => {
  it('reads a fenced json proposal and keeps the catalog header', () => {
    const answer = [
      'Here is my analysis.',
      '```json',
      '{"diagnosis": "too vague", "preamble": "Pick one id.", "rules": ["Answer with the id only."]}',
      '```'
    ].join('\n');
    const proposal = parseInstructionProposal(answer, DEFAULT_SCENARIO_INSTRUCTIONS);
    expect(proposal.diagnosis).toBe('too vague');
    expect(proposal.instructions).toEqual({
      preamble: 'Pick one id.',
      catalogHeader: DEFAULT_SCENARIO_INSTRUCTIONS.catalogHeader,
      rules: ['Answer with the id only.']
    });
  });

  it('reads an unfenced object surrounded by prose', () => {
    const proposal = parseInstructionProposal(
      'Answer: {"preamble": "P", "rules": ["R with } brace"]} — done',
      DEFAULT_SCENARIO_INSTRUCTIONS
    );
    expect(proposal.instructions.rules).toEqual(['R with } brace']);
  });

  it('caps the number of rules and drops empty ones', () => {
    const rules = JSON.stringify(new Array(MAX_PROPOSED_RULES + 3).fill('rule').concat(['', '  ']));
    const proposal = parseInstructionProposal(`{"preamble": "P", "rules": ${rules}}`, null);
    expect(proposal.instructions.rules).toHaveLength(MAX_PROPOSED_RULES);
  });

  it('rejects unusable answers', () => {
    expect(parseInstructionProposal('no json here', null)).toBeNull();
    expect(parseInstructionProposal('{not json}', null)).toBeNull();
    expect(parseInstructionProposal('{"preamble": "P"}', null)).toBeNull();
    expect(parseInstructionProposal('{"rules": ["R"]}', null)).toBeNull();
  });
});

describe('chooseCandidate', () => {
  const current = { successRate: 0.6, instructions: { preamble: 'current', rules: ['a'] } };

  it('adopts a candidate that clears the minimum gain', () => {
    const better = { successRate: 0.8, instructions: { preamble: 'better', rules: ['b'] } };
    const decision = chooseCandidate(current, [better], 0.01);
    expect(decision.accepted).toBe(true);
    expect(decision.winner).toBe(better);
    expect(decision.improvement).toBeCloseTo(0.2);
  });

  it('keeps the incumbent when the gain is within the noise threshold', () => {
    const marginal = { successRate: 0.605, instructions: { preamble: 'marginal', rules: ['b'] } };
    const decision = chooseCandidate(current, [marginal], 0.01);
    expect(decision.accepted).toBe(false);
    expect(decision.winner).toBe(current);
  });

  it('breaks ties in favour of the shorter prompt', () => {
    const long = { successRate: 0.9, instructions: { preamble: 'x'.repeat(50), rules: ['b'] } };
    const short = { successRate: 0.9, instructions: { preamble: 'x', rules: ['b'] } };
    expect(chooseCandidate(current, [long, short]).winner).toBe(short);
  });

  it('keeps the incumbent when there are no candidates', () => {
    const decision = chooseCandidate(current, []);
    expect(decision).toEqual({ accepted: false, winner: current, improvement: 0 });
  });
});

describe('helpers', () => {
  it('scores missing results as zero', () => {
    expect(scoreOf(null)).toBe(0);
    expect(scoreOf({ successRate: 0.25 })).toBe(0.25);
  });

  it('renders instructions as the model sees them', () => {
    expect(instructionsText({ preamble: 'P', rules: ['R1', 'R2'] })).toBe('P\nR1\nR2');
  });

  it('summarizes a round', () => {
    const summary = summarizeRound({ round: 2, baselineScore: 0.5, bestScore: 0.75, accepted: true });
    expect(summary).toBe('round 2: baseline 50% — best candidate 75% — accepted new instructions');
  });

  it('keeps the schedule on a fixed cadence', () => {
    expect(nextRunDelay(DEFAULT_OPTIMIZER_CONFIG.intervalMs, 0)).toBe(3600000);
    expect(nextRunDelay(3600000, 600000)).toBe(3000000);
    expect(nextRunDelay(3600000, 7200000)).toBe(0);
  });
});

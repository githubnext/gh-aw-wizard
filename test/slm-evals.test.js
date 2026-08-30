import { describe, expect, it, vi } from 'vitest';

import { EVAL_CORPUS, EVAL_REPETITIONS, EVAL_SAMPLE_SIZE, pickRandomSample, runEvals } from '../src/js/slm-evals.js';

describe('SLM eval corpus', () => {
  it('contains 100 queries with golden scenario answers', () => {
    expect(EVAL_CORPUS).toHaveLength(100);
    EVAL_CORPUS.forEach((item) => {
      expect(item.query).toBeTruthy();
      expect(item.golden).toBeTruthy();
    });
  });

  it('runs every query repeatedly and aggregates scenario statistics', async () => {
    const analyze = vi.fn(async (query) => ({
      scenario: query === 'first' ? 'status-report' : 'wrong'
    }));
    const onProgress = vi.fn();

    const result = await runEvals({
      corpus: [
        { query: 'first', golden: 'status-report' },
        { query: 'second', golden: 'issue-triage' }
      ],
      repetitions: 2,
      analyze,
      onProgress
    });

    expect(analyze).toHaveBeenCalledTimes(4);
    expect(onProgress).toHaveBeenLastCalledWith({ completed: 4, total: 4 });
    expect(result).toMatchObject({
      queries: 2,
      repetitions: 2,
      attempts: 4,
      successes: 2,
      successRate: 0.5
    });
    expect(result.rows).toEqual([
      expect.objectContaining({ scenario: 'status-report', attempts: 2, successes: 2, successRate: 1 }),
      expect.objectContaining({ scenario: 'issue-triage', attempts: 2, successes: 0, successRate: 0 })
    ]);
  });

  it('uses multiple repetitions by default', () => {
    expect(EVAL_REPETITIONS).toBeGreaterThan(1);
  });

  it('defaults the sample size to 10', () => {
    expect(EVAL_SAMPLE_SIZE).toBe(10);
  });

  it('picks a random sample of unique items without mutating the source corpus', () => {
    const originalLength = EVAL_CORPUS.length;
    const sample = pickRandomSample(EVAL_CORPUS, EVAL_SAMPLE_SIZE);

    expect(sample).toHaveLength(EVAL_SAMPLE_SIZE);
    expect(EVAL_CORPUS).toHaveLength(originalLength);
    expect(new Set(sample)).toHaveProperty('size', EVAL_SAMPLE_SIZE);
    sample.forEach((item) => expect(EVAL_CORPUS).toContain(item));
  });

  it('runs a random 10-query sample from the 100-query corpus 3 times by default', async () => {
    const analyze = vi.fn(async () => ({ scenario: 'status-report' }));

    const result = await runEvals({ sampleSize: EVAL_SAMPLE_SIZE, analyze });

    expect(result.queries).toBe(EVAL_SAMPLE_SIZE);
    expect(result.repetitions).toBe(EVAL_REPETITIONS);
    expect(analyze).toHaveBeenCalledTimes(EVAL_SAMPLE_SIZE * EVAL_REPETITIONS);
  });

  it('counts failed model calls without stopping the run', async () => {
    const result = await runEvals({
      corpus: [{ query: 'request', golden: 'custom' }],
      repetitions: 2,
      analyze: vi.fn()
        .mockRejectedValueOnce(new Error('model failed'))
        .mockResolvedValueOnce({ scenario: 'custom' })
    });

    expect(result).toMatchObject({ attempts: 2, successes: 1, errors: 1, successRate: 0.5 });
  });
});

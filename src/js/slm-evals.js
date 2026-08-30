// Synthetic requests and golden scenario selections for the hidden SLM eval mode.

const QUERY_GROUPS = [
  ['code-improvement', [
    'Find a small code quality problem and open a pull request fixing it',
    'Improve error handling in the codebase and submit the change',
    'Look for maintainability issues and implement one safe cleanup',
    'Find and fix a bug in the repository code',
    'Make a focused code improvement with tests'
  ]],
  ['status-report', [
    'Post a weekly summary of repository activity',
    'Create a daily report of open issues and pull requests',
    'Summarize what changed in the project every Monday',
    'Publish a regular engineering status update',
    'Report repository progress on a schedule'
  ]],
  ['pr-review', [
    'Review every new pull request and leave feedback',
    'Check pull request changes for correctness',
    'Act as an automated reviewer when a PR is opened',
    'Inspect proposed code changes and comment on problems',
    'Review pull requests for risky implementation choices'
  ]],
  ['documentation-updater', [
    'Keep the README synchronized with code changes',
    'Update documentation when public APIs change',
    'Find stale docs and open a pull request correcting them',
    'Refresh user guides after changes land',
    'Maintain accurate repository documentation'
  ]],
  ['content-moderation', [
    'Moderate new discussion comments for abusive content',
    'Flag inappropriate community posts',
    'Review issue comments for violations of our conduct policy',
    'Identify spam and harassment in repository discussions',
    'Check community content against moderation rules'
  ]],
  ['issue-triage', [
    'Label and prioritize newly opened issues',
    'Triage bug reports as they arrive',
    'Categorize incoming issues and request missing details',
    'Route new issues to the right area owners',
    'Apply severity labels to fresh issue reports'
  ]],
  ['dependency-monitor', [
    'Check dependencies for new releases every week',
    'Monitor upstream packages for breaking changes',
    'Track dependency health and open an issue when action is needed',
    'Report outdated project dependencies on a schedule',
    'Watch upstream libraries for important updates'
  ]],
  ['daily-test-improver', [
    'Improve one weak test every day',
    'Find missing test coverage and add a test daily',
    'Regularly strengthen flaky or incomplete tests',
    'Create a daily pull request that improves the test suite',
    'Look for untested edge cases each morning'
  ]],
  ['repo-maintainer', [
    'Perform routine repository maintenance automatically',
    'Keep stale project housekeeping tasks under control',
    'Handle recurring repository cleanup work',
    'Maintain labels and general repository hygiene',
    'Automate routine maintainer chores'
  ]],
  ['accessibility-expert', [
    'Audit the web interface for accessibility problems',
    'Find and fix WCAG violations',
    'Review UI changes for keyboard and screen reader support',
    'Improve accessibility of forms and interactive controls',
    'Check the site for accessible names and contrast issues'
  ]],
  ['performance-nut', [
    'Find performance bottlenecks and optimize them',
    'Review code for unnecessary slow paths',
    'Measure and improve application performance',
    'Investigate regressions in speed or memory use',
    'Make a focused performance optimization'
  ]],
  ['user-simulator', [
    'Simulate a new user trying the product',
    'Test the project from an end user perspective',
    'Walk through common user journeys and report friction',
    'Act like a user and evaluate the onboarding experience',
    'Exercise realistic product usage scenarios'
  ]],
  ['linter-workflows', [
    'Lint our agentic workflow files for mistakes',
    'Check GitHub agentic workflows against best practices',
    'Review workflow markdown for invalid configuration',
    'Find quality problems across our agentic workflows',
    'Validate all agentic workflow definitions'
  ]],
  ['skill-pr-reviewer', [
    'Review pull requests that change Copilot skills',
    'Check skill updates for quality and safety',
    'Evaluate proposed changes to agent skill files',
    'Review a new repository skill in a pull request',
    'Inspect skill PRs for missing instructions'
  ]],
  ['issue-hierarchy-manager', [
    'Organize issues into parents and sub-issues',
    'Maintain our issue hierarchy automatically',
    'Group related issues under tracking issues',
    'Connect task issues to the correct parent',
    'Keep parent and child issue relationships tidy'
  ]],
  ['security-scanner', [
    'Scan the repository for security vulnerabilities',
    'Look for exploitable code and report findings',
    'Audit source changes for security risks',
    'Find insecure patterns in the codebase',
    'Perform a recurring application security scan'
  ]],
  ['code-health-auditor', [
    'Audit overall code health and technical debt',
    'Report maintainability trends in the repository',
    'Assess code complexity and areas needing cleanup',
    'Create a code health report for maintainers',
    'Track technical debt and architecture quality'
  ]],
  ['ci-failure-triage', [
    'Investigate failed CI runs and explain the cause',
    'Triage GitHub Actions failures',
    'Analyze broken builds and suggest a fix',
    'Respond when continuous integration jobs fail',
    'Diagnose test failures from CI logs'
  ]],
  ['community-digest', [
    'Publish a digest of community discussions',
    'Summarize recent community activity each week',
    'Create a roundup of issues discussions and contributions',
    'Report highlights from the project community',
    'Compile a regular community update'
  ]],
  ['custom', [
    'Invent a workflow that composes music from weather data',
    'Automate a repository task that does not match any listed category',
    'Build a bespoke workflow for my unusual internal process',
    'Create an agent for a unique task I will describe later',
    'I need something completely different from the available scenarios'
  ]]
];

export const EVAL_REPETITIONS = 3;

export const EVAL_CORPUS = QUERY_GROUPS.flatMap(([golden, queries]) => {
  return queries.map((query) => ({ query, golden }));
});

export async function runEvals(options) {
  const opts = options || {};
  const corpus = opts.corpus || EVAL_CORPUS;
  const repetitions = opts.repetitions || EVAL_REPETITIONS;
  const analyze = opts.analyze;
  if (typeof analyze !== 'function') throw new Error('An analyze function is required');

  const byScenario = new Map();
  let completed = 0;
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (const item of corpus) {
      const stats = byScenario.get(item.golden) || {
        scenario: item.golden,
        queries: 0,
        attempts: 0,
        successes: 0,
        errors: 0
      };
      if (repetition === 0) stats.queries += 1;
      stats.attempts += 1;
      try {
        const result = await analyze(item.query);
        if (result && result.scenario === item.golden) stats.successes += 1;
      } catch {
        stats.errors += 1;
      }
      byScenario.set(item.golden, stats);
      completed += 1;
      if (typeof opts.onProgress === 'function') {
        opts.onProgress({ completed, total: corpus.length * repetitions });
      }
    }
  }

  const rows = Array.from(byScenario.values()).map((row) => ({
    ...row,
    successRate: row.attempts ? row.successes / row.attempts : 0
  }));
  const attempts = rows.reduce((sum, row) => sum + row.attempts, 0);
  const successes = rows.reduce((sum, row) => sum + row.successes, 0);
  const errors = rows.reduce((sum, row) => sum + row.errors, 0);
  return {
    queries: corpus.length,
    repetitions,
    attempts,
    successes,
    errors,
    successRate: attempts ? successes / attempts : 0,
    rows
  };
}

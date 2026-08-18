---
name: "🔬 Deep Research"
description: Analyze agentic workflow trends and open PRs to improve the pattern library
engine: copilot
on:
  schedule: daily
  skip-if-match: 'is:pr is:open in:title "Pattern library update"'
permissions:
  actions: read
  contents: read
  copilot-requests: write
safe-outputs:
  create-pull-request:
strict: true
timeout-minutes: 30
tools:
  agentic-workflows:
  cache-memory:
    key: deep-research-state
    retention-days: 30
    description: |
      Persistent state for the Deep Research scan. Contains:
      - `scan/discovered.json`, `scan/verified.json`, `scan/analyzed.json` — intermediate
        scan stages reused across runs so a scan can resume instead of starting over
      - `scan/state.json` — timestamps describing when each stage was last refreshed
      - `logs/` — agentic workflow run logs downloaded with `gh aw logs`
      - `reports/analysis-report.json` — the previous run's analysis report
steps:
  - name: Restore scan state from cache-memory
    uses: actions/github-script@v9
    with:
      script: |
        const fs = require('fs');
        const path = require('path');
        const cacheDir = '/tmp/gh-aw/cache-memory';
        const scanDir = '/tmp/aw-scan';
        fs.mkdirSync(scanDir, { recursive: true });
        const cachedScan = path.join(cacheDir, 'scan');
        if (!fs.existsSync(cachedScan)) {
          console.log('No cached scan state found — starting a fresh scan');
          return;
        }
        for (const file of fs.readdirSync(cachedScan)) {
          if (!file.endsWith('.json')) continue;
          fs.copyFileSync(path.join(cachedScan, file), path.join(scanDir, file));
          console.log(`Restored ${file} from cache-memory`);
        }

  - name: Run scan
    uses: actions/github-script@v9
    with:
      script: |
        await exec.exec('./scripts/scan.sh', ['--active-only', '--run-history', '--resume']);
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  - name: Install gh-aw CLI
    uses: github/gh-aw-actions/setup-cli@v0.87.0
    with:
      version: 'v0.87.0'
      github-token: ${{ secrets.GITHUB_TOKEN }}

  - name: Download agentic workflow logs
    continue-on-error: true
    uses: actions/github-script@v9
    with:
      script: |
        const fs = require('fs');
        const path = require('path');
        const logsDir = '/tmp/gh-aw/cache-memory/logs';
        fs.mkdirSync(logsDir, { recursive: true });
        const scan = JSON.parse(fs.readFileSync('data/scan-results.json', 'utf8'));
        const repos = Object.entries(scan.repos || {})
          .filter(([, repo]) => (repo.recent_runs || 0) > 0)
          .sort((a, b) => (b[1].stars || 0) - (a[1].stars || 0))
          .slice(0, 10)
          .map(([name]) => name);
        for (const repo of repos) {
          const outDir = path.join(logsDir, repo.replace('/', '__'));
          const code = await exec.exec(
            'gh',
            ['aw', 'logs', '--repo', repo, '--count', '10', '--start-date', '-7d',
             '--json', '--output', outDir, '--cache-before', '-30d'],
            { ignoreReturnCode: true },
          );
          if (code !== 0) {
            console.log(`Skipping ${repo} — gh aw logs exited with code ${code}`);
          }
        }
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  - name: Rebuild patterns.json
    run: python3 scripts/build-patterns.py

  - name: Run statistical analysis
    uses: actions/github-script@v9
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    with:
      script: |
        await require(`${process.env.GITHUB_WORKSPACE}/scripts/analyze.cjs`)({ github });

  - name: Validate generated data
    run: |
      shopt -s nullglob
      node scripts/validate-data.mjs \
        patterns.json \
        data/scan-results.json \
        data/analysis-report.json \
        data/scan-history/*.json

  - name: Persist scan state to cache-memory
    uses: actions/github-script@v9
    with:
      script: |
        const fs = require('fs');
        const path = require('path');
        const cacheDir = '/tmp/gh-aw/cache-memory';
        const scanDir = '/tmp/aw-scan';
        const cachedScan = path.join(cacheDir, 'scan');
        const cachedReports = path.join(cacheDir, 'reports');
        fs.mkdirSync(cachedScan, { recursive: true });
        fs.mkdirSync(cachedReports, { recursive: true });
        const state = { updated_at: new Date().toISOString(), stages: {} };
        for (const file of ['discovered.json', 'verified.json', 'analyzed.json']) {
          const src = path.join(scanDir, file);
          if (!fs.existsSync(src)) continue;
          fs.copyFileSync(src, path.join(cachedScan, file));
          state.stages[file] = fs.statSync(src).mtime.toISOString();
          console.log(`Cached ${file}`);
        }
        fs.writeFileSync(path.join(cachedScan, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
        for (const file of ['data/analysis-report.json', 'data/scan-results.json']) {
          if (!fs.existsSync(file)) continue;
          fs.copyFileSync(file, path.join(cachedReports, path.basename(file)));
          console.log(`Cached ${file}`);
        }
---

# Deep Research Agent

You are a **data analyst** specializing in GitHub Copilot agentic workflows.

Your job is to read the statistical analysis report, compare it with the current pattern library, and open a pull request with improvements when the data supports changes.

## Context

This repository contains a prompt generator for agentic workflows. It uses `patterns.json` as its knowledge base — a file that defines archetypes (types of workflows), their success rates, recommended configurations, tips, and anti-patterns.

The workflow first restores cached intermediate scan data, then runs `scripts/scan.sh --active-only --run-history --resume` to collect data from real public repositories, downloads agentic workflow run logs with `gh aw logs`, rebuilds `patterns.json`, and produces `data/analysis-report.json` with fresh statistics.

Because the scan is incremental, this workflow is designed to run repeatedly: intermediate stages that are still fresh (less than 7 days old) are reused from the cache instead of being re-fetched.

## Persistent state (cache-memory)

The cache-memory folder is restored at the start of every run and saved at the end. Use it to compare this run against previous ones:

- `scan/discovered.json`, `scan/verified.json`, `scan/analyzed.json` — intermediate scan stages
- `scan/state.json` — when each stage was last refreshed
- `logs/<owner>__<repo>/` — run logs downloaded with `gh aw logs`, including `summary.json` with per-run metrics
- `reports/analysis-report.json` — the analysis report from the previous run

You also have the `agentic-workflows` tools available (`status`, `compile`, `logs`, `audit`, `inspect`). Use `logs` to download or inspect additional run logs when a finding needs more evidence, and `audit` to investigate a specific failing run.

## Instructions

### Step 1: Read the data

1. Read `data/scan-results.json` — this is the fresh scan output
2. Read `data/analysis-report.json` — this is the statistical analysis output
3. Read `patterns.json` — this is the current pattern library rebuilt from the scan
4. Read the cache-memory folder (`reports/analysis-report.json` and `scan/state.json`) to see what the previous run found and which data was reused
5. Inspect `logs/` for failure evidence when the report flags degraded workflows
6. Understand what changed: look at the `recommendations` array in the report

### Step 2: Evaluate recommendations

For each recommendation in the report, decide if it warrants a change to `patterns.json`:

**DO change patterns.json when:**
- An archetype's success rate shifted by 5+ percentage points with n≥20 runs
- A trigger combination has <20% success rate across 10+ runs (add to anti-patterns)
- A new workflow pattern appears in 5+ repos with >70% success rate (consider new archetype or update existing tips)
- A feature correlation is significant (10+ pp delta with n≥10 in both groups)
- Degradation is widespread (3+ repos showing same pattern degrading)

**DO NOT change patterns.json when:**
- Sample sizes are too small (n<10)
- Changes are within noise range (<3 pp for rates, <5 repos for patterns)
- The recommendation is about a single repo's workflow
- You cannot verify the finding from the data

### Step 3: Make changes

If changes are warranted:

1. Create a new branch named `deep-research/YYYY-MM-DD`
2. Refine the rebuilt `patterns.json` with any additional supported changes:
   - Update `success_rate` values for archetypes when deltas are significant
   - Add new anti-patterns when trigger combos or workflow patterns consistently fail
   - Update `tips` arrays with new findings (e.g., "Adding workflow_dispatch improves success by X%")
   - Update `trigger_success_rates` if present, or add the section
   - Update `engine_success_rates` if engine data has shifted
3. Commit the changes with a descriptive message

### Step 4: Open a PR

Open a pull request with:

- **Title**: `📊 Pattern library update — [date]`
- **Body** that includes:
  - A summary of what changed and why
  - The data supporting each change (success rates, sample sizes)
  - A table of archetype health changes
  - Any new anti-patterns added
  - Trigger combo insights

### Step 5: Skip if no changes needed

If the analysis report shows no significant changes (all deltas within noise), do NOT open a PR. Instead, do nothing — no PR, no commit, no issue. Silence means the pattern library is still accurate.

## Rules

- Do not invent data. Every change must be traceable to a number in `analysis-report.json`.
- Do not remove existing archetypes or anti-patterns unless the data strongly contradicts them (n≥50, >20pp shift).
- Do not change the structure or schema of `patterns.json` — only update values within the existing schema.
- Do not reference internal or private repositories. All data comes from public repos.
- Keep PR descriptions concise — focus on what changed and the supporting numbers.
- Prefer conservative changes. When in doubt, don't change.
- Round success rates to 2 decimal places.
- Success rate changes should use the format: "72% → 74% (Δ+2pp, n=142)"
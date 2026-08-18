// Statistical analysis of scan results. Reads data/scan-results.json and patterns.json,
// writes data/analysis-report.json. Exported as a CommonJS module taking `{ github }`
// (an authenticated Octokit client), so it is called from actions/github-script.
module.exports = async ({ github }) => {
  const fs = require('fs');
  const path = require('path');

  const scanData = 'data/scan-results.json';
  const patternsFile = 'patterns.json';
  const reportFile = 'data/analysis-report.json';
  const historyDir = 'data/scan-history';
  const maxLogRepos = 100;

  const round = (value, digits = 3) => Number(value.toFixed(digits));
  const parseSuccessRate = (value) => {
    if (!value || value === '0/0') return null;
    const [successes, total] = value.split('/').map(Number);
    return total > 0 && Number.isFinite(successes) ? successes / total : null;
  };
  const classifyWorkflow = (workflow) => {
    const name = `${workflow.name || ''} ${workflow.file || ''}`.toLowerCase();
    if (name.includes('triage') || name.includes('label')) return 'issue-triage';
    if (name.includes('upstream') || name.includes('sync') || name.includes('monitor')) return 'upstream-monitor';
    if (name.includes('doc') && ['updat', 'improv', 'generat', 'clean'].some((word) => name.includes(word))) return 'documentation-updater';
    if (name.includes('review') || name.includes('pr-review') || name.includes('pr-check')) return 'pr-review';
    if (['fix', 'doctor', 'ci', 'code'].some((word) => name.includes(word))) return 'code-improvement';
    if (['report', 'summary', 'weekly', 'status'].some((word) => name.includes(word))) return 'status-report';
    if (['depend', 'update', 'renovate'].some((word) => name.includes(word))) return 'dependency-monitor';
    if (name.includes('moderat') || name.includes('content')) return 'content-moderation';
    return 'custom';
  };
  const increment = (map, key, amount = 1) => map.set(key, (map.get(key) || 0) + amount);
  const sortedEntries = (map, compare) => [...map.entries()].sort(compare);

  const errorPatterns = {
    safe_output_denied: /safe.?output|output.*denied|not allowed.*write|permission.*output/i,
    auth_error: /401|403|authentication|authorization|SAML|permission denied|Resource not accessible/i,
    not_found: /404|not found|does not exist|no such/i,
    mcp_error: /MCP.*error|MCP.*fail|tool.*error|tool call failed/i,
    timeout: /timed? ?out|deadline exceeded|execution time|Job was cancelled/i,
    rate_limit: /rate limit|API rate|secondary rate|abuse detection|429/i,
    payload_too_large: /payload was too large|exceeds.*threshold|response too large/i,
    token_limit: /token limit|context.*too long|max.*tokens|context window/i,
    network_error: /ECONNREFUSED|ENOTFOUND|DNS|network.*error|connection.*refused|fetch failed/i,
    empty_results: /total_count.*:.*0|no results found|0 items|empty response/i,
    agent_stuck: /no progress|stuck|loop detected|repeated.*same|identical.*response/i,
  };
  const categorizeLog = (text) => {
    if (!text) return ['unknown'];
    const categories = Object.entries(errorPatterns)
      .filter(([, pattern]) => pattern.test(text))
      .map(([name]) => name);
    return categories.length ? categories : ['unknown'];
  };
  const fetchFailedLogs = async (repo, runId) => {
    try {
      const [owner, repoName] = repo.split('/');
      const jobs = await github.paginate('GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs', {
        owner,
        repo: repoName,
        run_id: runId,
        per_page: 100,
      });
      const job = jobs.find(({ conclusion }) => conclusion === 'failure');
      if (!job) return null;
      const response = await github.request('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs', {
        owner,
        repo: repoName,
        job_id: job.id,
      });
      const text = Buffer.isBuffer(response.data)
        ? response.data.toString()
        : typeof response.data === 'string'
          ? response.data
          : Buffer.from(response.data).toString();
      return text.slice(-2000);
    } catch {
      return null;
    }
  };

  const historyFiles = () => {
    if (!fs.existsSync(historyDir)) return [];
    return fs.readdirSync(historyDir)
      .filter((name) => /^scan-.*\.json$/.test(name))
      .sort();
  };
  const loadPreviousScan = () => {
    const snapshots = historyFiles();
    if (snapshots.length < 2) return [null, null];
    const filename = snapshots.at(-2);
    try {
      return [
        JSON.parse(fs.readFileSync(path.join(historyDir, filename), 'utf8')),
        filename.replace(/^scan-/, '').replace(/\.json$/, ''),
      ];
    } catch {
      return [null, null];
    }
  };
  const detectCrossScanDegradation = (currentRepos, previousRepos) => {
    const degraded = [];
    for (const [repoKey, repo] of Object.entries(currentRepos)) {
      const previousRepo = previousRepos[repoKey];
      if (!previousRepo) continue;
      const previousWorkflows = new Map(
        (previousRepo.workflows || []).map((workflow) => [workflow.name || '', workflow]),
      );
      for (const workflow of repo.workflows || []) {
        const previousWorkflow = previousWorkflows.get(workflow.name || '');
        if (!previousWorkflow) continue;
        const currentRate = parseSuccessRate(workflow.success_rate);
        const previousRate = parseSuccessRate(previousWorkflow.success_rate);
        if (currentRate === null || previousRate === null) continue;
        if (previousRate >= 0.6 && currentRate < previousRate - 0.25) {
          degraded.push({
            repo: repoKey,
            workflow: workflow.name || '',
            previous_rate: round(previousRate),
            current_rate: round(currentRate),
            delta: round(currentRate - previousRate),
          });
        }
      }
    }
    return degraded.sort((a, b) => a.delta - b.delta);
  };
  const computeAdoptionVelocity = (currentRepos, previousRepos) => {
    const currentRepoNames = Object.keys(currentRepos);
    const previousRepoNames = Object.keys(previousRepos);
    const currentRepoSet = new Set(currentRepoNames);
    const previousRepoSet = new Set(previousRepoNames);
    const newRepos = currentRepoNames.filter((name) => !previousRepoSet.has(name)).sort();
    const removedRepos = previousRepoNames.filter((name) => !currentRepoSet.has(name)).sort();
    const newWorkflows = [];
    const disappearedWorkflows = [];

    for (const repoKey of currentRepoNames.filter((name) => previousRepoSet.has(name))) {
      const previousNames = new Set((previousRepos[repoKey].workflows || []).map((workflow) => workflow.name || ''));
      const currentNames = new Set((currentRepos[repoKey].workflows || []).map((workflow) => workflow.name || ''));
      for (const workflow of currentNames) {
        if (!previousNames.has(workflow)) newWorkflows.push({ repo: repoKey, workflow });
      }
      for (const workflow of previousNames) {
        if (!currentNames.has(workflow)) disappearedWorkflows.push({ repo: repoKey, workflow });
      }
    }
    return {
      new_repos: newRepos,
      removed_repos: removedRepos,
      new_repos_count: newRepos.length,
      removed_repos_count: removedRepos.length,
      new_workflows: newWorkflows,
      disappeared_workflows: disappearedWorkflows,
      new_workflows_count: newWorkflows.length,
      disappeared_workflows_count: disappearedWorkflows.length,
    };
  };
  const computeTemporalTrends = () => {
    const snapshots = historyFiles();
    if (snapshots.length < 2) return null;
    const timeline = [];
    for (const filename of snapshots) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(historyDir, filename), 'utf8'));
        const repos = Object.values(data);
        timeline.push({
          timestamp: filename.replace(/^scan-/, '').replace(/\.json$/, ''),
          repos: repos.length,
          workflows: repos.reduce((total, repo) => total + (repo.workflows || []).length, 0),
        });
      } catch {
        // Ignore invalid historical snapshots.
      }
    }
    if (timeline.length < 2) return null;
    const latest = timeline.at(-1);
    const previous = timeline.at(-2);
    const repoGrowth = latest.repos - previous.repos;
    const workflowGrowth = latest.workflows - previous.workflows;
    return {
      snapshots_available: timeline.length,
      latest,
      previous,
      repo_growth: repoGrowth,
      repo_growth_pct: previous.repos > 0 ? round(repoGrowth / previous.repos * 100, 1) : 0,
      workflow_growth: workflowGrowth,
      workflow_growth_pct: previous.workflows > 0 ? round(workflowGrowth / previous.workflows * 100, 1) : 0,
      timeline,
    };
  };
  const buildWhatChangedSummary = (adoption, crossScanDegraded, temporal) => {
    const lines = [];
    if (adoption) {
      if (adoption.new_repos_count) {
        lines.push(`📈 ${adoption.new_repos_count} new repo(s) adopted agentic workflows`);
        lines.push(...adoption.new_repos.slice(0, 5).map((repo) => `   + ${repo}`));
      }
      if (adoption.removed_repos_count) lines.push(`📉 ${adoption.removed_repos_count} repo(s) removed`);
      if (adoption.new_workflows_count) lines.push(`🆕 ${adoption.new_workflows_count} new workflow(s) added in existing repos`);
      if (adoption.disappeared_workflows_count) lines.push(`🗑️  ${adoption.disappeared_workflows_count} workflow(s) disappeared`);
    }
    if (temporal) {
      const signed = (value, digits = 0) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
      lines.push(`📊 Repo growth: ${signed(temporal.repo_growth)} (${signed(temporal.repo_growth_pct, 1)}%)`);
      lines.push(`📊 Workflow growth: ${signed(temporal.workflow_growth)} (${signed(temporal.workflow_growth_pct, 1)}%)`);
    }
    if (crossScanDegraded.length) {
      lines.push(`⚠️  ${crossScanDegraded.length} workflow(s) degraded since last scan:`);
      lines.push(...crossScanDegraded.slice(0, 5).map(
        (item) => `   ${item.repo}/${item.workflow}: ${(item.previous_rate * 100).toFixed(0)}% → ${(item.current_rate * 100).toFixed(0)}%`,
      ));
    }
    return lines.length ? lines : ['No previous scan data available for comparison.'];
  };

  console.log('═'.repeat(60));
  console.log('  Deep Research: Statistical Analysis');
  console.log('═'.repeat(60));
  if (!fs.existsSync(scanData)) {
    throw new Error(`${scanData} not found. Run scan.sh first.`);
  }

  const scan = JSON.parse(fs.readFileSync(scanData, 'utf8'));
  const repos = scan.repos || {};
  const metadata = scan.metadata || {};
  console.log(`\n  Dataset: ${metadata.total_repos ?? Object.keys(repos).length} repos, ${metadata.total_workflows ?? '?'} workflows`);

  const allWorkflows = [];
  for (const [repoKey, repo] of Object.entries(repos)) {
    for (const workflow of repo.workflows || []) {
      allWorkflows.push({
        ...workflow,
        _repo: repoKey,
        _stars: repo.stars || 0,
        _status: repo.status || 'unknown',
      });
    }
  }
  console.log(`  Flattened: ${allWorkflows.length} workflow entries`);

  console.log('\n  [0/10] Loading previous scan data...');
  const [previousScan, previousScanTimestamp] = loadPreviousScan();
  console.log(previousScan
    ? `    Previous scan found: ${previousScanTimestamp}`
    : '    No previous scan available for comparison');

  console.log('\n  [1/10] Trigger combo analysis...');
  const comboStats = new Map();
  for (const workflow of allWorkflows) {
    const triggers = [...new Set(workflow.triggers || [])].sort();
    if (!triggers.length) continue;
    const key = triggers.join('+');
    if (!comboStats.has(key)) comboStats.set(key, { successes: 0, total: 0, repos: new Set() });
    const stats = comboStats.get(key);
    const runs = workflow.recent_runs_detail || [];
    if (runs.length) {
      for (const run of runs) {
        stats.total += 1;
        if (run.conclusion === 'success') stats.successes += 1;
        stats.repos.add(workflow._repo);
      }
    } else if (parseSuccessRate(workflow.success_rate) !== null) {
      const [successes, total] = workflow.success_rate.split('/').map(Number);
      stats.successes += successes;
      stats.total += total;
      stats.repos.add(workflow._repo);
    }
  }
  const triggerCombos = sortedEntries(comboStats, ([, a], [, b]) => b.total - a.total)
    .map(([combo, stats]) => {
      const rate = stats.total > 0 ? stats.successes / stats.total : 0;
      return {
        combo,
        success_rate: round(rate),
        successes: stats.successes,
        total_runs: stats.total,
        n_workflows: stats.repos.size,
        risk: rate < 0.3 ? 'high' : rate < 0.6 ? 'medium' : 'low',
      };
    })
    .sort((a, b) => b.total_runs - a.total_runs);
  console.log(`    Found ${triggerCombos.length} unique trigger combinations`);

  console.log('  [2/10] Archetype health...');
  const archetypeStats = new Map();
  for (const workflow of allWorkflows) {
    const archetype = classifyWorkflow(workflow);
    if (!archetypeStats.has(archetype)) {
      archetypeStats.set(archetype, { successes: 0, total: 0, workflows: 0, repos: new Set() });
    }
    const stats = archetypeStats.get(archetype);
    stats.workflows += 1;
    stats.repos.add(workflow._repo);
    const runs = workflow.recent_runs_detail || [];
    if (runs.length) {
      for (const run of runs) {
        stats.total += 1;
        if (run.conclusion === 'success') stats.successes += 1;
      }
    } else if (parseSuccessRate(workflow.success_rate) !== null) {
      const [successes, total] = workflow.success_rate.split('/').map(Number);
      stats.successes += successes;
      stats.total += total;
    }
  }
  const currentPatterns = new Map();
  if (fs.existsSync(patternsFile)) {
    const patterns = JSON.parse(fs.readFileSync(patternsFile, 'utf8'));
    for (const archetype of patterns.archetypes || []) {
      currentPatterns.set(archetype.id, archetype.success_rate || 0);
    }
  }
  const archetypeHealth = sortedEntries(archetypeStats, ([a], [b]) => a.localeCompare(b))
    .map(([id, stats]) => {
      const computed = stats.total > 0 ? round(stats.successes / stats.total) : 0;
      const current = currentPatterns.get(id) || 0;
      const delta = round(computed - current);
      return {
        id,
        current_rate: current,
        computed_rate: computed,
        delta,
        n_runs: stats.total,
        n_workflows: stats.workflows,
        n_repos: stats.repos.size,
        significant_change: Math.abs(delta) >= 0.05,
      };
    });
  console.log(`    ${archetypeHealth.length} archetypes analyzed`);

  console.log('  [3/10] Engine analysis...');
  const engineStats = new Map();
  for (const workflow of allWorkflows) {
    const engine = workflow.engine || 'default';
    if (!engineStats.has(engine)) engineStats.set(engine, { successes: 0, total: 0, workflows: 0 });
    const stats = engineStats.get(engine);
    stats.workflows += 1;
    for (const run of workflow.recent_runs_detail || []) {
      stats.total += 1;
      if (run.conclusion === 'success') stats.successes += 1;
    }
  }
  const engineAnalysis = sortedEntries(engineStats, ([, a], [, b]) => b.total - a.total)
    .map(([engine, stats]) => ({
      engine,
      success_rate: stats.total > 0 ? round(stats.successes / stats.total) : 0,
      total_runs: stats.total,
      n_workflows: stats.workflows,
    }));
  console.log(`    ${engineAnalysis.length} engines found`);

  console.log('  [4/10] Prompt feature correlation...');
  const featureStats = new Map();
  for (const workflow of allWorkflows) {
    const runs = workflow.recent_runs_detail || [];
    if (!runs.length) continue;
    const successes = runs.filter((run) => run.conclusion === 'success').length;
    const features = {
      has_pre_steps: workflow.has_pre_steps || false,
      has_workflow_dispatch: (workflow.triggers || []).includes('workflow_dispatch'),
      has_schedule: (workflow.triggers || []).includes('schedule'),
      has_tools: Boolean(workflow.tools),
      has_safe_outputs: Boolean(workflow.safe_outputs),
      source_available: workflow.source_available || false,
    };
    for (const [feature, present] of Object.entries(features)) {
      if (!featureStats.has(feature)) featureStats.set(feature, { with: { s: 0, t: 0 }, without: { s: 0, t: 0 } });
      const bucket = featureStats.get(feature)[present ? 'with' : 'without'];
      bucket.s += successes;
      bucket.t += runs.length;
    }
  }
  const featureCorrelation = [...featureStats.entries()].map(([feature, stats]) => {
    const withRate = stats.with.t > 0 ? stats.with.s / stats.with.t : 0;
    const withoutRate = stats.without.t > 0 ? stats.without.s / stats.without.t : 0;
    const delta = round(withRate - withoutRate);
    return {
      feature,
      with_rate: round(withRate),
      with_n: stats.with.t,
      without_rate: round(withoutRate),
      without_n: stats.without.t,
      delta,
      significant: Math.abs(delta) >= 0.1 && Math.min(stats.with.t, stats.without.t) >= 10,
    };
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  console.log(`    ${featureCorrelation.length} features analyzed`);

  console.log('  [5/10] Degradation detection...');
  const degraded = [];
  for (const workflow of allWorkflows) {
    const runs = workflow.recent_runs_detail || [];
    if (runs.length < 4) continue;
    const midpoint = Math.floor(runs.length / 2);
    const recent = runs.slice(0, midpoint);
    const older = runs.slice(midpoint);
    const recentRate = recent.filter((run) => run.conclusion === 'success').length / recent.length;
    const olderRate = older.filter((run) => run.conclusion === 'success').length / older.length;
    if (olderRate >= 0.7 && recentRate <= 0.3) {
      degraded.push({
        repo: workflow._repo,
        workflow: workflow.name || 'unknown',
        older_rate: round(olderRate, 2),
        recent_rate: round(recentRate, 2),
        runs_analyzed: runs.length,
      });
    }
  }
  degraded.sort((a, b) => a.recent_rate - b.recent_rate);
  console.log(`    ${degraded.length} degraded workflows found`);

  console.log('  [6/10] New pattern discovery...');
  const nameCounts = new Map();
  const nameSuccess = new Map();
  for (const workflow of allWorkflows) {
    let name = (workflow.name || '').toLowerCase().trim();
    if (name.length < 3) continue;
    name = name.replace(/[-_](agent|bot|workflow|auto)$/, '');
    increment(nameCounts, name);
    if (!nameSuccess.has(name)) nameSuccess.set(name, { s: 0, t: 0, repos: new Set() });
    const stats = nameSuccess.get(name);
    for (const run of workflow.recent_runs_detail || []) {
      stats.t += 1;
      if (run.conclusion === 'success') stats.s += 1;
    }
    stats.repos.add(workflow._repo);
  }
  const newPatterns = sortedEntries(nameCounts, ([, countA], [, countB]) => countB - countA)
    .slice(0, 50)
    .flatMap(([name]) => {
      const stats = nameSuccess.get(name);
      if (stats.repos.size < 3 || stats.t < 5) return [];
      return [{
        name,
        current_archetype: classifyWorkflow({ name, file: '' }),
        repos_seen: stats.repos.size,
        total_runs: stats.t,
        success_rate: round(stats.s / stats.t),
      }];
    })
    .sort((a, b) => b.repos_seen - a.repos_seen);
  console.log(`    ${newPatterns.length} named patterns found across 3+ repos`);

  console.log('  [7/10] Failure log analysis (fetching logs)...');
  const failureCategories = new Map();
  const failureByArchetype = new Map();
  const logSamples = new Map();
  const failedRuns = allWorkflows.flatMap((workflow) =>
    (workflow.recent_runs_detail || [])
      .filter((run) => run.conclusion === 'failure')
      .map((run) => ({
        repo: workflow._repo,
        run_id: run.id,
        workflow: workflow.name || 'unknown',
        archetype: classifyWorkflow(workflow),
      })));
  const processedRepos = new Set();
  let logsFetched = 0;
  console.log(`    ${failedRuns.length} failed runs to analyze...`);
  for (const failedRun of failedRuns) {
    if (processedRepos.size >= maxLogRepos) break;
    processedRepos.add(failedRun.repo);
    const logText = await fetchFailedLogs(failedRun.repo, failedRun.run_id);
    const categories = categorizeLog(logText);
    if (!failureByArchetype.has(failedRun.archetype)) failureByArchetype.set(failedRun.archetype, new Map());
    for (const category of categories) {
      increment(failureCategories, category);
      increment(failureByArchetype.get(failedRun.archetype), category);
    }
    const primary = categories[0];
    if (logText) {
      if (!logSamples.has(primary)) logSamples.set(primary, []);
      if (logSamples.get(primary).length < 3) {
        logSamples.get(primary).push({
          repo: failedRun.repo,
          workflow: failedRun.workflow,
          snippet: logText.slice(-500),
        });
      }
    }
    logsFetched += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  console.log(`    Fetched ${logsFetched} logs from ${processedRepos.size} repos`);

  const totalFailures = [...failureCategories.values()].reduce((total, count) => total + count, 0);
  const categoryEntries = sortedEntries(failureCategories, ([, a], [, b]) => b - a);
  const failureAnalysis = {
    total_failures: totalFailures,
    categories: Object.fromEntries(categoryEntries.map(([category, count]) => [
      category,
      { count, pct: totalFailures > 0 ? round(count / totalFailures) : 0 },
    ])),
    by_archetype: Object.fromEntries([...failureByArchetype.entries()].map(([archetype, categories]) => [
      archetype,
      Object.fromEntries(sortedEntries(categories, ([, a], [, b]) => b - a)),
    ])),
    log_samples: Object.fromEntries(logSamples),
  };
  console.log(`    Failure categories: ${JSON.stringify(Object.fromEntries(categoryEntries))}`);

  console.log('  [8/10] Cross-scan degradation & adoption velocity...');
  const crossScanDegraded = previousScan ? detectCrossScanDegradation(repos, previousScan) : [];
  const adoption = previousScan ? computeAdoptionVelocity(repos, previousScan) : null;
  if (previousScan) {
    console.log(`    Cross-scan degraded: ${crossScanDegraded.length} workflows`);
    console.log(`    New repos: ${adoption.new_repos_count}, removed: ${adoption.removed_repos_count}, new workflows: ${adoption.new_workflows_count}, disappeared: ${adoption.disappeared_workflows_count}`);
  } else {
    console.log('    Skipped (no previous scan)');
  }

  console.log('  [9/10] Temporal trends...');
  const temporal = computeTemporalTrends();
  if (temporal) {
    console.log(`    ${temporal.snapshots_available} snapshots, repo growth: ${temporal.repo_growth}, workflow growth: ${temporal.workflow_growth}`);
  } else {
    console.log('    Skipped (insufficient history)');
  }

  console.log('  [10/10] Generating recommendations...');
  const recommendations = [];
  for (const combo of triggerCombos) {
    if (combo.total_runs >= 10 && combo.success_rate < 0.2) {
      recommendations.push({
        type: 'warn_trigger',
        message: `Trigger combo '${combo.combo}' has ${(combo.success_rate * 100).toFixed(0)}% success rate across ${combo.total_runs} runs — consider adding to anti-patterns`,
        data: combo,
      });
    }
  }
  for (const archetype of archetypeHealth) {
    if (archetype.significant_change) {
      recommendations.push({
        type: 'archetype_drift',
        message: `Archetype '${archetype.id}' has ${archetype.delta > 0 ? 'improved' : 'degraded'}: ${(archetype.current_rate * 100).toFixed(0)}% → ${(archetype.computed_rate * 100).toFixed(0)}% (Δ${archetype.delta >= 0 ? '+' : ''}${(archetype.delta * 100).toFixed(1)}pp, n=${archetype.n_runs})`,
        data: archetype,
      });
    }
  }
  for (const feature of featureCorrelation) {
    if (feature.significant) {
      recommendations.push({
        type: 'feature_correlation',
        message: `Feature '${feature.feature}' ${feature.delta > 0 ? 'improves' : 'hurts'} success rate by ${(Math.abs(feature.delta) * 100).toFixed(1)}pp (${(feature.with_rate * 100).toFixed(0)}% vs ${(feature.without_rate * 100).toFixed(0)}%)`,
        data: feature,
      });
    }
  }
  for (const item of degraded) {
    recommendations.push({
      type: 'degradation',
      message: `Workflow '${item.workflow}' in ${item.repo} degraded from ${(item.older_rate * 100).toFixed(0)}% to ${(item.recent_rate * 100).toFixed(0)}%`,
      data: item,
    });
  }
  for (const item of crossScanDegraded) {
    recommendations.push({
      type: 'cross_scan_degradation',
      message: `Workflow '${item.workflow}' in ${item.repo} degraded since last scan: ${(item.previous_rate * 100).toFixed(0)}% → ${(item.current_rate * 100).toFixed(0)}%`,
      data: item,
    });
  }
  console.log(`    ${recommendations.length} recommendations generated`);

  const whatChanged = buildWhatChangedSummary(adoption, crossScanDegraded, temporal);
  whatChanged.forEach((line) => console.log(`    ${line}`));
  const report = {
    generated_at: new Date().toISOString(),
    dataset: {
      repos: Object.keys(repos).length,
      workflows: allWorkflows.length,
      with_runs: allWorkflows.filter((workflow) => (workflow.recent_runs_detail || []).length).length,
      total_runs_analyzed: allWorkflows.reduce(
        (total, workflow) => total + (workflow.recent_runs_detail || []).length,
        0,
      ),
    },
    trigger_analysis: { combos: triggerCombos.slice(0, 30) },
    archetype_health: archetypeHealth,
    engine_analysis: engineAnalysis,
    feature_correlation: featureCorrelation,
    failure_analysis: failureAnalysis,
    degraded_workflows: degraded.slice(0, 20),
    new_patterns: newPatterns.slice(0, 20),
    cross_scan_degradation: crossScanDegraded.slice(0, 20),
    adoption_velocity: adoption,
    temporal_trends: temporal,
    what_changed_this_week: whatChanged,
    recommendations,
  };
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n  Analysis report written to ${reportFile}`);
  console.log(`     ${triggerCombos.length} trigger combos, ${archetypeHealth.length} archetypes, ${recommendations.length} recommendations`);
  console.log('═'.repeat(60));
};

---
name: "🔬 Deep Research"
description: Analyze agentic workflow trends and open PRs to improve the pattern library
engine: copilot
on:
  schedule: daily
  skip-if-match: 'is:pr is:open in:title "Pattern library update"'
permissions:
  contents: read
  copilot-requests: write
safe-outputs:
  create-pull-request:
strict: true
timeout-minutes: 30
steps:
  - name: Run scan
    uses: actions/github-script@v9
    with:
      script: |
        await exec.exec('./scripts/scan.sh', ['--active-only', '--run-history']);
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  - name: Rebuild patterns.json
    uses: actions/github-script@v9
    with:
      script: |
        const script = String.raw`
        import json
        from collections import Counter, defaultdict
        from datetime import datetime, timezone

        with open("data/scan-results.json") as f:
            data = json.load(f)

        metadata = data.get("metadata", {})
        repos = data.get("repos", {})

        # Collect all workflows with their repo context
        workflows = []
        for repo_key, repo in repos.items():
            for wf in repo.get("workflows", []):
                wf["_repo"] = repo_key
                wf["_stars"] = repo.get("stars", 0)
                workflows.append(wf)

        # Parse success rate from "N/M" string
        def parse_sr(sr_str):
            if not sr_str or sr_str == "0/0":
                return None
            try:
                parts = sr_str.split("/")
                num, den = int(parts[0]), int(parts[1])
                return num / den if den > 0 else None
            except Exception:
                return None

        # Classify workflows into archetypes
        def classify(wf):
            name = (wf.get("name", "") + " " + wf.get("file", "")).lower()
            if "triage" in name or "label" in name:
                return ("issue-triage", "Issue Triage", "Classify and label new issues")
            if "upstream" in name or "sync" in name or "monitor" in name:
                return ("upstream-monitor", "Upstream Monitor", "Track upstream dependencies and sync changes")
            if "doc" in name and ("updat" in name or "improv" in name or "generat" in name or "clean" in name):
                return ("documentation-updater", "Documentation Updater", "Keep docs accurate and up-to-date")
            if "review" in name or "pr-review" in name or "pr-check" in name:
                return ("pr-review", "PR Review", "Review pull requests for quality and issues")
            if "fix" in name or "doctor" in name or "ci" in name or "code" in name:
                return ("code-improvement", "Code Improvement", "Diagnose and fix code or CI issues")
            if "report" in name or "summary" in name or "weekly" in name or "status" in name:
                return ("status-report", "Status Report", "Generate periodic status summaries")
            if "depend" in name or "update" in name or "renovate" in name:
                return ("dependency-monitor", "Dependency Monitor", "Track and update dependencies")
            if "moderat" in name or "content" in name:
                return ("content-moderation", "Content Moderation", "Review content for quality or policy")
            return ("custom", "Custom", "Custom or uncategorized workflow")

        # Aggregate by archetype
        arch_data = defaultdict(lambda: {
            "workflows": [], "success_rates": [], "triggers": Counter(),
            "repos": [], "tips": set(), "anti_patterns": []
        })

        for wf in workflows:
            arch_id, label, desc = classify(wf)
            ad = arch_data[arch_id]
            ad["label"] = label
            ad["description"] = desc
            ad["workflows"].append(wf)
            sr = parse_sr(wf.get("success_rate"))
            if sr is not None:
                ad["success_rates"].append(sr)
            for t in wf.get("triggers", []):
                ad["triggers"][t] += 1
            ad["repos"].append((wf["_repo"], wf["_stars"]))

        # Build archetypes list
        archetypes = []
        for arch_id, ad in sorted(arch_data.items(), key=lambda x: -len(x[1]["workflows"])):
            rates = ad["success_rates"]
            avg_sr = round(sum(rates) / len(rates), 2) if rates else 0.0

            # Top triggers
            top_triggers = []
            for t, _ in ad["triggers"].most_common(3):
                top_triggers.append({"type": t, "config": {}})

            # Top repos by stars
            top_repos = sorted(set(ad["repos"]), key=lambda x: -x[1])[:5]
            top_repos = [{"repo": r, "stars": s} for r, s in top_repos]

            # Anti-patterns: workflows with very low success rates
            for wf in ad["workflows"]:
                sr = parse_sr(wf.get("success_rate"))
                if sr is not None and sr < 0.1 and wf.get("name"):
                    ad["anti_patterns"].append({
                        "pattern": wf["name"],
                        "success_rate": round(sr, 3),
                        "repo": wf["_repo"]
                    })

            # Data-driven tips and config per archetype
            archetype_config = {
                "issue-triage": {
                    "safe_outputs": ["issues"],
                    "tools": ["add-comment", "add-label"],
                    "prompt_style": "role-steps",
                    "size_range": [3000, 7000],
                    "tips": [
                        "Add workflow_dispatch as a fallback trigger — adds ~21pp to success rate",
                        "Include explicit label taxonomy in your prompt so the agent knows valid options",
                        "Use DO NOT constraints (e.g., 'Do NOT close issues') — 61% more likely to be healthy",
                    ],
                },
                "code-improvement": {
                    "safe_outputs": ["pull-requests", "contents"],
                    "tools": ["create-pull-request", "commit-files"],
                    "prompt_style": "phase-based",
                    "size_range": [5000, 12000],
                    "tips": [
                        "Use schedule+workflow_dispatch triggers (80% success rate)",
                        "Add pre-steps to run tests/linters before the agent starts — validates baseline",
                        "Avoid pr-fix and ci-doctor templates — both have <20% success in practice",
                    ],
                },
                "status-report": {
                    "safe_outputs": ["issues"],
                    "tools": ["create-issue"],
                    "prompt_style": "template-driven",
                    "size_range": [2000, 5000],
                    "tips": [
                        "Pre-fetch data in a steps: block — #1 predictor of workflow health",
                        "Use schedule+workflow_dispatch triggers (80% success rate)",
                        "Keep prompts focused on one report — multi-source reports need pre-steps",
                    ],
                },
                "dependency-monitor": {
                    "safe_outputs": ["issues", "pull-requests"],
                    "tools": ["create-issue", "create-pull-request"],
                    "prompt_style": "checklist",
                    "size_range": [3000, 6000],
                    "tips": [
                        "Use schedule+workflow_dispatch triggers for reliable periodic checks",
                        "Include a checklist of specific dependencies to monitor — don't leave it open-ended",
                        "Enable network access for fetching upstream release data",
                    ],
                },
                "content-moderation": {
                    "safe_outputs": ["issues", "pull-requests"],
                    "tools": ["add-comment", "add-label"],
                    "prompt_style": "role-rules",
                    "size_range": [4000, 7000],
                    "tips": [
                        "Never auto-close or lock — label and comment only",
                        "Include explicit rules for what IS legitimate to reduce false positives",
                        "Use DO NOT constraints for actions the agent should never take",
                    ],
                },
                "upstream-monitor": {
                    "safe_outputs": ["issues"],
                    "tools": ["create-issue"],
                    "prompt_style": "checklist",
                    "size_range": [3000, 6000],
                    "tips": [
                        "98% success rate across public repos — most reliable archetype",
                        "List specific upstream repos/packages to track in the prompt",
                        "Enable network access to fetch upstream release data",
                    ],
                },
                "documentation-updater": {
                    "safe_outputs": ["pull-requests", "contents"],
                    "tools": ["create-pull-request", "commit-files"],
                    "prompt_style": "phase-based",
                    "size_range": [3000, 7000],
                    "tips": [
                        "80% success rate — reliable when scoped to specific doc areas",
                        "Add pre-steps to validate docs build before the agent starts",
                        "Use DO NOT constraints to prevent deleting existing content",
                    ],
                },
                "pr-review": {
                    "safe_outputs": ["pull-requests"],
                    "tools": ["add-comment"],
                    "prompt_style": "role-rules",
                    "size_range": [3000, 7000],
                    "tips": [
                        "Focus on specific review criteria (security, performance, style)",
                        "Use pull_request+workflow_dispatch triggers for flexibility",
                        "Include DO NOT constraints to avoid false positive comments",
                    ],
                },
                "custom": {
                    "safe_outputs": [],
                    "tools": [],
                    "prompt_style": "role-steps",
                    "size_range": [3000, 8000],
                    "tips": [
                        "Add workflow_dispatch as a trigger — adds ~21pp to success rate",
                        "Prompts between 3-8KB perform best — too short lacks context, too long has diminishing returns",
                        "Use DO NOT constraints to bound agent behavior — 61% more likely to be healthy",
                    ],
                },
            }

            archetypes.append({
                "id": arch_id,
                "label": ad["label"],
                "description": ad["description"],
                "success_rate": avg_sr,
                "count": len(ad["workflows"]),
                "recommended_triggers": top_triggers,
                "recommended_safe_outputs": archetype_config.get(arch_id, {}).get("safe_outputs", []),
                "recommended_tools": archetype_config.get(arch_id, {}).get("tools", []),
                "timeout_minutes": 30 if "schedule" in ad["triggers"] else 15,
                "prompt_style": archetype_config.get(arch_id, {}).get("prompt_style"),
                "size_range_bytes": archetype_config.get(arch_id, {}).get("size_range"),
                "top_repos": top_repos,
                "tips": archetype_config.get(arch_id, {}).get("tips", []),
                "anti_patterns": [ap["pattern"] if isinstance(ap, dict) else ap for ap in ad["anti_patterns"][:5]]
            })

        # Global anti-patterns: lowest success rate workflows
        all_anti = []
        for wf in workflows:
            sr = parse_sr(wf.get("success_rate"))
            if sr is not None and sr < 0.05 and wf.get("name"):
                all_anti.append({
                    "pattern": wf["name"],
                    "success_rate": round(sr, 3),
                    "repos_seen": 1,
                    "reason": f"Very low success rate in {wf['_repo']}"
                })
        all_anti.sort(key=lambda x: x["success_rate"])

        # Compute trigger combo success rates
        combo_stats = defaultdict(lambda: {"s": 0, "t": 0})
        for wf in workflows:
            triggers = sorted(set(wf.get("triggers", [])))
            if not triggers: continue
            combo_key = "+".join(triggers)
            for run in wf.get("recent_runs_detail", []):
                combo_stats[combo_key]["t"] += 1
                if run.get("conclusion") == "success":
                    combo_stats[combo_key]["s"] += 1
            if not wf.get("recent_runs_detail"):
                sr_str = wf.get("success_rate", "0/0")
                parts = sr_str.split("/")
                if len(parts) == 2:
                    combo_stats[combo_key]["s"] += int(parts[0])
                    combo_stats[combo_key]["t"] += int(parts[1])

        trigger_combos = []
        for combo, stats in sorted(combo_stats.items(), key=lambda x: -x[1]["t"]):
            if stats["t"] >= 10:
                rate = stats["s"] / stats["t"]
                risk = "high" if rate < 0.3 else ("medium" if rate < 0.6 else "low")
                rec = "Avoid" if risk == "high" else ("Use with caution" if risk == "medium" else "Recommended")
                trigger_combos.append({
                    "combo": combo, "success_rate": round(rate, 2),
                    "count": stats["t"], "risk": risk, "recommendation": rec
                })
        trigger_combos.sort(key=lambda x: -x["success_rate"])

        # Build output
        output = {
            "metadata": {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "source_repos": metadata.get("total_repos", len(repos)),
                "active_workflows": metadata.get("active_repos", 0),
                "total_workflows": metadata.get("total_workflows", len(workflows))
            },
            "archetypes": archetypes,
            "anti_patterns": all_anti[:20],
            "config_defaults": {
                "model": None,
                "timeout_by_trigger": {
                    "issues": 15,
                    "schedule": 30,
                    "workflow_dispatch": 30,
                    "push": 15,
                    "slash_command": 15,
                    "workflow_run": 15,
                    "discussion": 15,
                    "pull_request": 15
                },
                "prompt_size_sweet_spot": [3000, 8000]
            },
            "trigger_combos": trigger_combos[:15],
            "research_findings": {
                "bimodal_distribution": "38% of workflows always succeed, 21% always fail, 41% are mixed. The average hides this.",
                "do_not_constraints": "Workflows with explicit DO NOT instructions are 61% more likely to be healthy (p=0.009).",
                "slash_command_broken": "slash_command triggers have 0-2% success rate across all combos. Avoid until platform stabilizes.",
                "workflow_run_risky": "workflow_run chaining has 13-16% success rate. Use pre-steps or schedule instead.",
                "pre_steps_help": "Workflows with pre-steps are more likely to be active (+13pp internal, +5pp community).",
                "prompt_size_matters": "Active workflows have 35-48% larger prompts. More detail = better outcomes.",
                "template_clones_fragile": "32% of workflows are template copies. Copied templates have lower success than customized ones."
            },
            "degraded_workflows": []
        }

        with open("patterns.json", "w") as f:
            json.dump(output, f, indent=2)
            f.write("\n")

        print(f"Built patterns.json: {len(archetypes)} archetypes, {len(all_anti[:20])} anti-patterns")
        `;
        await exec.exec('python3', ['-c', script]);

  - name: Run statistical analysis
    uses: actions/github-script@v9
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      ANALYSIS_SCRIPT: |
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

      ANALYSIS_SCRIPT_2: |
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
    with:
      script: await eval(`(async () => {\n${process.env.ANALYSIS_SCRIPT}\n${process.env.ANALYSIS_SCRIPT_2}\n})()`)
---

# Deep Research Agent

You are a **data analyst** specializing in GitHub Copilot agentic workflows.

Your job is to read the statistical analysis report, compare it with the current pattern library, and open a pull request with improvements when the data supports changes.

## Context

This repository contains a prompt generator for agentic workflows. It uses `patterns.json` as its knowledge base — a file that defines archetypes (types of workflows), their success rates, recommended configurations, tips, and anti-patterns.

The workflow first runs `scripts/scan.sh --active-only --run-history` to collect data from real public repositories, then rebuilds `patterns.json`, and then produces `data/analysis-report.json` with fresh statistics.

## Instructions

### Step 1: Read the data

1. Read `data/scan-results.json` — this is the fresh scan output
2. Read `data/analysis-report.json` — this is the statistical analysis output
3. Read `patterns.json` — this is the current pattern library rebuilt from the scan
4. Understand what changed: look at the `recommendations` array in the report

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
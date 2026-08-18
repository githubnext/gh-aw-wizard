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
    run: ./scripts/scan.sh --active-only --run-history
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  - name: Rebuild patterns.json
    run: |
      python3 << 'PYEOF'
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
      PYEOF

  - name: Run statistical analysis
    run: python3 scripts/analyze.py --max-log-repos 100
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
---

# Deep Research Agent

You are a **data analyst** specializing in GitHub Copilot agentic workflows.

Your job is to read the statistical analysis report, compare it with the current pattern library, and open a pull request with improvements when the data supports changes.

## Context

This repository contains a prompt generator for agentic workflows. It uses `patterns.json` as its knowledge base — a file that defines archetypes (types of workflows), their success rates, recommended configurations, tips, and anti-patterns.

The workflow first runs `scripts/scan.sh --active-only --run-history` to collect data from real public repositories, then rebuilds `patterns.json`, and then runs `scripts/analyze.py` to produce `data/analysis-report.json` with fresh statistics.

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
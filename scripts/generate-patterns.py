#!/usr/bin/env python3
"""Build the patterns/ directory deterministically from data/scan-results.json.

Pattern data is split into one file per archetype (patterns/archetypes/<id>.json)
plus a manifest (patterns/manifest.json) so the library can be versioned and
reviewed one archetype at a time instead of as a single monolithic JSON blob.
"""

import json
from collections import Counter, defaultdict
from pathlib import Path


SCAN_RESULTS = Path("data/scan-results.json")
PATTERNS_DIR = Path("patterns")
ARCHETYPES_DIR = PATTERNS_DIR / "archetypes"
MANIFEST = PATTERNS_DIR / "manifest.json"

CURATED_FIELDS = (
    "label",
    "description",
    "recommended_safe_outputs",
    "recommended_tools",
    "prompt_style",
    "size_range_bytes",
    "tips",
)
CURATED_REQUIRED_FIELDS = (*CURATED_FIELDS, "recommended_triggers")


def load_curated_archetypes():
    paths_by_id = {
        path.stem: path
        for path in ARCHETYPES_DIR.glob("*.json")
    }
    ordered_ids = []
    if MANIFEST.exists():
        manifest = json.loads(MANIFEST.read_text())
        ordered_ids.extend(manifest.get("archetypes", []))
    ordered_ids.extend(sorted(paths_by_id.keys() - set(ordered_ids)))

    curated_archetypes = {}
    for arch_id in ordered_ids:
        path = paths_by_id.get(arch_id)
        if path is None:
            continue
        archetype = json.loads(path.read_text())
        if archetype.get("success_rate") is not None:
            continue
        if archetype.get("id") != arch_id:
            raise ValueError(f"{path} must declare id {arch_id!r}")
        missing_fields = set(CURATED_REQUIRED_FIELDS) - archetype.keys()
        if missing_fields:
            raise ValueError(f"{path} is missing fields: {', '.join(sorted(missing_fields))}")
        curated_archetypes[arch_id] = archetype
    return curated_archetypes


curated_archetypes = load_curated_archetypes()


with SCAN_RESULTS.open() as f:
    data = json.load(f)

metadata = data.get("metadata", {})
repos = data.get("repos", {})

# Collect all workflows with their repo context
workflows = []
for repo_key, repo in repos.items():
    for wf in repo.get("workflows", []):
        wf["_repo"] = repo_key
        wf["_stars"] = repo.get("stars", 0)
        wf["_priority"] = repo.get("priority", False)
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


def wilson_lower(successes, total, z=1.96):
    if total == 0:
        return 0.0
    rate = successes / total
    denominator = 1 + z * z / total
    centre = rate + z * z / (2 * total)
    margin = z * ((rate * (1 - rate) / total + z * z / (4 * total * total)) ** 0.5)
    return (centre - margin) / denominator


def filtered_triggers(triggers):
    return [
        trigger for trigger in triggers
        if trigger != "workflow_dispatch"
    ]


# Classify workflows into archetypes
def classify(wf):
    name = (wf.get("name", "") + " " + wf.get("file", "")).lower()
    if "test-improver" in name or "test improver" in name:
        return ("daily-test-improver", "Daily Test Improver", "Add high-value tests and improve test quality")
    if "repo-assist" in name or "repo maintainer" in name or "repository maintainer" in name:
        return ("repo-maintainer", "Repo Maintainer", "Proactively triage, fix, and maintain a repository")
    if "linter-miner" in name or "linter miner" in name:
        return ("linter-miner", "Linter Miner", "Discover recurring defects and create custom lint rules")
    if "linter-refiner" in name or "linter refiner" in name:
        return ("linter-refiner", "Linter Refiner", "Improve lint rule accuracy, diagnostics, and performance")
    if "linter-applier" in name or "linter applier" in name:
        return ("linter-applier", "Linter Applier", "Fix a focused group of existing lint findings")
    if "skills-reviewer" in name or "skill-pr-review" in name or "ponytail-reviewer" in name:
        return ("skill-pr-reviewer", "Skill PR Reviewer", "Review pull requests with installed expert skills")
    if "triage" in name or "label" in name:
        return ("issue-triage", "Issue Triage", "Classify and label new issues")
    if "upstream" in name or "sync" in name or "monitor" in name:
        return ("dependency-monitor", "Dependency Monitor", "Track and update dependencies")
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
    "repos": [], "priority_workflows": 0, "tips": set(), "anti_patterns": []
})

for wf in workflows:
    arch_id, label, desc = classify(wf)
    ad = arch_data[arch_id]
    ad["label"] = label
    ad["description"] = desc
    ad["workflows"].append(wf)
    if wf["_priority"]:
        ad["priority_workflows"] += 1
    sr = parse_sr(wf.get("success_rate"))
    if sr is not None:
        ad["success_rates"].append(sr)
    for trigger in filtered_triggers(wf.get("triggers", [])):
        ad["triggers"][trigger] += 1
    ad["repos"].append((wf["_repo"], wf["_stars"], wf["_priority"]))

# Build archetypes list
archetypes = []
for arch_id, ad in sorted(
    arch_data.items(),
    key=lambda item: (-item[1]["priority_workflows"], -len(item[1]["workflows"]))
):
    rates = ad["success_rates"]
    avg_sr = round(sum(rates) / len(rates), 2) if rates else 0.0

    top_triggers = []
    for trigger, _ in ad["triggers"].most_common(3):
        top_triggers.append({"type": trigger, "config": {}})

    top_repos = sorted(set(ad["repos"]), key=lambda item: (-item[2], -item[1]))[:5]
    top_repos = [{"repo": repo, "stars": stars} for repo, stars, _ in top_repos]

    for wf in ad["workflows"]:
        sr = parse_sr(wf.get("success_rate"))
        if sr is not None and sr < 0.1 and wf.get("name"):
            ad["anti_patterns"].append({
                "pattern": wf["name"],
                "success_rate": round(sr, 3),
                "repo": wf["_repo"]
            })

    archetype_config = {
        "issue-triage": {
            "safe_outputs": ["issues"],
            "tools": ["add-comment", "add-labels"],
            "prompt_style": "role-steps",
            "size_range": [3000, 7000],
            "tips": [
                "Prefer event-driven triggers like issues and schedule over manual-only execution",
                "Include explicit label taxonomy in your prompt so the agent knows valid options",
                "Use DO NOT constraints (e.g., 'Do NOT close issues') — 61% more likely to be healthy",
            ],
        },
        "code-improvement": {
            "safe_outputs": ["pull-requests"],
            "tools": ["create-pull-request"],
            "prompt_style": "phase-based",
            "size_range": [5000, 12000],
            "tips": [
                "Use schedule triggers for continuous maintenance coverage",
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
                "Use schedule triggers for repeatable reporting",
                "Keep prompts focused on one report — multi-source reports need pre-steps",
            ],
        },
        "dependency-monitor": {
            "safe_outputs": ["issues", "pull-requests"],
            "tools": ["create-issue", "create-pull-request"],
            "prompt_style": "checklist",
            "size_range": [3000, 6000],
            "tips": [
                "Use schedule triggers for reliable periodic checks",
                "Include a checklist of specific dependencies to monitor — don't leave it open-ended",
                "Enable network access for fetching upstream release data",
            ],
        },
        "content-moderation": {
            "safe_outputs": ["issues", "pull-requests"],
            "tools": ["add-comment", "add-labels"],
            "prompt_style": "role-rules",
            "size_range": [4000, 7000],
            "tips": [
                "Never auto-close or lock — label and comment only",
                "Include explicit rules for what IS legitimate to reduce false positives",
                "Use DO NOT constraints for actions the agent should never take",
            ],
        },
        "documentation-updater": {
            "safe_outputs": ["pull-requests"],
            "tools": ["create-pull-request"],
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
                "Use pull_request triggers focused on ready-to-review activity",
                "Include DO NOT constraints to avoid false positive comments",
            ],
        },
        "custom": {
            "safe_outputs": [],
            "tools": [],
            "prompt_style": "role-steps",
            "size_range": [3000, 8000],
            "tips": [
                "Prefer concrete repository events or schedules over manual-only execution",
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
        "anti_patterns": [
            anti_pattern["pattern"] if isinstance(anti_pattern, dict) else anti_pattern
            for anti_pattern in ad["anti_patterns"][:5]
        ]
    })

archetypes_by_id = {archetype["id"]: archetype for archetype in archetypes}
for arch_id, curated in curated_archetypes.items():
    archetype = archetypes_by_id.get(arch_id)
    if archetype is None:
        archetype = dict(curated)
        archetypes.append(archetype)
        continue
    archetype.update({
        field: curated[field]
        for field in CURATED_FIELDS
    })
    if not archetype.get("recommended_triggers"):
        archetype["recommended_triggers"] = curated["recommended_triggers"]

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
all_anti.sort(key=lambda item: item["success_rate"])

# Compute trigger combo success rates
combo_stats = defaultdict(lambda: {"s": 0, "t": 0})
for wf in workflows:
    triggers = sorted(set(filtered_triggers(wf.get("triggers", []))))
    if not triggers:
        continue
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
for combo, stats in sorted(combo_stats.items(), key=lambda item: -item[1]["t"]):
    if stats["t"] >= 10:
        rate = stats["s"] / stats["t"]
        risk = "high" if rate < 0.3 else ("medium" if rate < 0.6 else "low")
        recommendation = "Avoid" if risk == "high" else ("Use with caution" if risk == "medium" else "Recommended")
        trigger_combos.append({
            "combo": combo, "success_rate": round(rate, 2),
            "count": stats["t"], "risk": risk, "recommendation": recommendation
        })
trigger_combos.sort(key=lambda item: -item["success_rate"])

# Rank trigger + safe-output configurations together. Requiring evidence
# across multiple workflows and repositories prevents a single template
# or unusually successful run from becoming a wizard default.
profile_stats = defaultdict(lambda: {
    "s": 0, "t": 0, "workflows": set(), "repos": set()
})
for wf in workflows:
    triggers = sorted(set(filtered_triggers(wf.get("triggers", []))))
    safe_outputs = sorted(set(wf.get("safe_outputs", [])))
    if not triggers or not safe_outputs:
        continue
    arch_id = classify(wf)[0]
    key = (arch_id, tuple(triggers), tuple(safe_outputs))
    stats = profile_stats[key]
    stats["workflows"].add(f"{wf['_repo']}/{wf.get('file', wf.get('name', ''))}")
    stats["repos"].add(wf["_repo"])
    runs = wf.get("recent_runs_detail", [])
    if runs:
        stats["t"] += len(runs)
        stats["s"] += sum(1 for run in runs if run.get("conclusion") == "success")
    else:
        sr_str = wf.get("success_rate", "0/0")
        parts = sr_str.split("/")
        if len(parts) == 2:
            stats["s"] += int(parts[0])
            stats["t"] += int(parts[1])

configuration_profiles = []
for (arch_id, triggers, safe_outputs), stats in profile_stats.items():
    n_workflows = len(stats["workflows"])
    n_repos = len(stats["repos"])
    if stats["t"] < 20 or n_workflows < 3 or n_repos < 3:
        continue
    configuration_profiles.append({
        "archetype": arch_id,
        "triggers": list(triggers),
        "safe_outputs": list(safe_outputs),
        "success_rate": round(stats["s"] / stats["t"], 3),
        "confidence_score": round(wilson_lower(stats["s"], stats["t"]), 3),
        "total_runs": stats["t"],
        "n_workflows": n_workflows,
        "n_repos": n_repos,
    })

configuration_profiles.sort(key=lambda profile: (
    profile["archetype"],
    -profile["confidence_score"],
    -profile["total_runs"],
))
ranked_profiles = []
profile_ranks = defaultdict(int)
for profile in configuration_profiles:
    profile_ranks[profile["archetype"]] += 1
    if profile_ranks[profile["archetype"]] > 3:
        continue
    profile["rank"] = profile_ranks[profile["archetype"]]
    ranked_profiles.append(profile)

output = {
    "metadata": {
        "generated_at": metadata.get("scanned_at"),
        "source_repos": metadata.get("total_repos", len(repos)),
        "active_workflows": metadata.get("active_repos", 0),
        "total_workflows": metadata.get("total_workflows", len(workflows))
    },
    "anti_patterns": all_anti[:20],
    "config_defaults": {
        "model": None,
        "timeout_by_trigger": {
            "issues": 15,
            "schedule": 30,
            "push": 15,
            "slash_command": 15,
            "workflow_run": 15,
            "discussion": 15,
            "pull_request": 15
        },
        "prompt_size_sweet_spot": [3000, 8000]
    },
    "trigger_combos": trigger_combos[:15],
    "configuration_profiles": ranked_profiles,
    "research_findings": {
        "bimodal_distribution": "38% of workflows always succeed, 21% always fail, 41% are mixed. The average hides this.",
        "do_not_constraints": "Workflows with explicit DO NOT instructions are 61% more likely to be healthy (p=0.009).",
        "slash_command_dispatcher": "slash_command triggers act as dispatchers routing to workflows via workflow_dispatch; execution metrics occur under the dispatched workflow runs.",
        "workflow_run_risky": "workflow_run chaining has 13-16% success rate. Use pre-steps or schedule instead.",
        "pre_steps_help": "Workflows with pre-steps are more likely to be active (+13pp internal, +5pp community).",
        "prompt_size_matters": "Active workflows have 35-48% larger prompts. More detail = better outcomes.",
        "template_clones_fragile": "32% of workflows are template copies. Copied templates have lower success than customized ones."
    },
    "degraded_workflows": []
}

manifest = {
    "metadata": output["metadata"],
    "archetypes": [archetype["id"] for archetype in archetypes if archetype["id"] != "custom"],
    "workflow_generation": "workflow-generation.json",
    "anti_patterns": output["anti_patterns"],
    "config_defaults": output["config_defaults"],
    "trigger_combos": output["trigger_combos"],
    "configuration_profiles": output["configuration_profiles"],
    "research_findings": output["research_findings"],
    "degraded_workflows": output["degraded_workflows"],
}
archetypes_by_file_id = {archetype["id"]: archetype for archetype in archetypes}


def load_existing_patterns():
    if not MANIFEST.exists():
        return None, {}
    try:
        existing_manifest = json.loads(MANIFEST.read_text())
    except (json.JSONDecodeError, OSError):
        return None, {}
    existing_archetypes = {}
    for arch_id in existing_manifest.get("archetypes", []):
        path = ARCHETYPES_DIR / f"{arch_id}.json"
        if not path.exists():
            continue
        try:
            existing_archetypes[arch_id] = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return existing_manifest, existing_archetypes


# Do not turn a scan timestamp refresh into a pattern-library change. Preserve
# generated_at when every generated field other than that timestamp is equal.
existing_manifest, existing_archetypes = load_existing_patterns()
if existing_manifest is not None:
    existing_manifest_without_timestamp = {
        **existing_manifest,
        "metadata": {**existing_manifest.get("metadata", {}), "generated_at": None},
    }
    manifest_without_timestamp = {
        **manifest,
        "metadata": {**manifest["metadata"], "generated_at": None},
    }
    if (
        existing_manifest_without_timestamp == manifest_without_timestamp
        and existing_archetypes == archetypes_by_file_id
    ):
        manifest["metadata"]["generated_at"] = existing_manifest.get("metadata", {}).get("generated_at")

ARCHETYPES_DIR.mkdir(parents=True, exist_ok=True)

# Remove archetype files that no longer correspond to a generated archetype.
for existing_file in ARCHETYPES_DIR.glob("*.json"):
    if existing_file.stem not in archetypes_by_file_id:
        existing_file.unlink()

with MANIFEST.open("w") as f:
    json.dump(manifest, f, indent=2)
    f.write("\n")

for archetype in archetypes:
    path = ARCHETYPES_DIR / f"{archetype['id']}.json"
    with path.open("w") as f:
        json.dump(archetype, f, indent=2)
        f.write("\n")

print(f"Built patterns/manifest.json + {len(archetypes)} archetype files, {len(all_anti[:20])} anti-patterns")

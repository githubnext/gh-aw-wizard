#!/usr/bin/env bash
# scan.sh — 4-step discovery pipeline for GitHub Agentic Workflows
#
# Usage:
#   ./scripts/scan.sh                          # Steps 1-3 (discover + verify + analyze)
#   ./scripts/scan.sh --active-only            # Only keep workflows with recent runs (default)
#   ./scripts/scan.sh --active-only --run-history  # Also fetch last 10 runs per workflow
#   ./scripts/scan.sh --cutoff-days 90         # Custom activity window (default: 90)
#   ./scripts/scan.sh --no-verify              # Skip activity check (step 1 + 3 only)
#
# Output: data/scan-results.json
#
# Requires: gh CLI (authenticated), python3, jq

set -euo pipefail

ACTIVE_ONLY=true
RUN_HISTORY=false
CUTOFF_DAYS=90
NO_VERIFY=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --active-only) ACTIVE_ONLY=true; shift ;;
    --all) ACTIVE_ONLY=false; shift ;;
    --run-history) RUN_HISTORY=true; shift ;;
    --cutoff-days) CUTOFF_DAYS="$2"; shift 2 ;;
    --no-verify) NO_VERIFY=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

CUTOFF_DATE=$(date -v-${CUTOFF_DAYS}d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -d "-${CUTOFF_DAYS} days" --iso-8601=seconds 2>/dev/null)
OUTDIR="$(cd "$(dirname "$0")/.." && pwd)/data"
mkdir -p "$OUTDIR" /tmp/aw-scan

echo "══════════════════════════════════════════════════════════════"
echo "  GitHub Agentic Workflows Scanner"
echo "  Active window: ${CUTOFF_DAYS} days (since ${CUTOFF_DATE})"
echo "══════════════════════════════════════════════════════════════"

# ─── Step 1: Discovery via GitHub Code Search ──────────────────────
echo ""
echo "Step 1 — Discovery: searching for .lock.yml files..."

QUERIES=(
  'path:.github/workflows extension:lock.yml "gh-aw"'
  'path:.github/workflows extension:lock.yml "agentic" "engine"'
  'path:.github/workflows extension:lock.yml "copilot" engine'
)

> /tmp/aw-scan/raw-results.jsonl

for i in "${!QUERIES[@]}"; do
  Q="${QUERIES[$i]}"
  echo "  Query $((i+1))/${#QUERIES[@]}: $Q"
  
  PAGE=1
  while true; do
    RESULT=$(gh api "search/code?q=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$Q'))")&per_page=100&page=$PAGE" 2>/dev/null || echo '{"items":[]}')
    
    ITEMS=$(echo "$RESULT" | python3 -c "import sys,json; items=json.load(sys.stdin).get('items',[]); print(len(items))")
    
    if [ "$ITEMS" = "0" ]; then break; fi
    
    echo "$RESULT" >> /tmp/aw-scan/raw-results.jsonl
    echo "    Page $PAGE: $ITEMS results"
    
    PAGE=$((PAGE + 1))
    if [ "$PAGE" -gt 10 ]; then break; fi
    sleep 2
  done
  sleep 3
done

# Parse into unique repos + workflow files
python3 << 'PYEOF'
import json, sys

repos = {}
with open("/tmp/aw-scan/raw-results.jsonl") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        data = json.loads(line)
        for item in data.get("items", []):
            r = item["repository"]
            name = r["full_name"]
            # Skip known non-public orgs
            if name.startswith(("octodemo/", "octodemo-framework/")):
                continue
            if name not in repos:
                repos[name] = {
                    "url": r["html_url"],
                    "visibility": r.get("visibility", "unknown"),
                    "stars": r.get("stargazers_count", 0),
                    "description": (r.get("description") or "")[:200],
                    "lock_files": []
                }
            wf = item["name"]
            if wf not in repos[name]["lock_files"]:
                repos[name]["lock_files"].append(wf)

# Verify visibility via gh api (authenticated, high rate limit)
import subprocess, time as _time
print("  Verifying repo visibility via gh api...")
public = {}
skipped = {}
for i, (name, info) in enumerate(sorted(repos.items())):
    if i % 20 == 0:
        sys.stdout.write(f"\r  Checking visibility {i+1}/{len(repos)}...")
        sys.stdout.flush()
    try:
        result = subprocess.run(
            ["gh", "api", f"repos/{name}", "--jq", ".visibility"],
            capture_output=True, text=True, timeout=15
        )
        if result.returncode == 0:
            vis = result.stdout.strip()
            info["visibility"] = vis
            if vis == "public":
                # Get stars + description
                result2 = subprocess.run(
                    ["gh", "api", f"repos/{name}", "--jq", '[.stargazers_count, .description // ""] | @tsv'],
                    capture_output=True, text=True, timeout=15
                )
                if result2.returncode == 0:
                    parts = result2.stdout.strip().split("\t", 1)
                    info["stars"] = int(parts[0]) if parts[0].isdigit() else 0
                    info["description"] = (parts[1] if len(parts) > 1 else "")[:200]
                public[name] = info
            else:
                skipped[name] = info
        else:
            info["visibility"] = "not_found"
            skipped[name] = info
    except Exception as e:
        info["visibility"] = "error"
        skipped[name] = info
    _time.sleep(0.05)
sys.stdout.write("\n")

with open("/tmp/aw-scan/discovered.json", "w") as f:
    json.dump(public, f, indent=2)

print(f"  Found {len(repos)} repos total, {len(public)} public, {len(skipped)} skipped (non-public)")
if skipped:
    for k in sorted(skipped):
        print(f"    ⚠️  Skipped: {k} (visibility: {skipped[k].get('visibility', 'unknown')})")
PYEOF

echo ""
REPO_COUNT=$(python3 -c "import json; print(len(json.load(open('/tmp/aw-scan/discovered.json'))))")
echo "  ✅ Discovered $REPO_COUNT public repos with .lock.yml files"

# ─── Step 2: Activity Verification ─────────────────────────────────
if [ "$NO_VERIFY" = "false" ]; then
  echo ""
  echo "Step 2 — Activity verification (cutoff: ${CUTOFF_DAYS} days)..."
  
  python3 - "$CUTOFF_DATE" "$ACTIVE_ONLY" << 'PYEOF'
import json, os, sys, subprocess, time

cutoff = sys.argv[1]
active_only = sys.argv[2] == "True"

with open("/tmp/aw-scan/discovered.json") as f:
    repos = json.load(f)

verified = {}
active_count = 0
skipped_count = 0

for i, (name, info) in enumerate(sorted(repos.items())):
    sys.stdout.write(f"\r  Checking {i+1}/{len(repos)}: {name[:50]}...")
    sys.stdout.flush()
    
    active_workflows = []
    inactive_workflows = []
    
    for lock_file in info["lock_files"]:
        try:
            result = subprocess.run(
                ["gh", "api", f"repos/{name}/actions/workflows/{lock_file}/runs",
                 "-q", f'[.workflow_runs[] | select(.created_at > "{cutoff}") | .id] | length'],
                capture_output=True, text=True, timeout=15
            )
            run_count = int(result.stdout.strip()) if result.returncode == 0 and result.stdout.strip() else 0
        except Exception:
            run_count = 0
        
        if run_count > 0:
            active_workflows.append({"lock_file": lock_file, "recent_runs": run_count})
        else:
            inactive_workflows.append(lock_file)
        
        time.sleep(0.3)
    
    has_activity = len(active_workflows) > 0
    
    if has_activity:
        active_count += 1
        verified[name] = {**info, "active_workflows": active_workflows, "inactive_workflows": inactive_workflows, "status": "active"}
        sys.stdout.write(f"\r  ✅ {name}: {len(active_workflows)} active, {len(inactive_workflows)} inactive\n")
    elif not active_only:
        skipped_count += 1
        verified[name] = {**info, "active_workflows": [], "inactive_workflows": info["lock_files"], "status": "inactive"}
        sys.stdout.write(f"\r  💤 {name}: no recent runs\n")
    else:
        skipped_count += 1
        sys.stdout.write(f"\r  💤 Skipped: {name} (no runs in {cutoff[:10]}..now)\n")

sys.stdout.write("\n")
print(f"  ✅ {active_count} active repos" + (f", 💤 {skipped_count} skipped" if skipped_count else ""))

with open("/tmp/aw-scan/verified.json", "w") as f:
    json.dump(verified, f, indent=2)
PYEOF
else
  echo ""
  echo "Step 2 — Skipped (--no-verify)"
  cp /tmp/aw-scan/discovered.json /tmp/aw-scan/verified.json
fi

# ─── Step 3: Analysis — fetch .md sources and extract patterns ─────
echo ""
echo "Step 3 — Analysis: fetching workflow definitions..."

python3 << 'PYEOF'
import json, subprocess, time, sys, re

with open("/tmp/aw-scan/verified.json") as f:
    repos = json.load(f)

analyzed = {}

for i, (name, info) in enumerate(sorted(repos.items())):
    sys.stdout.write(f"\r  Analyzing {i+1}/{len(repos)}: {name[:50]}...")
    sys.stdout.flush()
    
    workflows = []
    lock_files = [w["lock_file"] for w in info.get("active_workflows", [])] or info.get("lock_files", [])
    
    for lock_file in lock_files:
        md_file = lock_file.replace(".lock.yml", ".md")
        
        try:
            result = subprocess.run(
                ["gh", "api", f"repos/{name}/contents/.github/workflows/{md_file}",
                 "-q", ".content", "--header", "Accept: application/vnd.github.v3+json"],
                capture_output=True, text=True, timeout=15
            )
            if result.returncode == 0 and result.stdout.strip():
                import base64
                content = base64.b64decode(result.stdout.strip()).decode("utf-8", errors="replace")
                
                # Extract frontmatter patterns
                wf = {"name": md_file.replace(".md", ""), "file": md_file}
                
                # Engine — must be in frontmatter and have a valid value
                fm_match = re.match(r'^---\s*\n(.*?)\n---', content, re.DOTALL)
                fm_text = fm_match.group(1) if fm_match else ""
                m = re.search(r'^engine:\s*(\S+)', fm_text, re.MULTILINE)
                if m and m.group(1) not in ('id:', 'model:', '{', '|', '>'):
                    wf["engine"] = m.group(1)
                
                # Model
                m = re.search(r'^model:\s*(\S+)', fm_text, re.MULTILINE)
                if m and m.group(1) not in ('{', '|', '>', '```'):
                    wf["model"] = m.group(1)
                
                # Trigger
                triggers = re.findall(r'on:\s*\n((?:\s+\w+.*\n)*)', content)
                trigger_types = re.findall(r'^\s+(issues|pull_request|push|schedule|workflow_dispatch|workflow_run|slash_command|discussion)', content, re.MULTILINE)
                if trigger_types: wf["triggers"] = list(set(trigger_types))
                
                # Safe outputs
                outputs = re.findall(r'safe-outputs:\s*\n((?:\s+-\s+\w+.*\n)*)', content)
                output_types = re.findall(r'^\s+-\s+(add-comment|add-labels|create-issue|create-pull-request|create-discussion|upload-asset|dispatch-workflow)', content, re.MULTILINE)
                if output_types: wf["safe_outputs"] = list(set(output_types))
                
                # Stop-after
                m = re.search(r'stop-after:\s*(\S+)', content)
                if m: wf["stop_after"] = m.group(1)
                
                # Imports
                imports = re.findall(r'import:\s*(\S+)', content)
                if imports: wf["imports"] = imports
                
                # Tools
                tools = re.findall(r'tools:\s*\n((?:\s+-\s+\S+.*\n)*)', content)
                tool_list = re.findall(r'^\s+-\s+(\S+)', ''.join(tools), re.MULTILINE) if tools else []
                if tool_list: wf["tools"] = tool_list
                
                # Prompt size
                prompt_match = re.search(r'(?:^prompt:\s*\|?\s*\n)((?:.*\n)*)', content, re.MULTILINE)
                if prompt_match:
                    wf["prompt_size_bytes"] = len(prompt_match.group(0).encode())
                
                # Pre-steps (bash steps before the agent)
                has_pre_steps = bool(re.search(r'steps:\s*\n\s+-\s+(?:name|run):', content))
                wf["has_pre_steps"] = has_pre_steps
                
                wf["source_available"] = True
                workflows.append(wf)
            else:
                workflows.append({"name": lock_file.replace(".lock.yml", ""), "file": md_file, "source_available": False})
        except Exception as e:
            workflows.append({"name": lock_file.replace(".lock.yml", ""), "file": md_file, "source_available": False, "error": str(e)})
        
        time.sleep(0.3)
    
    recent_runs = 0
    for aw in info.get("active_workflows", []):
        recent_runs += aw.get("recent_runs", 0)
    
    analyzed[name] = {
        "url": info["url"],
        "stars": info.get("stars", 0),
        "description": info.get("description", ""),
        "status": info.get("status", "unknown"),
        "recent_runs": recent_runs,
        "workflows": workflows
    }

sys.stdout.write("\n")

# Summary stats
total_wf = sum(len(r["workflows"]) for r in analyzed.values())
with_source = sum(1 for r in analyzed.values() for w in r["workflows"] if w.get("source_available"))
engines = {}
models = {}
triggers = {}
outputs = {}
for r in analyzed.values():
    for w in r["workflows"]:
        if w.get("engine"): engines[w["engine"]] = engines.get(w["engine"], 0) + 1
        if w.get("model"): models[w["model"]] = models.get(w["model"], 0) + 1
        for t in w.get("triggers", []): triggers[t] = triggers.get(t, 0) + 1
        for o in w.get("safe_outputs", []): outputs[o] = outputs.get(o, 0) + 1

print(f"  ✅ Analyzed {len(analyzed)} repos, {total_wf} workflows ({with_source} with source)")
print(f"  Engines: {dict(sorted(engines.items(), key=lambda x: -x[1]))}")
print(f"  Models: {dict(sorted(models.items(), key=lambda x: -x[1]))}")
print(f"  Triggers: {dict(sorted(triggers.items(), key=lambda x: -x[1]))}")
print(f"  Outputs: {dict(sorted(outputs.items(), key=lambda x: -x[1]))}")

with open("/tmp/aw-scan/analyzed.json", "w") as f:
    json.dump(analyzed, f, indent=2)
PYEOF

# ─── Step 4 (optional): Run History ────────────────────────────────
if [ "$RUN_HISTORY" = "true" ]; then
  echo ""
  echo "Step 4 — Run history: fetching last 10 runs per workflow..."
  
  python3 << 'PYEOF'
import json, subprocess, time, sys

with open("/tmp/aw-scan/analyzed.json") as f:
    repos = json.load(f)

for i, (name, info) in enumerate(sorted(repos.items())):
    sys.stdout.write(f"\r  History {i+1}/{len(repos)}: {name[:50]}...")
    sys.stdout.flush()
    
    for wf in info["workflows"]:
        lock_file = wf.get("file", "").replace(".md", ".lock.yml")
        if not lock_file:
            continue
        try:
            result = subprocess.run(
                ["gh", "api", f"repos/{name}/actions/workflows/{lock_file}/runs?per_page=10",
                 "-q", '[.workflow_runs[] | {id, created_at, conclusion, run_started_at, updated_at}]'],
                capture_output=True, text=True, timeout=15
            )
            if result.returncode == 0 and result.stdout.strip():
                runs = json.loads(result.stdout)
                wf["recent_runs_detail"] = runs
                successes = sum(1 for r in runs if r.get("conclusion") == "success")
                failures = sum(1 for r in runs if r.get("conclusion") == "failure")
                wf["success_rate"] = f"{successes}/{len(runs)}" if runs else "0/0"
                wf["last_conclusion"] = runs[0].get("conclusion") if runs else None
        except Exception:
            pass
        time.sleep(0.3)

sys.stdout.write("\n")

with open("/tmp/aw-scan/analyzed.json", "w") as f:
    json.dump(repos, f, indent=2)

print("  ✅ Run history collected")
PYEOF
else
  echo ""
  echo "Step 4 — Skipped (use --run-history to enable)"
fi

# ─── Write final output ────────────────────────────────────────────
echo ""
echo "Saving historical snapshot..."
HISTORY_DIR="$OUTDIR/scan-history"
mkdir -p "$HISTORY_DIR"
TIMESTAMP=$(date +%Y-%m-%dT%H%M%S)
cp /tmp/aw-scan/analyzed.json "$HISTORY_DIR/scan-${TIMESTAMP}.json"
echo "  ✅ Saved snapshot to $HISTORY_DIR/scan-${TIMESTAMP}.json"

echo ""
echo "Writing results to $OUTDIR/scan-results.json..."

python3 - "$OUTDIR" << 'PYEOF'
import json, sys
from datetime import datetime

outdir = sys.argv[1]

with open("/tmp/aw-scan/analyzed.json") as f:
    repos = json.load(f)

output = {
    "metadata": {
        "scanned_at": datetime.utcnow().isoformat() + "Z",
        "total_repos": len(repos),
        "total_workflows": sum(len(r["workflows"]) for r in repos.values()),
        "active_repos": sum(1 for r in repos.values() if r.get("status") == "active"),
    },
    "repos": repos
}

with open(f"{outdir}/scan-results.json", "w") as f:
    json.dump(output, f, indent=2)

print(f"  ✅ Wrote {outdir}/scan-results.json")
print(f"     {output['metadata']['total_repos']} repos, {output['metadata']['total_workflows']} workflows")
PYEOF

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  Scan complete!"
echo "══════════════════════════════════════════════════════════════"

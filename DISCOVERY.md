# Discovery Methodology

How agentic workflows are discovered, verified, and analyzed.

## What are agentic workflows?

Agentic workflows are GitHub Copilot-powered automations defined as `.md` files in `.github/workflows/`. The `.md` file is the source prompt — it contains instructions and YAML frontmatter that tell the agent what to do. Running `gh aw compile` compiles each `.md` into a `.lock.yml` file, which is the executable GitHub Actions workflow.

## Discovery convention

The presence of a compiled lock file is how we identify agentic workflows at scale. Lock files match this pattern:

```
.github/workflows/*.lock.yml
```

Regex: `^\.github/workflows/[^/]+\.lock\.yml$`

The `.lock.yml` file is the compiled output. Its corresponding `.md` file (same name, different extension) is the source prompt that defines the agent's behavior.

## 5-Step Pipeline

### 1. Discovery

Search GitHub for `.lock.yml` files using code search: `path:.github/workflows extension:lock.yml`. Each result is a candidate repo.

### 2. Visibility

Verify each repo is public via `gh api "repos/{owner}/{repo}" --jq '.visibility'`. Only repos returning `"public"` are included so all data is independently verifiable.

### 3. Source analysis

Fetch `.md` source files from `.github/workflows/` and parse YAML frontmatter to extract triggers, model overrides, pre-steps, and stop-after limits.

### 4. Run history

Query the Actions API (`repos/{owner}/{repo}/actions/runs`) for recent runs. Compute per-workflow success rates (e.g., `"8/10"`) and flag repos active in the last 90 days.

### 5. Log analysis

Parse job logs from failed runs to categorize errors: `auth_error`, `not_found`, `safe_output_denied`, `timeout`, `rate_limit`. These patterns determine which archetypes are reliable.

## How to run

```bash
./scripts/scan.sh --active-only --run-history
```

| Flag | Description |
|------|-------------|
| `--active-only` | Only include repos with workflow runs in the last 90 days |
| `--run-history` | Fetch run history and compute success rates (slower, more data) |

Requires the `gh` CLI, authenticated with a token that has `public_repo` scope.

## Data schema

Results are written to `data/scan-results.json` with two top-level keys:

- **`metadata`** — `scanned_at`, `total_repos`, `total_workflows`, `active_repos`
- **`repos`** — keyed by `owner/repo`, each containing `url`, `stars`, `status`, and a `workflows` array. Each workflow entry includes `name`, `file`, `triggers`, `model`, `has_pre_steps`, `source_available`, `success_rate`, and `last_conclusion`.

# gh-aw-wizard

A wizard interface to create GitHub Agentic Workflows. Create ready-to-use [GitHub Agentic Workflows](https://github.github.com/gh-aw/) in minutes — just answer a few questions and get a workflow file you can drop into your repo.

🔗 **[Try it live →](https://githubnext.github.io/gh-aw-wizard)**

## How it works

1. **Pick a workflow type** — issue triage, status reports, dependency monitoring, code improvement, and more.
2. **Choose your triggers** — schedule, issue events, pull requests, or manual dispatch.
3. **Add optional context** — describe your project so the workflow knows what it's working with.
4. **Get your workflow** — download the `.md` file or copy a prompt to paste into your coding agent.
5. **Set up and run** — the generator walks you through installing the gh-aw extension, setting up your AI engine, and triggering your first run.

## Features

- **9 workflow types** — from issue triage to upstream monitoring, each with smart defaults
- **Auto-configured capabilities** — the tool knows which workflows need data pre-fetching, bash access, or GitHub API toolsets, so you don't have to
- **Two output formats** — download a `.md` workflow file, or get a prompt to paste into GitHub Copilot coding agent
- **Step-by-step setup guide** — not just "here's a file" — complete instructions to get your workflow running

## Built on real data

Every template and default comes from analyzing **269 public repos** running **679 real agentic workflows**. The generator automatically picks the trigger combinations, constraints, and configurations that actually work in practice.

The dataset updates weekly via an automated scan, so the generator always reflects current community patterns.

Want the full research details? See [DISCOVERY.md](DISCOVERY.md).

## Contributing

### Project structure

| File | Description |
|------|-------------|
| `index.html` / `style.css` / `generator.js` | The generator site (vanilla JS, no build step) |
| `patterns.json` | Pattern data powering the wizard — archetypes, triggers, tips |
| `scripts/scan.sh` | Weekly scanner that discovers agentic workflows across GitHub |
| `scripts/analyze.py` | Analysis script — processes scan results into patterns |
| `.github/workflows/deep-research.md` | Agentic workflow that analyzes trends and opens PRs with updates |

### Self-updating pipeline

A weekly GitHub Actions scan discovers new repos, refreshes run history, and updates the dataset. A [deep research agent](.github/workflows/deep-research.md) then analyzes the results and opens PRs when patterns shift.

```bash
# Run analysis locally
python3 scripts/analyze.py --skip-logs
```

## License

MIT

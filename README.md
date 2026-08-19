# gh-aw-wizard

🔗 **[Try it live →](https://githubnext.github.io/gh-aw-wizard)**

A wizard interface to create GitHub Agentic Workflows. Create ready-to-use [GitHub Agentic Workflows](https://github.github.com/gh-aw/) in minutes — just answer a few questions and get a workflow file you can drop into your repo.

## CLI

Generate an agent prompt from a JSON file containing the wizard answers:

```bash
npm run generate -- --input answers.json
```

Pass `--format workflow` to emit a workflow file instead. Use `--patterns path/to/patterns.json`
to select a pattern library other than the repository default.

## License

MIT

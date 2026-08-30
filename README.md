# gh-aw-wizard

🔗 **[Try it live →](https://githubnext.github.io/gh-aw-wizard)**

A wizard interface to create GitHub Agentic Workflows. Create ready-to-use [GitHub Agentic Workflows](https://github.github.com/gh-aw/) in minutes — just answer a few questions and get a workflow file you can drop into your repo.

## Customize the wizard

The dashboard is rendered at runtime from [`src/wizard.json`](src/wizard.json). The file defines the
landing-page text, footer labels and URLs, archetype ordering, trigger/output/extra/engine cards,
summary text, recommendation mappings, and the URLs of the pattern library and engine catalog.

To host a customized wizard in another repository:

1. Run `npm run build` and publish the contents of `dist/`.
2. Edit the published `wizard.json` without rebuilding the JavaScript bundle.
3. Point `patterns_url` at a compatible pattern manifest. Relative URLs are resolved from the
   location of `wizard.json`, so the configuration and its pattern library can be hosted together.
   The `recommendations.safe_outputs` map retains singular and plural aliases where upstream pattern
   libraries use both forms (for example, `add-label` and `add-labels`).

The default page reads the configuration URL from:

```html
<meta name="gh-aw-wizard-config" content="wizard.json">
```

An embedding application can instead call `initWizard({ configUrl })`. Cross-origin configuration,
pattern, and engine endpoints must allow the embedding origin with CORS headers. Option IDs should
match definitions in the configured pattern library's `workflow-generation.json`.

The site loads its third-party browser assets — Primer CSS and the scenario assistant runtime
(transformers.js plus the onnxruntime-web wasm files) — from the published site rather than a CDN, so
a customized deployment must publish `dist/primer/` and `dist/slm/` alongside the rest of the site.

## Development

```bash
npm install
npm run dev
npm test
npm run build
```

`npm run dev` and `npm run build` download the vendored browser assets into the gitignored
`vendor/` directory; `npm run vendor` refreshes them.

## License

MIT

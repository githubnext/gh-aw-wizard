---
name: customize-wizard
description: Customize gh-aw-wizard for a repository's own agentic workflow scenarios.
---

# Customize the Agentic Workflow Wizard

Use this skill when a user wants to tailor the wizard's branding, choices, or agentic workflow scenarios.

## Start with the scenarios

Ask for missing requirements before editing. For each scenario, establish:

- A stable kebab-case ID, label, and one-sentence description
- What the agent should do and explicit boundaries on what it must not do
- Recommended trigger, safe outputs, tools, and optional capabilities
- Whether the scenario produces a workflow or only a reusable prompt
- Which scenarios should be pinned and whether the generic Custom choice should remain

Prefer the user's terminology. Reuse an existing scenario ID when its behavior is being refined; do not create a near-duplicate.

## Inspect before changing

Read the current versions of:

- `src/wizard.json` for page content, card choices, recommendations, and data URLs
- `patterns/manifest.json` for the scenario IDs loaded by the wizard
- `patterns/archetypes/<id>.json` for scenario display metadata and recommendations
- `patterns/workflow-generation.json` for generation defaults and per-scenario prompts
- `src/js/workflow.js` and its tests when the requested behavior is not expressible in data

Keep the customization data-driven. Do not change JavaScript, HTML, or CSS unless the requested customization cannot be represented by the existing configuration schema.

## Apply a coherent customization

Keep each scenario synchronized across the pattern library:

1. Add its ID to `patterns/manifest.json`.
2. Add `patterns/archetypes/<id>.json` with the same `id`, its display metadata, recommendations, and evidence fields.
3. Add the matching entry under `archetypes` in `patterns/workflow-generation.json`, including its icon, instructions, capabilities, purpose, and prompt sections.
4. Update `src/wizard.json` only where needed:
   - Order highlighted scenarios with `archetypes.pinned`.
   - Map alternate labels with `archetypes.aliases`.
   - Customize or remove the generic choice with `archetypes.custom`.
   - Add only trigger, output, extra, or engine cards that generation data supports.
   - Keep `recommendations.safe_outputs` aligned with visible output IDs.

To expose only the user's scenarios, create or point `patterns_url` at a compatible pattern library whose manifest lists only those IDs. Do not use the pinned list as a filter; it changes ordering and emphasis only.

Relative `patterns_url` values resolve from the location of `wizard.json`. For cross-origin configuration, pattern, or engine URLs, remind the user that the host must allow the wizard origin with CORS headers.

## Preserve generation behavior

- Use only trigger, output, and extra IDs defined by `patterns/workflow-generation.json`.
- Grant the minimum permissions and capabilities required by the scenario.
- Pair every write operation with a supported safe output.
- Include at least two concrete scope boundaries in each generated prompt.
- Keep prompts focused and structured around role, task, steps, and constraints.
- Retain a requested slash-command scenario, but state that measured reliability is low and offer an issue or schedule trigger as an alternative.
- Do not select Codex merely as a default; preserve an explicit user choice.

Files under `patterns/` are also maintained by `scripts/generate-patterns.py`. Before editing them, determine whether the user wants a downstream static pattern library or changes to this repository's generated library. For persistent upstream changes, update the generator's source behavior as well; otherwise a later regeneration may overwrite the customization. Never run the generator just to format hand-authored scenario data.

## Validate

Before finishing:

1. Parse every changed JSON file.
2. Confirm every manifest ID has both an archetype file and a workflow-generation entry.
3. Confirm every pinned ID exists in the selected pattern library.
4. Confirm recommended triggers and outputs resolve to configured generation and recommendation entries.
5. Run the existing lint, unit tests, and production build when repository source changed.
6. Summarize the scenarios added or removed and any deployment or CORS action the user must take.

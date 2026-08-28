// Workflow generation controller — renders the runtime pattern data without DOM access.

import {
  getArchetype,
  getWorkflowDefinition,
  getWorkflowGeneration
} from './patterns.js';
import { isKnownEngine } from './engines.js';

export function normalizeEngine(engine) {
  return isKnownEngine(engine) ? engine : 'copilot';
}

export function workflowName(archetype, customDesc) {
  if (archetype === 'custom' && customDesc) {
    return customDesc.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'custom-workflow';
  }
  return archetype;
}

function generationModel(patterns) {
  const generation = getWorkflowGeneration(patterns);
  if (!generation) throw new Error('Workflow generation pattern data is unavailable.');
  return generation;
}

function workflowDefinition(patterns, archetype) {
  return getWorkflowDefinition(patterns, archetype) || {};
}

function mergeCapabilities(patterns, archetype) {
  const generation = generationModel(patterns);
  return Object.assign(
    {},
    generation.default_capabilities || {},
    workflowDefinition(patterns, archetype).capabilities || {}
  );
}

export function inferNeedsPreSteps(archetype, patterns) {
  return Boolean(mergeCapabilities(patterns, archetype).pre_steps);
}

export function inferCapabilities(archetype, patterns) {
  const capabilities = mergeCapabilities(patterns, archetype);
  return {
    preSteps: Boolean(capabilities.pre_steps),
    bash: Boolean(capabilities.bash),
    githubToolsets: Boolean(capabilities.github_toolsets),
    browser: Boolean(capabilities.browser),
    network: Boolean(capabilities.network)
  };
}

function renderTemplate(value, variables) {
  return String(value).replace(/\{\{([a-z_]+)\}\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : match;
  });
}

function indentYaml(yaml) {
  return `${yaml.split('\n').map((line) => `  ${  line}`).join('\n')  }\n`;
}

function triggerDefinition(patterns, archetype, trigger) {
  const generation = generationModel(patterns);
  const definitions = generation.triggers || {};
  const original = definitions[trigger];
  if (!original) return null;
  const resolved = original.alias ? definitions[original.alias] : original;
  if (!resolved) return null;
  const overrides = workflowDefinition(patterns, archetype).trigger_overrides || {};
  return Object.assign({}, resolved, overrides[trigger] || {});
}

export function buildTriggerYaml(triggers, commandName, archetype, patterns) {
  const name = commandName || 'agentic-workflow';
  const yamlBlocks = [];
  const seenYaml = new Set();
  const activityTypes = new Map();

  triggers.forEach((trigger) => {
    const definition = triggerDefinition(patterns, archetype, trigger);
    if (!definition) return;
    if (definition.event && definition.activity_type) {
      const types = activityTypes.get(definition.event) || [];
      if (types.indexOf(definition.activity_type) === -1) types.push(definition.activity_type);
      activityTypes.set(definition.event, types);
      return;
    }
    if (!definition.yaml) return;
    const yaml = renderTemplate(definition.yaml, { name });
    if (!seenYaml.has(yaml)) {
      seenYaml.add(yaml);
      yamlBlocks.push(yaml);
    }
  });

  activityTypes.forEach((types, event) => {
    yamlBlocks.push(`${event  }:\n  types: [${  types.join(', ')  }]`);
  });
  return yamlBlocks.map(indentYaml).join('');
}

function outputDefinition(patterns, output) {
  const definitions = generationModel(patterns).outputs || {};
  const original = definitions[output];
  if (!original) return null;
  const resolved = original.alias ? definitions[original.alias] : original;
  if (!resolved) return null;
  const definition = Object.assign({}, resolved, original);
  delete definition.alias;
  return definition;
}

function selectedExtras(answers, patterns) {
  const definitions = generationModel(patterns).extras || {};
  return (answers.extras || []).map((id) => {
    return definitions[id] ? Object.assign({ id }, definitions[id]) : null;
  }).filter(Boolean);
}

function safeOutputsFor(answers, patterns) {
  const safeOutputs = new Set();
  (answers.outputs || []).forEach((output) => {
    const definition = outputDefinition(patterns, output);
    if (definition && definition.safe_output) safeOutputs.add(definition.safe_output);
  });
  selectedExtras(answers, patterns).forEach((extra) => {
    if (extra.safe_output) safeOutputs.add(extra.safe_output);
  });
  return Array.from(safeOutputs);
}

function renderPreSteps(answers, patterns) {
  if (!answers.needsData) return '';
  const generation = generationModel(patterns);
  const lines = (generation.pre_steps || {})[answers.archetype] ||
    (generation.pre_steps || {}).default || [];
  return renderTemplate(lines.join('\n'), {
    data_description: answers.dataDescription || 'the required external data'
  });
}

function renderWorkflowBody(answers, patterns, archetype) {
  const generation = generationModel(patterns);
  const definition = workflowDefinition(patterns, answers.archetype);
  const template = definition.body || generation.default_body || [];
  const purpose = answers.archetype === 'custom' && answers.customDescription
    ? answers.customDescription
    : archetype.description || answers.customDescription || 'Perform the specified task on this repository.';
  return `${renderTemplate(template.join('\n'), {
    label: definition.title || archetype.label || 'Custom Workflow',
    purpose,
    pre_steps: renderPreSteps(answers, patterns)
  }).replace(/\n{3,}/g, '\n\n').trimEnd()  }\n`;
}

function permissionsFor(patterns, archetype, inferred) {
  const generation = generationModel(patterns);
  const definition = workflowDefinition(patterns, archetype);
  if (definition.permissions) return definition.permissions;
  if (inferred.githubToolsets) {
    return generation.github_permissions || generation.default_permissions || [];
  }
  return generation.default_permissions || [];
}

function toolsetsFor(patterns, archetype) {
  const generation = generationModel(patterns);
  return workflowDefinition(patterns, archetype).github_toolsets ||
    generation.default_github_toolsets || [];
}

function validLsp(lsp) {
  const valid = {};
  Object.entries(lsp || {}).forEach(([language, config]) => {
    if (config && config.command && config.fileExtensions && Object.keys(config.fileExtensions).length) {
      valid[language] = config;
    }
  });
  return valid;
}

function lspFor(patterns, archetype, engine, extras) {
  if (normalizeEngine(engine) !== 'copilot') return null;
  const lsp = validLsp(workflowDefinition(patterns, archetype).lsp);
  extras.forEach((extra) => Object.assign(lsp, validLsp(extra.lsp)));
  return Object.keys(lsp).length ? lsp : null;
}

export function generateWorkflowFile(answers, patterns) {
  generationModel(patterns);
  const definition = workflowDefinition(patterns, answers.archetype);
  if (definition.file_generation_error) throw new Error(definition.file_generation_error);

  const archetype = getArchetype(patterns, answers.archetype) || {};
  const name = workflowName(answers.archetype, answers.customDescription);
  const description = answers.archetype === 'custom' && answers.customDescription
    ? answers.customDescription
    : archetype.description || answers.customDescription || 'Custom agentic workflow';
  const safeOutputs = safeOutputsFor(answers, patterns);
  const inferred = inferCapabilities(answers.archetype, patterns);
  const extras = selectedExtras(answers, patterns);
  const lsp = lspFor(patterns, answers.archetype, answers.engine, extras);

  let timeout = archetype.timeout_minutes || 30;
  const timeoutByTrigger = patterns.config_defaults && patterns.config_defaults.timeout_by_trigger;
  if (timeoutByTrigger) {
    answers.triggers.forEach((trigger) => {
      if (timeoutByTrigger[trigger] > timeout) timeout = timeoutByTrigger[trigger];
    });
  }

  let frontmatter = '---\n';
  frontmatter += `name: ${  name  }\n`;
  frontmatter += `description: ${  description  }\n`;
  frontmatter += `on:\n${  buildTriggerYaml(answers.triggers, name, answers.archetype, patterns)}`;
  frontmatter += 'permissions:\n';
  permissionsFor(patterns, answers.archetype, inferred).forEach((permission) => {
    frontmatter += `  ${  permission  }: read\n`;
  });
  if (inferred.network || lsp) {
    frontmatter += 'network:\n  allowed:\n    - defaults\n    - github\n';
    if (lsp) frontmatter += '    - node\n';
  }
  frontmatter += `engine: ${  normalizeEngine(answers.engine)  }\n`;
  if (lsp) {
    frontmatter += 'lsp:\n';
    Object.entries(lsp).forEach(([language, config]) => {
      frontmatter += `  ${  language  }:\n`;
      frontmatter += `    command: ${  config.command  }\n`;
      if (config.args && config.args.length) frontmatter += `    args: [${  config.args.map((arg) => `"${  arg  }"`).join(', ')  }]\n`;
      frontmatter += '    fileExtensions:\n';
      Object.entries(config.fileExtensions).forEach(([extension, id]) => {
        frontmatter += `      "${  extension  }": ${  id  }\n`;
      });
    });
  }

  if (inferred.bash || inferred.githubToolsets || inferred.browser || extras.some((extra) => extra.tool)) {
    frontmatter += 'tools:\n';
    if (inferred.bash) frontmatter += '  bash: true\n';
    if (inferred.githubToolsets) {
      frontmatter += `  github:\n    toolsets: [${  toolsetsFor(patterns, answers.archetype).join(', ')  }]\n`;
    }
    extras.forEach((extra) => {
      if (extra.tool === 'cache-memory') frontmatter += '  cache-memory:\n';
      if (extra.tool === 'agentic-workflows') frontmatter += '  agentic-workflows: true\n';
    });
    if (inferred.browser || extras.some((extra) => extra.tool === 'playwright')) {
      frontmatter += '  playwright:\n    mode: cli\n';
    }
  }
  if (safeOutputs.length) {
    frontmatter += 'safe-outputs:\n';
    safeOutputs.forEach((safeOutput) => { frontmatter += `  ${  safeOutput  }:\n`; });
  }
  frontmatter += `timeout-minutes: ${  timeout  }\n`;
  frontmatter += '---\n\n';

  return frontmatter + renderWorkflowBody(answers, patterns, archetype);
}

export function fencedBlock(content, lang) {
  const body = String(content).replace(/\s+$/, '');
  let longest = 0;
  const matches = body.match(/`+/g) || [];
  matches.forEach((match) => { if (match.length > longest) longest = match.length; });
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence + (lang || '')  }\n${  body  }\n${  fence}`;
}

function instructionUrls(patterns, archetype) {
  const generation = generationModel(patterns);
  const definition = workflowDefinition(patterns, archetype);
  const files = (generation.default_instructions || []).concat(definition.instructions || []);
  return files.map((instruction) => {
    return instruction.indexOf('https://') === 0
      ? instruction
      : generation.instruction_base_url + instruction;
  });
}

function sampleWorkflowFile(answers, patterns, label) {
  const workflow = generateWorkflowFile(answers, patterns);
  const frontmatterEnd = workflow.indexOf('\n---\n\n');
  const frontmatter = workflow.slice(0, frontmatterEnd + 6);
  return `${frontmatter  }Let the agent generate the detailed ${  label.toLowerCase()  } prompt for this repository...\n`;
}

function requestedWorkflows(answers, patterns) {
  const definition = workflowDefinition(patterns, answers.archetype);
  const archetypes = definition.workflows || [answers.archetype];
  return archetypes.map((archetypeId) => {
    const archetype = getArchetype(patterns, archetypeId) || {};
    return {
      answers: Object.assign({}, answers, {
        archetype: archetypeId,
        needsData: archetypeId === answers.archetype
          ? answers.needsData
          : inferNeedsPreSteps(archetypeId, patterns)
      }),
      label: archetype.label || 'Custom Workflow',
      description: archetype.description || answers.customDescription || 'Custom agentic workflow'
    };
  });
}

function readableTriggers(answers, patterns) {
  return answers.triggers.map((trigger) => {
    const definition = triggerDefinition(patterns, answers.archetype, trigger);
    return definition && definition.description ? definition.description : trigger;
  }).join(', ');
}

function readableOutputs(answers, patterns) {
  return answers.outputs.map((output) => {
    const definition = outputDefinition(patterns, output);
    return definition && definition.description ? definition.description : output;
  }).join(', ');
}

// Surface each archetype's own "DO NOT" tips (from patterns/archetypes/*.json) as
// explicit behavioral constraints in the generated prompt. gh-aw's research findings
// show workflows with explicit DO NOT instructions are 61% more likely to be healthy,
// but that guidance previously stayed in the pattern library and never reached the
// prompt the downstream agent actually follows.
function doNotConstraints(workflows, patterns) {
  const constraints = [];
  workflows.forEach((workflow) => {
    const archetype = getArchetype(patterns, workflow.answers.archetype) || {};
    (archetype.tips || []).forEach((tip) => {
      if (/do not/i.test(tip) && constraints.indexOf(tip) === -1) constraints.push(tip);
    });
  });
  return constraints;
}

// Surface each archetype's duplicate-prevention tips (skip-if-match, tracker-id,
// expires) as explicit requirements in the generated prompt. Scheduled workflows
// that create-issue/create-pull-request on every run will otherwise reopen the
// same finding on every scheduled run, since nothing else in the generated prompt
// mentions this guidance even though it lives in the pattern library.
function duplicatePreventionTips(workflows, patterns) {
  const tips = [];
  workflows.forEach((workflow) => {
    const archetype = getArchetype(patterns, workflow.answers.archetype) || {};
    (archetype.tips || []).forEach((tip) => {
      if (/skip-if-match|tracker-id|\bexpires\b/i.test(tip) && tips.indexOf(tip) === -1) tips.push(tip);
    });
  });
  return tips;
}

// Surface each archetype's protected-files guidance as an explicit requirement.
// Archetypes that open pull requests unattended (code-improvement,
// documentation-updater) otherwise lose this tip entirely: it doesn't match
// doNotConstraints' /do not/i filter or duplicatePreventionTips' skip-if-match
// filter, so it was silently dropped even though it guards against an
// unreviewed PR touching manifests, CI configs, or agent instructions.
function protectedFilesTips(workflows, patterns) {
  const tips = [];
  workflows.forEach((workflow) => {
    const archetype = getArchetype(patterns, workflow.answers.archetype) || {};
    (archetype.tips || []).forEach((tip) => {
      if (/protected-files/i.test(tip) && tips.indexOf(tip) === -1) tips.push(tip);
    });
  });
  return tips;
}

// A free-form "intent" typed in the wizard is appended to the generated prompt as
// explicit requirements: state the intent, turn it into a single measurable
// operational value registered as the workflow's grader, and decompose it into
// BinEval binary questions under the `evals:` frontmatter block.
function intentRequirements(intent) {
  return [
    `- Additional intent for this workflow, provided by the user: ${intent}`,
    '- Derive a single measurable "operational value" statement from that intent — one sentence describing ' +
      'the concrete outcome a successful run must deliver — and register it as the workflow grader: add it ' +
      'as the first entry of an `evals:` frontmatter block with `id: operational_value` and a question that ' +
      'asks whether the agent output demonstrates that value was delivered',
    '- Add BinEval evaluations for the intent: 2-4 further `evals:` questions that each verify one ' +
      'observable property of the intent, phrased as falsifiable YES/NO questions answerable from the agent ' +
      'output alone (no compound questions, unique ids, YES means success)',
    '- Reflect the intent in the workflow prompt itself so the agent optimizes for it at run time',
    '- Keep a `safe-outputs:` block in the workflow so the evals judge can read `agent_output.json`'
  ];
}

export function generateAgentPrompt(answers, patterns) {
  const archetype = getArchetype(patterns, answers.archetype) || {};
  const name = workflowName(answers.archetype, answers.customDescription);
  const description = answers.archetype === 'custom' && answers.customDescription
    ? answers.customDescription
    : archetype.description || answers.customDescription || 'Custom agentic workflow';
  const workflows = requestedWorkflows(answers, patterns);
  const multiple = workflows.length > 1;

  let prompt = `Create a draft PR that adds ${
    multiple ? `${workflows.length} agentic workflows` : 'an agentic workflow'
  } using these instructions:\n`;
  const instructionSet = new Set();
  workflows.forEach((workflow) => {
    instructionUrls(patterns, workflow.answers.archetype).forEach((url) => instructionSet.add(url));
  });
  instructionSet.forEach((url) => { prompt += `- ${  url  }\n`; });
  prompt += '\n';
  prompt += `The purpose of ${  multiple ? 'the workflows' : 'the workflow'  } is: ${  description  }\n\n`;
  prompt += `First, analyze this repository so the ${  multiple ? 'workflows are' : 'workflow is'  } optimized for it:\n`;
  prompt += '- Read the README, AGENTS.md (and any CONTRIBUTING or docs files) to understand the project purpose and conventions\n';
  prompt += '- Identify the languages, package managers, build/test/lint commands and CI setup actually used\n';
  prompt += '- Note repository conventions such as labels, issue/PR templates and branch naming\n';
  prompt += '- Use those findings to tailor the workflow prompt, tools, and instructions to this repository\n\n';
  prompt += 'Requirements:\n';
  if (multiple) {
    prompt += `- Generate exactly ${  workflows.length  } independent workflow files:\n`;
    workflows.forEach((workflow) => {
      prompt += `  - ${  workflow.label  }: name it ${
        workflowName(workflow.answers.archetype, workflow.answers.customDescription)
      } and use it to ${  workflow.description.charAt(0).toLowerCase()  }${workflow.description.slice(1)  }\n`;
    });
  } else {
    prompt += `- Name: ${  name  }\n`;
  }
  prompt += `- Engine: ${  normalizeEngine(answers.engine)  }\n`;
  prompt += `- Triggers: ${  readableTriggers(answers, patterns)  }\n`;
  prompt += `- Allowed outputs: ${  readableOutputs(answers, patterns)  }\n`;
  prompt += multiple
    ? '- Save each workflow in its own appropriately named .github/workflows/*.md file\n'
    : '- Choose an appropriate kebab-case filename for the new .github/workflows/*.md file\n';
  if (answers.needsData) prompt += '- Add a pre-step to fetch external data before the agent runs\n';
  selectedExtras(answers, patterns).forEach((extra) => {
    if (extra.requirement) prompt += `- ${  extra.requirement  }\n`;
  });
  const constraints = doNotConstraints(workflows, patterns);
  if (constraints.length) {
    prompt += `- Include explicit boundary constraints in the workflow prompt, for example: ${
      constraints.join('; ')
    }\n`;
  }
  const duplicateTips = duplicatePreventionTips(workflows, patterns);
  if (duplicateTips.length) {
    prompt += `- Prevent duplicate scheduled findings, for example: ${
      duplicateTips.join('; ')
    }\n`;
  }
  const intent = typeof answers.intent === 'string' ? answers.intent.trim() : '';
  if (intent) {
    intentRequirements(intent).forEach((requirement) => { prompt += `${  requirement  }\n`; });
  }
  const protectedTips = protectedFilesTips(workflows, patterns);
  if (protectedTips.length) {
    prompt += `- Guard sensitive files, for example: ${
      protectedTips.join('; ')
    }\n`;
  }
  prompt += multiple
    ? '\nAll workflows should be saved as separate Markdown files in .github/workflows/.'
    : '\nThe workflow should be saved as a new Markdown file in .github/workflows/.';
  prompt += '\nCreate a pull request with the generated agentic workflow files.';
  prompt += `\n\n## Suggested workflow ${  multiple ? 'files' : 'file'  }\n\n`;
  if (!multiple) {
    prompt += 'Use this generated draft as a starting point for the new `.github/workflows/*.md` file, ' +
      'adapting it to the repository as needed:\n\n';
  }
  workflows.forEach((workflow) => {
    if (multiple) prompt += `### ${  workflow.label  }\n\n`;
    prompt += `${fencedBlock(
      sampleWorkflowFile(workflow.answers, patterns, workflow.label),
      'markdown'
    )  }\n`;
    if (multiple) prompt += '\n';
  });
  return prompt;
}

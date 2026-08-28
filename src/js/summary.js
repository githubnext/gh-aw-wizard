// Readable, progressive summary of the workflow being configured.

import { getArchetype } from './patterns.js';
import { formatEngineLabel } from './engines.js';
import { wizardOptions, wizardStep } from './wizard-config.js';

function readableList(values, conjunction) {
  conjunction = conjunction || 'and';
  if (values.length < 2) return values[0] || '';
  if (values.length === 2) return `${values[0]  } ${  conjunction  } ${  values[1]}`;
  return `${values.slice(0, -1).join(', ')  }, ${  conjunction  } ${  values[values.length - 1]}`;
}

function mapLabels(values, labels) {
  return readableList(values.map((value) => { return labels[value] || value; }));
}

function optionLabels(config, stepId) {
  return Object.fromEntries(wizardOptions(config, stepId).map((option) => {
    return [option.id, option.summary || option.label || option.id];
  }));
}

export function buildWorkflowSummary(answers, patterns, wizardConfig) {
  const archetype = getArchetype(patterns, answers.archetype);
  const triggerLabels = optionLabels(wizardConfig, 'trigger');
  const outputLabels = optionLabels(wizardConfig, 'output');
  const engineLabels = optionLabels(wizardConfig, 'engine');
  const extraLabels = optionLabels(wizardConfig, 'extra');
  const summaryOverrides = wizardConfig && wizardConfig.summary_overrides &&
    wizardConfig.summary_overrides[answers.archetype]
    ? wizardConfig.summary_overrides[answers.archetype]
    : {};
  const purpose = answers.archetype === 'custom'
    ? answers.customDescription
    : archetype && archetype.description;
  const engine = answers.engine ? (engineLabels[answers.engine] || formatEngineLabel(answers.engine)) : null;
  const capabilities = (answers.extras || []).map((extra) => { return extraLabels[extra] || extra; });

  return {
    trigger: {
      value: answers.triggers.length
        ? readableList(answers.triggers.map((trigger) => {
          return (summaryOverrides.trigger || {})[trigger] || triggerLabels[trigger] || trigger;
        }), 'or')
        : wizardStep(wizardConfig, 'trigger').placeholder || '',
      complete: answers.triggers.length > 0
    },
    purpose: {
      value: purpose || wizardStep(wizardConfig, 'purpose').placeholder || '',
      complete: Boolean(purpose)
    },
    output: {
      value: answers.outputs.length
        ? mapLabels(answers.outputs, outputLabels)
        : wizardStep(wizardConfig, 'output').placeholder || '',
      complete: answers.outputs.length > 0
    },
    extras: {
      value: capabilities.length
        ? readableList(capabilities)
        : wizardStep(wizardConfig, 'extra').placeholder || '',
      complete: capabilities.length > 0
    },
    engine: {
      value: engine || wizardStep(wizardConfig, 'engine').placeholder || '',
      complete: Boolean(engine)
    },
    intent: {
      value: answers.intent || wizardStep(wizardConfig, 'intent').placeholder || '',
      complete: Boolean(answers.intent)
    }
  };
}

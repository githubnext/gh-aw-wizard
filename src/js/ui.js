// DOM wiring for the wizard UI.

import { loadPatterns, getArchetype, getRecommendedConfiguration } from './patterns.js';
import {
  workflowName,
  inferNeedsPreSteps,
  generateAgentPrompt
} from './workflow.js';
import { highlightMarkdown } from './highlight.js';
import { nextStepsHtml } from './next-steps.js';
import { initTheme } from './theme.js';
import { buildWorkflowSummary } from './summary.js';

var patterns = null;
var currentStep = 1;
var generatedPrompt = '';
var TOTAL_STEPS = 6;
var SELECTION_STORAGE_KEY = 'gh-aw-wizard-selection';

export function initWizard() {
  initTheme();
  loadPatterns().then(function (data) {
    patterns = data;
    renderWorkflowSummary();
  });
  bindNavigation();
  bindFormEvents();
  restoreSelectionState();
  initNavigationHistory();
  renderWorkflowSummary();
}

function generateAndShow() {
  refreshGeneratedContent();
  goToStep(6);
  showPreview(generatedPrompt);
  var answers = gatherAnswers();
  showNextSteps('prompt', workflowName(answers.archetype, answers.customDescription), answers.engine);
  document.getElementById('preview-filename').textContent = 'prompt.txt';
}

function refreshPreview() {
  refreshGeneratedContent();
  showPreview(generatedPrompt);
  var answers = gatherAnswers();
  showNextSteps('prompt', workflowName(answers.archetype, answers.customDescription), answers.engine);
}

function showNextSteps(format, name, engine) {
  var panel = document.getElementById('next-steps-panel');
  if (!panel) return;
  panel.innerHTML = nextStepsHtml(format, name, engine);
}

function refreshGeneratedContent() {
  var answers = gatherAnswers();
  generatedPrompt = generateAgentPrompt(answers, patterns);
}

// ── Navigation ─────────────────────────────────────────────────────────────
function bindNavigation() {
  document.getElementById('next-1').addEventListener('click', function () { goToStep(2); });
  document.getElementById('next-2').addEventListener('click', function () { goToStep(3); });
  document.getElementById('next-3').addEventListener('click', function () { goToStep(4); });
  document.getElementById('next-4').addEventListener('click', function () { goToStep(5); });
  document.getElementById('next-5').addEventListener('click', function () { generateAndShow(); });
  document.getElementById('prev-2').addEventListener('click', function () { goToStep(1); });
  document.getElementById('prev-3').addEventListener('click', function () { goToStep(2); });
  document.getElementById('prev-4').addEventListener('click', function () { goToStep(3); });
  document.getElementById('prev-5').addEventListener('click', function () { goToStep(4); });
  document.getElementById('prev-6').addEventListener('click', function () { goToStep(5); });

  document.getElementById('btn-copy').addEventListener('click', copyToClipboard);
  document.getElementById('task-dialog-cancel').addEventListener('click', function () {
    document.getElementById('task-dialog').close();
  });
  document.querySelector('#task-dialog form').addEventListener('submit', function () {
    var description = document.getElementById('task-dialog-description').value.trim();
    document.getElementById('custom-description').value = description;
    renderWorkflowSummary();
    saveSelectionState();
    goToStep(2);
  });

  // Clickable progress steps
  var steps = document.querySelectorAll('.progress-step');
  steps.forEach(function (el) {
    el.addEventListener('click', function () {
      var target = parseInt(el.getAttribute('data-step'));
      if (target < currentStep) goToStep(target);
    });
  });
}

function goToStep(n, options) {
  if (n === currentStep || n < 1 || n > TOTAL_STEPS) return;
  var skipHistory = options && options.skipHistory === true;
  var direction = n > currentStep ? 'forward' : 'back';
  var current = document.getElementById('step-' + currentStep);
  current.classList.remove('active');
  // Update progress
  updateProgress(currentStep, n);
  currentStep = n;
  var next = document.getElementById('step-' + n);
  next.style.animation = 'none';
  next.offsetHeight; // reflow
  next.style.animation = direction === 'forward' ? 'accordionOpen 0.3s ease' : 'accordionOpenReverse 0.3s ease';
  next.classList.add('active');
  if (!skipHistory) {
    window.history.pushState({ step: n }, '');
  }
}

function initNavigationHistory() {
  var stateStep = getStepFromHistoryState(window.history.state);
  if (stateStep === null) {
    window.history.replaceState({ step: currentStep }, '');
  } else if (stateStep !== currentStep) {
    goToStep(stateStep, { skipHistory: true });
  }
  window.addEventListener('popstate', function (event) {
    var step = getStepFromHistoryState(event.state);
    if (step !== null) {
      goToStep(step, { skipHistory: true });
    }
  });
}

function getStepFromHistoryState(state) {
  if (!state || typeof state.step !== 'number') return null;
  if (state.step < 1 || state.step > TOTAL_STEPS) return null;
  return state.step;
}

function updateProgress(from, to) {
  var steps = document.querySelectorAll('.progress-step');
  steps.forEach(function (el) {
    var s = parseInt(el.getAttribute('data-step'));
    el.classList.remove('active', 'completed');
    el.removeAttribute('aria-current');
    el.setAttribute('aria-expanded', s === to ? 'true' : 'false');
    if (s < to) el.classList.add('completed');
    else if (s === to) {
      el.classList.add('active');
      el.setAttribute('aria-current', 'step');
    }
    el.disabled = s > to;
    var item = el.closest('.recipe-item');
    if (item) {
      item.classList.toggle('active', s === to);
      item.classList.toggle('completed', s < to);
    }
  });
  // Update checkmarks
  steps.forEach(function (el) {
    var ind = el.querySelector('.step-indicator');
    var s = parseInt(el.getAttribute('data-step'));
    ind.textContent = el.classList.contains('completed') ? '✓' : s;
  });
  document.getElementById('recipe-step-status').textContent = 'Step ' + to + ' of ' + TOTAL_STEPS;
}

// ── Form events ────────────────────────────────────────────────────────────
function bindFormEvents() {
  // Step 1: archetype radios
  document.querySelectorAll('input[name="archetype"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      updateCardSelection('#archetype-options', 'radio');
      document.getElementById('next-1').disabled = false;
      var customField = document.getElementById('custom-description-field');
      customField.classList.add('visible');
      // Selecting a new "what" scenario invalidates any downstream choices made for the previous one.
      clearDownstreamSelections(radio.value);
      // Auto-fill triggers/outputs from archetype data
      prefillFromArchetype(radio.value);
      openTaskDialog(radio.value);
    });
  });

  // Step 2: trigger checkboxes
  document.querySelectorAll('input[name="trigger"]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      updateCardSelection('#trigger-options', 'checkbox');
      document.getElementById('next-2').disabled = !hasChecked('trigger');
    });
  });

  // Step 3: output checkboxes
  document.querySelectorAll('input[name="output"]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      updateCardSelection('#output-options', 'checkbox');
      document.getElementById('next-3').disabled = !hasChecked('output');
    });
  });

  // Step 4: extras (optional checkboxes, no validation needed)
  document.querySelectorAll('input[name="extra"]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      updateCardSelection('#data-options', 'checkbox');
    });
  });

  // Step 5: engine radio cards
  document.querySelectorAll('input[name="engine"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      updateCardSelection('#engine-options', 'radio');
      if (currentStep === 6) refreshPreview();
    });
  });
  updateCardSelection('#engine-options', 'radio');

  document.querySelectorAll('input').forEach(function (input) {
    input.addEventListener('change', function () {
      renderWorkflowSummary();
      saveSelectionState();
    });
  });
  document.querySelectorAll('textarea').forEach(function (textarea) {
    textarea.addEventListener('input', function () {
      renderWorkflowSummary();
      saveSelectionState();
    });
  });
  document.getElementById('custom-description').addEventListener('input', function () {
    document.getElementById('next-1').disabled = !this.value.trim();
  });
}

function openTaskDialog(archetypeId) {
  var archetype = getArchetype(patterns, archetypeId);
  var description = archetypeId === 'custom'
    ? ''
    : (archetype && archetype.description) || '';
  document.getElementById('custom-description').value = description;
  document.getElementById('task-dialog-description').value = description;
  document.getElementById('next-1').disabled = !description;
  document.getElementById('task-dialog').showModal();
  document.getElementById('task-dialog-description').focus();
}

// Reset any selections that depend on the "what" (archetype) choice, since they
// no longer apply once a different scenario is picked.
function clearDownstreamSelections(archetypeId) {
  document.getElementById('data-description').value = '';
}

function updateCardSelection(containerSel, type) {
  var cards = document.querySelectorAll(containerSel + ' .option-card');
  cards.forEach(function (card) {
    var input = card.querySelector('input');
    card.classList.toggle('selected', input.checked);
  });
}

function hasChecked(name) {
  return document.querySelectorAll('input[name="' + name + '"]:checked').length > 0;
}

function prefillFromArchetype(id) {
  var recommendation = getRecommendedConfiguration(patterns, id);
  if (!recommendation.triggers.length && !recommendation.outputs.length) return;

  // Pre-check recommended triggers
  document.querySelectorAll('input[name="trigger"]').forEach(function (cb) { cb.checked = false; });
  recommendation.triggers.forEach(function (trigger) {
    var cb = document.querySelector('input[name="trigger"][value="' + trigger + '"]');
    if (cb) cb.checked = true;
  });
  updateCardSelection('#trigger-options', 'checkbox');
  document.getElementById('next-2').disabled = !hasChecked('trigger');

  // Pre-check recommended outputs
  document.querySelectorAll('input[name="output"]').forEach(function (cb) { cb.checked = false; });
  recommendation.outputs.forEach(function (output) {
    var cb = document.querySelector('input[name="output"][value="' + output + '"]');
    if (cb) cb.checked = true;
  });
  updateCardSelection('#output-options', 'checkbox');
  document.getElementById('next-3').disabled = !hasChecked('output');

  // Reset extras
  document.querySelectorAll('input[name="extra"]').forEach(function (cb) { cb.checked = false; });
  updateCardSelection('#data-options', 'checkbox');
}

// ── Gather answers ─────────────────────────────────────────────────────────
function gatherAnswers() {
  var arch = document.querySelector('input[name="archetype"]:checked');
  var triggers = [];
  document.querySelectorAll('input[name="trigger"]:checked').forEach(function (cb) { triggers.push(cb.value); });
  var outputs = [];
  document.querySelectorAll('input[name="output"]:checked').forEach(function (cb) { outputs.push(cb.value); });
  var extras = [];
  document.querySelectorAll('input[name="extra"]:checked').forEach(function (cb) { extras.push(cb.value); });
  var archetypeId = arch ? arch.value : 'custom';

  return {
    archetype: archetypeId,
    customDescription: document.getElementById('custom-description').value.trim(),
    triggers: triggers,
    outputs: outputs,
    engine: (document.querySelector('input[name="engine"]:checked') || { value: 'copilot' }).value,
    extras: extras,
    needsData: inferNeedsPreSteps(archetypeId),
    dataDescription: document.getElementById('data-description').value.trim()
  };
}

// ── Selection persistence (localStorage) ────────────────────────────────────
function currentSelectionState() {
  var arch = document.querySelector('input[name="archetype"]:checked');
  var triggers = [];
  document.querySelectorAll('input[name="trigger"]:checked').forEach(function (cb) { triggers.push(cb.value); });
  var outputs = [];
  document.querySelectorAll('input[name="output"]:checked').forEach(function (cb) { outputs.push(cb.value); });
  var extras = [];
  document.querySelectorAll('input[name="extra"]:checked').forEach(function (cb) { extras.push(cb.value); });
  var engine = document.querySelector('input[name="engine"]:checked');

  return {
    archetype: arch ? arch.value : null,
    customDescription: document.getElementById('custom-description').value,
    triggers: triggers,
    outputs: outputs,
    extras: extras,
    engine: engine ? engine.value : null,
    dataDescription: document.getElementById('data-description').value
  };
}

function saveSelectionState() {
  try {
    localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(currentSelectionState()));
  } catch (e) {
    // Ignore storage failures; the selections still apply for this page load.
  }
}

function loadSelectionState() {
  try {
    var raw = localStorage.getItem(SELECTION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function restoreSelectionState() {
  var state = loadSelectionState();
  if (!state) return;

  if (state.archetype) {
    var archRadio = document.querySelector('input[name="archetype"][value="' + state.archetype + '"]');
    if (archRadio) archRadio.checked = true;
  }
  updateCardSelection('#archetype-options', 'radio');
  document.getElementById('next-1').disabled = !state.archetype;
  document.getElementById('custom-description-field').classList.toggle('visible', Boolean(state.archetype));
  if (state.customDescription != null) document.getElementById('custom-description').value = state.customDescription;

  (state.triggers || []).forEach(function (trigger) {
    var cb = document.querySelector('input[name="trigger"][value="' + trigger + '"]');
    if (cb) cb.checked = true;
  });
  updateCardSelection('#trigger-options', 'checkbox');
  document.getElementById('next-2').disabled = !hasChecked('trigger');

  (state.outputs || []).forEach(function (output) {
    var cb = document.querySelector('input[name="output"][value="' + output + '"]');
    if (cb) cb.checked = true;
  });
  updateCardSelection('#output-options', 'checkbox');
  document.getElementById('next-3').disabled = !hasChecked('output');

  (state.extras || []).forEach(function (extra) {
    var cb = document.querySelector('input[name="extra"][value="' + extra + '"]');
    if (cb) cb.checked = true;
  });
  updateCardSelection('#data-options', 'checkbox');

  if (state.dataDescription != null) document.getElementById('data-description').value = state.dataDescription;

  if (state.engine) {
    var engineRadio = document.querySelector('input[name="engine"][value="' + state.engine + '"]');
    if (engineRadio) engineRadio.checked = true;
  }
  updateCardSelection('#engine-options', 'radio');
}

function renderWorkflowSummary() {
  var summary = buildWorkflowSummary(gatherAnswers(), patterns);
  updateSummaryClause('summary-purpose', summary.purpose);
  updateSummaryClause('summary-trigger', summary.trigger);
  updateSummaryClause('summary-output', summary.output);
  updateSummaryClause('summary-context', {
    value: summary.context ? 'With ' + summary.context + '.' : 'choose how it works',
    complete: Boolean(summary.context)
  });
  updateSummaryClause('summary-engine', summary.engine);
}

function updateSummaryClause(id, clause) {
  var value = document.getElementById(id);
  value.textContent = clause.value;
  value.parentElement.classList.toggle('is-placeholder', !clause.complete);
  var item = value.closest('.recipe-item');
  if (item) item.classList.toggle('is-placeholder', !clause.complete);
}

// ── Preview rendering ──────────────────────────────────────────────────────
function showPreview(md) {
  var el = document.getElementById('preview-code');
  el.innerHTML = highlightMarkdown(md);
}


// ── Clipboard ──────────────────────────────────────────────────────────────
function copyToClipboard() {
  var text = generatedPrompt;
  navigator.clipboard.writeText(text).then(function () {
    showToast('Copied to clipboard!');
  }).catch(function () {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Copied to clipboard!');
  });
}

function showToast(msg) {
  var toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(function () { toast.classList.remove('show'); }, 2500);
}

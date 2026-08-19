// DOM wiring for the wizard UI.

import { loadPatterns, getRecommendedConfiguration } from './patterns.js';
import {
  inferNeedsPreSteps,
  generateAgentPrompt
} from './workflow.js';
import { highlightMarkdown } from './highlight.js';
import { initTheme } from './theme.js';
import { initLanding } from './landing.js';
import { buildWorkflowSummary } from './summary.js';
import { engineIconMarkup, formatEngineOptionLabel, loadDefinitionEngines, registerDefinitionEngines } from './engines.js';

let patterns = null;
let currentStep = 1;
let generatedPrompt = '';
const TOTAL_STEPS = 6;

export function initWizard() {
  initTheme();
  loadPatterns().then((data) => {
    patterns = data;
    renderWorkflowSummary();
  });
  bindNavigation();
  bindFormEvents();
  loadDefinitionEngines().then((engines) => {
    registerDefinitionEngines(engines);
    addDefinitionEngineOptions(engines);
  });
  initNavigationHistory();
  initLanding(focusFirstArchetype);
  renderWorkflowSummary();
}

function focusFirstArchetype() {
  var first = document.querySelector('#archetype-options input[type="radio"]');
  if (first) first.focus();
}

function generateAndShow() {
  refreshGeneratedContent();
  goToStep(6);
  showPreview(generatedPrompt);
}

function refreshPreview() {
  refreshGeneratedContent();
  showPreview(generatedPrompt);
}

function refreshGeneratedContent() {
  const answers = gatherAnswers();
  generatedPrompt = generateAgentPrompt(answers, patterns);
}

// ── Navigation ─────────────────────────────────────────────────────────────
function bindNavigation() {
  document.getElementById('btn-copy').addEventListener('click', copyToClipboard);

  // Clickable progress steps
  const steps = document.querySelectorAll('.progress-step');
  steps.forEach((el) => {
    el.addEventListener('click', () => {
      const target = parseInt(el.getAttribute('data-step'));
      if (target === currentStep) {
        toggleCurrentStep();
        return;
      }
      if (target < currentStep) {
        goToStep(target);
        return;
      }
      for (let i = 0; i < TOTAL_STEPS && target > currentStep; i++) {
        const previousStep = currentStep;
        if (!advanceOneStepLikeNext()) break;
        if (currentStep === previousStep) break;
      }
    });
  });
  syncProgressStepAvailability();
}

function toggleCurrentStep() {
  const step = document.getElementById(`step-${  currentStep}`);
  const isOpen = step.classList.toggle('active');
  const tab = document.querySelector(`.progress-step[data-step="${  currentStep  }"]`);
  tab.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function advanceOneStepLikeNext() {
  if (currentStep >= 1 && currentStep <= 4) {
    if (currentStep + 1 > maxReachableStep(hasChecked('archetype'))) return false;
    goToStep(currentStep + 1);
    return true;
  }
  if (currentStep === 5) {
    generateAndShow();
    return true;
  }
  return false;
}

function goToStep(n, options) {
  if (n === currentStep || n < 1 || n > TOTAL_STEPS) return;
  const skipHistory = options && options.skipHistory === true;
  const direction = n > currentStep ? 'forward' : 'back';
  const current = document.getElementById(`step-${  currentStep}`);
  current.classList.remove('active');
  // Update progress
  updateProgress(currentStep, n);
  currentStep = n;
  const next = document.getElementById(`step-${  n}`);
  next.style.animation = 'none';
  next.offsetHeight; // reflow
  next.style.animation = direction === 'forward' ? 'accordionOpen 0.3s ease' : 'accordionOpenReverse 0.3s ease';
  next.classList.add('active');
  if (!skipHistory) {
    window.history.pushState({ step: n }, '');
  }
}

function initNavigationHistory() {
  const stateStep = getStepFromHistoryState(window.history.state);
  if (stateStep === null) {
    window.history.replaceState({ step: currentStep }, '');
  } else if (stateStep !== currentStep) {
    goToStep(stateStep, { skipHistory: true });
  }
  window.addEventListener('popstate', (event) => {
    const step = getStepFromHistoryState(event.state);
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
  const steps = document.querySelectorAll('.progress-step');
  steps.forEach((el) => {
    const s = parseInt(el.getAttribute('data-step'));
    el.classList.remove('active', 'completed');
    el.removeAttribute('aria-current');
    el.setAttribute('aria-expanded', s === to ? 'true' : 'false');
    if (s < to) el.classList.add('completed');
    else if (s === to) {
      el.classList.add('active');
      el.setAttribute('aria-current', 'step');
    }
    const item = el.closest('.recipe-item');
    if (item) {
      item.classList.toggle('active', s === to);
      item.classList.toggle('completed', s < to);
    }
  });
  syncProgressStepAvailability();
  // Update checkmarks
  steps.forEach((el) => {
    const ind = el.querySelector('.step-indicator');
    const s = parseInt(el.getAttribute('data-step'));
    if (el.classList.contains('completed')) {
      ind.innerHTML = '<svg class="octicon" aria-hidden="true"><use href="#octicon-check"></use></svg>';
    } else {
      ind.textContent = s;
    }
  });
}

export function maxReachableStep(hasArchetype) {
  return hasArchetype ? TOTAL_STEPS : 1;
}

function syncProgressStepAvailability() {
  const maxStep = maxReachableStep(hasChecked('archetype'));
  document.querySelectorAll('.progress-step').forEach((el) => {
    const step = parseInt(el.getAttribute('data-step'));
    el.disabled = step > maxStep;
  });
}

// ── Form events ────────────────────────────────────────────────────────────

// Native radio inputs cannot be unchecked by clicking them again. This wires up
// each radio in the group so that clicking (or pressing Space on) an already-
// selected item unchecks it and invokes `onDeselect` instead.
function bindRadioDeselect(radios, onDeselect) {
  radios.forEach((radio) => {
    // Track whether the radio was already selected before the click so we can
    // toggle it off. The `mousedown` listener is bound to the enclosing card
    // rather than the radio itself: users click anywhere on the card, and that
    // press lands on whatever element is under the pointer (the label, icon,
    // or text), not necessarily the (sometimes visually hidden) input.
    const card = radio.closest('.option-card') || radio;
    let wasChecked = false;
    card.addEventListener('mousedown', () => {
      wasChecked = radio.checked;
    });
    radio.addEventListener('keydown', (e) => {
      // Chrome does not fire `click` when Space is pressed on an already-checked
      // radio, so handle keyboard deselection here to match the pointer behaviour.
      if ((e.key === ' ' || e.key === 'Spacebar') && radio.checked) {
        e.preventDefault();
        radio.checked = false;
        onDeselect();
      }
    });
    radio.addEventListener('click', () => {
      // Note: no preventDefault() here. Calling it would make the browser treat
      // the click as canceled, which reverts `checked` back to its pre-click
      // value (still `true`, since the click didn't change the checked radio in
      // the group) *after* every listener finishes — undoing the manual uncheck
      // below.
      if (wasChecked) {
        radio.checked = false;
        onDeselect();
      }
    });
  });
}

function bindFormEvents() {
  // Step 1: archetype radios
  const archetypeRadios = document.querySelectorAll('input[name="archetype"]');
  const archetypeGroup = document.getElementById('archetype-options');
  bindRadioDeselect(archetypeRadios, clearArchetypeSelection);

  // Arrow keys move focus *and* selection between radios in a native
  // radiogroup, firing a `change` event just like a click does. Auto-advancing
  // to step 2 on every `change` would eject keyboard focus from the group
  // while the user is still browsing options with the arrow keys (WCAG 2.1.1 /
  // 2.4.3 / 3.2.2). Track arrow-key navigation so the auto-advance below only
  // fires for a discrete selection (click, or Enter/Space), and otherwise
  // defer it until focus actually leaves the radiogroup.
  let arrowKeyNav = false;
  archetypeGroup.addEventListener('keydown', (e) => {
    const isArrow = e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight';
    if (isArrow && e.target && e.target.name === 'archetype') arrowKeyNav = true;
  });
  archetypeGroup.addEventListener('focusout', () => {
    setTimeout(() => {
      if (archetypeGroup.contains(document.activeElement)) return;
      const checked = archetypeGroup.querySelector('input[name="archetype"]:checked');
      if (checked && checked.value !== 'custom' && currentStep === 1) goToStep(2);
    }, 0);
  });

  archetypeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      updateCardSelection('#archetype-options', 'radio');
      const customField = document.getElementById('custom-description-field');
      customField.classList.toggle('visible', radio.value === 'custom');
      // Selecting a new "what" scenario invalidates any downstream choices made for the previous one.
      clearDownstreamSelections(radio.value);
      // Auto-fill triggers/outputs from archetype data
      prefillFromArchetype(radio.value);
      if (radio.value !== 'custom') {
        if (arrowKeyNav) {
          // Leave focus on the radio the user just navigated to; step 2 will
          // be shown once focus leaves the radiogroup (see `focusout` above).
          arrowKeyNav = false;
          return;
        }
        const hadFocus = document.activeElement === radio;
        goToStep(2);
        // The collapsing step would otherwise drop keyboard focus to the body.
        const nextClause = document.querySelector('.recipe-clause[data-step="2"]');
        if (hadFocus && nextClause) nextClause.focus();
      }
    });
  });

  // Step 2: trigger checkboxes
  document.querySelectorAll('input[name="trigger"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      updateCardSelection('#trigger-options', 'checkbox');
    });
  });

  // Step 3: output checkboxes
  document.querySelectorAll('input[name="output"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      updateCardSelection('#output-options', 'checkbox');
    });
  });

  // Step 4: extras (optional checkboxes, no validation needed)
  document.querySelectorAll('input[name="extra"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      updateCardSelection('#extras-options', 'checkbox');
      if (currentStep === 6) refreshPreview();
    });
  });

  // Step 5: engine radio cards
  const engineOptions = document.getElementById('engine-options');
  bindRadioDeselect(engineOptions.querySelectorAll('input[name="engine"]'), clearEngineSelection);
  engineOptions.addEventListener('change', (event) => {
    if (event.target.name === 'engine') {
      updateCardSelection('#engine-options', 'radio');
      if (currentStep === 6) refreshPreview();
    }
  });
  updateCardSelection('#engine-options', 'radio');

  document.addEventListener('change', (event) => {
    if (event.target.matches('input')) {
      renderWorkflowSummary();
      syncProgressStepAvailability();
    }
  });
}

function addDefinitionEngineOptions(engines) {
  const container = document.getElementById('engine-options');
  const existing = new Set(Array.from(container.querySelectorAll('input[name="engine"]')).map((input) => {
    return input.value;
  }));
  const added = [];

  engines.forEach((engine) => {
    if (existing.has(engine.id)) return;
    existing.add(engine.id);

    const card = document.createElement('label');
    card.className = 'option-card';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'engine';
    input.value = engine.id;

    const info = document.createElement('div');
    info.className = 'option-info';

    const label = document.createElement('div');
    label.className = 'option-label option-label-with-icon option-label-with-engine-icon';
    label.innerHTML = engineIconMarkup(engine.id);
    label.appendChild(document.createTextNode(formatEngineOptionLabel(engine.id)));

    info.append(label);
    card.append(input, info);
    container.appendChild(card);
    added.push(input);
  });

  bindRadioDeselect(added, clearEngineSelection);
}

// Reset any selections that depend on the "what" (archetype) choice, since they
// no longer apply once a different scenario is picked.
function clearDownstreamSelections(archetypeId) {
  if (archetypeId !== 'custom') {
    document.getElementById('custom-description').value = '';
  }
}

// Fully clear the "what" (archetype) choice and every downstream selection that
// depended on it. Used when the user clicks an already-selected activity card
// to deselect it.
function clearArchetypeSelection() {
  document.querySelectorAll('input[name="archetype"]').forEach((radio) => { radio.checked = false; });
  updateCardSelection('#archetype-options', 'radio');
  document.getElementById('custom-description-field').classList.remove('visible');
  clearDownstreamSelections(null);

  document.querySelectorAll('input[name="trigger"]').forEach((cb) => { cb.checked = false; });
  updateCardSelection('#trigger-options', 'checkbox');

  document.querySelectorAll('input[name="output"]').forEach((cb) => { cb.checked = false; });
  updateCardSelection('#output-options', 'checkbox');

  document.querySelectorAll('input[name="extra"]').forEach((cb) => { cb.checked = false; });
  updateCardSelection('#extras-options', 'checkbox');
  renderWorkflowSummary();
  syncProgressStepAvailability();
}

// Deselect the engine choice. Used when the user clicks an already-selected
// engine card to deselect it.
function clearEngineSelection() {
  document.querySelectorAll('input[name="engine"]').forEach((radio) => { radio.checked = false; });
  updateCardSelection('#engine-options', 'radio');
  renderWorkflowSummary();
  syncProgressStepAvailability();
  if (currentStep === 6) refreshPreview();
}

function updateCardSelection(containerSel) {
  const cards = document.querySelectorAll(`${containerSel  } .option-card`);
  cards.forEach((card) => {
    const input = card.querySelector('input');
    card.classList.toggle('selected', input.checked);
  });
}

function hasChecked(name) {
  return document.querySelectorAll(`input[name="${  name  }"]:checked`).length > 0;
}

function prefillFromArchetype(id) {
  const recommendation = getRecommendedConfiguration(patterns, id);
  if (!recommendation.triggers.length && !recommendation.outputs.length) return;

  // Pre-check recommended triggers
  document.querySelectorAll('input[name="trigger"]').forEach((cb) => { cb.checked = false; });
  recommendation.triggers.forEach((trigger) => {
    const cb = document.querySelector(`input[name="trigger"][value="${  trigger  }"]`);
    if (cb) cb.checked = true;
  });
  updateCardSelection('#trigger-options', 'checkbox');

  // Pre-check recommended outputs
  document.querySelectorAll('input[name="output"]').forEach((cb) => { cb.checked = false; });
  recommendation.outputs.forEach((output) => {
    const cb = document.querySelector(`input[name="output"][value="${  output  }"]`);
    if (cb) cb.checked = true;
  });
  updateCardSelection('#output-options', 'checkbox');

  // Reset extras
  document.querySelectorAll('input[name="extra"]').forEach((cb) => { cb.checked = false; });
  updateCardSelection('#extras-options', 'checkbox');
}

// ── Gather answers ─────────────────────────────────────────────────────────
function gatherAnswers() {
  const arch = document.querySelector('input[name="archetype"]:checked');
  const triggers = [];
  document.querySelectorAll('input[name="trigger"]:checked').forEach((cb) => { triggers.push(cb.value); });
  const outputs = [];
  document.querySelectorAll('input[name="output"]:checked').forEach((cb) => { outputs.push(cb.value); });
  const extras = [];
  document.querySelectorAll('input[name="extra"]:checked').forEach((cb) => { extras.push(cb.value); });
  const archetypeId = arch ? arch.value : 'custom';

  return {
    archetype: archetypeId,
    customDescription: document.getElementById('custom-description').value.trim(),
    triggers,
    outputs,
    engine: (document.querySelector('input[name="engine"]:checked') || {}).value || null,
    extras,
    needsData: inferNeedsPreSteps(archetypeId)
  };
}

function renderWorkflowSummary() {
  const summary = buildWorkflowSummary(gatherAnswers(), patterns);
  updateSummaryClause('summary-purpose', summary.purpose);
  updateSummaryClause('summary-trigger', summary.trigger);
  updateSummaryClause('summary-output', summary.output);
  updateSummaryClause('summary-extras', summary.extras);
  updateSummaryClause('summary-engine', summary.engine);
}

function updateSummaryClause(id, clause) {
  const value = document.getElementById(id);
  value.textContent = clause.value;
  value.parentElement.classList.toggle('is-placeholder', !clause.complete);
  const item = value.closest('.recipe-item');
  if (item) item.classList.toggle('is-placeholder', !clause.complete);
}

// ── Preview rendering ──────────────────────────────────────────────────────
function showPreview(md) {
  const el = document.getElementById('preview-code');
  el.innerHTML = highlightMarkdown(md);
}


// ── Clipboard ──────────────────────────────────────────────────────────────
function copyToClipboard() {
  const text = generatedPrompt;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!');
  }).catch(() => {
    const ta = document.createElement('textarea');
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
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => { toast.classList.remove('show'); }, 2500);
}

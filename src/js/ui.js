// DOM wiring for the wizard UI.

import { loadPatterns, getArchetype } from './patterns.js';
import {
  workflowName,
  inferNeedsPreSteps,
  generateWorkflowFile,
  generateAgentPrompt
} from './workflow.js';
import { highlightMarkdown } from './highlight.js';
import { nextStepsHtml } from './next-steps.js';
import { initTheme } from './theme.js';

var patterns = null;
var currentStep = 1;
var generatedMd = '';
var generatedPrompt = '';
var currentFormat = 'workflow';

export function initWizard() {
  initTheme();
  loadPatterns().then(function (data) { patterns = data; });
  bindNavigation();
  bindFormEvents();
}

function generateAndShow() {
  var answers = gatherAnswers();
  generatedMd = generateWorkflowFile(answers, patterns);
  generatedPrompt = generateAgentPrompt(answers, patterns);
  currentFormat = 'workflow';
  document.querySelectorAll('.format-btn').forEach(function (b) { b.classList.remove('active'); });
  document.getElementById('fmt-workflow').classList.add('active');
  goToStep(5);
  showPreview(generatedMd);
  showNextSteps('workflow');
  var name = workflowName(answers.archetype, answers.customDescription);
  document.getElementById('preview-filename').textContent = name + '.md';
  document.getElementById('btn-download').style.display = '';
}

function switchFormat(fmt) {
  var answers = gatherAnswers();
  var name = workflowName(answers.archetype, answers.customDescription);
  if (fmt === 'prompt') {
    showPreview(generatedPrompt);
    document.getElementById('preview-filename').textContent = 'prompt.txt';
    document.getElementById('btn-download').style.display = 'none';
  } else {
    showPreview(generatedMd);
    document.getElementById('preview-filename').textContent = name + '.md';
    document.getElementById('btn-download').style.display = '';
  }
  showNextSteps(fmt);
}

function showNextSteps(format) {
  var panel = document.getElementById('next-steps-panel');
  if (!panel) return;
  var answers = gatherAnswers();
  panel.innerHTML = nextStepsHtml(format, workflowName(answers.archetype, answers.customDescription));
}

// ── Navigation ─────────────────────────────────────────────────────────────
function bindNavigation() {
  document.getElementById('next-1').addEventListener('click', function () { goToStep(2); });
  document.getElementById('next-2').addEventListener('click', function () { goToStep(3); });
  document.getElementById('next-3').addEventListener('click', function () { goToStep(4); });
  document.getElementById('next-4').addEventListener('click', function () { generateAndShow(); });
  document.getElementById('prev-2').addEventListener('click', function () { goToStep(1); });
  document.getElementById('prev-3').addEventListener('click', function () { goToStep(2); });
  document.getElementById('prev-4').addEventListener('click', function () { goToStep(3); });
  document.getElementById('prev-5').addEventListener('click', function () { goToStep(4); });

  document.getElementById('btn-copy').addEventListener('click', copyToClipboard);
  document.getElementById('btn-download').addEventListener('click', downloadFile);

  // Format toggle
  document.querySelectorAll('.format-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var fmt = btn.getAttribute('data-format');
      if (fmt === currentFormat) return;
      currentFormat = fmt;
      document.querySelectorAll('.format-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      switchFormat(fmt);
    });
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

function goToStep(n) {
  var direction = n > currentStep ? 'forward' : 'back';
  var current = document.getElementById('step-' + currentStep);
  current.classList.remove('active');
  // Update progress
  updateProgress(currentStep, n);
  currentStep = n;
  var next = document.getElementById('step-' + n);
  next.style.animation = 'none';
  next.offsetHeight; // reflow
  next.style.animation = direction === 'forward' ? 'slideIn 0.3s ease' : 'slideInReverse 0.3s ease';
  next.classList.add('active');
}

function updateProgress(from, to) {
  var steps = document.querySelectorAll('.progress-step');
  steps.forEach(function (el) {
    var s = parseInt(el.getAttribute('data-step'));
    el.classList.remove('active', 'completed');
    if (s < to) el.classList.add('completed');
    else if (s === to) el.classList.add('active');
  });
  // Update checkmarks
  steps.forEach(function (el) {
    var ind = el.querySelector('.step-indicator');
    var s = parseInt(el.getAttribute('data-step'));
    ind.textContent = el.classList.contains('completed') ? '✓' : s;
  });
}

// ── Form events ────────────────────────────────────────────────────────────
function bindFormEvents() {
  // Step 1: archetype radios
  document.querySelectorAll('input[name="archetype"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      updateCardSelection('#archetype-options', 'radio');
      document.getElementById('next-1').disabled = false;
      var customField = document.getElementById('custom-description-field');
      customField.classList.toggle('visible', radio.value === 'custom');
      // Auto-fill triggers/outputs from archetype data
      prefillFromArchetype(radio.value);
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
  var arch = getArchetype(patterns, id);
  if (!arch) return;

  // Pre-check recommended triggers
  document.querySelectorAll('input[name="trigger"]').forEach(function (cb) { cb.checked = false; });
  if (arch.recommended_triggers) {
    arch.recommended_triggers.forEach(function (t) {
      var cb = document.querySelector('input[name="trigger"][value="' + t.type + '"]');
      if (cb) cb.checked = true;
    });
  }
  updateCardSelection('#trigger-options', 'checkbox');
  document.getElementById('next-2').disabled = !hasChecked('trigger');

  // Pre-check recommended outputs
  var outputMap = {
    'issues': ['comments', 'labels', 'new-issues'],
    'pull-requests': ['pull-requests', 'comments'],
    'contents': ['commits']
  };
  document.querySelectorAll('input[name="output"]').forEach(function (cb) { cb.checked = false; });
  if (arch.recommended_safe_outputs) {
    arch.recommended_safe_outputs.forEach(function (so) {
      var vals = outputMap[so] || [];
      vals.forEach(function (v) {
        var cb = document.querySelector('input[name="output"][value="' + v + '"]');
        if (cb) cb.checked = true;
      });
    });
  }
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
    extras: extras,
    needsData: inferNeedsPreSteps(archetypeId),
    dataDescription: document.getElementById('data-description').value.trim()
  };
}



// ── Preview rendering ──────────────────────────────────────────────────────
function showPreview(md) {
  var el = document.getElementById('preview-code');
  el.innerHTML = highlightMarkdown(md);
}


// ── Clipboard & download ───────────────────────────────────────────────────
function copyToClipboard() {
  var text = currentFormat === 'prompt' ? generatedPrompt : generatedMd;
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

function downloadFile() {
  var answers = gatherAnswers();
  var name = workflowName(answers.archetype, answers.customDescription);
  var blob = new Blob([generatedMd], { type: 'text/markdown' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = name + '.md';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Downloaded ' + name + '.md');
}

function showToast(msg) {
  var toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(function () { toast.classList.remove('show'); }, 2500);
}

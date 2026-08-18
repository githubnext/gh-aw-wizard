(function () {
  'use strict';

  let patterns = null;
  let currentStep = 1;
  let generatedMd = '';
  let generatedPrompt = '';
  let currentFormat = 'workflow';

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    loadPatterns();
    bindNavigation();
    bindFormEvents();
  });

  // ── Data loading ───────────────────────────────────────────────────────────
  function loadPatterns() {
    fetch('patterns.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        patterns = data;
      })
      .catch(function () {
        // patterns unavailable — generator still works with defaults
      });
  }

  function getArchetype(id) {
    if (!patterns) return null;
    for (var i = 0; i < patterns.archetypes.length; i++) {
      if (patterns.archetypes[i].id === id) return patterns.archetypes[i];
    }
    return null;
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
    var arch = getArchetype(id);
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

  function inferNeedsPreSteps(archetype) {
    // These archetypes deal with lots of data — auto-add pre-steps
    return ['status-report', 'dependency-monitor', 'upstream-monitor'].indexOf(archetype) !== -1;
  }

  function inferCapabilities(archetype) {
    // Auto-infer what tools/capabilities the archetype needs
    var caps = { preSteps: false, bash: false, githubToolsets: false };
    switch (archetype) {
      case 'status-report':
        caps.preSteps = true; caps.githubToolsets = true; break;
      case 'dependency-monitor':
      case 'upstream-monitor':
        caps.preSteps = true; caps.bash = true; break;
      case 'code-improvement':
      case 'documentation-updater':
        caps.bash = true; break;
    }
    return caps;
  }

  // ── Generate prompt ────────────────────────────────────────────────────────
  function generateAndShow() {
    var answers = gatherAnswers();
    generatedMd = generateWorkflowFile(answers);
    generatedPrompt = generateAgentPrompt(answers);
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

  function workflowName(archetype, customDesc) {
    if (archetype === 'custom' && customDesc) {
      return customDesc.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'custom-workflow';
    }
    return archetype;
  }

  function generateWorkflowFile(answers) {
    var arch = getArchetype(answers.archetype);
    var name = workflowName(answers.archetype, answers.customDescription);
    var label = arch ? arch.label : 'Custom Workflow';
    var desc = arch ? arch.description : answers.customDescription || 'Custom agentic workflow';

    // Build tools and safe-outputs
    var toolSet = new Set();
    var safeSet = new Set();
    answers.outputs.forEach(function (o) {
      switch (o) {
        case 'comments':
          toolSet.add('add-comment'); safeSet.add('issues'); safeSet.add('pull-requests'); break;
        case 'labels':
          toolSet.add('add-label'); safeSet.add('issues'); break;
        case 'new-issues':
          toolSet.add('create-issue'); safeSet.add('issues'); break;
        case 'pull-requests':
          toolSet.add('create-pull-request'); safeSet.add('pull-requests'); break;
        case 'commits':
          toolSet.add('commit-files'); safeSet.add('contents'); break;
      }
    });
    var tools = Array.from(toolSet);
    var safeOutputs = Array.from(safeSet);

    // Timeout
    var timeout = (arch && arch.timeout_minutes) ? arch.timeout_minutes : 30;
    if (patterns && patterns.config_defaults && patterns.config_defaults.timeout_by_trigger) {
      answers.triggers.forEach(function (t) {
        var val = patterns.config_defaults.timeout_by_trigger[t];
        if (val && val > timeout) timeout = val;
      });
    }

    // Trigger config YAML
    var triggerYaml = buildTriggerYaml(answers.triggers);

    // Frontmatter — auto-infer capabilities from archetype
    var inferred = inferCapabilities(answers.archetype);
    var extras = answers.extras || [];
    var fm = '---\n';
    fm += 'name: ' + name + '\n';
    fm += 'description: ' + desc + '\n';
    fm += 'on:\n' + triggerYaml;

    // Tools section
    fm += 'tools:\n';
    tools.forEach(function (t) { fm += '  - ' + t + '\n'; });
    if (inferred.bash) {
      fm += '  bash: true\n';
    }
    if (inferred.githubToolsets) {
      fm += '  github:\n';
      fm += '    toolsets: [repos, issues, pull_requests, actions, code_security, discussions]\n';
    }
    if (extras.indexOf('memory') !== -1) {
      fm += '  cache-memory:\n';
    }

    fm += 'safe-outputs:\n';
    safeOutputs.forEach(function (s) { fm += '  - ' + s + '\n'; });
    fm += 'timeout-minutes: ' + timeout + '\n';

    fm += '---\n\n';

    // Add project context if provided
    var context = answers.dataDescription;
    var contextSection = '';
    if (context) {
      contextSection = '## Project Context\n\n' + context + '\n\n';
    }

    // Body — varies by archetype
    var body = '';
    switch (answers.archetype) {
      case 'issue-triage':
        body = buildIssueTriage(answers, label);
        break;
      case 'code-improvement':
        body = buildCodeImprovement(answers, label);
        break;
      case 'status-report':
        body = buildStatusReport(answers, label);
        break;
      case 'dependency-monitor':
        body = buildDependencyMonitor(answers, label);
        break;
      case 'content-moderation':
        body = buildContentModeration(answers, label);
        break;
      case 'upstream-monitor':
        body = buildUpstreamMonitor(answers, label);
        break;
      case 'documentation-updater':
        body = buildDocumentationUpdater(answers, label);
        break;
      case 'pr-review':
        body = buildPrReview(answers, label);
        break;
      default:
        body = buildCustom(answers, label);
    }

    return fm + body + contextSection;
  }

  function buildTriggerYaml(triggers) {
    var lines = '';
    triggers.forEach(function (t) {
      switch (t) {
        case 'issues':
          lines += '  issues:\n    types: [opened]\n'; break;
        case 'pull_request':
          lines += '  pull_request:\n    types: [opened]\n'; break;
        case 'schedule':
          lines += '  schedule:\n    - cron: "0 9 * * 1-5"\n'; break;
        case 'workflow_dispatch':
          lines += '  workflow_dispatch:\n'; break;
        case 'issue_comment':
          lines += '  issue_comment:\n    types: [created]\n'; break;
        case 'push':
          lines += '  push:\n    branches: [main]\n'; break;
      }
    });
    return lines;
  }

  // ── Coding agent prompt ─────────────────────────────────────────────────
  function generateAgentPrompt(answers) {
    var arch = getArchetype(answers.archetype);
    var name = workflowName(answers.archetype, answers.customDescription);
    var label = arch ? arch.label : 'Custom Workflow';
    var desc = arch ? arch.description : answers.customDescription || 'Custom agentic workflow';

    var triggersReadable = answers.triggers.map(function (t) {
      var map = {
        'issues': 'when a new issue is opened',
        'pull_request': 'when a pull request is opened',
        'schedule': 'on a daily/weekly schedule',
        'workflow_dispatch': 'on manual dispatch',
        'issue_comment': 'on slash commands in comments',
        'push': 'on push to main'
      };
      return map[t] || t;
    }).join(', ');

    var outputsReadable = answers.outputs.map(function (o) {
      var map = {
        'comments': 'post comments on issues/PRs',
        'labels': 'add/remove labels',
        'new-issues': 'create new issues',
        'pull-requests': 'open pull requests',
        'commits': 'commit file changes'
      };
      return map[o] || o;
    }).join(', ');

    var prompt = 'Create a workflow for GitHub Agentic Workflows using https://raw.githubusercontent.com/github/gh-aw/main/create.md\n\n';
    prompt += 'The purpose of the workflow is: ' + desc + '\n\n';
    prompt += 'Requirements:\n';
    prompt += '- Name: ' + name + '\n';
    prompt += '- Triggers: ' + triggersReadable + '\n';
    prompt += '- Allowed outputs: ' + outputsReadable + '\n';

    // Auto-inferred capabilities communicated to the agent
    if (answers.needsData) {
      prompt += '- Add a pre-step to fetch external data before the agent runs\n';
    }
    var extras = answers.extras || [];
    if (extras.indexOf('memory') !== -1) {
      prompt += '- Add cache-memory tool for persistent memory across runs\n';
    }
    if (answers.dataDescription) {
      prompt += '- Additional project context: ' + answers.dataDescription + '\n';
    }

    prompt += '\nThe workflow should be saved to .github/workflows/' + name + '.md';
    return prompt;
  }

  // ── Next steps ──────────────────────────────────────────────────────────
  function showNextSteps(format) {
    var panel = document.getElementById('next-steps-panel');
    if (!panel) return;

    var html = '<h3>Next steps</h3>';
    var name = workflowName(gatherAnswers().archetype, gatherAnswers().customDescription);

    if (format === 'workflow') {
      html += step(1, 'Make sure <a href="https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository" target="_blank">GitHub Actions is enabled</a> on your repository');
      html += step(2, 'Install the <a href="https://cli.github.com" target="_blank">GitHub CLI</a> and the Agentic Workflows extension:<br><code>gh extension install github/gh-aw</code>');
      html += step(3, 'Download the <code>.md</code> file and save it to <code>.github/workflows/' + name + '.md</code>');
      html += step(4, 'Set up your AI engine secret — run <code>gh aw add-wizard</code> to configure <a href="https://github.github.com/gh-aw/reference/engines/" target="_blank">Copilot, Claude, or Codex</a>');
      html += step(5, 'Compile the workflow to generate the Actions YAML:<br><code>gh aw compile</code>');
      html += step(6, 'Commit both files and push:<br><code>git add .github/workflows/' + name + '.md .github/workflows/' + name + '.lock.yml && git push</code>');
      html += step(7, 'Trigger a run from the Actions tab or with:<br><code>gh aw run ' + name + '</code>');
    } else {
      html += step(1, 'Make sure <a href="https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository" target="_blank">GitHub Actions is enabled</a> on your repository');
      html += step(2, 'Install the <a href="https://cli.github.com" target="_blank">GitHub CLI</a> and the Agentic Workflows extension:<br><code>gh extension install github/gh-aw</code>');
      html += step(3, 'Copy the prompt above and paste it into your coding agent — <a href="https://code.visualstudio.com/docs/copilot/agents/overview" target="_blank">VS Code Agent Mode</a>, Copilot, Claude, or Codex');
      html += step(4, 'The agent will create a <code>.md</code> file in <code>.github/workflows/</code> — review it');
      html += step(5, 'Set up your AI engine secret with <code>gh aw add-wizard</code> if you haven\'t already');
      html += step(6, 'Compile, commit, and push:<br><code>gh aw compile && git add .github/workflows/ && git push</code>');
      html += step(7, 'Trigger a run from the Actions tab or with:<br><code>gh aw run ' + name + '</code>');
    }

    html += '<div style="margin-top:0.75rem;font-size:0.8rem;color:var(--text-muted);">' +
      '📖 <a href="https://github.github.com/gh-aw/setup/quick-start/" target="_blank" style="color:var(--text-secondary);">Quick start guide</a>' +
      ' · <a href="https://github.github.com/gh-aw/setup/creating-workflows/" target="_blank" style="color:var(--text-secondary);">Creating workflows</a></div>';

    panel.innerHTML = html;
  }

  function step(n, content) {
    return '<div class="next-step"><div class="next-step-num">' + n + '</div><div>' + content + '</div></div>';
  }

  // ── Archetype body builders ────────────────────────────────────────────────
  function preStepsBlock(answers) {
    if (!answers.needsData) return '';
    var desc = answers.dataDescription || 'the required external data';
    var archetype = answers.archetype;
    var block = '## Pre-steps\n\n';

    // Archetype-specific pre-step guidance
    if (archetype === 'status-report') {
      block += 'Before starting, pre-fetch all data sources in a `steps:` block. This is the #1 predictor of workflow health.\n\n' +
        '```yaml\nsteps:\n  - name: Fetch activity data\n    run: |\n      gh api graphql ... > /tmp/activity.json\n    env:\n      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n```\n\n' +
        '1. **Fetch** ' + desc + '\n' +
        '2. **Validate** that the data is complete — check for empty arrays or missing fields\n' +
        '3. **Read** the pre-fetched JSON files from `/tmp/` instead of making API calls at runtime\n\n';
    } else if (archetype === 'dependency-monitor' || archetype === 'upstream-monitor') {
      block += 'Pre-fetch dependency/release data before analysis:\n\n' +
        '1. **Check** upstream repos or package registries for new versions\n' +
        '2. **Compare** against current versions in your project\n' +
        '3. **Prepare** a diff of what changed\n\n';
    } else if (archetype === 'code-improvement') {
      block += 'Run validation before the agent starts making changes:\n\n' +
        '1. **Run tests** to establish baseline — know what already passes\n' +
        '2. **Run linter** to identify existing issues vs new ones\n' +
        '3. **Collect** ' + desc + '\n\n';
    } else if (archetype === 'documentation-updater') {
      block += 'Validate docs build before making changes:\n\n' +
        '1. **Build docs** to confirm the current state compiles\n' +
        '2. **Identify** outdated or missing sections\n' +
        '3. **Fetch** ' + desc + '\n\n';
    } else {
      block += 'Before starting, gather the following:\n\n' +
        '1. **Fetch** ' + desc + '\n' +
        '2. **Validate** that the fetched data is complete and well-formed\n' +
        '3. **Store** the results for use in the steps below\n\n';
    }
    return block;
  }

  function buildIssueTriage(answers, label) {
    return '# ' + label + '\n\n' +
      'You are an **issue triage specialist** for this repository.\n\n' +
      'Your job is to read every newly opened issue, classify it, apply the correct labels, and post a helpful comment.\n\n' +
      preStepsBlock(answers) +
      '## Instructions\n\n' +
      '1. **Read** the issue title and body carefully\n' +
      '2. **Classify** the issue into one of these categories:\n' +
      '   - `bug` — Something is broken or not working as expected\n' +
      '   - `feature` — A request for new functionality\n' +
      '   - `question` — A question about usage or behavior\n' +
      '   - `docs` — Documentation improvement needed\n' +
      '   - `chore` — Maintenance, refactoring, or infrastructure\n' +
      '3. **Apply** the appropriate label(s) to the issue\n' +
      '4. **Comment** on the issue with:\n' +
      '   - A brief acknowledgment\n' +
      '   - The classification you chose and why\n' +
      '   - Any initial guidance or next steps for the author\n\n' +
      '## Rules\n\n' +
      '- Only apply labels that already exist in the repository. Do not create new labels.\n' +
      '- If the issue is unclear or ambiguous, apply a `needs-triage` label and ask the author for clarification.\n' +
      '- Do not attempt to fix the issue or write code. Your job is classification only.\n' +
      '- Be polite and professional in your comments.\n' +
      '- If the issue is a duplicate, note it in your comment but do not close the issue.\n';
  }

  function buildCodeImprovement(answers, label) {
    return '# ' + label + '\n\n' +
      'You are a **code quality engineer** for this repository.\n\n' +
      'Your job is to find one targeted improvement, implement it, validate it, and open a pull request.\n\n' +
      preStepsBlock(answers) +
      '## Phase 1: Analyze\n\n' +
      '1. Scan the codebase for one of these improvement opportunities (pick only one per run):\n' +
      '   - Missing or incomplete test coverage\n' +
      '   - Code that can be simplified or deduplicated\n' +
      '   - Outdated or missing documentation\n' +
      '   - Type safety improvements\n' +
      '2. Choose the single highest-impact improvement you can make\n' +
      '3. Write a brief analysis of what you found and why it matters\n\n' +
      '## Phase 2: Plan\n\n' +
      '1. List the specific files you will modify\n' +
      '2. Describe the exact changes you will make\n' +
      '3. Identify any risks or dependencies\n\n' +
      '## Phase 3: Implement\n\n' +
      '1. Make the changes described in your plan\n' +
      '2. Keep changes minimal and focused — one improvement per PR\n' +
      '3. Follow the existing code style and conventions\n\n' +
      '## Phase 4: Validate\n\n' +
      '1. Verify that existing tests still pass\n' +
      '2. If you added tests, verify they pass\n' +
      '3. Review your own changes for correctness\n\n' +
      '## Rules\n\n' +
      '- One improvement per run. Do not try to fix everything at once.\n' +
      '- Do not change functionality — only improve quality.\n' +
      '- Do not modify generated files, vendored code, or lock files.\n' +
      '- If you cannot find a meaningful improvement, do nothing. Do not create empty PRs.\n' +
      '- PR title must start with the type of improvement: `test:`, `refactor:`, `docs:`, or `types:`.\n';
  }

  function buildStatusReport(answers, label) {
    return '# ' + label + '\n\n' +
      'You are a **project status reporter** for this repository.\n\n' +
      'Your job is to gather activity data and produce a formatted status report as a new issue.\n\n' +
      preStepsBlock(answers) +
      '## Instructions\n\n' +
      '1. **Gather data** for the reporting period (since last report or last 7 days):\n' +
      '   - New issues opened and closed\n' +
      '   - Pull requests opened, merged, and closed\n' +
      '   - Notable commits or releases\n' +
      '   - Active contributors\n' +
      '2. **Generate** the report using the template below\n' +
      '3. **Create** a new issue with the report\n\n' +
      '## Report Template\n\n' +
      'Use this exact format for the report issue:\n\n' +
      '```\n' +
      '## 📊 Weekly Status Report — {date range}\n\n' +
      '### Summary\n' +
      '{2-3 sentence overview of the week}\n\n' +
      '### Issues\n' +
      '- Opened: {count}\n' +
      '- Closed: {count}\n' +
      '- Net change: {+/- count}\n\n' +
      '### Pull Requests\n' +
      '- Opened: {count}\n' +
      '- Merged: {count}\n' +
      '- Closed without merge: {count}\n\n' +
      '### Highlights\n' +
      '- {notable item 1}\n' +
      '- {notable item 2}\n\n' +
      '### Active Contributors\n' +
      '{list of contributors with activity}\n' +
      '```\n\n' +
      '## Rules\n\n' +
      '- Stick to facts. Do not editorialize or make recommendations.\n' +
      '- Use the exact template format above for consistency.\n' +
      '- If there is no activity to report, create a brief report noting that.\n' +
      '- Label the report issue with `status-report`.\n';
  }

  function buildDependencyMonitor(answers, label) {
    return '# ' + label + '\n\n' +
      'You are a **dependency monitor** for this repository.\n\n' +
      'Your job is to check for upstream changes in key dependencies and flag anything that needs attention.\n\n' +
      preStepsBlock(answers) +
      '## Checklist\n\n' +
      'For each monitored dependency, perform these checks:\n\n' +
      '- [ ] **Check latest version**: Compare the currently used version with the latest available release\n' +
      '- [ ] **Review changelog**: Read the changelog or release notes for any new versions\n' +
      '- [ ] **Identify breaking changes**: Flag any breaking changes that could affect this repository\n' +
      '- [ ] **Check security advisories**: Look for any security vulnerabilities in current versions\n' +
      '- [ ] **Assess urgency**: Determine if an update is critical, recommended, or optional\n\n' +
      '## Output\n\n' +
      'If updates are found:\n\n' +
      '1. Create an issue summarizing the findings with a table:\n' +
      '   | Dependency | Current | Latest | Breaking? | Urgency |\n' +
      '   |------------|---------|--------|-----------|---------|\n' +
      '   | {name}     | {ver}   | {ver}  | Yes/No    | {level} |\n\n' +
      '2. If the update is straightforward, open a PR with the version bump\n\n' +
      '## Rules\n\n' +
      '- Do not auto-merge or auto-approve dependency updates.\n' +
      '- Only create a PR for non-breaking, patch-level updates.\n' +
      '- For major version updates, create an issue only — let humans decide.\n' +
      '- If no updates are available, do nothing. Do not create empty reports.\n';
  }

  function buildContentModeration(answers, label) {
    return '# ' + label + '\n\n' +
      'You are a **content moderator** for this repository.\n\n' +
      'Your job is to review new issues and pull requests for spam, abuse, or policy violations.\n\n' +
      preStepsBlock(answers) +
      '## Instructions\n\n' +
      '1. **Read** the issue or PR title, body, and any attached content\n' +
      '2. **Evaluate** against the rules below\n' +
      '3. **Take action** based on your evaluation\n\n' +
      '## Rules for Classification\n\n' +
      '### Spam indicators (flag as `spam`):\n' +
      '- Promotional content unrelated to the project\n' +
      '- Mass-posted identical content across repos\n' +
      '- Links to suspicious or unrelated external sites\n' +
      '- Bot-generated nonsense text\n\n' +
      '### Policy violations (flag as `policy-violation`):\n' +
      '- Abusive, harassing, or threatening language directed at contributors\n' +
      '- Content that violates the project\'s code of conduct\n' +
      '- Deliberately misleading or malicious content\n\n' +
      '### Legitimate content:\n' +
      '- Bug reports, feature requests, and questions — even if poorly written\n' +
      '- Content in non-English languages (do not flag for language)\n' +
      '- Beginner questions or first-time contributions\n\n' +
      '## Actions\n\n' +
      '- **If spam**: Apply `spam` label and comment explaining why it was flagged\n' +
      '- **If policy violation**: Apply `policy-violation` label and comment with a link to the code of conduct\n' +
      '- **If legitimate**: Do nothing — no comment, no label\n\n' +
      '## Constraints\n\n' +
      '- **DO NOT** close or lock any issue or PR. Only label and comment.\n' +
      '- **DO NOT** flag content just because it is in a non-English language.\n' +
      '- When in doubt, err on the side of legitimate. False positives are worse than false negatives.\n' +
      '- Be factual in your comments. Do not be accusatory.\n' +
      '- Include specific evidence for why content was flagged.\n';
  }

  function buildUpstreamMonitor(answers, label) {
    return '# ' + label + '\n\n' +
      'You are an **upstream dependency monitor** for this repository.\n\n' +
      'Your job is to check upstream repositories or packages for new releases, breaking changes, or important updates, and report findings.\n\n' +
      preStepsBlock(answers) +
      '## Instructions\n\n' +
      '1. **Identify** the upstream dependencies to check (listed below or in package files)\n' +
      '2. **Check** for new releases, tags, or significant commits since the last check\n' +
      '3. **Compare** upstream changes against the current state of this project\n' +
      '4. **Report** findings by creating an issue with a summary\n\n' +
      '## What to Monitor\n\n' +
      '- New stable releases or version tags\n' +
      '- Breaking changes or deprecation notices\n' +
      '- Security advisories affecting tracked packages\n' +
      '- API changes that may require updates in this project\n\n' +
      '## Output Format\n\n' +
      'Create an issue titled `[Upstream] Updates detected — YYYY-MM-DD` with:\n' +
      '- A table of dependencies checked and their status\n' +
      '- Details of any new releases or breaking changes\n' +
      '- Recommended actions for the team\n\n' +
      '## Constraints\n\n' +
      '- **DO NOT** automatically create PRs or merge changes — report only.\n' +
      '- **DO NOT** report on dependencies that have not changed.\n' +
      '- If no updates are found, do not create an issue.\n' +
      '- Include links to upstream changelogs or release notes when available.\n';
  }

  function buildDocumentationUpdater(answers, label) {
    return '# ' + label + '\n\n' +
      'You are a **documentation maintenance agent** for this repository.\n\n' +
      'Your job is to keep documentation accurate, up-to-date, and consistent with the codebase.\n\n' +
      preStepsBlock(answers) +
      '## Instructions\n\n' +
      '1. **Scan** documentation files (README, docs/, wiki) for outdated content\n' +
      '2. **Compare** documentation against the current code and API surface\n' +
      '3. **Fix** inaccuracies, broken links, and outdated examples\n' +
      '4. **Open** a pull request with the improvements\n\n' +
      '## What to Update\n\n' +
      '- Code examples that no longer match the current API\n' +
      '- Broken links to external resources\n' +
      '- Outdated version numbers or dependency references\n' +
      '- Missing documentation for new public APIs or features\n' +
      '- Typos and formatting inconsistencies\n\n' +
      '## Constraints\n\n' +
      '- **DO NOT** delete existing documentation sections — update or flag for review.\n' +
      '- **DO NOT** change the tone, voice, or writing style of existing docs.\n' +
      '- **DO NOT** document internal or private APIs unless they are already documented.\n' +
      '- Make one focused PR per documentation area. Do not combine unrelated changes.\n' +
      '- Keep changes factual — do not add marketing language or opinions.\n';
  }

  function buildPrReview(answers, label) {
    return '# ' + label + '\n\n' +
      'You are a **pull request reviewer** for this repository.\n\n' +
      'Your job is to review opened pull requests for code quality, potential bugs, and adherence to project standards.\n\n' +
      preStepsBlock(answers) +
      '## Instructions\n\n' +
      '1. **Read** the PR diff, title, and description\n' +
      '2. **Analyze** the changes for issues listed below\n' +
      '3. **Comment** with specific, actionable feedback on problematic lines\n' +
      '4. **Summarize** your overall assessment as a PR comment\n\n' +
      '## Review Criteria\n\n' +
      '### Check for:\n' +
      '- Security vulnerabilities (SQL injection, XSS, hardcoded secrets, unsafe deserialization)\n' +
      '- Logic errors or off-by-one bugs\n' +
      '- Missing error handling for fallible operations\n' +
      '- Performance issues (N+1 queries, unbounded loops, memory leaks)\n' +
      '- Breaking changes to public APIs without version bumps\n\n' +
      '### Ignore:\n' +
      '- Style preferences (formatting, naming conventions) — the linter handles these\n' +
      '- Minor refactoring suggestions that don\'t affect correctness\n' +
      '- Test coverage gaps (unless a critical path is completely untested)\n\n' +
      '## Constraints\n\n' +
      '- **DO NOT** approve or request changes — only leave comments.\n' +
      '- **DO NOT** comment on files you are uncertain about. Only flag issues you are confident in.\n' +
      '- Be specific — reference line numbers and explain why something is a problem.\n' +
      '- If the PR looks clean, say so briefly. Do not manufacture issues.\n';
  }

  function buildCustom(answers, label) {
    var desc = answers.customDescription || 'Perform the specified task on this repository.';
    return '# Custom Workflow\n\n' +
      'You are an **automated assistant** for this repository.\n\n' +
      'Your job is: ' + desc + '\n\n' +
      preStepsBlock(answers) +
      '## Instructions\n\n' +
      '1. **Understand** the context from the triggering event\n' +
      '2. **Analyze** what needs to be done based on the description above\n' +
      '3. **Execute** the task using the tools available to you\n' +
      '4. **Report** the results by commenting on the relevant issue or PR\n\n' +
      '## Rules\n\n' +
      '- Stay focused on the specific task described above. Do not go beyond scope.\n' +
      '- If the task cannot be completed, comment explaining why.\n' +
      '- Be conservative — it is better to do less and be correct than to do more and break things.\n' +
      '- Follow existing code conventions and project standards.\n';
  }

  // ── Preview rendering ──────────────────────────────────────────────────────
  function showPreview(md) {
    var el = document.getElementById('preview-code');
    el.innerHTML = highlightMarkdown(md);
  }

  function highlightMarkdown(md) {
    var lines = md.split('\n');
    var inFrontmatter = false;
    var result = [];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var escaped = escapeHtml(line);

      if (line === '---' && (i === 0 || inFrontmatter)) {
        inFrontmatter = !inFrontmatter;
        result.push('<span class="yaml-delim">' + escaped + '</span>');
        continue;
      }

      if (inFrontmatter) {
        result.push(highlightYamlLine(escaped));
      } else if (/^#{1,6}\s/.test(line)) {
        result.push('<span class="md-heading">' + escaped + '</span>');
      } else if (/^\d+\.\s/.test(line)) {
        var num = escaped.match(/^(\d+\.)/)[1];
        result.push('<span class="md-number">' + num + '</span>' + escaped.slice(num.length));
      } else if (/^[-*]\s/.test(line) || /^\s+[-*]\s/.test(line)) {
        result.push('<span class="md-list">' + escaped + '</span>');
      } else {
        // Bold markers
        result.push(escaped.replace(/\*\*([^*]+)\*\*/g, '<span class="md-bold">**$1**</span>'));
      }
    }
    return result.join('\n');
  }

  function highlightYamlLine(escaped) {
    var match = escaped.match(/^(\s*)([\w-]+)(:)(.*)/);
    if (match) {
      return match[1] +
        '<span class="yaml-key">' + match[2] + '</span>' +
        '<span class="yaml-delim">' + match[3] + '</span>' +
        '<span class="yaml-value">' + match[4] + '</span>';
    }
    // List items in frontmatter
    if (/^\s*-\s/.test(escaped)) {
      return '<span class="yaml-value">' + escaped + '</span>';
    }
    return escaped;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
})();

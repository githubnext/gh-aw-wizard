import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = new URL('..', import.meta.url).pathname;
const cliPath = join(repositoryRoot, 'src/js/cli.js');
const temporaryDirectories = [];

function inputFile(answers) {
  const directory = mkdtempSync(join(tmpdir(), 'gh-aw-wizard-cli-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'answers.json');
  writeFileSync(path, JSON.stringify(answers));
  return path;
}

function runCli(...args) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
}

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true }));
});

describe('prompt generator CLI', () => {
  const answers = {
    archetype: 'custom',
    customDescription: 'Summarize new issues',
    triggers: ['workflow_dispatch'],
    outputs: ['add-comment'],
    engine: 'copilot',
    extras: [],
    needsData: false
  };

  it('generates an agent prompt from a JSON input file', () => {
    const result = runCli('--input', inputFile(answers));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('- Name: summarize-new-issues');
  });

  it('generates a workflow file when requested', () => {
    const result = runCli('--input', inputFile(answers), '--format', 'workflow');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('name: summarize-new-issues');
    expect(result.stdout).toContain('# Custom Workflow');
  });

  it('reports invalid command-line arguments', () => {
    const result = runCli('--format', 'invalid');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Error: An input file is required.');
  });
});

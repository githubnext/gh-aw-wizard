import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = new URL('..', import.meta.url).pathname;
const generatorPath = join(repositoryRoot, 'scripts/generate-patterns.py');
const temporaryDirectories = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true }));
});

describe('pattern generator', () => {
  it('retains safety guidance when regenerating measured archetypes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'gh-aw-wizard-patterns-'));
    temporaryDirectories.push(directory);
    mkdirSync(join(directory, 'data'));
    mkdirSync(join(directory, 'patterns/archetypes'), { recursive: true });
    mkdirSync(join(directory, 'scripts'));
    copyFileSync(generatorPath, join(directory, 'scripts/generate-patterns.py'));
    writeFileSync(join(directory, 'data/scan-results.json'), JSON.stringify({
      metadata: {},
      repos: {
        'example/repo': {
          stars: 1,
          workflows: [
            { name: 'CI doctor', success_rate: '1/1', triggers: ['schedule'] },
            { name: 'Daily test improver', success_rate: '1/1', triggers: ['schedule'] },
            { name: 'Dependency monitor', success_rate: '1/1', triggers: ['schedule'] },
            { name: 'Docs updater', success_rate: '1/1', triggers: ['schedule'] },
            { name: 'Repo maintainer', success_rate: '1/1', triggers: ['schedule'] },
            { name: 'Weekly status', success_rate: '1/1', triggers: ['schedule'] }
          ]
        }
      }
    }));

    const result = spawnSync('python3', ['scripts/generate-patterns.py'], {
      cwd: directory,
      encoding: 'utf8'
    });

    expect(result.status, result.stderr).toBe(0);
    const readTips = (id) => JSON.parse(readFileSync(
      join(directory, `patterns/archetypes/${id}.json`),
      'utf8'
    )).tips.join('\n');
    expect(readTips('code-improvement')).toContain('protected-files');
    expect(readTips('code-improvement')).toContain('pre-activation');
    expect(readTips('dependency-monitor')).toContain('skip-if-match');
    expect(readTips('status-report')).toContain('DO NOT constraints');
    expect(readTips('documentation-updater')).toContain('protected-files');
    expect(readTips('daily-test-improver')).toContain('passing baseline');
    expect(readTips('repo-maintainer')).toContain('destructive actions');
    expect(JSON.parse(readFileSync(
      join(directory, 'patterns/archetypes/repo-maintainer.json'),
      'utf8'
    )).recommended_tools).toContain('create-pull-request');
  });

  it('loads curated archetype data from the committed pattern file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'gh-aw-wizard-patterns-'));
    temporaryDirectories.push(directory);
    mkdirSync(join(directory, 'data'));
    mkdirSync(join(directory, 'patterns/archetypes'), { recursive: true });
    mkdirSync(join(directory, 'scripts'));
    copyFileSync(generatorPath, join(directory, 'scripts/generate-patterns.py'));

    const curatedArchetype = {
      id: 'canonical-pattern',
      label: 'Canonical Pattern',
      description: 'Loaded from its pattern file',
      success_rate: null,
      count: 0,
      recommended_triggers: [{ type: 'schedule', config: {} }],
      recommended_safe_outputs: ['issues'],
      recommended_tools: ['create-issue'],
      timeout_minutes: 30,
      prompt_style: 'role-steps',
      size_range_bytes: [3000, 8000],
      top_repos: [],
      tips: ['Keep curated data in one place'],
      anti_patterns: []
    };
    writeFileSync(
      join(directory, 'patterns/archetypes/canonical-pattern.json'),
      JSON.stringify(curatedArchetype)
    );
    writeFileSync(
      join(directory, 'patterns/manifest.json'),
      JSON.stringify({ archetypes: ['canonical-pattern'] })
    );
    writeFileSync(
      join(directory, 'data/scan-results.json'),
      JSON.stringify({ metadata: {}, repos: {} })
    );

    const result = spawnSync('python3', ['scripts/generate-patterns.py'], {
      cwd: directory,
      encoding: 'utf8'
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(
      join(directory, 'patterns/archetypes/canonical-pattern.json'),
      'utf8'
    ))).toEqual(curatedArchetype);
  });
});

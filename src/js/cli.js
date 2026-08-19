#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generateAgentPrompt, generateWorkflowFile } from './workflow.js';
import { loadPatternsFromDir } from './patterns-node.js';

const defaultPatternsPath = fileURLToPath(new URL('../../patterns', import.meta.url));

function usage() {
  return [
    'Usage: node src/js/cli.js --input <answers.json> [options]',
    '',
    'Generate a GitHub Agentic Workflow prompt or workflow file from wizard answers.',
    '',
    'Options:',
    '  -i, --input <path>       JSON file containing wizard answers (required)',
    '  -f, --format <format>    Output format: prompt (default) or workflow',
    '  -p, --patterns <path>   Pattern library directory (default: patterns/)',
    '  -h, --help              Show this help message'
  ].join('\n');
}

function parseArgs(args) {
  const options = { format: 'prompt', patterns: defaultPatternsPath };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '-h' || arg === '--help') return { help: true };
    if (arg === '-i' || arg === '--input') {
      options.input = args[++index];
    } else if (arg === '-f' || arg === '--format') {
      options.format = args[++index];
    } else if (arg === '-p' || arg === '--patterns') {
      options.patterns = args[++index];
    } else {
      throw new Error(`Unknown option: ${  arg}`);
    }
  }

  if (!options.input) throw new Error('An input file is required.');
  if (!options.format || !['prompt', 'workflow'].includes(options.format)) {
    throw new Error('Format must be "prompt" or "workflow".');
  }
  return options;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function runCli(args, io) {
  const output = io || process;
  const options = parseArgs(args);
  if (options.help) {
    output.stdout.write(`${usage()  }\n`);
    return;
  }

  const [answers, patterns] = await Promise.all([
    readJson(options.input),
    loadPatternsFromDir(options.patterns)
  ]);
  const generated = options.format === 'workflow'
    ? generateWorkflowFile(answers, patterns)
    : generateAgentPrompt(answers, patterns);
  output.stdout.write(`${generated  }\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Error: ${  error.message  }\n`);
    process.exitCode = 1;
  });
}

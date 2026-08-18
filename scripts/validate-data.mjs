#!/usr/bin/env node
// validate-data.mjs — gate for generated data files.
//
// Usage: node scripts/validate-data.mjs <file> [<file> ...]
//
// Every file must exist, parse as well-formed JSON, and stay at or below the
// MAX_BYTES limit (10 MB). Exits non-zero with a report of every failure.

import { readFileSync, statSync } from 'node:fs';

const MAX_BYTES = 10 * 1024 * 1024;

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('validate-data: no files given');
  process.exit(2);
}

const errors = [];

for (const file of files) {
  let size;
  try {
    size = statSync(file).size;
  } catch {
    errors.push(`${file}: missing`);
    continue;
  }

  if (size > MAX_BYTES) {
    errors.push(`${file}: ${size} bytes exceeds the ${MAX_BYTES} byte limit`);
    continue;
  }

  try {
    JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`${file}: invalid JSON - ${error.message}`);
    continue;
  }

  console.log(`${file}: valid JSON, ${size} bytes`);
}

if (errors.length > 0) {
  for (const error of errors) console.error(`validate-data: ${error}`);
  process.exit(1);
}

console.log(`validate-data: ${files.length} file(s) validated`);

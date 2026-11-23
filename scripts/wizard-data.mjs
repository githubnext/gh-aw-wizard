import { readFile } from 'node:fs/promises';

import { loadPatternsFromDir } from '../src/js/patterns-node.js';

export async function loadWizardData(wizardConfigPath, patternsDir, fetchImpl = fetch) {
  const wizard = JSON.parse(await readFile(wizardConfigPath, 'utf8'));
  const [patterns, response] = await Promise.all([
    loadPatternsFromDir(patternsDir),
    fetchImpl(wizard.engines_url, { signal: AbortSignal.timeout(30_000) })
  ]);
  if (!response.ok) {
    throw new Error(`Unable to export wizard engine catalog: HTTP ${response.status}`);
  }
  const engines = await response.json();
  if (!engines || !Array.isArray(engines.engines)) {
    throw new Error('Unable to export wizard engine catalog: expected an engines array');
  }
  return { schema_version: 1, wizard, patterns, engines };
}

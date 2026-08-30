// Downloads the third-party browser assets the site depends on so they are
// served from its own origin (GitHub Pages) instead of a CDN, which keeps the
// wizard usable on networks that block third-party asset hosts.
//
// The files are pulled from the npm registry with `npm pack` (tarballs only —
// none of the Node-only dependencies of these packages are installed) and
// extracted into `vendor/`, which the Vite build copies into `dist/`.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VENDOR_DIR = fileURLToPath(new URL('../vendor', import.meta.url));

// The paths the site points at live in `assistant.model` in `src/wizard.json`.
export const PACKAGES = [
  {
    name: '@primer/css',
    version: '22.3.0',
    files: [{ from: 'dist/primer.css', to: 'primer/primer.css' }]
  },
  {
    name: '@mlc-ai/web-llm',
    version: '0.2.84',
    files: [{ from: 'lib/index.js', to: 'slm/webllm.js' }]
  }
];

export function vendoredFiles() {
  return PACKAGES.flatMap((pkg) => pkg.files.map((file) => file.to));
}

export function isVendored(vendorDir) {
  const dir = vendorDir || VENDOR_DIR;
  return vendoredFiles().every((file) => existsSync(join(dir, ...file.split('/'))));
}

function extractPackage(pkg, vendorDir) {
  const workDir = mkdtempSync(join(tmpdir(), 'gh-aw-wizard-vendor-'));
  try {
    const spec = `${pkg.name}@${pkg.version}`;
    const output = execFileSync('npm', ['pack', spec, '--pack-destination', workDir, '--silent'], {
      encoding: 'utf8'
    });
    const tarball = join(workDir, output.trim().split('\n').pop().trim());
    execFileSync('tar', ['-xf', tarball, '-C', workDir]);
    pkg.files.forEach((file) => {
      const target = join(vendorDir, ...file.to.split('/'));
      mkdirSync(join(target, '..'), { recursive: true });
      cpSync(join(workDir, 'package', file.from), target);
    });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export function fetchVendorAssets(options) {
  const opts = options || {};
  const vendorDir = opts.vendorDir || VENDOR_DIR;
  if (!opts.force && isVendored(vendorDir)) return false;
  mkdirSync(vendorDir, { recursive: true });
  PACKAGES.forEach((pkg) => extractPackage(pkg, vendorDir));
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fetched = fetchVendorAssets({ force: process.argv.includes('--force') });
  process.stdout.write(fetched
    ? `Vendored the browser assets into ${VENDOR_DIR}\n`
    : 'The browser assets are already vendored.\n');
}

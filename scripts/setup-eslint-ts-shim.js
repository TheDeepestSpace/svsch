#!/usr/bin/env node
// typescript-eslint doesn't support the TypeScript 7 native compiler yet
// (https://github.com/typescript-eslint/typescript-eslint/issues/10940) and
// throws at require-time if it sees one. This repo's tsc/build steps need
// TS 7, so we give ESLint's TS tooling its own nested `typescript` resolving
// to the last TS 6.x release (pinned via the `typescript-eslint-ts-compat`
// alias devDependency) without touching the top-level `typescript` package.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const compatSrc = path.join(root, 'node_modules', 'typescript-eslint-ts-compat');

const targets = [
  'typescript-eslint',
  '@typescript-eslint/parser',
  '@typescript-eslint/eslint-plugin',
  '@typescript-eslint/utils',
  '@typescript-eslint/type-utils',
  '@typescript-eslint/typescript-estree',
  '@typescript-eslint/project-service',
  '@typescript-eslint/tsconfig-utils',
  'ts-api-utils',
];

if (!fs.existsSync(compatSrc)) {
  process.exit(0);
}

for (const target of targets) {
  const pkgDir = path.join(root, 'node_modules', target);
  if (!fs.existsSync(pkgDir)) continue;

  const linkPath = path.join(pkgDir, 'node_modules', 'typescript');
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.rmSync(linkPath, { recursive: true, force: true });
  if (process.platform === 'win32') {
    // Junctions don't require the elevated 'Create symbolic links' privilege
    // that plain directory symlinks need on Windows, and they require an
    // absolute target.
    fs.symlinkSync(compatSrc, linkPath, 'junction');
  } else {
    fs.symlinkSync(path.relative(path.dirname(linkPath), compatSrc), linkPath, 'dir');
  }
}

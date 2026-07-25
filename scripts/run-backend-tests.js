const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const surelogBin = path.join(WORKSPACE_ROOT, 'dist', 'surelog', 'bin');
const envPath = `${process.env.PATH}${path.delimiter}${surelogBin}`;
const buildDir = path.join(WORKSPACE_ROOT, 'src', 'parser', 'backend_cpp', 'build');
fs.mkdirSync(buildDir, { recursive: true });

execSync('cmake .. -G Ninja', { cwd: buildDir, stdio: 'inherit', env: { ...process.env, PATH: envPath } });
execSync('cmake --build . --target svsch_test', { cwd: buildDir, stdio: 'inherit', env: { ...process.env, PATH: envPath } });

const res = spawnSync('./svsch_test', process.argv.slice(2), { cwd: buildDir, stdio: 'inherit', env: { ...process.env, PATH: envPath } });
process.exit(res.status !== null ? res.status : 1);

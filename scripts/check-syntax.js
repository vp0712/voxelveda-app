'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const files = ['app.js', 'server.js'];
function collect(directory) {
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(relative);
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(relative);
  }
}
for (const directory of ['config', 'controllers', 'middleware', 'routes', 'services', 'utils', 'public', 'scripts']) collect(directory);
for (const file of [...new Set(files)].sort()) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `Syntax check could not run for ${file}: ${result.error?.code || result.status}\n`);
    process.exit(result.status || 1);
  }
}
console.log(`Syntax check passed for all ${new Set(files).size} application, browser and verification JavaScript files.`);

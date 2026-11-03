#!/usr/bin/env node
// Builds the release package: dist/valleverde-pm-<version>.zip plus a SHA-256 checksum.
// Run with: npm run build   (needs the `zip` command, available on macOS, Linux and GitHub Actions)
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const name = `valleverde-pm-${version}`;
const dist = 'dist';
const out = path.join(dist, name);

rmSync(dist, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const include = ['app', 'server.js', 'start.sh', 'start.bat', 'package.json', 'README.md', 'CHANGELOG.md', 'PRIVACY.md', 'LICENSE'];
for (const item of include) if (existsSync(item)) cpSync(item, path.join(out, item), { recursive: true });

// Release packages only need `npm start`: drop the developer scripts.
const pkg = JSON.parse(readFileSync(path.join(out, 'package.json'), 'utf8'));
pkg.scripts = { start: pkg.scripts.start, serve: pkg.scripts.serve };
writeFileSync(path.join(out, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

const zip = `${name}.zip`;
try { execFileSync('zip', ['-rqX', zip, name], { cwd: dist }); }
catch { console.error('The `zip` command isn’t available. The unzipped package is in ' + out); process.exit(1); }

const hash = createHash('sha256').update(readFileSync(path.join(dist, zip))).digest('hex');
writeFileSync(path.join(dist, `${zip}.sha256`), `${hash}  ${zip}\n`);
console.log(`Built ${path.join(dist, zip)}\nSHA-256 ${hash}`);

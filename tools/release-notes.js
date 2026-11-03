#!/usr/bin/env node
// Prints the CHANGELOG.md section for a version, for the GitHub release notes.
// Usage: node tools/release-notes.js 0.1.0
import { readFileSync } from 'node:fs';
const version = (process.argv[2] || '').replace(/^v/, '');
const text = readFileSync('CHANGELOG.md', 'utf8');
const start = text.indexOf(`## [${version}]`);
if (start < 0) { console.error(`No CHANGELOG.md entry for ${version}`); process.exit(1); }
const next = text.indexOf('\n## [', start + 1);
console.log(text.slice(text.indexOf('\n', start) + 1, next < 0 ? undefined : next).trim());

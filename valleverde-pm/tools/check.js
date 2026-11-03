#!/usr/bin/env node
// Release checks. Run with: npm run check
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

let failed = false;
const ok = m => console.log(`✓ ${m}`);
const fail = m => { console.error(`✗ ${m}`); failed = true; };

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const html = readFileSync('app/index.html', 'utf8');
const changelog = readFileSync('CHANGELOG.md', 'utf8');

// 1. The app script compiles.
const script = html.match(/<script>([\s\S]*)<\/script>/);
if (!script) fail('No <script> in app/index.html');
else { try { new vm.Script(script[1]); ok('App script compiles'); } catch (e) { fail(`App script: ${e.message}`); } }

// 2. One version everywhere.
const appVersion = (html.match(/const APP_VERSION='([^']+)'/) || [])[1];
appVersion === pkg.version ? ok(`Version ${pkg.version} in app and package.json`) : fail(`APP_VERSION (${appVersion}) doesn’t match package.json (${pkg.version})`);
changelog.includes(`## [${pkg.version}]`) ? ok(`CHANGELOG.md has an entry for ${pkg.version}`) : fail(`CHANGELOG.md has no entry for ${pkg.version}`);

// 3. Offline guarantee: the page forbids network requests and contains no remote addresses.
const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
csp.includes("connect-src 'none'") && csp.includes("default-src 'none'") ? ok('Content-Security-Policy blocks network requests') : fail('Content-Security-Policy must include default-src \'none\' and connect-src \'none\'');
const remote = html.match(/https?:\/\/[^\s"'`<>)]+/g) || [];
remote.length ? fail(`Remote addresses found in app/index.html: ${[...new Set(remote)].join(', ')}`) : ok('No remote addresses in the app');
for (const api of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon']) if (html.includes(api)) fail(`Network API used in the app: ${api}`);

// 4. Every font the CSS references is bundled.
const fonts = [...html.matchAll(/url\((fonts\/[^)]+)\)/g)].map(m => m[1]);
const missing = fonts.filter(f => !existsSync(`app/${f}`));
missing.length ? fail(`Missing font files: ${missing.join(', ')}`) : ok(`${fonts.length} bundled font files present`);

if (failed) { console.error('\nChecks failed.'); process.exit(1); }
console.log('\nAll checks passed.');

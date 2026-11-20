// Interface checks in a real browser engine, under the app's own content-security policy.
// GitHub runs them in WebKit, the engine of the Mac app: npm run test:ui
// Elsewhere: BROWSER=chromium node tools/ui-check.js (PW_EXECUTABLE=… for a browser installed by hand).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { webkit, chromium } from 'playwright';

const root = new URL('../src/', import.meta.url).pathname;
const conf = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const CSP = conf.app.security.csp;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

const server = createServer(async (req, res) => {
  // Browsers ask for a favicon by themselves; the Mac app doesn't.
  if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; }
  const path = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!path.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path.endsWith('/') ? join(path, 'index.html') : path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream', 'Content-Security-Policy': CSP });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

// A day in the current week, as YYYY-MM-DD in local time.
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const now = new Date();
const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
const day = n => ymd(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + n));
const inDays = n => ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
const line = (id, text, level, done, ref) => ({ id, text, level, done, ...(ref ? { ref } : {}) });
const sample = {
  app: 'valleverde-pm', schema: 6,
  settings: { begin: '10:30', end: '18:30', meetingsInBudget: true, timeFormat: '24' },
  weeks: { [day(0)]: { goals: [{ id: 'g1', text: 'Partena - Icons', level: 0, done: false, color: 'violet' }] } },
  days: {
    [day(0)]: { begin: '10:30', end: '18:30', lines: [
      line('a', 'Partena', 0, false, { p: 'a' }), line('b', 'Icons - 2h', 1, false), line('c', '15m FU', 1, true),
      line('d', 'Reboot4You', 0, false, { p: 'b' }), line('e', '1h30 Training prep', 1, false), line('f', '[MAIL] Recap mail 15m', 1, true)
    ] }
  },
  meetings: { [day(0)]: [{ id: 'm1', start: '13:00', end: '14:00', title: 'Call' }] },
  projects: [
    { id: 'a', num: 1, name: 'Partena', fields: { deadline: inDays(60) }, todos: [] },
    { id: 'b', num: 2, name: 'Reboot4You', fields: {}, todos: [] }
  ],
  templates: [], templateCats: [], calendars: [], drafts: {}
};

// The desktop side, simulated: the data file, saving, and what's copied.
const fake = `(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + (e.sample || '')));
  const st = window.__fake = { content: ${JSON.stringify(JSON.stringify(sample))}, mtime: 1, copied: '', csv: null };
  window.__TAURI__ = { core: { invoke: async (cmd, args) => {
    if (cmd === 'load_workspace') return { path: '/x/valleverde.json', dir: '/x', content: st.content, mtime: st.mtime };
    if (cmd === 'save_workspace') { st.content = args.content; st.mtime++; return st.mtime; }
    if (cmd === 'workspace_mtime') return st.mtime;
    if (cmd === 'clock_format') return { forced: '24', locale: 'en_ES' };
    if (cmd === 'save_csv_file') { st.csv = args; return '/x/' + args.name; }
    return null;
  } } };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async t => { st.copied = t; }, write: async () => {}, readText: async () => st.copied } });
})();`;

const name = process.env.BROWSER === 'chromium' ? 'chromium' : 'webkit';
const browser = await (name === 'chromium' ? chromium : webkit).launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(fake);
await page.goto(url);
await page.waitForSelector('#app:not([hidden])');

let failed = 0;
async function check(title, fn) {
  try { await fn(); console.log(`  ok  ${title}`); }
  catch (e) { failed++; console.log(`  FAIL ${title}\n       ${String(e.message || e).split('\n')[0]}`); }
}
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
const ok = (v, what) => { if (!v) throw new Error(what); };
const saved = async () => JSON.parse(await page.evaluate('window.__fake.content'));
const drag = async (from, to) => {
  const a = await page.locator(from).boundingBox(), b = await page.locator(to).boundingBox();
  await page.mouse.move(a.x + 12, a.y + 8);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(150);
};

console.log(`Interface, in ${name}`);
// Start on Monday of this week, in the day view.
for (let i = 0; i < (now.getDay() + 6) % 7; i++) await page.click('#prevBtn');

await check('the day is planned without the clock', async () => {
  eq(await page.innerText('#left'), '3h30 left', 'left');
  eq(await page.innerText('#slack'), '3h free', 'free: 8h minus 3h30 to do, 30m done and 1h of meetings');
  eq(await page.locator('#ribbon .gone, #ribbon .nowmark').count(), 0, 'clock marks');
});
await check('each project has its colour (set by classes, not inline styles)', async () => {
  const chip = await page.$eval('#tasks .pchip.gc', e => getComputedStyle(e).backgroundColor);
  ok(chip !== 'rgba(0, 0, 0, 0)' && chip !== 'transparent', `the project chip has no colour (${chip})`);
  const segs = await page.$$eval('#ribbon .seg.plan.gc', els => els.map(e => getComputedStyle(e).backgroundColor));
  eq(segs.length, 2, 'both projects coloured on the bar');
  ok(segs[0] !== segs[1], 'in different colours');
  const dot = await page.$eval('#agenda .ev-dot.cal-mine', e => getComputedStyle(e).backgroundColor);
  ok(dot !== 'rgba(0, 0, 0, 0)', 'the meeting’s dot');
  eq(await page.locator('#tasks .goal.gc, .gdot').count(), 0, 'goals have no colour any more');
});
await check('icons and sticky headers', async () => {
  ok(await page.locator('#tab-plan svg.i').count() === 1, 'an icon in the Plan tab');
  eq(await page.$eval('.tabs', e => getComputedStyle(e).position), 'sticky', 'the tabs');
  eq(await page.$eval('#view-plan .top', e => getComputedStyle(e).position), 'sticky', 'the date row');
});
await check('the timesheet for the day', async () => {
  await page.click('[data-act="menu"]');
  await page.click('[data-act="timesheet-day"]');
  const t = await page.evaluate('window.__fake.copied');
  ok(t.includes('Partena: 0:15') && t.includes('Reboot4You: 0:15'), t);
});
await check('the week view, and moving a task to another day', async () => {
  await page.keyboard.press('w');
  eq(await page.locator('.wrow').count() >= 5, true, 'rows');
  await drag('.wrow >> nth=0 >> .wchip:has-text("Reboot4You")', '.wrow >> nth=2');
  ok((await page.innerText('.wrow >> nth=2')).includes('Reboot4You'), 'moved to Wednesday');
});
await check('undo and redo', async () => {
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  ok((await page.innerText('.wrow >> nth=0')).includes('Reboot4You'), 'back on Monday');
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(100);
  ok((await page.innerText('.wrow >> nth=2')).includes('Reboot4You'), 'on Wednesday again');
});
await check('the project board, and dragging a card to set its deadline', async () => {
  await page.click('#tab-projects');
  await page.click('[data-act="project-view"][data-view="board"]');
  ok(await page.isVisible('.col[data-col="none"] [data-card="b"]'), 'Reboot4You has no deadline');
  const stripe = await page.$eval('[data-card="b"]', e => getComputedStyle(e).borderLeftColor);
  ok(stripe !== 'rgba(0, 0, 0, 0)', 'the card shows its project’s colour');
  await drag('[data-card="b"]', '.col[data-col="next"]');
  ok(await page.isVisible('.col[data-col="next"] [data-card="b"]'), 'in next week');
  await page.waitForTimeout(400);
  const p = (await saved()).projects.find(x => x.id === 'b');
  ok(/^\d{4}-\d\d-\d\d$/.test(p.fields.deadline || ''), 'the deadline is saved');
});
await check('a new template from the suggestions', async () => {
  await page.click('#tab-mail');
  await page.click('.view-head [data-act="tpl-new"]');
  await page.click('[data-tp="Kick-off"]');
  await page.click('#tpUse');
  eq(await page.innerText('.ctitle'), 'Kick-off', 'opened');
  const sw = await page.$eval('#tplItems, #composeBody', () => true);
  ok(sw, 'compose');
});
await check('nothing is blocked by the content-security policy, and no errors', async () => {
  eq(JSON.stringify(await page.evaluate('window.__csp')), '[]', 'blocked');
  eq(JSON.stringify(errors), '[]', 'errors');
});

await browser.close();
server.close();
console.log(failed ? `\n${failed} check(s) failed.` : '\nAll interface checks passed.');
process.exit(failed ? 1 : 0);

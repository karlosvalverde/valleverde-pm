// npm run check: versions match, scripts parse, core logic behaves. Exits non-zero on failure.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
let failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message.split('\n').join('\n       ')}`); }
};

console.log('Versions');
const pkg = JSON.parse(read('package.json')).version;
const conf = JSON.parse(read('src-tauri/tauri.conf.json')).version;
const cargo = (/^version\s*=\s*"([^"]+)"/m.exec(read('src-tauri/Cargo.toml')) || [])[1];
const app = (/const APP_VERSION = '([^']+)'/.exec(read('src/app.js')) || [])[1];
test(`package.json ${pkg}, tauri.conf.json ${conf}, Cargo.toml ${cargo}, app.js ${app} all match`, () => {
  assert.ok([conf, cargo, app].every(v => v === pkg));
});
test(`CHANGELOG.md has a ${pkg} entry`, () => assert.match(read('CHANGELOG.md'), new RegExp(`^## \\[${pkg.replace(/\./g, '\\.')}\\]`, 'm')));

console.log('Syntax');
for (const f of ['src/core.js', 'src/app.js']) {
  test(f, () => execFileSync(process.execPath, ['--check', new URL(f, root).pathname], { stdio: 'pipe' }));
}

console.log('Core');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(read('src/core.js'), ctx);
const C = ctx.Core;
let n = 0;
const id = () => `n${++n}`;
const L = rows => rows.map(([level, text, done]) => ({ id: id(), level, text, done: !!done }));
const texts = list => list.map(l => (l.level ? '  ' : '') + l.text + (l.done ? ' ✓' : ''));

test('durations are read from the line', () => {
  const cases = { '15m FU': 15, 'Icons - 2h': 120, 'CKAZ / KE FU 15m': 15, '1h30 call': 90, '1h30m call': 90,
    '1.5h review': 90, '1,5h review': 90, '90 min': 90, '2h UPG': 120, 'Formech': 0, 'Mayra 3 meetings': 0, 'Q4 plan': 0, '': 0 };
  for (const [t, m] of Object.entries(cases)) assert.equal(C.duration(t), m, t);
});
test('durations are formatted like the note', () => {
  assert.deepEqual([0, 15, 60, 75, 465, 135].map(C.fmtDur), ['0m', '15m', '1h', '1h15', '7h45', '2h15']);
});
// The note's tasks: 7h of open estimates (its two 15m PM lines were routines, which are gone).
test('the note in the screenshot has 7h of open task estimates', () => {
  const day = {
    lines: L([[0, 'Femarvi'], [1, '15m FU'], [0, '1 - Partena'], [1, '15m MAIL'], [1, 'Icons - 2h'],
      [0, '2 - Interbat UPG'], [1, '15m MAIL + Setup'], [1, '2h UPG'], [0, '3 - La Table'], [1, '2h DES'],
      [0, '4 - Mayra'], [1, '15m FU MEET'], [0, 'Nemak', 1], [1, '15m FU', 1]])
  };
  assert.deepEqual({ ...C.dayMinutes(day) }, { left: 420, done: 15 });
});
test('available time counts from now, or from the start of the day', () => {
  const d = { begin: '09:30', end: '18:30' };
  assert.equal(C.available(d, '2026-11-05', '2026-11-04', 600), 540);
  assert.equal(C.available(d, '2026-11-04', '2026-11-04', 8 * 60), 540);
  assert.equal(C.available(d, '2026-11-04', '2026-11-04', 17 * 60), 90);
  assert.equal(C.available(d, '2026-11-04', '2026-11-04', 19 * 60), 0);
  assert.equal(C.available(d, '2026-11-03', '2026-11-04', 600), null);
});
test('checking the last child checks the parent and sinks the group', () => {
  const list = L([[0, 'A'], [1, 'a1', 1], [1, 'a2'], [0, 'B'], [0, 'Done', 1]]);
  C.toggle(list, 2, true);
  assert.deepEqual(texts(list), ['B', 'A ✓', '  a1 ✓', '  a2 ✓', 'Done ✓'], 'a group just done goes to the top of the done ones');
});
test('unchecking a child reopens the group above the done ones', () => {
  const list = L([[0, 'B'], [0, 'Done', 1], [0, 'A', 1], [1, 'a1', 1]]);
  C.toggle(list, 3, true);
  assert.deepEqual(texts(list), ['B', 'A', '  a1', 'Done ✓']);
});
test('checking a parent checks all its children', () => {
  const list = L([[0, 'A'], [1, 'a1'], [1, 'a2']]);
  C.toggle(list, 0, false);
  assert.ok(list.every(l => l.done));
});
test('groups move past whole groups', () => {
  const list = L([[0, 'A'], [1, 'a1'], [0, 'B'], [1, 'b1'], [1, 'b2'], [0, 'C']]);
  assert.equal(C.moveBlock(list, 2, -1), 0);
  assert.deepEqual(texts(list), ['B', '  b1', '  b2', 'A', '  a1', 'C']);
  assert.equal(C.moveBlock(list, 3, 1), 4);
  assert.deepEqual(texts(list), ['B', '  b1', '  b2', 'C', 'A', '  a1']);
});
test('a child moves across into the next group', () => {
  const list = L([[0, 'A'], [1, 'a1'], [0, 'B']]);
  C.moveBlock(list, 1, 1);
  assert.deepEqual(texts(list), ['A', 'B', '  a1']);
  assert.equal(C.moveBlock(list, 2, -1), 1);
  assert.deepEqual(texts(list), ['A', '  a1', 'B']);
  assert.equal(C.moveBlock(list, 1, -1), -1, 'a child can’t move above the first project');
});
test('dragging a group lands on a group boundary', () => {
  const list = L([[0, 'A'], [1, 'a1'], [0, 'B'], [1, 'b1']]);
  C.dropBlock(list, 0, 3, true);
  assert.deepEqual(texts(list), ['B', '  b1', 'A', '  a1']);
});
test('dragging a child to the top makes it a project line', () => {
  const list = L([[0, 'A'], [1, 'a1']]);
  C.dropBlock(list, 1, 0, false);
  assert.deepEqual(list.map(l => l.level), [0, 0]);
});
test('carry-over copies open tasks, merges into same project, marks originals moved', () => {
  const src = L([[0, '1 - Partena'], [1, '15m MAIL', 1], [1, 'Icons - 2h'], [0, 'Femarvi'], [0, 'Nemak', 1], [1, '15m FU', 1]]);
  const dst = L([[0, '1 - Partena'], [1, 'Call 15m'], [0, 'Done thing', 1]]);
  assert.equal(C.openCount(src), 2);
  assert.equal(C.carryOver(src, dst, '2026-11-05', id), 2);
  assert.deepEqual(texts(dst), ['1 - Partena', '  Call 15m', '  Icons - 2h', 'Femarvi', 'Done thing ✓']);
  assert.deepEqual(src.map(l => l.moved || ''), ['2026-11-05', '', '2026-11-05', '2026-11-05', '', '']);
  assert.equal(C.openCount(src), 0);
  assert.equal(C.dayMinutes({ lines: src }).left, 0);
});
test('goals match the day’s project lines', () => {
  assert.ok(C.goalMatch('1. Partena - Icon', '1 - Partena'));
  assert.ok(C.goalMatch('2. La Table - Adapt', '3 - La Table'));
  assert.ok(C.goalMatch('Interbat - UPG', '2 - Interbat UPG'));
  assert.ok(!C.goalMatch('Celasa - FU?', 'Femarvi'));
  assert.equal(C.label('15m PM Formech'), '15m PM Formech');
  assert.equal(C.stripDuration('15m PM Formech'), 'PM Formech');
  assert.equal(C.stripDuration('Icons - 2h'), 'Icons');
});
test('week summary totals time done per project', () => {
  const days = {
    '2026-11-02': { lines: L([[0, 'Nemak', 1], [1, '15m FU', 1]]) },
    '2026-11-04': { lines: L([[0, 'Icons work'], [1, 'Icons - 2h', 1], [1, '15m MAIL']]) }
  };
  days['2026-11-04'].lines[0].ref = { p: 'p7' };
  const s = C.weekSummary(days, '2026-11-02', id => (id === 'p7' ? '#7 Partena' : ''));
  assert.match(s, /Monday 2 November: 15m/);
  assert.match(s, /- #7 Partena: 2h \(Icons - 2h\)/, 'linked lines are grouped under their project');
  assert.match(s, /By project: 2h15 in total/);
});
test('week ranges read naturally', () => {
  assert.equal(C.fmtRange('2026-11-02'), '2–8 Nov');
  assert.equal(C.fmtRange('2026-11-30'), '30 Nov – 6 Dec');
  assert.equal(C.mondayOf('2026-11-08'), '2026-11-02');
});

test('carried tasks keep their link to the project to-do', () => {
  const src = L([[0, 'Partena'], [1, 'Icons 2h']]);
  src[1].ref = { p: 'p1', t: 't1' };
  const dst = [];
  C.carryOver(src, dst, '2026-11-05', id);
  assert.deepEqual({ ...dst[1].ref }, { p: 'p1', t: 't1' });
});
test('SPOC gives a name, a first name and an email', () => {
  assert.equal(C.emailIn('Ana García <ana@partena.be>'), 'ana@partena.be');
  assert.equal(C.nameIn('Ana García <ana@partena.be>'), 'Ana García');
  assert.equal(C.nameIn('ana@partena.be'), '');
});
test('links are found in project fields', () => {
  assert.equal(C.linkOf('https://partena.be/fr'), 'https://partena.be/fr');
  assert.equal(C.linkOf('partena.odoo.com'), 'https://partena.odoo.com');
  assert.equal(C.linkOf('partena-prod'), '');
  assert.equal(C.linkOf('ana@partena.be'), '');
  assert.equal(C.linkOf('Odoo 18.0'), '');
});
test('deadlines read as due dates', () => {
  const t = '2026-11-04';
  assert.deepEqual({ ...C.dueLabel('2026-11-04', t) }, { text: 'Due today', soon: true });
  assert.equal(C.dueLabel('2026-11-06', t).text, 'Due Fri 6');
  assert.equal(C.dueLabel('2026-11-20', t).text, 'Due 20 Nov');
  assert.deepEqual({ ...C.dueLabel('2026-11-01', t) }, { text: '3 days late', late: true });
});
test('templates fill from the project, in the right language', () => {
  const p = { name: 'Partena', fields: { spoc: 'Ana García <ana@partena.be>', deadline: '2026-11-20', db: 'partena-staging' } };
  const me = { name: 'Karlos', signature: 'Karlos Valverde\nValleverde' };
  const en = C.autoValues(p, me, 'en', '2026-11-04');
  const es = C.autoValues(p, me, 'es', '2026-11-04');
  assert.equal(en.first_name, 'Ana');
  assert.equal(en.deadline, '20 November 2026');
  assert.equal(es.deadline, '20 de noviembre de 2026');
  assert.equal(en.week, '45');
  const t = C.STARTER_TEMPLATES.find(x => x.name === 'Deadline reminder');
  assert.deepEqual([...C.placeholders(t.en.subject + t.en.body)], ['project', 'deadline', 'first_name', 'pending', 'signature']);
  assert.equal(C.fill(t.es.subject, es), 'Partena: fecha límite el 20 de noviembre de 2026');
  const parts = C.fillParts('Hi {{first_name}}, {{pending}}', en);
  assert.deepEqual([...parts.map(x => x.blank || x.text)], ['Hi ', 'Ana', ', ', 'pending']);
});
test('mailto keeps line breaks and the address readable', () => {
  assert.equal(C.mailto('ana@partena.be', 'A & B', 'x\ny'), 'mailto:ana@partena.be?subject=A%20%26%20B&body=x%0Ay');
});
test('a version 0.1 backup brings its templates and projects', () => {
  const backup = { app: 'valleverde-pm', data: {
    templates: [{ id: 'a', name: 'Status', category: 'Weekly', en: { subject: 'S', body: 'B {{project}}' }, es: { subject: '', body: '' } }, { name: 'Empty' }],
    projects: [{ id: 'x', name: 'Nemak', client: 'Nemak SA', contactName: 'Luis', contactEmail: 'luis@nemak.com', lang: 'es' }]
  } };
  const r = C.importV01(backup, id);
  assert.equal(r.templates.length, 1);
  assert.equal(r.templates[0].en.body, 'B {{project}}');
  assert.equal(r.projects[0].fields.spoc, 'Luis luis@nemak.com');
  assert.equal(r.projects[0].fields.notes, 'Client: Nemak SA');
  assert.equal(r.projects[0].lang, 'es');
});

test('several SPOCs: first one greets, all are addressed', () => {
  const p = { name: 'Mayra', num: 12, fields: { spoc: 'Ravi V. Sadwani <ravi@mayra.es> - functional lead\nJavier Ruiz javier@mayra.es' },
    schedule: [{ text: 'Website design', date: '2026-11-13' }, { text: 'Go live', date: '' }] };
  const v = C.autoValues(p, {}, 'en', '2026-11-04');
  assert.equal(v.contact, 'Ravi V. Sadwani');
  assert.equal(v.first_name, 'Ravi');
  assert.equal(v.spoc_email, 'ravi@mayra.es, javier@mayra.es');
  assert.equal(v.project_number, '12');
  assert.equal(v.schedule, '- Website design: 13 November 2026\n- Go live');
});
test('projects are numbered, duplicated and found', () => {
  const ps = [{ id: 'a', num: 3, name: 'Mayra Hogar y Menaje', fields: { spoc: 'Ravi' }, lang: 'es',
    schedule: [{ id: 's', text: 'Go live', date: '2026-12-01', done: true }], todos: [{ id: 't', text: 'Icons', level: 0, done: true }] },
    { id: 'b', num: 12, name: 'Test', fields: {}, schedule: [], todos: [] }];
  assert.equal(C.nextNumber(ps), 13);
  const d = C.duplicateProject(ps[0], ps, id);
  assert.equal(d.num, 13);
  assert.equal(d.name, 'Mayra Hogar y Menaje (copy)');
  assert.equal(d.fields.spoc, 'Ravi');
  assert.ok(d.fields !== ps[0].fields && d.schedule[0].id !== 's' && !d.schedule[0].done && !d.todos[0].done);
  assert.equal(C.findProjects(ps, '#12')[0].id, 'b');
  assert.equal(C.findProjects(ps, 'hogar')[0].id, 'a');
  assert.equal(C.findProjects(ps, 'zzz').length, 0);
  assert.equal(C.scheduleFrom(C.DEFAULT_SCHEDULE, id).length, 5);
  assert.equal(C.nextPhase({ schedule: [{ text: 'A', done: true }, { text: 'B', done: false }] }).text, 'B');
});
test('carry-over keeps a project link on the project line', () => {
  const src = L([[0, 'Mayra'], [1, '15m FU']]);
  src[0].ref = { p: 'p3' };
  const dst = L([[0, 'Something else'], [1, '1h call']]);
  dst[0].ref = { p: 'p3' };
  C.carryOver(src, dst, '2026-11-05', id);
  assert.deepEqual(texts(dst), ['Something else', '  1h call', '  15m FU'], 'merges into the line linked to the same project');
  const dst2 = [];
  C.carryOver(L([[0, 'Mayra']]).map(l => ({ ...l, ref: { p: 'p3' } })), dst2, '2026-11-05', id);
  assert.equal(dst2[0].ref.p, 'p3');
});

const NOTE = `# #14 Mayra Hogar y Menaje

Project TODO's
- [ ] Icons - 2h
- [x] Send the sitemap
    - [ ] Check categories

**SPOC:** Ravi V. Sadwani
Javier – functional lead in the meetings

DB: mayra-staging
Current Website: [www.mayrahogar.es](https://www.mayrahogar.es)
Version: Odoo 18
Task link: https://odoo.example.com/odoo/project/12/tasks/345
Deadline: 20/12/2026
BA: Laura
Languages involved: ES, EN, FR

## Goal
New B2C shop with \\*fast\\* checkout.

## Sitemap
- Home
- Shop
  - Kitchen
- About us

## Project schedule
1. Homepage design + Design line definition - ? Deadline
2. Website design (more design)
3. Content review / Adjustments - 15.12.2026
4. Training / Q&A
5. Go Live

## Meeting 3 Nov
Client wants a blog.

![](Attachments/logo.png)
`;
test('a project note from Apple Notes becomes a project', () => {
  const p = C.parseProjectMarkdown(NOTE, id);
  assert.equal(p.num, 14);
  assert.equal(p.name, 'Mayra Hogar y Menaje');
  assert.deepEqual([...p.todos.map(t => `${t.level}${t.done ? 'x' : ' '}${t.text}`)], ['0 Icons - 2h', '0xSend the sitemap', '1 Check categories']);
  assert.equal(p.fields.spoc, 'Ravi V. Sadwani\nJavier – functional lead in the meetings');
  assert.equal(p.fields.db, 'mayra-staging');
  assert.equal(p.fields.website, 'https://www.mayrahogar.es');
  assert.equal(p.fields.version, 'Odoo 18');
  assert.equal(p.fields.task_link, 'https://odoo.example.com/odoo/project/12/tasks/345');
  assert.equal(p.fields.deadline, '2026-12-20');
  assert.equal(p.fields.ba, 'Laura');
  assert.equal(p.fields.languages, 'ES, EN, FR');
  assert.equal(p.fields.goal, 'New B2C shop with *fast* checkout.');
  assert.equal(p.fields.sitemap, '- Home\n- Shop\n  - Kitchen\n- About us');
  assert.deepEqual([...p.schedule.map(x => `${x.text}|${x.date}`)], ['Homepage design + Design line definition|', 'Website design (more design)|',
    'Content review / Adjustments|2026-12-15', 'Training / Q&A|', 'Go Live|']);
  assert.equal(p.fields.notes, 'Meeting 3 Nov:\nClient wants a blog.');
});
test('a pasted note without headings or checkboxes still parses', () => {
  const p = C.parseProjectMarkdown('Nemak relaunch\nSPOC: Luis luis@nemak.com\nTo-dos\nCall Luis\nFix menu\nDeadline: no deadline', id);
  assert.equal(p.name, 'Nemak relaunch');
  assert.equal(p.num, 0);
  assert.equal(p.fields.spoc, 'Luis luis@nemak.com');
  assert.deepEqual([...p.todos.map(t => t.text)], ['Call Luis', 'Fix menu']);
  assert.equal(p.fields.deadline, undefined);
  assert.equal(p.fields.notes, undefined);
});
test('exported projects read back the same', () => {
  const p = C.parseProjectMarkdown(NOTE, id);
  p.todos[0].done = true;
  const back = C.parseProjectMarkdown(C.projectToMarkdown({ ...p, archived: false }), id);
  assert.equal(back.num, 14);
  assert.equal(back.name, p.name);
  for (const k of Object.keys(p.fields)) assert.equal(back.fields[k], p.fields[k], k);
  assert.deepEqual([...back.todos.map(t => `${t.level}${t.done}${t.text}`)], [...p.todos.map(t => `${t.level}${t.done}${t.text}`)]);
  assert.deepEqual([...back.schedule.map(x => x.text + x.date)], [...p.schedule.map(x => x.text + x.date)]);
  assert.match(C.projectToMarkdown({ num: 2, name: 'Test', fields: {}, todos: [], schedule: [] }), /\*\*Deadline:\*\* \? {2}\n/);
  assert.equal(C.fileNameFor({ num: 14, name: 'Mayra / Hogar: "Menaje"' }), '14 Mayra Hogar Menaje.md');
});
test('languages are read from the project', () => {
  assert.deepEqual([...C.parseLanguages('ES, EN, FR')], ['es', 'en', 'fr']);
  assert.deepEqual([...C.parseLanguages('Español e italiano')], ['es', 'it']);
  assert.equal(C.autoValues({ name: 'X', fields: { deadline: '2026-11-20' } }, {}, 'fr', '2026-11-04').deadline, '20 novembre 2026');
  assert.equal(C.autoValues({ name: 'X', fields: { deadline: '2026-11-20' } }, {}, 'it', '2026-11-04').deadline, '20 novembre 2026');
});
test('review prompts open the assistant, or are copied when too long', () => {
  const q = C.reviewPrompt('fr', 'Sujet', 'Bonjour', false);
  assert.match(q, /written in French/);
  assert.ok(C.assistantLink('claude-desktop', q).url.startsWith('claude://claude.ai/new?q='));
  const long = C.assistantLink('claude-web', 'x'.repeat(9000));
  assert.deepEqual({ ...long }, { url: 'https://claude.ai/new', copy: true });
  assert.deepEqual({ ...C.assistantLink('gemini', q) }, { url: 'https://gemini.google.com/app', copy: true });
});
test('website copy: pages from the sitemap, prompts, and answers pasted back', () => {
  assert.deepEqual([...C.sitemapPages('- Home\n- Shop\n  - Kitchen (category)\n- About us\n- home')], ['Home', 'Shop', 'Kitchen', 'About us']);
  const page = C.newPage('Home', id);
  page.blocks[0].text.en = 'Old headline';
  const proj = { name: 'Mayra', num: 14, fields: { goal: 'Sell online' }, copy: { brief: { voice: 'Warm' }, pages: [page] } };
  const q = C.pagePrompt(proj, page, 'en');
  assert.match(q, /Improve the copy/);
  assert.match(q, /\[SEO title\] \(60 characters at most\)/);
  assert.match(q, /Tone of voice: Warm/);
  assert.match(C.pagePrompt(proj, page, 'fr', 'en'), /from English into French/);
  const r = C.applyCopyAnswer(page, 'fr', '**[Headline]**\nVotre maison, votre style\n\n[Meta description]: Meubles et déco.\n[FAQ]\nQ: Livraison ?', id);
  assert.deepEqual({ ...r }, { filled: 3, added: 1 });
  assert.equal(page.blocks[0].text.fr, 'Votre maison, votre style');
  assert.equal(page.blocks.find(b => b.kind === 'meta').text.fr, 'Meubles et déco.');
  assert.equal(page.blocks[page.blocks.length - 1].label, 'FAQ');
  assert.match(C.copyDeckMarkdown(proj, ['en', 'fr']), /### Headline\n\*\*EN:\*\* Old headline\n\*\*FR:\*\* Votre maison, votre style/);
});

// A real export from Notes (macOS 26): bold labels, U+2028 line separators, — separators, a schedule without a heading.
test('a real Notes export imports field by field', () => {
  const p = C.parseProjectMarkdown(read('tools/fixtures/notes-export.md'), id);
  assert.equal(p.name, 'Test Project');
  const f = p.fields;
  assert.equal(f.spoc, 'John Doe - john@doe.com');
  assert.equal(f.db, 'https://mydb.odoo.com');
  assert.equal(f.website, 'https://mywebsite.com', 'a half-linked address is put back together');
  assert.equal(f.version, '20.0 SaaS');
  assert.equal(f.task_link, 'https://www.odoo.com/odoo/project.task/xxxxx');
  assert.equal(f.deadline, undefined, '"?" means no deadline yet');
  assert.equal(f.ba, 'Jane Doe (JANEDO)');
  assert.equal(f.salesperson, 'Sales Man (SALES)');
  assert.equal(f.languages, 'ES, EN ?');
  assert.deepEqual([...C.parseLanguages(f.languages)], ['es', 'en']);
  assert.equal(f.goal, '- Migrate to Odoo\n- B2B / B2C');
  assert.equal(f.references, 'https://www.apple.com');
  assert.equal(f.apps, '- Website\n- eCommerce\n- Blog', 'an app called Website stays an app');
  assert.equal(f.sitemap.split('\n').length, 9);
  assert.equal(f.notes, '- Some notes\n- More notes');
  assert.deepEqual([...p.schedule.map(x => x.text + (x.date ? '|' + x.date : ''))],
    ['Definición del diseño + Página de inicio', 'Diseño web', 'Revisiones de contenidos', 'Formación / Q&A', 'Go-Live']);
  assert.deepEqual([...C.sitemapPages(f.sitemap)].slice(0, 3), ['Inicio', 'eCommerce', 'Sobre Mayrahogar']);
});
test('schedule lines with dates, and unknown labels kept in notes', () => {
  const p = C.parseProjectMarkdown('**X**\n—\n**Diseño web** - 15/12/2026\n**Go-Live** - xxx\n—\n**Hosting:** OVH\n', id);
  assert.deepEqual([...p.schedule.map(x => x.text + '|' + x.date)], ['Diseño web|2026-12-15', 'Go-Live|']);
  assert.equal(p.fields.notes, 'Hosting:\nOVH');
});
test('the real export survives a round trip in the same style', () => {
  const p = C.parseProjectMarkdown(read('tools/fixtures/notes-export.md'), id);
  p.num = 7;
  p.schedule[1].date = '2026-12-15';
  p.schedule[0].done = true;
  p.todos = [{ id: 'a', text: 'Send sitemap', level: 0, done: false }, { id: 'b', text: 'Check menus', level: 1, done: true }];
  const md = C.projectToMarkdown(p);
  assert.match(md, /^\*\*#7 Test Project\*\* {2}\n— {2}\n/);
  assert.match(md, /\*\*SPOC:\*\* {2}\nJohn Doe - john@doe\.com {2}\n/);
  assert.match(md, /- \[x\] \*\*Definición del diseño \+ Página de inicio\*\* - xxx\n- \[ \] \*\*Diseño web\*\* - 15\/12\/2026/);
  const back = C.parseProjectMarkdown(md, id);
  assert.equal(back.num, 7);
  assert.equal(back.name, 'Test Project');
  for (const k of Object.keys(p.fields)) assert.equal(back.fields[k], p.fields[k], k);
  assert.deepEqual([...back.schedule.map(x => `${x.done}|${x.text}|${x.date}`)], [...p.schedule.map(x => `${x.done}|${x.text}|${x.date}`)]);
  assert.deepEqual([...back.todos.map(t => `${t.level}${t.done}${t.text}`)], ['0falseSend sitemap', '1trueCheck menus']);
});

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll checks passed.');

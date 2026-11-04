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
// The note said 7h45; its open estimates add up to 7h30, the kind of drift the app removes.
test('the note in the screenshot has 7h30 of open estimates', () => {
  const day = {
    routines: [{ text: '15m PM Formech' }, { text: '15m PM Partena' }],
    lines: L([[0, 'Femarvi'], [1, '15m FU'], [0, '1 - Partena'], [1, '15m MAIL'], [1, 'Icons - 2h'],
      [0, '2 - Interbat UPG'], [1, '15m MAIL + Setup'], [1, '2h UPG'], [0, '3 - La Table'], [1, '2h DES'],
      [0, '4 - Mayra'], [1, '15m FU MEET'], [0, 'Nemak', 1], [1, '15m FU', 1]])
  };
  assert.deepEqual({ ...C.dayMinutes(day) }, { left: 450, done: 15 });
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
    '2026-11-02': { routines: [{ text: '15m PM Formech', done: true }], lines: L([[0, 'Nemak', 1], [1, '15m FU', 1]]) },
    '2026-11-04': { routines: [], lines: L([[0, '1 - Partena'], [1, 'Icons - 2h', 1], [1, '15m MAIL']]) }
  };
  const s = C.weekSummary(days, '2026-11-02');
  assert.match(s, /Monday 2 November: 30m/);
  assert.match(s, /- Partena: 2h \(Icons - 2h\)/);
  assert.match(s, /By project: 2h30 in total/);
});
test('week ranges read naturally', () => {
  assert.equal(C.fmtRange('2026-11-02'), '2–8 Nov');
  assert.equal(C.fmtRange('2026-11-30'), '30 Nov – 6 Dec');
  assert.equal(C.mondayOf('2026-11-08'), '2026-11-02');
});

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll checks passed.');

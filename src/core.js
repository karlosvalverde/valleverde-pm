/* Valleverde PM core: pure functions with no DOM access, so they can be tested in Node.
   Loaded in the app before app.js and exposed as globalThis.Core. */
(function (root) {
  'use strict';

  const pad = n => String(n).padStart(2, '0');

  /* ---------- dates ---------- */
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const mondayOf = s => { const d = parseYmd(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };

  const LONG = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const LONG_Y = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const SHORT = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' });
  const DM = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
  const DMY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const fmtLong = (s, withYear) => (withYear ? LONG_Y : LONG).format(parseYmd(s));
  const fmtShort = s => SHORT.format(parseYmd(s));
  const fmtDots = s => s.split('-').reverse().join('.');
  function fmtRange(mon) {
    const a = parseYmd(mon), b = parseYmd(addDays(mon, 6));
    return a.getMonth() === b.getMonth()
      ? `${a.getDate()}–${DM.format(b)}`
      : `${DM.format(a)} – ${DM.format(b)}`;
  }

  /* ---------- durations ---------- */
  // Matches 15m, 15 min, 2h, 1h30, 1h30m, 1.5h, 1,5h as a separate token anywhere in a line.
  const DUR_SRC = '(^|[^\\p{L}\\p{N}])(?:(\\d{1,2}(?:[.,]\\d{1,2})?)\\s?h(?:\\s?(\\d{1,2})\\s?m?)?|(\\d{1,3})\\s?(?:mins?|m)\\.?)(?![\\p{L}\\p{N}])';
  const DUR_RE = new RegExp(DUR_SRC, 'iu');
  const DUR_RE_G = new RegExp(DUR_SRC, 'giu');

  function duration(text) {
    const m = DUR_RE.exec(text || '');
    if (!m) return 0;
    if (m[2]) return Math.round(parseFloat(m[2].replace(',', '.')) * 60) + (m[3] ? Number(m[3]) : 0);
    return Number(m[4]);
  }
  const stripDuration = text => (text || '').replace(DUR_RE_G, '$1').replace(/\s{2,}/g, ' ').replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '');

  function fmtDur(min) {
    min = Math.max(0, Math.round(min || 0));
    const h = Math.floor(min / 60), m = min % 60;
    if (!h) return `${m}m`;
    return m ? `${h}h${pad(m)}` : `${h}h`;
  }
  const toMin = hm => { const m = /^(\d{1,2}):(\d{2})$/.exec(hm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const isTime = hm => toMin(hm) !== null && toMin(hm) < 24 * 60;

  /* ---------- outline structure ----------
     A list is a flat array of lines { id, text, level (0|1), done, moved? }.
     A group is a level-0 line followed by its level-1 lines. */
  function groupStart(L, i) { while (i > 0 && L[i].level > 0) i--; return i; }
  function groupEnd(L, s) { let j = s + 1; while (j < L.length && L[j].level > 0) j++; return j; }
  function groups(L) { const out = []; let s = 0; while (s < L.length) { const e = groupEnd(L, s); out.push([s, e]); s = e; } return out; }
  function firstDoneGroup(L) { for (const [s] of groups(L)) if (L[s].done) return s; return L.length; }
  function normalize(L, maxLevel) {
    for (const l of L) l.level = Math.min(maxLevel, l.level > 0 ? 1 : 0);
    if (L.length && L[0].level) L[0].level = 0;
    return L;
  }

  // Check or uncheck a line. Checking a parent checks its children; a parent follows its children.
  // With sink, done groups collect at the bottom: a group that becomes done goes to the top of them,
  // and one that reopens goes back just above them.
  function toggle(L, i, sink) {
    const line = L[i];
    if (!line) return;
    const s = groupStart(L, i), e = groupEnd(L, s);
    const wasDone = !!L[s].done;
    const now = !line.done;
    delete line.moved;
    line.done = now;
    if (line.level === 0) {
      if (now) for (let k = s + 1; k < e; k++) { L[k].done = true; delete L[k].moved; }
    } else if (e - s > 1) {
      L[s].done = L.slice(s + 1, e).every(x => x.done);
    }
    if (sink && !!L[s].done !== wasDone) {
      const block = L.splice(s, e - s);
      L.splice(firstDoneGroup(L), 0, ...block);
    }
  }

  // Alt+Up/Down. Groups move past whole groups; a child moves one line and can change group.
  function moveBlock(L, i, dir) {
    const line = L[i];
    if (!line) return -1;
    if (line.level === 0) {
      const e = groupEnd(L, i);
      if (dir < 0) {
        if (i === 0) return -1;
        const ps = groupStart(L, i - 1);
        const block = L.splice(i, e - i);
        L.splice(ps, 0, ...block);
        return ps;
      }
      if (e >= L.length) return -1;
      const ne = groupEnd(L, e);
      const block = L.splice(i, e - i);
      const at = ne - block.length;
      L.splice(at, 0, ...block);
      return at;
    }
    const j = i + dir;
    if (j < 1 || j >= L.length) return -1;
    [L[i], L[j]] = [L[j], L[i]];
    return j;
  }

  // Drag and drop: move the dragged line (or its whole group) before or after the target line.
  function dropBlock(L, from, to, after) {
    if (from === to || !L[from] || !L[to]) return false;
    const isGroup = L[from].level === 0;
    const end = isGroup ? groupEnd(L, from) : from + 1;
    if (to >= from && to < end) return false;
    const targetId = L[to].id;
    const block = L.splice(from, end - from);
    const t = L.findIndex(x => x.id === targetId);
    let at;
    if (isGroup) {
      const gs = groupStart(L, t);
      at = after ? groupEnd(L, gs) : gs;
    } else {
      at = after ? t + 1 : t;
      if (at === 0) block[0].level = 0;
    }
    L.splice(at, 0, ...block);
    return true;
  }

  /* ---------- day maths ---------- */
  function dayMinutes(day) {
    let left = 0, done = 0;
    for (const l of day.lines || []) {
      if (l.moved) continue;
      const m = duration(l.text);
      if (l.done) done += m; else left += m;
    }
    return { left, done };
  }

  // Minutes still available in the working day, or null when it doesn't apply (past day, no hours).
  function available(day, date, today, nowMin) {
    const b = toMin(day.begin), e = toMin(day.end);
    if (b === null || e === null || e <= b || date < today) return null;
    if (date > today) return e - b;
    return Math.max(0, e - Math.max(nowMin, b));
  }

  function groupMinutes(L, s) {
    const e = groupEnd(L, s);
    let open = 0, done = 0;
    for (let k = s; k < e; k++) {
      if (L[k].moved) continue;
      const m = duration(L[k].text);
      if (L[k].done) done += m; else open += m;
    }
    return { open, done, kids: e - s - 1 };
  }

  /* ---------- carrying open tasks to another day ---------- */
  function openCount(L) {
    let n = 0;
    for (const [s, e] of groups(L)) {
      const kids = L.slice(s + 1, e).filter(k => !k.done && !k.moved).length;
      n += kids || (e - s === 1 && !L[s].done && !L[s].moved ? 1 : 0);
    }
    return n;
  }

  const norm = t => (t || '').trim().toLowerCase();

  // Copies open tasks from src to dst and marks the originals as moved. Returns how many tasks moved.
  function carryOver(src, dst, dstDate, newId) {
    let count = 0;
    for (const [s, e] of groups(src)) {
      const p = src[s];
      const kids = src.slice(s + 1, e);
      const openKids = kids.filter(k => !k.done && !k.moved);
      const parentOpen = !p.done && !p.moved;
      if (!openKids.length && !(parentOpen && !kids.length)) continue;
      const copies = openKids.map(k => ({ id: newId(), text: k.text, level: 1, done: false, ...(k.ref ? { ref: { ...k.ref } } : {}) }));
      const sameProject = (a, b) => a.ref && b.ref && a.ref.p === b.ref.p && !a.ref.t && !b.ref.t;
      const existing = groups(dst).find(([ds]) => !dst[ds].done && (norm(dst[ds].text) === norm(p.text) || sameProject(dst[ds], p)));
      if (existing && copies.length) {
        dst.splice(existing[1], 0, ...copies);
      } else if (!existing) {
        dst.splice(firstDoneGroup(dst), 0, { id: newId(), text: p.text, level: 0, done: false, ...(p.ref ? { ref: { ...p.ref } } : {}) }, ...copies);
      }
      count += openKids.length || 1;
      if (parentOpen) p.moved = dstDate;
      for (const k of openKids) k.moved = dstDate;
    }
    return count;
  }

  /* ---------- goals and projects ---------- */
  // "1 - Partena" -> "Partena". Numbering needs a separator, so "15m FU" is left alone.
  const label = text => (text || '').replace(/^\s*\d{1,2}\s*[.)\-–—:]\s*/, '').trim();
  const goalKey = text => norm(label(text).split(/\s[-–—:]\s|:\s/)[0]);
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function goalMatch(goalText, headerText) {
    const k = goalKey(goalText);
    if (k.length < 3) return false;
    const h = norm(label(headerText));
    return h === k || new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(k)}($|[^\\p{L}\\p{N}])`, 'u').test(h);
  }

  /* ---------- text exports ---------- */
  const box = done => (done ? '- [x] ' : '- [ ] ');

  function dayAsText(day, date, goals, today, agenda) {
    const { left, done } = dayMinutes(day);
    const out = [fmtDots(date)];
    if (date < today) out.push(`Done: ${fmtDur(done)}`, `Not done: ${fmtDur(left)}`);
    else out.push(`Time left: ${fmtDur(left)}`);
    if (day.begin) out.push(`Begin: ${day.begin.replace(/^0/, '')}`);
    if (day.end) out.push(`End: ${day.end.replace(/^0/, '')}`);
    if (agenda && agenda.length) out.push('', 'Agenda', ...agenda.map(x => `- ${x}`));
    const g = (goals || []).filter(x => x.text.trim());
    if (g.length) out.push('', 'Week goals', ...g.map(x => box(x.done) + x.text));
    const L = (day.lines || []).filter(x => x.text.trim());
    if (L.length) out.push('', 'Tasks', ...L.map(x => (x.level ? '    ' : '') + box(x.done) + x.text + (x.moved ? ` (moved to ${fmtShort(x.moved)})` : '')));
    return out.join('\n') + '\n';
  }

  // Time done per project for a week, for updating Odoo or any timesheet by hand.
  function weekSummary(days, monday, projectName) {
    const out = [`Week of ${DMY.format(parseYmd(monday))}: time done`, ''];
    const totals = new Map();
    let week = 0;
    for (let i = 0; i < 7; i++) {
      const date = addDays(monday, i);
      const day = days[date];
      if (!day) continue;
      const rows = new Map();
      const add = (lbl, min, item) => {
        if (!rows.has(lbl)) rows.set(lbl, { min: 0, items: [] });
        const r = rows.get(lbl); r.min += min; if (item) r.items.push(item);
      };
      const L = day.lines || [];
      for (const [s, e] of groups(L)) {
        const linked = L[s].ref && projectName && projectName(L[s].ref.p);
        const lbl = linked || label(stripDuration(L[s].text)) || 'Other';
        for (let k = s; k < e; k++) {
          const m = duration(L[k].text);
          if (L[k].done && !L[k].moved && m) add(lbl, m, k === s ? '' : L[k].text.trim());
        }
      }
      if (!rows.size) continue;
      let total = 0;
      for (const v of rows.values()) total += v.min;
      week += total;
      out.push(`${fmtLong(date)}: ${fmtDur(total)}`);
      for (const [lbl, v] of rows) {
        out.push(`- ${lbl}: ${fmtDur(v.min)}${v.items.length ? ` (${v.items.join(', ')})` : ''}`);
        totals.set(lbl, (totals.get(lbl) || 0) + v.min);
      }
      out.push('');
    }
    if (!week) return out.concat('No timed tasks were checked off this week.').join('\n') + '\n';
    out.push(`By project: ${fmtDur(week)} in total`);
    for (const [lbl, m] of [...totals].sort((a, b) => b[1] - a[1])) out.push(`- ${lbl}: ${fmtDur(m)}`);
    return out.join('\n') + '\n';
  }

  /* ---------- projects ---------- */
  // The project sheet, in the order of the user's own notes. Keys double as {{placeholders}}.
  const PROJECT_FIELDS = [
    { key: 'spoc', label: 'SPOC', long: true, hint: 'One contact per line: name and email' },
    { key: 'db', label: 'DB', hint: 'Database name or URL' },
    { key: 'website', label: 'Current website', hint: 'https://…' },
    { key: 'version', label: 'Version', hint: 'For example Odoo 18.0' },
    { key: 'task_link', label: 'Task link', hint: 'https://…' },
    { key: 'deadline', label: 'Deadline', type: 'date' },
    { key: 'ba', label: 'BA', hint: 'Business analyst' },
    { key: 'salesperson', label: 'Salesperson' },
    { key: 'languages', label: 'Languages involved', hint: 'For example ES, EN, FR' },
    { key: 'goal', label: 'Goal', long: true },
    { key: 'references', label: 'References', long: true, hint: 'Websites and examples to take as a reference' },
    { key: 'apps', label: 'Apps', long: true },
    { key: 'sitemap', label: 'Sitemap', long: true },
    { key: 'notes', label: 'Notes', long: true }
  ];
  const EMAIL_RE = /[^\s<>,;:()"'[\]]+@[^\s<>,;:()"'[\]]+\.[a-z]{2,}/i;
  const EMAIL_RE_G = new RegExp(EMAIL_RE.source, 'gi');
  const emailIn = s => (EMAIL_RE.exec(s || '') || [''])[0];
  const emailsIn = s => [...new Set((String(s || '').match(EMAIL_RE_G) || []))];
  const firstLine = s => (String(s || '').split('\n').find(l => l.trim()) || '').trim();
  const nameIn = s => (s || '').replace(EMAIL_RE, ' ').replace(/[<>()[\],;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  // A link worth opening: a full http(s) URL, or a bare domain like partena.odoo.com.
  function linkOf(s) {
    s = (s || '').trim();
    if (/^https?:\/\/[^\s]+$/i.test(s)) return s;
    if (!s.includes('@') && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(s) && /\.[a-z]{2,}(:\d+)?(\/|$)/i.test(s)) return 'https://' + s;
    return '';
  }
  const DEFAULT_SCHEDULE = [
    'Homepage design + design line definition',
    'Website design',
    'Content review / adjustments',
    'Training / Q&A',
    'Go live'
  ];
  const nextNumber = projects => projects.reduce((m, p) => Math.max(m, Number(p.num) || 0), 0) + 1;
  const scheduleFrom = (names, newId) => names.filter(n => n.trim()).map(text => ({ id: newId(), text: text.trim(), date: '', done: false }));
  // The first phase not done yet, which is what the project is working toward now.
  const nextPhase = p => (p.schedule || []).find(x => !x.done && x.text.trim()) || null;
  function duplicateProject(p, projects, newId) {
    const copyLine = l => ({ id: newId(), text: l.text, level: l.level, done: false });
    return {
      id: newId(), num: nextNumber(projects), name: `${p.name.trim() || 'Untitled project'} (copy)`,
      archived: false, lang: p.lang, fields: { ...p.fields },
      schedule: (p.schedule || []).map(x => ({ id: newId(), text: x.text, date: x.date || '', done: false })),
      todos: (p.todos || []).map(copyLine),
      copy: {
        brief: { ...((p.copy && p.copy.brief) || {}) },
        pages: ((p.copy && p.copy.pages) || []).map(pg => ({
          id: newId(), name: pg.name, blocks: pg.blocks.map(b => ({ id: newId(), kind: b.kind, label: b.label, text: { ...b.text } }))
        }))
      }
    };
  }
  // Finds projects by number ("12", "#12") or by any part of the name.
  function findProjects(projects, q) {
    q = norm(q).replace(/^#/, '');
    if (!q) return projects.slice();
    const num = /^\d+$/.test(q) ? Number(q) : null;
    return projects
      .map(p => {
        const n = norm(p.name);
        const score = num !== null && p.num === num ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : num !== null && String(p.num).startsWith(q) ? 3 : 9;
        return [score, p];
      })
      .filter(([sc]) => sc < 9).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  }
  const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);
  function dueLabel(date, today) {
    if (!isDate(date)) return null;
    const d = daysBetween(today, date);
    if (d < 0) return { text: d === -1 ? '1 day late' : `${-d} days late`, late: true };
    if (d === 0) return { text: 'Due today', soon: true };
    if (d === 1) return { text: 'Due tomorrow', soon: true };
    if (d < 7) return { text: `Due ${fmtShort(date)}`, soon: d < 3 };
    return { text: `Due ${DM.format(parseYmd(date))}` };
  }

  /* ---------- mail templates ---------- */
  const PH = /\{\{\s*([\w.-]+)\s*\}\}/g;
  function placeholders(s) {
    const out = [];
    String(s || '').replace(PH, (m, n) => { if (!out.includes(n)) out.push(n); return m; });
    return out;
  }
  const fill = (s, v) => String(s || '').replace(PH, (all, n) => (v[n] ? v[n] : all));
  // Splits text into plain and placeholder parts, for previews that highlight what's still blank.
  function fillParts(s, v) {
    s = String(s || '');
    const out = [];
    let last = 0;
    String(s || '').replace(PH, (all, n, off) => {
      if (off > last) out.push({ text: s.slice(last, off) });
      out.push(v[n] ? { text: v[n] } : { text: all, blank: n });
      last = off + all.length;
      return all;
    });
    if (last < s.length) out.push({ text: s.slice(last) });
    return out;
  }
  function isoWeek(s) {
    const d = parseYmd(s);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const jan4 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  }
  const LONG_DATE = Object.fromEntries([['en', 'en-GB'], ['es', 'es-ES'], ['fr', 'fr-FR'], ['it', 'it-IT']]
    .map(([k, loc]) => [k, new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long', year: 'numeric' })]));
  const AUTO_KEYS = ['project', 'project_number', 'first_name', 'contact', 'spoc_email', 'schedule', 'date', 'week', 'my_name', 'signature'];
  function autoValues(project, me, lang, today) {
    const f = (project && project.fields) || {};
    const fmt = s => (isDate(s) ? (LONG_DATE[lang] || LONG_DATE.en).format(parseYmd(s)) : '');
    const contact = nameIn(firstLine(f.spoc)).replace(/\s+-\s+.*$/, '');
    const v = {
      project: project ? project.name.trim() : '',
      project_number: project && project.num ? String(project.num) : '',
      contact, first_name: contact.split(' ')[0] || '', spoc_email: emailsIn(f.spoc).join(', '),
      schedule: ((project && project.schedule) || []).filter(x => x.text.trim())
        .map(x => `- ${x.text.trim()}${isDate(x.date) ? `: ${fmt(x.date)}` : ''}`).join('\n'),
      date: fmt(today), week: String(isoWeek(today)),
      my_name: (me && me.name || '').trim(), signature: (me && (me.signature || me.name) || '').trim()
    };
    for (const { key } of PROJECT_FIELDS) v[key] = key === 'deadline' ? fmt(f.deadline) : String(f[key] || '').trim();
    v.spoc = String(f.spoc || '').trim();
    return v;
  }
  const isLongBlank = n => /points|steps|pending|done|planned|risks|summary|details|notes|items|list|agenda|issues|changes|comments|message|body|text/i.test(n);
  const humanize = n => {
    const f = PROJECT_FIELDS.find(x => x.key === n);
    if (f) return f.label;
    if (n === 'spoc_email') return 'SPOC email';
    if (n === 'project_number') return 'Project number';
    if (n === 'schedule') return 'Project schedule';
    const t = n.replace(/[._-]+/g, ' ').trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const mailto = (to, subject, body) =>
    `mailto:${encodeURIComponent(to || '').replace(/%40/g, '@')}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body || '')}`;

  // The suggestion library: one template per kind of email, in four languages, grouped by category.
  const TEMPLATE_CATEGORIES = ['Project start', 'Meetings', 'Updates', 'Follow-ups', 'Review and delivery', 'Closing'];
  const tpl = (name, cat, about, en, es, fr, it) => ({
    name, cat, about, en: { subject: en[0], body: en[1] }, es: { subject: es[0], body: es[1] },
    fr: { subject: fr[0], body: fr[1] }, it: { subject: it[0], body: it[1] }
  });
  const STARTER_TEMPLATES = [
    tpl('Kick-off', 'Project start', 'Introduce yourself, share the plan and propose the kick-off meeting.',
      ['{{project}}: kick-off', 'Hi {{first_name}},\n\nI’m {{my_name}}, and I’ll be managing {{project}}. I’m looking forward to working with you.\n\nTo get started, I’d like to set up a kick-off meeting to go over the goals, the scope and the schedule. Would {{proposed_date}} suit you?\n\nThis is the plan we’ll follow:\n{{schedule}}\n\nYou can follow the project in [the project task]({{task_link}}).\n\nBest regards,\n{{signature}}'],
      ['{{project}}: inicio del proyecto', 'Hola {{first_name}}:\n\nSoy {{my_name}} y voy a gestionar el proyecto {{project}}. Tengo muchas ganas de trabajar contigo.\n\nPara empezar, me gustaría organizar una reunión de inicio para repasar los objetivos, el alcance y el calendario. ¿Te viene bien el {{proposed_date}}?\n\nEste es el plan que seguiremos:\n{{schedule}}\n\nPuedes seguir el proyecto en [la tarea del proyecto]({{task_link}}).\n\nUn saludo,\n{{signature}}'],
      ['{{project}}\u00a0: lancement du projet', 'Bonjour {{first_name}},\n\nJe suis {{my_name}} et je piloterai le projet {{project}}. Je me réjouis de travailler avec vous.\n\nPour commencer, je vous propose une réunion de lancement afin de passer en revue les objectifs, le périmètre et le planning. Le {{proposed_date}} vous conviendrait-il\u00a0?\n\nVoici le planning que nous suivrons\u00a0:\n{{schedule}}\n\nVous pouvez suivre l’avancement dans [la tâche du projet]({{task_link}}).\n\nBien cordialement,\n{{signature}}'],
      ['{{project}}: avvio del progetto', 'Buongiorno {{first_name}},\n\nsono {{my_name}} e seguirò il progetto {{project}}. Non vedo l’ora di lavorare insieme.\n\nPer iniziare, vorrei organizzare una riunione di avvio per rivedere gli obiettivi, il perimetro e la pianificazione. Le andrebbe bene il {{proposed_date}}?\n\nQuesta è la pianificazione che seguiremo:\n{{schedule}}\n\nPuò seguire l’avanzamento nel [task del progetto]({{task_link}}).\n\nCordiali saluti,\n{{signature}}']),
    tpl('Meeting invitation', 'Meetings', 'Invite the client to a meeting, with the agenda and a link to join.',
      ['{{project}}: meeting on {{meeting_date}}', 'Hi {{first_name}},\n\nI’d like to invite you to a meeting about {{topic}} on {{meeting_date}}.\n\nAgenda:\n{{agenda}}\n\n[Join the meeting]({{meeting_link}})\n\nIf that time doesn’t suit you, let me know and I’ll find another one.\n\nBest regards,\n{{signature}}'],
      ['{{project}}: reunión el {{meeting_date}}', 'Hola {{first_name}}:\n\nTe invito a una reunión sobre {{topic}} el {{meeting_date}}.\n\nOrden del día:\n{{agenda}}\n\n[Unirse a la reunión]({{meeting_link}})\n\nSi no te viene bien, dímelo y buscamos otro momento.\n\nUn saludo,\n{{signature}}'],
      ['{{project}}\u00a0: réunion le {{meeting_date}}', 'Bonjour {{first_name}},\n\nJe vous propose une réunion au sujet de {{topic}} le {{meeting_date}}.\n\nOrdre du jour\u00a0:\n{{agenda}}\n\n[Rejoindre la réunion]({{meeting_link}})\n\nSi ce créneau ne vous convient pas, dites-le-moi et nous en trouverons un autre.\n\nBien cordialement,\n{{signature}}'],
      ['{{project}}: riunione il {{meeting_date}}', 'Buongiorno {{first_name}},\n\nLa invito a una riunione su {{topic}} il {{meeting_date}}.\n\nOrdine del giorno:\n{{agenda}}\n\n[Partecipa alla riunione]({{meeting_link}})\n\nSe l’orario non Le va bene, me lo faccia sapere e troveremo un altro momento.\n\nCordiali saluti,\n{{signature}}']),
    tpl('Meeting recap', 'Meetings', 'Sum up what was agreed and the next steps.',
      ['{{project}}: meeting recap, {{date}}', 'Hi {{first_name}},\n\nThanks for your time today. Here’s what we agreed:\n\n{{points}}\n\nNext steps:\n{{next_steps}}\n\nBest regards,\n{{signature}}'],
      ['{{project}}: resumen de la reunión del {{date}}', 'Hola {{first_name}}:\n\nGracias por tu tiempo hoy. Esto es lo que acordamos:\n\n{{points}}\n\nPróximos pasos:\n{{next_steps}}\n\nUn saludo,\n{{signature}}'],
      ['{{project}}\u00a0: compte rendu de la réunion du {{date}}', 'Bonjour {{first_name}},\n\nMerci pour votre temps aujourd’hui. Voici ce que nous avons convenu\u00a0:\n\n{{points}}\n\nProchaines étapes\u00a0:\n{{next_steps}}\n\nBien cordialement,\n{{signature}}'],
      ['{{project}}: resoconto della riunione del {{date}}', 'Buongiorno {{first_name}},\n\ngrazie per il tempo dedicato oggi. Ecco quanto abbiamo concordato:\n\n{{points}}\n\nProssimi passi:\n{{next_steps}}\n\nCordiali saluti,\n{{signature}}']),
    tpl('Heads-up', 'Updates', 'Let the client know about something coming up before it happens.',
      ['{{project}}: heads-up about {{topic}}', 'Hi {{first_name}},\n\nA quick heads-up about {{topic}}: {{details}}\n\nI’ll keep you posted. In the meantime, let me know if you have any questions.\n\nBest regards,\n{{signature}}'],
      ['{{project}}: aviso sobre {{topic}}', 'Hola {{first_name}}:\n\nTe escribo para avisarte sobre {{topic}}: {{details}}\n\nTe mantendré al tanto. Mientras tanto, si tienes cualquier duda, dímelo.\n\nUn saludo,\n{{signature}}'],
      ['{{project}}\u00a0: information concernant {{topic}}', 'Bonjour {{first_name}},\n\nPour information, concernant {{topic}}\u00a0: {{details}}\n\nJe vous tiendrai au courant. D’ici là, n’hésitez pas si vous avez des questions.\n\nBien cordialement,\n{{signature}}'],
      ['{{project}}: avviso su {{topic}}', 'Buongiorno {{first_name}},\n\nLe segnalo una novità su {{topic}}: {{details}}\n\nLe farò sapere gli sviluppi. Nel frattempo, resto a disposizione per qualsiasi domanda.\n\nCordiali saluti,\n{{signature}}']),
    tpl('Status update', 'Updates', 'What was done, what comes next and what you need from the client.',
      ['{{project}}: status update, week {{week}}', 'Hi {{first_name}},\n\nHere’s where {{project}} stands this week.\n\nDone:\n{{done}}\n\nNext:\n{{next_steps}}\n\nWhat we need from you:\n{{pending}}\n\nThe schedule:\n{{schedule}}\n\nBest regards,\n{{signature}}'],
      ['{{project}}: estado del proyecto, semana {{week}}', 'Hola {{first_name}}:\n\nAsí va {{project}} esta semana.\n\nHecho:\n{{done}}\n\nPróximos pasos:\n{{next_steps}}\n\nLo que necesitamos de ti:\n{{pending}}\n\nCalendario:\n{{schedule}}\n\nUn saludo,\n{{signature}}'],
      ['{{project}}\u00a0: point d’avancement, semaine {{week}}', 'Bonjour {{first_name}},\n\nVoici où en est {{project}} cette semaine.\n\nRéalisé\u00a0:\n{{done}}\n\nProchaines étapes\u00a0:\n{{next_steps}}\n\nCe dont nous avons besoin de votre part\u00a0:\n{{pending}}\n\nPlanning\u00a0:\n{{schedule}}\n\nBien cordialement,\n{{signature}}'],
      ['{{project}}: stato di avanzamento, settimana {{week}}', 'Buongiorno {{first_name}},\n\necco a che punto è {{project}} questa settimana.\n\nCompletato:\n{{done}}\n\nProssimi passi:\n{{next_steps}}\n\nCosa ci serve da parte Sua:\n{{pending}}\n\nPianificazione:\n{{schedule}}\n\nCordiali saluti,\n{{signature}}']),
    tpl('Delay notice', 'Updates', 'Announce a new date, why it moved and how you’ll limit the impact.',
      ['{{project}}: change to the schedule', 'Hi {{first_name}},\n\nI’m writing to let you know that {{what}} will be delayed. It’s now planned for {{new_date}}, because {{reason}}.\n\nTo limit the impact, {{plan}}\n\nI’m sorry for the inconvenience. Let me know if you’d like to talk it through.\n\nBest regards,\n{{signature}}'],
      ['{{project}}: cambio en el calendario', 'Hola {{first_name}}:\n\nTe escribo para avisarte de que {{what}} se va a retrasar. Ahora está previsto para el {{new_date}}, porque {{reason}}.\n\nPara limitar el impacto, {{plan}}\n\nSiento las molestias. Si quieres, lo comentamos en una llamada.\n\nUn saludo,\n{{signature}}'],
      ['{{project}}\u00a0: modification du planning', 'Bonjour {{first_name}},\n\nJe vous informe que {{what}} prendra du retard. La nouvelle date prévue est le {{new_date}}, en raison de {{reason}}.\n\nPour en limiter l’impact, {{plan}}\n\nJe vous prie de nous excuser pour ce contretemps. N’hésitez pas si vous souhaitez en parler.\n\nBien cordialement,\n{{signature}}'],
      ['{{project}}: modifica della pianificazione', 'Buongiorno {{first_name}},\n\nLe comunico che {{what}} subirà un ritardo. La nuova data prevista è il {{new_date}}, a causa di {{reason}}.\n\nPer limitarne l’impatto, {{plan}}\n\nCi scusiamo per il disagio. Se vuole, possiamo parlarne in una breve chiamata.\n\nCordiali saluti,\n{{signature}}']),
    tpl('Change request', 'Updates', 'Reply to a request outside the scope, with the effort and the impact.',
      ['{{project}}: change request', 'Hi {{first_name}},\n\nThanks for your request about {{change}}. It isn’t part of the current scope, so here is what it involves:\n\n- Estimated effort: {{effort}}\n- Impact on the schedule: {{impact}}\n\nCould you confirm whether you’d like us to go ahead?\n\nBest regards,\n{{signature}}'],
      ['{{project}}: solicitud de cambio', 'Hola {{first_name}}:\n\nGracias por tu petición sobre {{change}}. No forma parte del alcance actual, así que te detallo lo que supone:\n\n- Esfuerzo estimado: {{effort}}\n- Impacto en el calendario: {{impact}}\n\n¿Me confirmas si quieres que sigamos adelante?\n\nUn saludo,\n{{signature}}'],
      ['{{project}}\u00a0: demande de modification', 'Bonjour {{first_name}},\n\nMerci pour votre demande concernant {{change}}. Elle ne fait pas partie du périmètre actuel\u00a0; voici donc ce qu’elle implique\u00a0:\n\n- Charge estimée\u00a0: {{effort}}\n- Impact sur le planning\u00a0: {{impact}}\n\nPourriez-vous me confirmer si vous souhaitez que nous allions de l’avant\u00a0?\n\nBien cordialement,\n{{signature}}'],
      ['{{project}}: richiesta di modifica', 'Buongiorno {{first_name}},\n\ngrazie per la richiesta relativa a {{change}}. Non rientra nel perimetro attuale, quindi Le riporto cosa comporta:\n\n- Impegno stimato: {{effort}}\n- Impatto sulla pianificazione: {{impact}}\n\nMi conferma se desidera procedere?\n\nCordiali saluti,\n{{signature}}']),
    tpl('Follow-up', 'Follow-ups', 'Ask where something stands when you’re waiting on the client.',
      ['{{project}}: following up', 'Hi {{first_name}},\n\nI’m following up on {{topic}}. Could you let me know where things stand when you have a moment?\n\nThanks,\n{{signature}}'],
      ['{{project}}: seguimiento', 'Hola {{first_name}}:\n\nTe escribo para hacer seguimiento de {{topic}}. ¿Me puedes indicar cómo va cuando tengas un momento?\n\nGracias,\n{{signature}}'],
      ['{{project}}\u00a0: suivi', 'Bonjour {{first_name}},\n\nJe reviens vers vous au sujet de {{topic}}. Pourriez-vous me dire où en sont les choses quand vous aurez un moment\u00a0?\n\nMerci,\n{{signature}}'],
      ['{{project}}: aggiornamento', 'Buongiorno {{first_name}},\n\nLe scrivo per avere un aggiornamento su {{topic}}. Quando ha un momento, potrebbe dirmi a che punto siamo?\n\nGrazie,\n{{signature}}']),
    tpl('Deadline reminder', 'Follow-ups', 'Remind the client of the deadline and what’s still missing.',
      ['{{project}}: deadline on {{deadline}}', 'Hi {{first_name}},\n\nA quick reminder that the deadline for {{project}} is {{deadline}}. To stay on track, we still need:\n\n{{pending}}\n\nThanks,\n{{signature}}'],
      ['{{project}}: fecha límite el {{deadline}}', 'Hola {{first_name}}:\n\nTe recuerdo que la fecha límite de {{project}} es el {{deadline}}. Para cumplirla, todavía necesitamos:\n\n{{pending}}\n\nGracias,\n{{signature}}'],
      ['{{project}}\u00a0: échéance le {{deadline}}', 'Bonjour {{first_name}},\n\nPetit rappel\u00a0: l’échéance de {{project}} est fixée au {{deadline}}. Pour la respecter, il nous manque encore\u00a0:\n\n{{pending}}\n\nMerci,\n{{signature}}'],
      ['{{project}}: scadenza il {{deadline}}', 'Buongiorno {{first_name}},\n\nle ricordo che la scadenza di {{project}} è il {{deadline}}. Per rispettarla, ci servono ancora:\n\n{{pending}}\n\nGrazie,\n{{signature}}']),
    tpl('Ready for review', 'Review and delivery', 'Ask the client to test something and send feedback by a date.',
      ['{{project}}: ready for your review', 'Hi {{first_name}},\n\n{{what}} is ready for you to review on {{db}}.\n\nCould you test it and send me your feedback by {{review_by}}?\n\nBest regards,\n{{signature}}'],
      ['{{project}}: listo para tu revisión', 'Hola {{first_name}}:\n\n{{what}} está listo para que lo revises en {{db}}.\n\n¿Puedes probarlo y enviarme tus comentarios antes del {{review_by}}?\n\nUn saludo,\n{{signature}}'],
      ['{{project}}\u00a0: prêt pour votre validation', 'Bonjour {{first_name}},\n\n{{what}} est prêt à être testé sur {{db}}.\n\nPourriez-vous le vérifier et m’envoyer vos retours d’ici le {{review_by}}\u00a0?\n\nBien cordialement,\n{{signature}}'],
      ['{{project}}: pronto per la sua revisione', 'Buongiorno {{first_name}},\n\n{{what}} è pronto per essere verificato su {{db}}.\n\nPotrebbe provarlo e inviarmi il suo riscontro entro il {{review_by}}?\n\nCordiali saluti,\n{{signature}}']),
    tpl('Wrap-up', 'Closing', 'Close the project: what was delivered and how support works from now on.',
      ['{{project}}: wrapping up', 'Hi {{first_name}},\n\n{{project}} is now live. Thank you for your trust and your help throughout the project.\n\nTo sum up:\n{{summary}}\n\nFrom now on, {{support}}\n\nIt’s been a pleasure working with you.\n\nBest regards,\n{{signature}}'],
      ['{{project}}: cierre del proyecto', 'Hola {{first_name}}:\n\n{{project}} ya está en producción. Gracias por tu confianza y tu ayuda durante todo el proyecto.\n\nEn resumen:\n{{summary}}\n\nA partir de ahora, {{support}}\n\nHa sido un placer trabajar contigo.\n\nUn saludo,\n{{signature}}'],
      ['{{project}}\u00a0: clôture du projet', 'Bonjour {{first_name}},\n\n{{project}} est désormais en production. Merci pour votre confiance et votre aide tout au long du projet.\n\nEn résumé\u00a0:\n{{summary}}\n\nDésormais, {{support}}\n\nCe fut un plaisir de travailler avec vous.\n\nBien cordialement,\n{{signature}}'],
      ['{{project}}: chiusura del progetto', 'Buongiorno {{first_name}},\n\n{{project}} è ora in produzione. Grazie per la fiducia e per il supporto durante tutto il progetto.\n\nIn sintesi:\n{{summary}}\n\nDa ora in poi, {{support}}\n\nÈ stato un piacere lavorare insieme.\n\nCordiali saluti,\n{{signature}}']),
    tpl('Thank you', 'Closing', 'A short thank-you for the client’s help or feedback.',
      ['Thank you, {{first_name}}', 'Hi {{first_name}},\n\nThank you for {{reason}}. It really helped us move {{project}} forward.\n\nBest regards,\n{{signature}}'],
      ['Gracias, {{first_name}}', 'Hola {{first_name}}:\n\nGracias por {{reason}}. Nos ha ayudado mucho a avanzar con {{project}}.\n\nUn saludo,\n{{signature}}'],
      ['Merci, {{first_name}}', 'Bonjour {{first_name}},\n\nMerci pour {{reason}}. Cela nous a beaucoup aidés à faire avancer {{project}}.\n\nBien cordialement,\n{{signature}}'],
      ['Grazie, {{first_name}}', 'Buongiorno {{first_name}},\n\ngrazie per {{reason}}. Ci è stato di grande aiuto per far avanzare {{project}}.\n\nCordiali saluti,\n{{signature}}'])
  ];

  /* ---------- languages ---------- */
  const LANGS = ['en', 'es', 'fr', 'it'];
  const LANG_NAMES = { en: 'English', es: 'Spanish', fr: 'French', it: 'Italian', de: 'German', nl: 'Dutch', pt: 'Portuguese', ca: 'Catalan', eu: 'Basque', gl: 'Galician', pl: 'Polish', ro: 'Romanian', sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish', cs: 'Czech', el: 'Greek', tr: 'Turkish', ar: 'Arabic', zh: 'Chinese', ja: 'Japanese' };
  const langName = c => LANG_NAMES[c] || c.toUpperCase();
  const NAME_TO_CODE = { english: 'en', ingles: 'en', anglais: 'en', inglese: 'en', spanish: 'es', espanol: 'es', castellano: 'es', espagnol: 'es', spagnolo: 'es', french: 'fr', frances: 'fr', francais: 'fr', francese: 'fr', italian: 'it', italiano: 'it', italien: 'it', german: 'de', aleman: 'de', deutsch: 'de', dutch: 'nl', neerlandes: 'nl', holandes: 'nl', portuguese: 'pt', portugues: 'pt', catalan: 'ca', catala: 'ca' };
  // "ES, EN, FR" or "Spanish and French" -> ['es', 'en', 'fr'].
  function parseLanguages(s) {
    const out = [];
    for (const w of fold(s).split(/[^a-z]+/)) {
      const c = w.length === 2 && LANG_NAMES[w] ? w : NAME_TO_CODE[w];
      if (c && !out.includes(c)) out.push(c);
    }
    return out;
  }
  // Lowercase, without accents or punctuation: for matching labels in any language.
  const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  /* ---------- projects as Markdown (Apple Notes) ---------- */
  const SECTION_ALIASES = {
    todos: ['project todos', 'project to dos', 'project todo', 'todos', 'to dos', 'todo', 'to do', 'tasks', 'project tasks', 'pendientes', 'tareas', 'a faire'],
    schedule: ['project schedule', 'schedule', 'planning', 'timeline', 'phases', 'cronograma', 'calendario', 'planificacion'],
    spoc: ['spoc', 'spocs', 'contact', 'contacts', 'client contact', 'contacto', 'contactos'],
    db: ['db', 'database', 'odoo db', 'odoo database', 'base de datos', 'bd'],
    website: ['current website', 'website', 'current site', 'web', 'site', 'web actual', 'sitio web', 'url'],
    version: ['version', 'odoo version', 'odoo'],
    task_link: ['task link', 'task', 'odoo task', 'task url', 'link', 'tarea'],
    deadline: ['deadline', 'due date', 'due', 'fecha limite', 'fecha de entrega', 'entrega', 'fecha'],
    ba: ['ba', 'business analyst', 'analyst', 'analista'],
    salesperson: ['salesperson', 'sales person', 'salesman', 'saleswoman', 'sales', 'account manager', 'comercial', 'vendedor', 'vendedora'],
    references: ['references', 'reference', 'referencias', 'referencia', 'inspiration', 'inspiracion', 'benchmarks', 'examples', 'ejemplos'],
    languages: ['languages involved', 'languages', 'language', 'idiomas', 'idioma'],
    goal: ['goal', 'goals', 'objective', 'objectives', 'objetivo', 'objetivos'],
    sitemap: ['sitemap', 'site map', 'pages', 'mapa del sitio', 'mapa web'],
    apps: ['apps', 'odoo apps', 'modules', 'aplicaciones', 'modulos'],
    notes: ['notes', 'note', 'notas', 'comments']
  };
  const ALIAS = new Map();
  for (const [k, list] of Object.entries(SECTION_ALIASES)) for (const a of list) ALIAS.set(a, k);
  const sectionOf = label => ALIAS.get(fold(label).replace(/ s$/, 's')) || null;

  const unescapeMd = s => s.replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, '$1');
  // Notes writes bold as **x**, sometimes doubled (****x****); emphasis markers carry no meaning here.
  const stripInline = s => unescapeMd(String(s).replace(/(?<!\\)\*{2,}/g, '').replace(/__(.+?)__/g, '$1').replace(/(^|\s)\*(\S.*?)\*(?=\s|$)/g, '$1$2'));
  // [text](url) -> the URL when the text is the URL (or for link fields), otherwise "text (url)".
  // Notes sometimes links only part of an address: [https://site](https://site).com reads as https://site.com.
  const mdLinks = (s, preferUrl) => s.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (m, t, u) => (preferUrl || !t || t === u ? u : `${t} (${u})`));
  const DATE_PATTERNS = [
    [/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, m => [m[1], m[2], m[3]]],
    [/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/, m => [m[3].length === 2 ? `20${m[3]}` : m[3], m[2], m[1]]]
  ];
  // Finds a date written as 2026-11-13, 13/11/2026, 13.11.2026 or 13-11-26 (day first, as in Europe).
  function findDate(s) {
    for (const [re, get] of DATE_PATTERNS) {
      const m = re.exec(s || '');
      if (!m) continue;
      const [y, mo, d] = get(m).map(Number);
      const dt = new Date(y, mo - 1, d);
      if (dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d) return { date: ymd(dt), match: m[0] };
    }
    return null;
  }
  const fmtSlash = s => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
  const LIST_RE = /^(\s*)(?:[-*+•◦▪]|\d{1,3}[.)])\s+(?:\[( |x|X)\]\s+)?(.*)$/;
  const BOX_RE = /^(\s*)(?:\[( |x|X)\]|([☐☑✓✔]))\s+(.*)$/;
  function listItem(line) {
    let m = LIST_RE.exec(line);
    if (m) return { indent: m[1].replace(/\t/g, '    ').length, done: /x/i.test(m[2] || ''), text: m[3] };
    m = BOX_RE.exec(line);
    if (m) return { indent: m[1].replace(/\t/g, '    ').length, done: /x/i.test(m[2] || '') || /[☑✓✔]/.test(m[3] || ''), text: m[4] };
    return null;
  }
  // "xxx", "?", "-" and "TBD" are placeholders for something not known yet.
  const PLACEHOLDER = /^(x{2,}|\?+|[-—–]+|tbd|tbc|n\/a|na|pending|pendiente|por definir|a definir|sin definir)$/i;
  const NO_DATE = /^(no|none|sin|sin fecha|no deadline|pas de date|nessuna)\b/i;
  const isSeparator = l => /^\s*([—–]+|[-*_]{3,}|(?:[-*_]\s){2,}[-*_])\s*$/.test(l);
  const isEmptyBullet = l => /^\s*(?:[-*+•]|\d{1,3}[.)])\s*$/.test(l);
  // A line that starts a section: a heading, a bold label, "Label:" alone, or "Label: value".
  // List items never do, so an app called "Website" in a list stays an app.
  function sectionLine(line) {
    let m = /^\s*#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (m) { const t = stripInline(m[1]).replace(/:\s*$/, '').trim(); return { label: t, key: sectionOf(t), rest: '' }; }
    if (listItem(line)) return null;
    m = /^\s*\*{2,}(.+?)\*{2,}\s*(:?)\s*(.*)$/.exec(line);
    if (m) {
      const colon = /:\s*$/.test(m[1]) || m[2] === ':';
      const label = stripInline(m[1]).replace(/:\s*$/, '').trim();
      const key = sectionOf(label);
      if (key) return { label, key, rest: m[3] };
      // An unknown bold label with a colon ("SALESPERSON:") still starts a section of its own.
      if (colon && label.length <= 40) return { label, key: null, rest: m[3] };
      return null;
    }
    m = /^\s*([^:\n]{1,40}?)\s*:\s*(.*)$/.exec(stripInline(line));
    if (m && sectionOf(m[1]) && !/^https?$/i.test(m[1])) return { label: m[1].trim(), key: sectionOf(m[1]), rest: m[2] };
    const plain = stripInline(line).trim().replace(/:$/, '');
    if (plain && plain.length <= 40 && sectionOf(plain)) return { label: plain, key: sectionOf(plain), rest: '' };
    return null;
  }
  const titleParts = t => {
    t = stripInline(t).trim();
    let m = /^#(\d{1,6})\s+(.*)$/.exec(t) || /^(\d{1,6})\s*[-–.:)]\s+(.*)$/.exec(t) || /^\[(\d{1,6})\]\s*(.*)$/.exec(t);
    return m ? { num: Number(m[1]), name: m[2].trim() } : { num: 0, name: t };
  };
  // A schedule line: "**Diseño web** - xxx", "Go-Live - 15/12/2026", or a checklist item with a date.
  function phaseLine(line) {
    const it = listItem(line);
    const raw = it ? it.text : line;
    const bold = /^\s*\*{2,}(.+?)\*{2,}\s*(?:[-–—:]\s*(.*))?$/.exec(raw);
    let name, value;
    if (bold) { name = stripInline(bold[1]); value = bold[2] || ''; }
    else {
      const m = /^(.+?)\s+[-–—:]\s+(.*)$/.exec(stripInline(raw));
      if (!m) return null;
      name = m[1]; value = m[2];
    }
    value = stripInline(value).trim();
    const d = findDate(value);
    if (!bold && !d && !PLACEHOLDER.test(value)) return null;
    name = name.replace(/\s{2,}/g, ' ').replace(/[:\s]+$/, '').trim();
    if (!name || name.length > 80) return null;
    const rest = d ? value.replace(d.match, '').replace(/^[\s,;:-]+|[\s,;:-]+$/g, '') : PLACEHOLDER.test(value) ? '' : value;
    return { text: rest ? `${name} (${rest})` : name, date: d ? d.date : '', done: !!(it && it.done) };
  }

  function parseProjectMarkdown(text, newId) {
    const lines = String(text || '').replace(/\r\n?|[\u2028\u2029]/g, '\n').replace(/\u00a0/g, ' ').split('\n').map(l => l.replace(/\s+$/, ''));
    const p = { num: 0, name: '', fields: {}, todos: [], schedule: null, extra: [] };
    let i = 0;
    while (i < lines.length && (!lines[i].trim() || isSeparator(lines[i]))) i++;
    if (i < lines.length) {
      const h = /^\s*#{1,6}\s+(.*)$/.exec(lines[i]);
      const s0 = sectionLine(lines[i]);
      if (h || !s0 || !s0.key) { Object.assign(p, titleParts(h ? h[1] : lines[i])); i++; }
    }
    let cur = null;
    const sections = [];
    for (; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line) || isEmptyBullet(line)) continue;
      if (isSeparator(line)) { cur = null; continue; }
      const s = sectionLine(line);
      if (s) {
        cur = { key: s.key, label: s.label, lines: [] };
        sections.push(cur);
        if (s.rest.trim()) cur.lines.push(s.rest);
        continue;
      }
      if (!cur) { cur = { key: null, label: '', lines: [] }; sections.push(cur); }
      cur.lines.push(line);
    }
    const trimBlock = arr => {
      const a = [];
      for (const l of arr) if (l.trim() || (a.length && a[a.length - 1].trim())) a.push(l);
      while (a.length && !a[a.length - 1].trim()) a.pop();
      return a;
    };
    const addPhases = list => { p.schedule = (p.schedule || []).concat(list.map(x => ({ id: newId(), ...x }))); };
    for (const sec of sections) {
      const body = trimBlock(sec.lines);
      const filled = body.filter(l => l.trim());
      if (sec.key === 'todos') {
        let base = null;
        for (const l of filled) {
          const it = listItem(l) || { indent: 0, done: false, text: l.trim() };
          if (base === null) base = it.indent;
          const t = stripInline(mdLinks(it.text, false)).trim();
          if (t) p.todos.push({ id: newId(), text: t, level: it.indent > base + 1 && p.todos.length ? 1 : 0, done: it.done });
        }
      } else if (sec.key === 'schedule' || (!sec.key && !sec.label && filled.length >= 2 && filled.every(phaseLine))) {
        addPhases(filled.map(l => phaseLine(l) || (() => {
          const it = listItem(l) || { done: false, text: l.trim() };
          let t = stripInline(it.text);
          const d = findDate(t);
          if (d) t = t.replace(d.match, ' ');
          t = t.replace(/\s*[-–—:,]?\s*(\?+\s*)?(deadline|fecha( limite)?|date|due)?\s*[:?]*\s*$/i, '').replace(/\s{2,}/g, ' ').trim();
          return { text: t, date: d ? d.date : '', done: it.done };
        })()).filter(x => x.text));
      } else if (sec.key === 'deadline') {
        const t = stripInline(filled.join(' ')).trim();
        const d = findDate(t);
        if (d) p.fields.deadline = d.date;
        else if (t && !PLACEHOLDER.test(t) && !NO_DATE.test(t)) p.extra.push(`Deadline: ${t}`);
      } else if (sec.key) {
        const def = PROJECT_FIELDS.find(f => f.key === sec.key) || {};
        const url = sec.key === 'website' || sec.key === 'task_link' || sec.key === 'db';
        let v;
        if (def.long) {
          // Keep lists and their indentation; drop bold markers and links' duplicate text.
          v = body.map(l => stripInline(mdLinks(l, sec.key === 'references'))).join('\n');
          if (sec.key === 'spoc' || sec.key === 'references') v = v.split('\n').map(l => { const it = listItem(l); return it ? it.text : l; }).join('\n');
        } else {
          const parts = filled.map(l => { const it = listItem(l); return stripInline(mdLinks(it ? it.text : l, url)).trim(); }).filter(Boolean);
          v = parts.join(filled.every(l => listItem(l)) ? ', ' : ' ');
        }
        v = v.trim();
        if (!v || PLACEHOLDER.test(v)) continue;
        if (sec.key === 'notes') p.extra.unshift(v);
        else if (p.fields[sec.key]) p.fields[sec.key] += (def.long ? '\n' : ' ') + v;
        else p.fields[sec.key] = v;
      } else {
        const v = body.map(l => stripInline(mdLinks(l, false))).join('\n').trim();
        if (v) p.extra.push(sec.label ? `${sec.label}:\n${v}` : v);
      }
    }
    if (p.extra.length) p.fields.notes = p.extra.join('\n\n');
    delete p.extra;
    return p;
  }

  // Written the way the user's own notes look, with two trailing spaces where Notes keeps line breaks,
  // so the file imports into Notes as a familiar note and reads back into the app unchanged.
  function projectToMarkdown(p) {
    const f = p.fields || {};
    const out = [];
    const br = l => `${l}  `;
    // Asterisks in the user's own text are escaped, so Notes doesn't read them as bold or italics.
    const block = (label, value) => {
      const v = String(value || '').trim().replace(/\*/g, '\\*');
      const lines = v ? v.split('\n') : [];
      const single = !PROJECT_FIELDS.find(x => x.label === label && x.long) && lines.length <= 1;
      if (single) out.push(br(`**${label}:** ${v || '-'}`));
      else { out.push(br(`**${label}:**`)); for (const l of (lines.length ? lines : ['-'])) out.push(listItem(l) ? l : br(l)); out.push(''); }
    };
    out.push(br(`**#${p.num} ${p.name.trim() || 'Untitled project'}**`), br('—'), '');
    for (const fd of PROJECT_FIELDS) {
      if (fd.key === 'apps') break;
      const v = fd.key === 'deadline' ? (isDate(f.deadline) ? fmtSlash(f.deadline) : '?') : f[fd.key];
      if (fd.long && out[out.length - 1] !== '') out.push('');
      block(fd.label, v);
    }
    const sched = (p.schedule || []).filter(x => x.text.trim());
    if (sched.length) {
      out.push('', br('—'), '');
      for (const x of sched) out.push(`- [${x.done ? 'x' : ' '}] **${x.text.trim().replace(/\*/g, '\\*')}** - ${isDate(x.date) ? fmtSlash(x.date) : 'xxx'}`);
      out.push('', br('—'), '');
    }
    const todos = (p.todos || []).filter(t => t.text.trim());
    out.push(br("**Project TODO's:**"));
    for (const t of todos.length ? todos : [{ text: '', level: 0, done: false }]) out.push(`${t.level ? '    ' : ''}- [${t.done ? 'x' : ' '}] ${t.text.trim().replace(/\*/g, '\\*')}`);
    out.push('');
    for (const key of ['apps', 'sitemap', 'notes']) { out.push(''); block(PROJECT_FIELDS.find(x => x.key === key).label, f[key]); }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  const fileNameFor = (p, suffix) => `${p.num ? `${p.num} ` : ''}${(p.name.trim() || 'Untitled project')}${suffix || ''}`.replace(/[/\\:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) + '.md';

  /* ---------- asking an AI assistant ---------- */
  // Claude Desktop, Claude or ChatGPT on the web open with the prompt typed in; anything else gets it copied.
  const ASSISTANTS = {
    'claude-desktop': { label: 'Claude', url: q => `claude://claude.ai/new?q=${encodeURIComponent(q)}`, max: 13000 },
    'claude-web': { label: 'Claude', url: q => `https://claude.ai/new?q=${encodeURIComponent(q)}`, max: 7000, plain: 'https://claude.ai/new' },
    chatgpt: { label: 'ChatGPT', url: q => `https://chatgpt.com/?q=${encodeURIComponent(q)}`, max: 7000, plain: 'https://chatgpt.com/' },
    gemini: { label: 'Gemini', url: null, plain: 'https://gemini.google.com/app' },
    copy: { label: 'your assistant', url: null }
  };
  function assistantLink(kind, prompt) {
    const a = ASSISTANTS[kind] || ASSISTANTS['claude-desktop'];
    const url = a.url ? a.url(prompt) : '';
    if (url && url.length <= a.max) return { url, copy: false };
    return { url: a.plain || '', copy: true };
  }
  function reviewPrompt(lang, subject, body, isTemplate) {
    const L = langName(lang);
    return [
      `Please review this ${isTemplate ? 'email template' : 'email'}, written in ${L}, before I send it to a client.`,
      `- Correct spelling, grammar and punctuation, and make it read naturally to a native ${L} speaker${lang === 'fr' ? ', including French spacing before : ; ? and !' : ''}.`,
      '- Keep a professional, friendly tone. Keep the meaning, names, dates, links and anything in {{double braces}} exactly as they are. Links are written [text](address): keep that form.',
      `- Reply with the corrected subject and ${isTemplate ? 'template' : 'email'} first, ready to copy, then a short list of what you changed and why.`,
      '', `Subject: ${subject}`, '', body
    ].join('\n');
  }

  /* ---------- website copy ---------- */
  const COPY_KINDS = [
    { key: 'headline', label: 'Headline', hint: 'About 70 characters at most' },
    { key: 'subheadline', label: 'Subheadline', hint: 'One or two sentences' },
    { key: 'body', label: 'Body text' },
    { key: 'cta', label: 'Call to action', hint: 'A few words' },
    { key: 'list', label: 'List' },
    { key: 'seo_title', label: 'SEO title', limit: 60 },
    { key: 'meta', label: 'Meta description', limit: 155 },
    { key: 'other', label: 'Other' }
  ];
  const kindOf = k => COPY_KINDS.find(x => x.key === k) || COPY_KINDS[COPY_KINDS.length - 1];
  const DEFAULT_BLOCKS = ['headline', 'subheadline', 'body', 'cta', 'seo_title', 'meta'];
  const BRIEF_FIELDS = [
    { key: 'audience', label: 'Audience', hint: 'Who the site is for' },
    { key: 'voice', label: 'Tone of voice', hint: 'For example warm, expert, plain-spoken' },
    { key: 'messages', label: 'Key messages', hint: 'What every visitor should take away' },
    { key: 'keywords', label: 'SEO keywords', hint: 'Comma-separated' },
    { key: 'ctas', label: 'Calls to action', hint: 'For example Book a demo, Request a quote' }
  ];
  const newBlock = (kind, newId) => ({ id: newId(), kind, label: kindOf(kind).label, text: {} });
  const newPage = (name, newId) => ({ id: newId(), name, blocks: DEFAULT_BLOCKS.map(k => newBlock(k, newId)) });
  // Sitemap lines ("- Home", "  - About us") become page names; markers and numbering are dropped.
  const sitemapPages = s => String(s || '').split('\n')
    .map(l => stripInline(mdLinks(l, false)).replace(/^\s*(?:[-*+•◦▪>]|\d{1,3}[.)])?\s*/, '').replace(/\s*[(:].*$/, '').trim())
    .filter((l, k, a) => l && l.length <= 60 && a.findIndex(x => x.toLowerCase() === l.toLowerCase()) === k);

  function briefLines(project) {
    const c = project.copy || {}, b = c.brief || {}, f = project.fields || {};
    const out = [`Project: ${project.name.trim()}`];
    if ((f.goal || '').trim()) out.push(`Goal: ${f.goal.trim()}`);
    for (const x of BRIEF_FIELDS) if ((b[x.key] || '').trim()) out.push(`${x.label}: ${b[x.key].trim()}`);
    if ((f.sitemap || '').trim()) out.push('', 'Site map:', f.sitemap.trim());
    return out;
  }
  const blockSpec = b => { const k = kindOf(b.kind); return `[${b.label.trim() || k.label}]${k.limit ? ` (${k.limit} characters at most)` : k.hint ? ` (${k.hint.toLowerCase()})` : ''}`; };
  function pagePrompt(project, page, lang, from) {
    const L = langName(lang);
    const has = page.blocks.some(b => (b.text[lang] || '').trim());
    const src = from && page.blocks.some(b => (b.text[from] || '').trim());
    const intro = src
      ? `Translate and adapt the copy of one page of a website from ${langName(from)} into ${L}. Write it the way a native ${L} copywriter would, not word for word, and keep the SEO limits.`
      : has
        ? `Improve the copy of one page of a website, in ${L}. Keep what works, tighten the rest, and stay within the limits.`
        : `Write the copy for one page of a website, in ${L}, for a web design project.`;
    const out = [intro, '', ...briefLines(project), '', `Page: ${page.name.trim() || 'Untitled page'}`, '',
      'Write these parts. Put each label on its own line in square brackets, exactly as written, with its text below it:'];
    for (const b of page.blocks) out.push(blockSpec(b));
    const draftLang = src ? from : has ? lang : null;
    if (draftLang) {
      out.push('', `${src ? 'The current copy' : 'The current draft'}, in ${langName(draftLang)}:`);
      for (const b of page.blocks) { const t = (b.text[draftLang] || '').trim(); if (t) out.push(`[${b.label.trim() || kindOf(b.kind).label}]`, t); }
    }
    out.push('', 'Reply with only the labelled parts, nothing before or after them.');
    return out.join('\n');
  }
  // Reads "[Label]" sections from an assistant's answer. Bold, headings and "Label:" forms are accepted too.
  function parseCopyAnswer(text) {
    const out = [];
    let cur = null;
    for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
      const l = raw.replace(/^\s*#{1,6}\s*/, '').replace(/^\s*\*\*(.*?)\*\*\s*$/, '$1');
      const m = /^\s*\[([^\]]{1,60})\]\s*(?:\(.*\))?\s*:?\s*(.*)$/.exec(l);
      if (m) { cur = { label: m[1].trim(), lines: m[2] ? [m[2]] : [] }; out.push(cur); continue; }
      if (cur) cur.lines.push(raw);
    }
    return out.map(x => ({ label: x.label, text: x.lines.join('\n').trim().replace(/^["“](.*)["”]$/s, '$1') })).filter(x => x.text);
  }
  function applyCopyAnswer(page, lang, answer, newId) {
    let filled = 0, added = 0;
    for (const part of parseCopyAnswer(answer)) {
      const key = fold(part.label);
      let b = page.blocks.find(x => fold(x.label) === key) || page.blocks.find(x => fold(kindOf(x.kind).label) === key);
      if (!b) {
        const kind = (COPY_KINDS.find(k => fold(k.label) === key) || { key: 'other' }).key;
        b = { ...newBlock(kind, newId), label: part.label };
        page.blocks.push(b);
        added++;
      }
      b.text[lang] = part.text;
      filled++;
    }
    return { filled, added };
  }
  function copyDeckMarkdown(project, langs) {
    const c = project.copy || { pages: [] };
    const out = [`# Website copy: #${project.num} ${project.name.trim()}`, ''];
    const b = c.brief || {};
    const brief = BRIEF_FIELDS.filter(x => (b[x.key] || '').trim());
    if (brief.length) { out.push('## Brief'); for (const x of brief) out.push(`**${x.label}:** ${b[x.key].trim()}`); out.push(''); }
    for (const page of c.pages || []) {
      out.push(`## ${page.name.trim() || 'Untitled page'}`, '');
      for (const blk of page.blocks) {
        const label = blk.label.trim() || kindOf(blk.kind).label;
        if (langs.length === 1) { out.push(`### ${label}`, (blk.text[langs[0]] || '').trim() || '_To write_', ''); continue; }
        out.push(`### ${label}`);
        for (const l of langs) out.push(`**${l.toUpperCase()}:** ${(blk.text[l] || '').trim() || '_To write_'}`);
        out.push('');
      }
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  function pageAsText(page, lang) {
    return page.blocks.filter(b => (b.text[lang] || '').trim()).map(b => `${b.label.trim() || kindOf(b.kind).label}\n${b.text[lang].trim()}`).join('\n\n') + '\n';
  }

  /* ---------- links in emails ----------
     Templates stay plain text. A link is written [text](address), where the address can be a web address,
     an email address or a {{placeholder}}. Copying makes real links; plain text gets "text (address)". */
  const LINK_RE = /\[([^\]\n]{1,300})\]\(\s*([^()\s]{1,2000}?)\s*\)/g;
  const BARE_URL_RE = /\bhttps?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]'’”]/gi;
  function linkHref(u) {
    u = String(u || '').trim();
    if (/^(https?:\/\/|mailto:)\S+$/i.test(u)) return u;
    if (/^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i.test(u)) return `mailto:${u}`;
    return linkOf(u);
  }
  // Splits text into plain parts and links, for previews and copies.
  function linkParts(s) {
    s = String(s || '');
    const out = [];
    let last = 0;
    s.replace(LINK_RE, (m, text, url, off) => {
      if (off > last) out.push({ text: s.slice(last, off) });
      out.push({ link: true, label: text, url, raw: m });
      last = off + m.length;
      return m;
    });
    if (last < s.length) out.push({ text: s.slice(last) });
    return out;
  }
  // The email as plain text: links become "text (address)", or the address alone when it is the text.
  function plainMail(s) {
    return linkParts(s).map(x => {
      if (!x.link) return x.text;
      const href = linkHref(x.url);
      if (!href) return x.raw;
      const shown = href.replace(/^mailto:/i, '');
      return x.label.trim() === x.url.trim() || x.label.trim() === shown ? shown : `${x.label} (${shown})`;
    }).join('');
  }
  const escHtml = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // The email as HTML for pasting into a mail app: links work, line breaks stay, no styles of its own.
  function htmlMail(s) {
    const text = t => escHtml(t).replace(BARE_URL_RE, u => `<a href="${u}">${u}</a>`);
    const body = linkParts(s).map(x => {
      if (!x.link) return text(x.text);
      const href = linkHref(x.url);
      return href ? `<a href="${escHtml(href)}">${escHtml(x.label)}</a>` : text(x.raw);
    }).join('');
    return `<div>${body.replace(/\r?\n/g, '<br>\n')}</div>`;
  }
  // The link around a caret position, for editing it: { start, end, label, url } or null.
  function linkAt(s, pos) {
    let hit = null;
    String(s || '').replace(LINK_RE, (m, label, url, off) => {
      if (!hit && pos >= off && pos <= off + m.length) hit = { start: off, end: off + m.length, label, url };
      return m;
    });
    return hit;
  }
  const linkMarkup = (label, url) => `[${String(label).replace(/[[\]\n]/g, ' ').trim() || url}](${String(url).trim()})`;

  /* ---------- ordering ---------- */
  // Moves the item with id before or after the item with toId. Returns false when nothing moved.
  function moveById(list, id, toId, after) {
    const from = list.findIndex(x => x.id === id);
    if (from < 0 || id === toId) return false;
    const [item] = list.splice(from, 1);
    let at = list.findIndex(x => x.id === toId);
    if (at < 0) { list.splice(from, 0, item); return false; }
    if (after) at++;
    list.splice(at, 0, item);
    return at !== from;
  }
  // Projects: open ones first, in the user's order, then archived ones. The number is the position.
  function renumberProjects(projects) {
    const open = projects.filter(p => !p.archived), arch = projects.filter(p => p.archived);
    projects.splice(0, projects.length, ...open, ...arch);
    projects.forEach((p, i) => { p.num = i + 1; });
    return projects;
  }
  // Moves a project to a 1-based position among the open projects.
  function moveProjectTo(projects, id, pos) {
    renumberProjects(projects);
    const open = projects.filter(p => !p.archived);
    const p = open.find(x => x.id === id);
    if (!p) return false;
    pos = Math.max(1, Math.min(open.length, Math.round(pos) || 1));
    const rest = open.filter(x => x !== p);
    rest.splice(pos - 1, 0, p);
    projects.splice(0, open.length, ...rest);
    renumberProjects(projects);
    return true;
  }
  // Templates: the array order is the order within each category; cat is a category id or ''.
  // Dropping on a template puts it next to that one, in its category; dropping on a category puts it first there.
  function moveTemplate(templates, id, target, after) {
    const t = templates.find(x => x.id === id);
    if (!t) return false;
    if (target.tpl) {
      const to = templates.find(x => x.id === target.tpl);
      if (!to || to === t) return false;
      t.cat = to.cat || '';
      return moveById(templates, id, to.id, after) || true;
    }
    const cat = target.cat || '';
    t.cat = cat;
    templates.splice(templates.indexOf(t), 1);
    const first = templates.findIndex(x => (x.cat || '') === cat);
    templates.splice(first < 0 ? templates.length : first, 0, t);
    return true;
  }

  /* ---------- calendars (iCalendar files and secret addresses) ---------- */
  const WINDOWS_ZONES = {
    'romance standard time': 'Europe/Paris', 'w. europe standard time': 'Europe/Berlin', 'central europe standard time': 'Europe/Budapest',
    'central european standard time': 'Europe/Warsaw', 'gmt standard time': 'Europe/London', 'greenwich standard time': 'Atlantic/Reykjavik',
    'e. europe standard time': 'Europe/Chisinau', 'fle standard time': 'Europe/Kiev', 'gtb standard time': 'Europe/Bucharest',
    'russian standard time': 'Europe/Moscow', 'utc': 'UTC', 'coordinated universal time': 'UTC',
    'eastern standard time': 'America/New_York', 'central standard time': 'America/Chicago', 'mountain standard time': 'America/Denver',
    'pacific standard time': 'America/Los_Angeles', 'sa pacific standard time': 'America/Bogota', 'argentina standard time': 'America/Buenos_Aires',
    'e. south america standard time': 'America/Sao_Paulo', 'central standard time (mexico)': 'America/Mexico_City',
    'pacific sa standard time': 'America/Santiago', 'canary standard time': 'Atlantic/Canary', 'morocco standard time': 'Africa/Casablanca',
    'india standard time': 'Asia/Kolkata', 'china standard time': 'Asia/Shanghai', 'tokyo standard time': 'Asia/Tokyo',
    'singapore standard time': 'Asia/Singapore', 'arabian standard time': 'Asia/Dubai', 'aus eastern standard time': 'Australia/Sydney'
  };
  const zoneOk = new Map();
  function ianaZone(name) {
    if (!name) return null;
    if (zoneOk.has(name)) return zoneOk.get(name);
    let ok = null;
    try { new Intl.DateTimeFormat('en-US', { timeZone: name }); ok = name; } catch {}
    zoneOk.set(name, ok);
    return ok;
  }
  const zoneFmt = new Map();
  // Minutes east of UTC for a zone at an instant.
  function zoneOffset(ms, zone) {
    let f = zoneFmt.get(zone);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
      zoneFmt.set(zone, f);
    }
    const v = {};
    for (const p of f.formatToParts(new Date(ms))) v[p.type] = Number(p.value);
    return Math.round((Date.UTC(v.year, v.month - 1, v.day, v.hour % 24, v.minute, v.second) - Math.floor(ms / 1000) * 1000) / 60000);
  }
  const wallUtc = w => Date.UTC(w.y, w.mo - 1, w.d, w.h || 0, w.mi || 0, w.s || 0);
  // A clock time in a zone, as an instant.
  function zonedMs(w, zone) {
    const guess = wallUtc(w);
    let ms = guess - zoneOffset(guess, zone) * 60000;
    const again = guess - zoneOffset(ms, zone) * 60000;
    if (again !== ms) ms = again;
    return ms;
  }
  const nthWeekday = (y, mo, n, wd) => {
    if (n > 0) { const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay(); return 1 + ((wd - first + 7) % 7) + (n - 1) * 7; }
    const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const lastWd = new Date(Date.UTC(y, mo - 1, days)).getUTCDay();
    return days - ((lastWd - wd + 7) % 7) + (n + 1) * 7;
  };
  const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  // Offset (minutes east) from a VTIMEZONE's STANDARD and DAYLIGHT rules, for zones Intl doesn't know.
  function vtzOffset(rules, w) {
    const at = wallUtc(w);
    let best = null;
    for (const r of rules) {
      const cands = [];
      if (r.month && r.byday) {
        for (const y of [w.y - 1, w.y]) cands.push(Date.UTC(y, r.month - 1, nthWeekday(y, r.month, r.byday.n || 1, r.byday.wd), r.start.h, r.start.mi));
      } else cands.push(wallUtc(r.start));
      for (const c of cands) if (c <= at && (!best || c > best.at)) best = { at: c, to: r.to };
    }
    if (best) return best.to;
    return rules.length ? rules[0].to : 0;
  }
  function zoneOf(tzid, vtz) {
    if (tzid === 'Z') return { kind: 'utc' };
    if (!tzid) return { kind: 'local' };
    const clean = tzid.replace(/^"|"$/g, '').replace(/^\/[^/]+\/[^/]+\//, '').trim();
    const iana = ianaZone(clean) || ianaZone(WINDOWS_ZONES[clean.toLowerCase()]);
    if (iana) return { kind: 'iana', zone: iana };
    if (vtz && vtz[tzid] && vtz[tzid].length) return { kind: 'vtz', rules: vtz[tzid] };
    return { kind: 'local' };
  }
  function wallMs(w, z) {
    if (z.kind === 'utc') return wallUtc(w);
    if (z.kind === 'iana') return zonedMs(w, z.zone);
    if (z.kind === 'vtz') return wallUtc(w) - vtzOffset(z.rules, w) * 60000;
    return new Date(w.y, w.mo - 1, w.d, w.h || 0, w.mi || 0, w.s || 0).getTime();
  }

  const unfoldIcs = t => String(t || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');
  const unescIcs = v => String(v || '').replace(/\\([nN\\;,])/g, (m, c) => (c === 'n' || c === 'N' ? '\n' : c));
  function icsLine(line) {
    let i = 0, q = false;
    for (; i < line.length; i++) { const c = line[i]; if (c === '"') q = !q; else if (c === ':' && !q) break; }
    const head = line.slice(0, i), value = line.slice(i + 1);
    const parts = head.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    const params = {};
    for (const p of parts.slice(1)) { const k = p.indexOf('='); if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, ''); }
    return { name: parts[0].toUpperCase(), params, value };
  }
  // "20261104T100000Z", "20261104T100000" or "20261104" -> { y, mo, d, h, mi, s, utc, date }.
  function icsWall(v) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(v || '').trim());
    if (!m) return null;
    return { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0), utc: !!m[7], date: !m[4] };
  }
  function icsDuration(v) {
    const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v || '').trim());
    if (!m) return null;
    const min = (+(m[2] || 0)) * 10080 + (+(m[3] || 0)) * 1440 + (+(m[4] || 0)) * 60 + (+(m[5] || 0)) + Math.round((+(m[6] || 0)) / 60);
    return m[1] === '-' ? -min : min;
  }
  function parseRrule(v) {
    const r = {};
    for (const part of String(v || '').split(';')) {
      const [k, x] = part.split('=');
      if (!k || x === undefined) continue;
      r[k.toUpperCase()] = x;
    }
    if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.FREQ)) return null;
    const list = x => (x ? x.split(',').map(s => s.trim()).filter(Boolean) : []);
    return {
      freq: r.FREQ, interval: Math.max(1, parseInt(r.INTERVAL, 10) || 1),
      count: r.COUNT ? parseInt(r.COUNT, 10) : 0, until: r.UNTIL || '',
      byday: list(r.BYDAY).map(d => { const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(d); return m ? { n: m[1] ? +m[1] : 0, wd: WD[m[2].toUpperCase()] } : null; }).filter(Boolean),
      bymonthday: list(r.BYMONTHDAY).map(Number).filter(n => n && Math.abs(n) <= 31),
      bymonth: list(r.BYMONTH).map(Number).filter(n => n >= 1 && n <= 12),
      bysetpos: list(r.BYSETPOS).map(Number).filter(Boolean)
    };
  }
  const pad4 = n => String(n).padStart(4, '0');
  const wallKey = w => `${pad4(w.y)}${pad(w.mo)}${pad(w.d)}${w.date ? '' : `T${pad(w.h)}${pad(w.mi)}${pad(w.s)}`}`;
  const keyWall = k => icsWall(k);
  const ymdOf = w => `${pad4(w.y)}-${pad(w.mo)}-${pad(w.d)}`;

  // Reads an iCalendar file into a calendar: its name, its time zones and its events, ready to store.
  // Events that ended before `since` (a Date) are dropped, so years of history don't weigh on the data file.
  function parseIcs(text, since) {
    const lines = unfoldIcs(text).split('\n');
    const vtz = {};
    const events = [];
    let name = '', ev = null, tz = null, comp = null, depth = [];
    const sinceMs = since ? since.getTime() : -Infinity;
    for (const raw of lines) {
      if (!raw.trim()) continue;
      const { name: n, params, value } = icsLine(raw);
      if (n === 'BEGIN') {
        const what = value.trim().toUpperCase();
        depth.push(what);
        if (what === 'VEVENT') ev = { p: {}, ex: [] };
        else if (what === 'VTIMEZONE') tz = { id: '', rules: [] };
        else if (tz && (what === 'STANDARD' || what === 'DAYLIGHT')) comp = {};
        continue;
      }
      if (n === 'END') {
        const what = value.trim().toUpperCase();
        depth.pop();
        if (what === 'VEVENT' && ev) { events.push(ev); ev = null; }
        else if (what === 'VTIMEZONE' && tz) { if (tz.id) vtz[tz.id] = tz.rules; tz = null; }
        else if ((what === 'STANDARD' || what === 'DAYLIGHT') && tz && comp) {
          const to = /^([+-])(\d{2})(\d{2})/.exec(comp.to || '');
          const start = icsWall(comp.start) || { y: 1970, mo: 1, d: 1, h: 0, mi: 0, s: 0 };
          const rr = parseRrule(comp.rrule || '');
          if (to) tz.rules.push({
            to: (to[1] === '-' ? -1 : 1) * (+to[2] * 60 + +to[3]), start,
            month: rr && rr.bymonth[0], byday: rr && rr.byday[0]
          });
          comp = null;
        }
        continue;
      }
      if (ev && depth[depth.length - 1] === 'VEVENT') {
        if (n === 'EXDATE') { for (const v of value.split(',')) ev.ex.push({ v, tz: params.TZID || '' }); continue; }
        if (!ev.p[n]) ev.p[n] = { value, params };
      } else if (comp) {
        if (n === 'TZOFFSETTO') comp.to = value.trim();
        else if (n === 'DTSTART') comp.start = value.trim();
        else if (n === 'RRULE') comp.rrule = value.trim();
      } else if (tz && n === 'TZID') tz.id = value.trim();
      else if (!depth.includes('VEVENT') && n === 'X-WR-CALNAME') name = unescIcs(value).trim();
    }
    const out = [];
    for (const e of events) {
      const P = e.p;
      if (!P.DTSTART) continue;
      const sw = icsWall(P.DTSTART.value);
      if (!sw) continue;
      const allDay = sw.date || (P.DTSTART.params.VALUE || '').toUpperCase() === 'DATE';
      const z = allDay ? '' : sw.utc ? 'Z' : (P.DTSTART.params.TZID || '');
      const zone = zoneOf(z, vtz);
      let dur = null;
      if (P.DTEND) {
        const ew = icsWall(P.DTEND.value);
        if (ew) {
          if (allDay) dur = Math.round((wallUtc({ ...ew, h: 0, mi: 0, s: 0 }) - wallUtc({ ...sw, h: 0, mi: 0, s: 0 })) / 60000);
          else dur = Math.round((wallMs(ew, zoneOf(ew.utc ? 'Z' : (P.DTEND.params.TZID || z), vtz)) - wallMs(sw, zone)) / 60000);
        }
      } else if (P.DURATION) dur = icsDuration(P.DURATION.value);
      if (dur === null || dur < 0) dur = allDay ? 1440 : 0;
      const rr = P.RRULE ? P.RRULE.value.trim() : '';
      const rule = rr ? parseRrule(rr) : null;
      const instantOf = (v, tzid) => {
        const w = icsWall(v);
        if (!w) return null;
        if (allDay || w.date) return ymdOf(w);
        return wallMs(w, zoneOf(w.utc ? 'Z' : (tzid || z), vtz));
      };
      // Skip what ended long ago: single events before `since`, and series whose UNTIL is before it.
      if (!rule) {
        const startMs = allDay ? wallUtc(sw) : wallMs(sw, zone);
        if (startMs + dur * 60000 < sinceMs && !P['RECURRENCE-ID']) continue;
      } else if (rule.until) {
        const u = icsWall(rule.until);
        if (u && (u.utc ? wallUtc(u) : wallMs(u, zone)) < sinceMs) continue;
      }
      const d = {
        u: P.UID ? P.UID.value.trim() : `${wallKey(sw)}-${out.length}`,
        t: unescIcs(P.SUMMARY ? P.SUMMARY.value : '').trim(),
        s: wallKey(sw), z, dur
      };
      const loc = unescIcs(P.LOCATION ? P.LOCATION.value : '').trim();
      if (loc) d.l = loc.slice(0, 300);
      if (rule) d.r = rr;
      if (P['RECURRENCE-ID']) d.rid = instantOf(P['RECURRENCE-ID'].value, P['RECURRENCE-ID'].params.TZID);
      if (e.ex.length) d.x = e.ex.map(x => instantOf(x.v.trim(), x.tz)).filter(x => x !== null);
      if (P.STATUS && P.STATUS.value.trim().toUpperCase() === 'CANCELLED') d.c = 1;
      if (P.TRANSP && P.TRANSP.value.trim().toUpperCase() === 'TRANSPARENT') d.f = 1;
      out.push(d);
    }
    return { name, tz: vtz, events: out };
  }

  const dayNum = w => Math.floor(Date.UTC(w.y, w.mo - 1, w.d) / 864e5);
  const fromDayNum = n => { const d = new Date(n * 864e5); return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate() }; };
  const monthDays = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
  // The days of one period of a rule (a day, a week, a month, a year), sorted, as day numbers.
  function periodDays(rule, start, k) {
    const sd = dayNum(start);
    if (rule.freq === 'DAILY') return [sd + k * rule.interval];
    if (rule.freq === 'WEEKLY') {
      const monday = sd - ((new Date(sd * 864e5).getUTCDay() + 6) % 7) + k * 7 * rule.interval;
      const wds = rule.byday.length ? rule.byday.map(b => b.wd) : [new Date(sd * 864e5).getUTCDay()];
      return [...new Set(wds)].map(wd => monday + ((wd + 6) % 7)).sort((a, b) => a - b);
    }
    const monthList = (y, mo) => {
      const n = monthDays(y, mo);
      let days = [];
      if (rule.byday.length) {
        for (const b of rule.byday) {
          if (b.n) { const d = nthWeekday(y, mo, b.n, b.wd); if (d >= 1 && d <= n) days.push(d); }
          else for (let d = 1; d <= n; d++) if (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() === b.wd) days.push(d);
        }
        if (rule.bymonthday.length) days = days.filter(d => rule.bymonthday.some(x => (x > 0 ? x : n + 1 + x) === d));
      } else if (rule.bymonthday.length) days = rule.bymonthday.map(x => (x > 0 ? x : n + 1 + x)).filter(d => d >= 1 && d <= n);
      else if (start.d <= n) days = [start.d];
      days = [...new Set(days)].sort((a, b) => a - b);
      if (rule.bysetpos.length) days = rule.bysetpos.map(p => days[p > 0 ? p - 1 : days.length + p]).filter(Boolean);
      return days.map(d => dayNum({ y, mo, d }));
    };
    if (rule.freq === 'MONTHLY') {
      const idx = start.y * 12 + (start.mo - 1) + k * rule.interval;
      return monthList(Math.floor(idx / 12), (idx % 12) + 1);
    }
    const y = start.y + k * rule.interval;
    const months = rule.bymonth.length ? rule.bymonth : [start.mo];
    let out = [];
    for (const mo of months) {
      if (!rule.byday.length && !rule.bymonthday.length) { if (start.d <= monthDays(y, mo)) out.push(dayNum({ y, mo, d: start.d })); }
      else out = out.concat(monthList(y, mo));
    }
    return out.sort((a, b) => a - b);
  }

  // Occurrences of a stored calendar overlapping [from, to), two local dates as YYYY-MM-DD (to exclusive).
  function expandCalendar(cal, from, to) {
    const fromMs = parseYmd(from).getTime(), toMs = parseYmd(to).getTime();
    const fromDay = dayNum(icsWall(from.replace(/-/g, ''))), toDay = dayNum(icsWall(to.replace(/-/g, '')));
    const vtz = cal.tz || {};
    const overrides = new Map();
    for (const e of cal.events || []) if (e.rid !== undefined) {
      if (!overrides.has(e.u)) overrides.set(e.u, new Set());
      overrides.get(e.u).add(e.rid);
    }
    const out = [];
    const push = (e, w, zone) => {
      if (e.c) return;
      const allDay = !!w.date || e.s.length === 8;
      if (allDay) {
        const s = dayNum(w), n = Math.max(1, Math.round(e.dur / 1440));
        if (s >= toDay || s + n <= fromDay) return;
        out.push({ id: `${cal.id}:${e.u}:${wallKey(w)}`, cal: cal.id, title: e.t, loc: e.l || '', allDay: true, sd: ymdOf(w), ed: ymdOf({ ...fromDayNum(s + n), date: true }), busy: false });
        return;
      }
      const start = wallMs(w, zone), end = start + e.dur * 60000;
      if (start >= toMs || (end <= fromMs && !(e.dur === 0 && start >= fromMs))) return;
      out.push({ id: `${cal.id}:${e.u}:${start}`, cal: cal.id, title: e.t, loc: e.l || '', allDay: false, start, end, busy: !e.f });
    };
    for (const e of cal.events || []) {
      const sw = keyWall(e.s);
      if (!sw) continue;
      const allDay = e.s.length === 8;
      const zone = allDay ? { kind: 'local' } : zoneOf(e.z, vtz);
      const rule = e.r ? parseRrule(e.r) : null;
      if (!rule || e.rid !== undefined) { push(e, sw, zone); continue; }
      const skip = new Set((e.x || []).map(String));
      const moved = overrides.get(e.u) || new Set();
      for (const x of moved) skip.add(String(x));
      const untilW = rule.until ? icsWall(rule.until) : null;
      const untilMs = untilW ? (untilW.date ? wallUtc(untilW) + 864e5 - 1 : untilW.utc ? wallUtc(untilW) : wallMs(untilW, zone)) : Infinity;
      const startDay = dayNum(sw);
      const spanDays = Math.ceil(e.dur / 1440) + 1;
      // Without a COUNT, jump close to the window instead of walking from the first occurrence.
      let k = 0;
      if (!rule.count) {
        const per = rule.freq === 'DAILY' ? rule.interval : rule.freq === 'WEEKLY' ? 7 * rule.interval : rule.freq === 'MONTHLY' ? 31 * rule.interval : 366 * rule.interval;
        k = Math.max(0, Math.floor((fromDay - spanDays - startDay) / per) - 2);
      }
      let n = 0, guard = 0;
      outer:
      for (; guard < 5000; k++, guard++) {
        const days = periodDays(rule, sw, k);
        if (!days.length) { if (rule.freq === 'DAILY' || rule.freq === 'WEEKLY') break; continue; }
        if (days[0] > toDay + 1 && !rule.count) break;
        for (const dn of days) {
          if (dn < startDay) continue;
          const dd = fromDayNum(dn);
          const w = { ...sw, y: dd.y, mo: dd.mo, d: dd.d };
          const key = allDay ? ymdOf(w) : wallMs(w, zone);
          if (key > untilMs && !allDay) break outer;
          if (allDay && wallUtc(w) > untilMs) break outer;
          n++;
          if (rule.count && n > rule.count) break outer;
          if (dn > toDay + 1) { if (rule.count) break outer; continue; }
          if (dn < fromDay - spanDays) continue;
          if (skip.has(String(key))) continue;
          push(e, w, zone);
        }
      }
    }
    return out.sort((a, b) => (a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : a.allDay ? a.title.localeCompare(b.title) : a.start - b.start || a.end - b.end));
  }

  // The occurrences on one local date: all-day ones covering it and timed ones overlapping it.
  function eventsOn(occs, date) {
    const a = parseYmd(date).getTime(), b = parseYmd(addDays(date, 1)).getTime();
    return occs.filter(o => (o.allDay ? o.sd <= date && date < o.ed : o.start < b && (o.end > a || (o.start >= a && o.end === o.start))));
  }
  // Busy minutes on a date between two clock times (minutes after midnight), overlaps counted once.
  function busyMinutes(occs, date, fromMin, toMin) {
    const day = parseYmd(date).getTime();
    const spans = occs.filter(o => !o.allDay && o.busy)
      .map(o => [Math.max(fromMin, (o.start - day) / 60000), Math.min(toMin, (o.end - day) / 60000)])
      .filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0]);
    let total = 0, cur = null;
    for (const s of spans) {
      if (!cur || s[0] > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = s.slice(); }
      else cur[1] = Math.max(cur[1], s[1]);
    }
    if (cur) total += cur[1] - cur[0];
    return Math.round(total);
  }
  const hm = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  // "10:00–11:00", or "until 11:00" / "from 22:00" for events that cross midnight.
  function eventTime(o, date) {
    if (o.allDay) return 'All day';
    const a = parseYmd(date).getTime(), b = parseYmd(addDays(date, 1)).getTime();
    if (o.start < a && o.end > b) return 'All day';
    if (o.start < a) return `Until ${hm(o.end)}`;
    if (o.end > b) return `From ${hm(o.start)}`;
    return o.end > o.start ? `${hm(o.start)}–${hm(o.end)}` : hm(o.start);
  }
  // A meeting link in the location or title (Google Meet, Teams, Zoom or any web address).
  function eventLink(o) {
    const m = /https?:\/\/[^\s<>"]+/i.exec(`${o.loc || ''} ${o.title || ''}`);
    return m ? m[0].replace(/[.,;)]+$/, '') : '';
  }

  /* ---------- your own meetings, typed like tasks ---------- */
  // A clock time: 10:00, 9.30, 10h30, 2pm, 2:30pm. Returns minutes after midnight, or null.
  const CLOCK = '(\\d{1,2})(?:[:.h](\\d{2}))?\\s?(am|pm|a\\.m\\.|p\\.m\\.)?';
  function clockMin(h, m, ap) {
    h = Number(h); m = Number(m || 0);
    if (ap) { const pm = /^p/i.test(ap); if (h < 1 || h > 12) return null; h = (h % 12) + (pm ? 12 : 0); }
    return h <= 23 && m <= 59 ? h * 60 + m : null;
  }
  const hhmm = min => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
  // "10:00 Partena kick-off", "10:00–11:30 Steering", "14:30 1h Call Mayra" -> { start, end, title } in minutes.
  // A time needs minutes or am/pm, so "2 meetings" or "15m FU" isn't read as a time. No length means 30 minutes.
  function parseMeeting(text, fallbackLen) {
    const s = String(text || '');
    const re = new RegExp(`^\\s*${CLOCK}(?:\\s*(?:[-–—]|to|a|à)\\s*${CLOCK})?(?=\\s|$)`, 'i');
    const m = re.exec(s);
    if (!m || (!m[2] && !m[3])) return null;
    const start = clockMin(m[1], m[2], m[3]);
    if (start === null) return null;
    let end = null;
    if (m[4] !== undefined) {
      end = clockMin(m[4], m[5], m[6] || m[3] || null);
      if (end === null) return null;
      // "11:00-1" means one in the afternoon.
      if (end <= start && !m[6] && !m[3] && end < 720 && end + 720 > start) end += 720;
      if (end <= start) return null;
    }
    let rest = s.slice(m[0].length);
    if (end === null) {
      const d = new RegExp(`^\\s*${DUR_SRC.replace('(^|[^\\\\p{L}\\\\p{N}])', '()')}`, 'iu').exec(rest);
      const len = d ? duration(d[0]) : 0;
      if (len) rest = rest.slice(d[0].length);
      end = Math.min(24 * 60, start + (len || fallbackLen || 30));
    }
    return { start: hhmm(start), end: end >= 24 * 60 ? '24:00' : hhmm(end), title: rest.replace(/^\s*[-–—:,]?\s*/, '').trim() };
  }
  // Just the times, as typed in a meeting's time field: "10:00", "10:00–11:00", "10:00 1h".
  function parseMeetingTime(text, oldLen) {
    const x = parseMeeting(`${text} x`, oldLen);
    return x && x.title === 'x' ? { start: x.start, end: x.end } : null;
  }
  const meetingLabel = m => `${m.start}–${m.end}`;

  /* ---------- zip files, for Google Calendar's export ---------- */
  // The files in a zip whose names end in one of exts, as [{ name, bytes }]. Inflating needs DecompressionStream.
  async function unzip(buf, exts) {
    const v = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not a zip');
    const count = v.getUint16(eocd + 10, true);
    let p = v.getUint32(eocd + 16, true);
    const out = [];
    for (let k = 0; k < count; k++) {
      if (v.getUint32(p, true) !== 0x02014b50) break;
      const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
      const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
      const local = v.getUint32(p + 42, true);
      const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      const base = name.split('/').pop();
      if (!base || base.startsWith('.') || !exts.some(e => base.toLowerCase().endsWith(e))) continue;
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const raw = new Uint8Array(buf, start, size);
      let bytes;
      if (method === 0) bytes = raw;
      else if (method === 8) {
        if (typeof DecompressionStream === 'undefined') throw new Error('no inflate');
        const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      } else continue;
      out.push({ name: base, bytes });
    }
    return out;
  }

  root.Core = {
    pad, isDate, ymd, parseYmd, addDays, mondayOf, fmtLong, fmtShort, fmtDots, fmtRange,
    duration, stripDuration, fmtDur, toMin, isTime,
    groupStart, groupEnd, groups, firstDoneGroup, normalize, toggle, moveBlock, dropBlock,
    dayMinutes, available, groupMinutes, openCount, carryOver,
    label, goalKey, goalMatch, dayAsText, weekSummary,
    PROJECT_FIELDS, emailIn, emailsIn, firstLine, nameIn, linkOf,
    DEFAULT_SCHEDULE, nextNumber, scheduleFrom, nextPhase, duplicateProject, findProjects, daysBetween, dueLabel,
    placeholders, fill, fillParts, isoWeek, AUTO_KEYS, autoValues, isLongBlank, humanize, mailto,
    STARTER_TEMPLATES, TEMPLATE_CATEGORIES,
    LANGS, LANG_NAMES, langName, parseLanguages, fold,
    parseProjectMarkdown, projectToMarkdown, fileNameFor, findDate,
    ASSISTANTS, assistantLink, reviewPrompt,
    COPY_KINDS, kindOf, DEFAULT_BLOCKS, BRIEF_FIELDS, newBlock, newPage, sitemapPages,
    pagePrompt, parseCopyAnswer, applyCopyAnswer, copyDeckMarkdown, pageAsText,
    linkHref, linkParts, plainMail, htmlMail, linkAt, linkMarkup,
    moveById, renumberProjects, moveProjectTo, moveTemplate,
    parseIcs, expandCalendar, eventsOn, busyMinutes, eventTime, eventLink, zonedMs,
    parseMeeting, parseMeetingTime, meetingLabel, unzip
  };
})(globalThis);

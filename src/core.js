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
    for (const r of day.routines || []) {
      if (r.skip) continue;
      const m = duration(r.text);
      if (r.done) done += m; else left += m;
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
      const existing = groups(dst).find(([ds]) => !dst[ds].done && norm(dst[ds].text) === norm(p.text));
      if (existing && copies.length) {
        dst.splice(existing[1], 0, ...copies);
      } else if (!existing) {
        dst.splice(firstDoneGroup(dst), 0, { id: newId(), text: p.text, level: 0, done: false }, ...copies);
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

  function dayAsText(day, date, goals, today) {
    const { left, done } = dayMinutes(day);
    const out = [fmtDots(date)];
    if (date < today) out.push(`Done: ${fmtDur(done)}`, `Not done: ${fmtDur(left)}`);
    else out.push(`Time left: ${fmtDur(left)}`);
    if (day.begin) out.push(`Begin: ${day.begin.replace(/^0/, '')}`);
    if (day.end) out.push(`End: ${day.end.replace(/^0/, '')}`);
    const g = (goals || []).filter(x => x.text.trim());
    if (g.length) out.push('', 'Week goals', ...g.map(x => box(x.done) + x.text));
    const r = (day.routines || []).filter(x => x.text.trim());
    if (r.length) out.push('', 'Routines', ...r.map(x => box(x.done) + x.text + (x.skip ? ' (skipped)' : '')));
    const L = (day.lines || []).filter(x => x.text.trim());
    if (L.length) out.push('', 'Tasks', ...L.map(x => (x.level ? '    ' : '') + box(x.done) + x.text + (x.moved ? ` (moved to ${fmtShort(x.moved)})` : '')));
    return out.join('\n') + '\n';
  }

  // Time done per project for a week, for updating Odoo or any timesheet by hand.
  function weekSummary(days, monday) {
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
        const lbl = label(stripDuration(L[s].text)) || 'Other';
        for (let k = s; k < e; k++) {
          const m = duration(L[k].text);
          if (L[k].done && !L[k].moved && m) add(lbl, m, k === s ? '' : L[k].text.trim());
        }
      }
      for (const r of day.routines || []) {
        const m = duration(r.text);
        if (r.done && !r.skip && m) add(stripDuration(r.text) || 'Routine', m, '');
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
    { key: 'spoc', label: 'SPOC', hint: 'Single point of contact: name and email' },
    { key: 'db', label: 'DB', hint: 'Database name or URL' },
    { key: 'website', label: 'Current website', hint: 'https://…' },
    { key: 'version', label: 'Version', hint: 'For example Odoo 18.0' },
    { key: 'task_link', label: 'Task link', hint: 'https://…' },
    { key: 'deadline', label: 'Deadline', type: 'date' },
    { key: 'ba', label: 'BA', hint: 'Business analyst' },
    { key: 'languages', label: 'Languages involved', hint: 'For example ES, EN, FR' },
    { key: 'goal', label: 'Goal', long: true },
    { key: 'sitemap', label: 'Sitemap', long: true },
    { key: 'apps', label: 'Apps', long: true },
    { key: 'schedule', label: 'Project schedule', long: true },
    { key: 'notes', label: 'Notes', long: true }
  ];
  const EMAIL_RE = /[^\s<>,;:()"'[\]]+@[^\s<>,;:()"'[\]]+\.[a-z]{2,}/i;
  const emailIn = s => (EMAIL_RE.exec(s || '') || [''])[0];
  const nameIn = s => (s || '').replace(EMAIL_RE, ' ').replace(/[<>()[\],;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  // A link worth opening: a full http(s) URL, or a bare domain like partena.odoo.com.
  function linkOf(s) {
    s = (s || '').trim();
    if (/^https?:\/\/[^\s]+$/i.test(s)) return s;
    if (!s.includes('@') && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(s) && /\.[a-z]{2,}(:\d+)?(\/|$)/i.test(s)) return 'https://' + s;
    return '';
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
  const LONG_DATE = {
    en: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    es: new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
  };
  const AUTO_KEYS = ['project', 'first_name', 'contact', 'spoc_email', 'date', 'week', 'my_name', 'signature'];
  function autoValues(project, me, lang, today) {
    const f = (project && project.fields) || {};
    const fmt = s => (isDate(s) ? LONG_DATE[lang === 'es' ? 'es' : 'en'].format(parseYmd(s)) : '');
    const contact = nameIn(f.spoc);
    const v = {
      project: project ? project.name.trim() : '',
      contact, first_name: contact.split(' ')[0] || '', spoc_email: emailIn(f.spoc),
      date: fmt(today), week: String(isoWeek(today)),
      my_name: (me && me.name || '').trim(), signature: (me && (me.signature || me.name) || '').trim()
    };
    for (const { key } of PROJECT_FIELDS) v[key] = key === 'deadline' ? fmt(f.deadline) : String(f[key] || '').trim();
    return v;
  }
  const isLongBlank = n => /points|steps|pending|done|planned|risks|summary|details|notes|items|list|agenda|issues|changes|comments|message|body|text/i.test(n);
  const humanize = n => {
    const f = PROJECT_FIELDS.find(x => x.key === n);
    if (f) return f.label;
    if (n === 'spoc_email') return 'SPOC email';
    const t = n.replace(/[._-]+/g, ' ').trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const mailto = (to, subject, body) =>
    `mailto:${encodeURIComponent(to || '').replace(/%40/g, '@')}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body || '')}`;

  const tpl = (name, en, es) => ({ name, en: { subject: en[0], body: en[1] }, es: { subject: es[0], body: es[1] } });
  const STARTER_TEMPLATES = [
    tpl('Follow-up',
      ['{{project}}: following up', 'Hi {{first_name}},\n\nI’m following up on {{topic}}. Could you let me know where things stand when you have a moment?\n\nThanks,\n{{signature}}'],
      ['{{project}}: seguimiento', 'Hola {{first_name}}:\n\nTe escribo para hacer seguimiento de {{topic}}. ¿Me puedes indicar cómo va cuando tengas un momento?\n\nGracias,\n{{signature}}']),
    tpl('Meeting recap',
      ['{{project}}: meeting recap, {{date}}', 'Hi {{first_name}},\n\nThanks for your time today. Here’s what we agreed:\n\n{{points}}\n\nNext steps:\n{{next_steps}}\n\nBest regards,\n{{signature}}'],
      ['{{project}}: resumen de la reunión del {{date}}', 'Hola {{first_name}}:\n\nGracias por tu tiempo hoy. Esto es lo que acordamos:\n\n{{points}}\n\nPróximos pasos:\n{{next_steps}}\n\nUn saludo,\n{{signature}}']),
    tpl('Deadline reminder',
      ['{{project}}: deadline on {{deadline}}', 'Hi {{first_name}},\n\nA quick reminder that the deadline for {{project}} is {{deadline}}. To stay on track, we still need:\n\n{{pending}}\n\nThanks,\n{{signature}}'],
      ['{{project}}: fecha límite el {{deadline}}', 'Hola {{first_name}}:\n\nTe recuerdo que la fecha límite de {{project}} es el {{deadline}}. Para cumplirla, todavía necesitamos:\n\n{{pending}}\n\nGracias,\n{{signature}}']),
    tpl('Ready for review',
      ['{{project}}: ready for your review', 'Hi {{first_name}},\n\n{{what}} is ready for you to review on {{db}}.\n\nCould you test it and send me your feedback by {{review_by}}?\n\nBest regards,\n{{signature}}'],
      ['{{project}}: listo para tu revisión', 'Hola {{first_name}}:\n\n{{what}} está listo para que lo revises en {{db}}.\n\n¿Puedes probarlo y enviarme tus comentarios antes del {{review_by}}?\n\nUn saludo,\n{{signature}}'])
  ];

  /* ---------- importing a version 0.1 backup ---------- */
  function findArray(o, key, depth) {
    if (!o || typeof o !== 'object' || depth > 4) return null;
    if (Array.isArray(o[key])) return o[key];
    for (const v of Object.values(o)) { const r = findArray(v, key, depth + 1); if (r) return r; }
    return null;
  }
  const part = x => ({ subject: String((x && x.subject) || ''), body: String((x && x.body) || '') });
  function importV01(data, newId) {
    const templates = (findArray(data, 'templates', 0) || [])
      .filter(t => t && typeof t === 'object' && t.name)
      .map(t => ({ id: newId(), name: String(t.name), en: part(t.en), es: part(t.es) }))
      .filter(t => t.en.subject || t.en.body || t.es.subject || t.es.body);
    const projects = (findArray(data, 'projects', 0) || [])
      .filter(p => p && typeof p === 'object' && p.name)
      .map(p => {
        const fields = {};
        const spoc = [p.contactName || p.contact, p.contactEmail || p.email].filter(Boolean).join(' ');
        if (spoc) fields.spoc = String(spoc);
        const notes = [p.client && `Client: ${p.client}`, p.code && `Code: ${p.code}`, p.notes].filter(Boolean).join('\n');
        if (notes) fields.notes = String(notes);
        return { id: newId(), name: String(p.name), archived: !!p.archived, lang: p.lang === 'es' ? 'es' : 'en', fields, todos: [] };
      });
    return { templates, projects };
  }

  root.Core = {
    pad, isDate, ymd, parseYmd, addDays, mondayOf, fmtLong, fmtShort, fmtDots, fmtRange,
    duration, stripDuration, fmtDur, toMin, isTime,
    groupStart, groupEnd, groups, firstDoneGroup, normalize, toggle, moveBlock, dropBlock,
    dayMinutes, available, groupMinutes, openCount, carryOver,
    label, goalKey, goalMatch, dayAsText, weekSummary,
    PROJECT_FIELDS, emailIn, nameIn, linkOf, daysBetween, dueLabel,
    placeholders, fill, fillParts, isoWeek, AUTO_KEYS, autoValues, isLongBlank, humanize, mailto,
    STARTER_TEMPLATES, importV01
  };
})(globalThis);

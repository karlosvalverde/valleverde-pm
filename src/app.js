/* Valleverde PM: the interface. Logic that doesn't touch the page lives in core.js. */
(() => {
  'use strict';
  const APP_VERSION = '0.6.2';
  const SCHEMA = 6;
  const C = globalThis.Core;

  const $ = (s, r = document) => r.querySelector(s);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => C.ymd(new Date());
  const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
  const isMac = /Mac/.test(navigator.platform || navigator.userAgent);
  const MOD = isMac ? '⌘' : 'Ctrl';
  const INPUT_ATTRS = 'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"';
  // Writing fields (emails, website copy) keep macOS spelling and grammar checks on.
  const PROSE_ATTRS = 'autocomplete="off" autocapitalize="sentences" spellcheck="true"';
  const okLang = l => (C.LANGS.includes(l) ? l : 'en');

  /* ---------- storage: a file through Tauri, or the browser for previews ---------- */
  const Backend = (() => {
    const T = globalThis.__TAURI__;
    if (T && T.core && typeof T.core.invoke === 'function') {
      const invoke = T.core.invoke;
      return {
        kind: 'file',
        load: () => invoke('load_workspace'),
        save: content => invoke('save_workspace', { content, today: today() }),
        mtime: () => invoke('workspace_mtime'),
        chooseFolder: () => invoke('choose_folder'),
        useFolder: (mode, content) => invoke('use_folder', { mode, content, today: today() }),
        reveal: () => invoke('reveal_data_file'),
        open: url => invoke('open_external', { url }),
        saveText: (name, content) => invoke('save_text_file', { name, content }),
        saveTexts: files => invoke('save_text_files', { files }),
        fetchCalendar: url => invoke('fetch_calendar', { url })
      };
    }
    const KEY = 'valleverde-pm-v2';
    return {
      kind: 'browser',
      load: async () => { let c = null; try { c = localStorage.getItem(KEY); } catch {} return { path: null, dir: null, content: c, mtime: 0 }; },
      save: async content => { localStorage.setItem(KEY, content); return 0; },
      mtime: async () => 0,
      open: async url => { window.open(url, '_blank', 'noopener'); },
      saveText: async (name, content) => { download(name, content); return 'your downloads'; },
      saveTexts: async files => { for (const f of files) download(f.name, f.content); return 'your downloads'; },
      fetchCalendar: async () => { throw new Error('Calendar addresses refresh in the desktop app. Here, import an .ics file instead.'); }
    };
    function download(name, content) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }));
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  })();

  /* ---------- data ---------- */
  let D = blank();
  let info = { path: null, dir: null };
  let readOnly = '';
  let lastMtime = 0, dirty = false, saveTimer = 0, saving = Promise.resolve();
  // What this window last wrote, when, and a count of edits, so a reload never drops typing in progress.
  let lastWritten = '', lastSavedAt = 0, edits = 0;
  const ui = {
    view: 'plan', date: today(), today: today(),
    project: null, selecting: false, sel: new Set(), dateEdit: null,
    sheetTab: 'project', copyLang: null, openPages: new Set(), briefOpen: false,
    mail: { tpl: null, project: '', lang: null, editing: false, editText: false },
    openCats: new Set(), renameCat: null
  };

  function blank() {
    return {
      app: 'valleverde-pm', schema: SCHEMA,
      settings: {
        begin: '09:30', end: '18:30', me: { name: '', signature: '', lang: 'en' },
        defaultSchedule: C.DEFAULT_SCHEDULE.slice(), assistant: 'claude-desktop',
        meetingsInBudget: true, calendarHint: true
      },
      weeks: {}, days: {}, projects: [], templates: [], templateCats: [], calendars: [], drafts: {}, meetings: {}
    };
  }
  function normalizeData(o) {
    const b = blank();
    if (!o || typeof o !== 'object') return b;
    const arr = x => (Array.isArray(x) ? x.filter(v => v && typeof v === 'object') : []);
    const time = (t, d) => (C.isTime(t) ? t : d);
    const line = x => {
      const l = { id: String(x.id || uid()), text: String(x.text ?? ''), level: x.level === 1 ? 1 : 0, done: !!x.done };
      if (C.isDate(x.moved)) l.moved = x.moved;
      if (x.ref && typeof x.ref === 'object' && x.ref.p) l.ref = x.ref.t ? { p: String(x.ref.p), t: String(x.ref.t) } : { p: String(x.ref.p) };
      if (C.isDate(x.planned)) l.planned = x.planned;
      return l;
    };
    const str = v => (typeof v === 'string' ? v : '');
    const part = x => ({ subject: str(x && x.subject), body: str(x && x.body) });
    b.settings.begin = time(o.settings && o.settings.begin, b.settings.begin);
    b.settings.end = time(o.settings && o.settings.end, b.settings.end);
    const me = (o.settings && o.settings.me) || {};
    b.settings.me = { name: str(me.name), signature: str(me.signature), lang: okLang(me.lang) };
    b.settings.assistant = C.ASSISTANTS[o.settings && o.settings.assistant] ? o.settings.assistant : 'claude-desktop';
    if (o.settings && o.settings.meetingsInBudget === false) b.settings.meetingsInBudget = false;
    if (o.settings && o.settings.calendarHint === false) b.settings.calendarHint = false;
    if (o.settings && Array.isArray(o.settings.defaultSchedule)) b.settings.defaultSchedule = o.settings.defaultSchedule.map(str).filter(x => x.trim());
    b.projects = arr(o.projects).map(p => {
      const pf = p.fields || {};
      const fields = {};
      for (const { key } of C.PROJECT_FIELDS) if (str(pf[key])) fields[key] = pf[key];
      // 0.3 kept the schedule as free text: keep that text in the notes, and start the new phase list.
      if (str(pf.schedule).trim() && !Array.isArray(p.schedule)) fields.notes = [fields.notes, `Project schedule:\n${pf.schedule}`].filter(Boolean).join('\n\n');
      const schedule = Array.isArray(p.schedule)
        ? arr(p.schedule).map(x => ({ id: String(x.id || uid()), text: str(x.text), date: C.isDate(x.date) ? x.date : '', done: !!x.done }))
        : C.scheduleFrom(b.settings.defaultSchedule, uid);
      return {
        id: String(p.id || uid()), num: Number.isInteger(p.num) && p.num > 0 ? p.num : 0,
        name: str(p.name), archived: !!p.archived, lang: okLang(p.lang),
        fields, schedule, todos: C.normalize(arr(p.todos).map(line), 1), copy: normalizeCopy(p.copy)
      };
    });
    // Until 0.5 the number was set by hand; from 0.6 it is the position in the list, in the same order as before.
    if (!(o.schema >= 6)) b.projects.sort((x, y) => (x.num || 1e9) - (y.num || 1e9));
    C.renumberProjects(b.projects);
    b.templateCats = arr(o.templateCats).map(c => ({ id: String(c.id || uid()), name: str(c.name), ...(c.collapsed ? { collapsed: true } : {}) }));
    const cats = new Set(b.templateCats.map(c => c.id));
    b.templates = arr(o.templates).map(t => ({
      id: String(t.id || uid()), name: str(t.name), cat: cats.has(t.cat) ? t.cat : '',
      ...Object.fromEntries(C.LANGS.map(l => [l, part(t[l])]))
    }));
    // Until 0.5 the list was sorted by name: keep that order as the starting point.
    if (!(o.schema >= 6)) b.templates.sort((x, y) => x.name.localeCompare(y.name));
    b.calendars = arr(o.calendars).map(normalizeCalendar).filter(Boolean);
    for (const [k, list] of Object.entries(o.meetings && typeof o.meetings === 'object' ? o.meetings : {})) {
      if (!C.isDate(k)) continue;
      const ms = arr(list).filter(m => C.isTime(m.start) && (C.isTime(m.end) || m.end === '24:00')).map(m => ({
        id: String(m.id || uid()), start: m.start, end: m.end, title: str(m.title),
        ...(m.ref && m.ref.p ? { ref: { p: String(m.ref.p) } } : {})
      }));
      if (ms.length) b.meetings[k] = ms;
    }
    const month = Date.now() - 31 * 864e5;
    for (const [k, d] of Object.entries(o.drafts && typeof o.drafts === 'object' ? o.drafts : {})) {
      if (!d || typeof d !== 'object' || !(d.at > month) || !b.templates.some(t => k.startsWith(t.id + '|'))) continue;
      const fields = {};
      for (const [n, v] of Object.entries(d.fields || {})) if (typeof v === 'string' && v) fields[n] = v;
      const text = {};
      for (const l of C.LANGS) if (d.text && d.text[l] && typeof d.text[l].body === 'string') text[l] = part(d.text[l]);
      b.drafts[k] = { at: d.at, to: str(d.to), toTouched: !!d.toTouched, fields, text };
    }
    if (Number.isFinite(o.savedAt)) b.savedAt = o.savedAt;
    for (const [k, w] of Object.entries(o.weeks || {})) {
      if (!C.isDate(k) || !w) continue;
      b.weeks[k] = { goals: arr(w.goals).map(g => ({ ...line(g), level: 0 })) };
      if (w.dismissed) b.weeks[k].dismissed = true;
    }
    for (const [k, d] of Object.entries(o.days || {})) {
      if (!C.isDate(k) || !d) continue;
      const day = {
        begin: time(d.begin, b.settings.begin), end: time(d.end, b.settings.end),
        lines: C.normalize(arr(d.lines).map(line), 1)
      };
      if (C.isDate(d.dismissed)) day.dismissed = d.dismissed;
      b.days[k] = day;
    }
    return b;
  }

  const CAL_COLORS = ['#3d7a50', '#3a6ea5', '#b0573b', '#8a5bb0', '#b08a2e', '#3a8f8f'];
  function normalizeCalendar(c) {
    const str = v => (typeof v === 'string' ? v : '');
    if (!c.id) return null;
    const cal = {
      id: String(c.id), name: str(c.name), url: str(c.url), color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : CAL_COLORS[0], hidden: !!c.hidden
    };
    // Imported files keep their events in the data file; addresses keep only the address and refresh on each Mac.
    if (!cal.url) {
      cal.file = str(c.file);
      cal.imported = Number(c.imported) || 0;
      cal.tz = c.tz && typeof c.tz === 'object' ? c.tz : {};
      cal.events = Array.isArray(c.events) ? c.events.filter(e => e && typeof e === 'object' && typeof e.s === 'string') : [];
    }
    return cal;
  }

  function normalizeCopy(c) {
    const arr = x => (Array.isArray(x) ? x.filter(v => v && typeof v === 'object') : []);
    const str = v => (typeof v === 'string' ? v : '');
    const brief = {};
    for (const { key } of C.BRIEF_FIELDS) if (str(c && c.brief && c.brief[key])) brief[key] = c.brief[key];
    return {
      brief,
      pages: arr(c && c.pages).map(pg => ({
        id: String(pg.id || uid()), name: str(pg.name),
        blocks: arr(pg.blocks).map(b => {
          const text = {};
          for (const [k, v] of Object.entries(b.text || {})) if (/^[a-z]{2}$/.test(k) && typeof v === 'string') text[k] = v;
          return { id: String(b.id || uid()), kind: C.kindOf(b.kind).key, label: str(b.label) || C.kindOf(b.kind).label, text };
        })
      }))
    };
  }

  function applyLoaded(r) {
    info = { path: r.path, dir: r.dir };
    lastMtime = r.mtime || 0;
    readOnly = '';
    let parsed = null;
    if (r.content) {
      try { parsed = JSON.parse(r.content); }
      catch { readOnly = 'Your data file couldn’t be read, so nothing will be saved over it. Open Settings, choose Show data file, and restore a copy from the backups folder next to it.'; }
    }
    if (parsed && parsed.schema > SCHEMA) readOnly = 'This data file was saved by a newer version of Valleverde PM. Update the app to edit it; nothing will be saved until then.';
    D = normalizeData(parsed);
    lastWritten = r.content || '';
    lastSavedAt = D.savedAt || 0;
    calCache.clear();
  }

  function changed() {
    if (readOnly) return;
    edits++;
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 300);
  }
  function flush() {
    clearTimeout(saveTimer);
    if (!dirty || readOnly) return saving;
    dirty = false;
    D.savedAt = Math.max(Date.now(), lastSavedAt + 1);
    lastSavedAt = D.savedAt;
    const content = JSON.stringify(D, null, 1);
    saving = saving
      .then(() => Backend.save(content))
      .then(m => { lastMtime = m || lastMtime; lastWritten = content; setSaveError(''); })
      .catch(e => { dirty = true; setSaveError(String(e && e.message || e)); });
    return saving;
  }
  function setSaveError(msg) {
    const el = $('#saveState');
    el.hidden = !msg;
    el.title = msg ? `${msg}\nClick to try again.` : '';
  }

  // When the window comes back, pick up changes saved by another Mac. Anything typed in the meantime wins,
  // and so does this window's data when the file on disk is an older copy (as iCloud sometimes puts back).
  let checking = false;
  async function checkExternalChange() {
    if (Backend.kind !== 'file' || dirty || checking) return;
    checking = true;
    try {
      await saving;
      const seq = edits;
      let m = 0;
      try { m = await Backend.mtime(); } catch { return; }
      if (!m || !lastMtime || m === lastMtime || dirty || edits !== seq) return;
      let r;
      try { r = await Backend.load(); } catch { return; }
      if (dirty || edits !== seq) return;
      lastMtime = r.mtime || m;
      if (!r.content || r.content === lastWritten) return;
      let theirs = null;
      try { theirs = JSON.parse(r.content); } catch { return; }
      if (theirs && Number.isFinite(theirs.savedAt) && theirs.savedAt < lastSavedAt) {
        // An older copy came back: keep what this window has and write it again.
        dirty = true;
        flush();
        return;
      }
      applyLoaded(r);
      render();
      toast('Updated with changes from the data file');
    } finally { checking = false; }
  }

  /* ---------- days and weeks ---------- */
  const week = () => C.mondayOf(ui.date);
  function ensureDay(date) {
    if (!D.days[date]) D.days[date] = { begin: D.settings.begin, end: D.settings.end, lines: [] };
    return D.days[date];
  }
  const viewDay = date => D.days[date] || { begin: D.settings.begin, end: D.settings.end, lines: [] };
  const ensureWeek = mon => (D.weeks[mon] ||= { goals: [] });
  const weekGoals = () => ((D.weeks[week()] || {}).goals || []).filter(g => g.text.trim());
  // A goal matches a project line by its text, or by the name of the project it's linked to.
  const lineNames = l => { const p = l.ref && proj(l.ref.p); return p ? [l.text, p.name] : [l.text]; };
  function goalNumber(l) {
    const i = weekGoals().findIndex(g => lineNames(l).some(t => C.goalMatch(g.text, t)));
    return i + 1;
  }
  function plannedForGoal(goalText) {
    const L = viewDay(ui.date).lines;
    let m = 0;
    for (const [s] of C.groups(L)) if (lineNames(L[s]).some(t => C.goalMatch(goalText, t))) m += C.groupMinutes(L, s).open;
    return m;
  }

  /* ---------- the outliner ---------- */
  class Outline {
    constructor(el, o) {
      this.el = el;
      this.o = Object.assign({ maxLevel: 1, sink: false, check: true, ghost: '', label: 'Item', decorate: null }, o);
      this.focus = null;
      this.drag = null;
      el.addEventListener('click', e => this.onClick(e));
      el.addEventListener('input', e => this.onInput(e));
      el.addEventListener('keydown', e => this.onKey(e));
      el.addEventListener('dragstart', e => this.onDragStart(e));
      el.addEventListener('dragover', e => this.onDragOver(e));
      el.addEventListener('drop', e => this.onDrop(e));
      el.addEventListener('dragend', () => this.endDrag());
    }
    read() { return this.o.read(); }
    write() { return this.o.write(); }
    ghostIndex(L) { return this.o.sink ? C.firstDoneGroup(L) : L.length; }
    render() {
      const L = this.read();
      const gi = this.ghostIndex(L);
      let h = '';
      L.forEach((l, i) => { if (i === gi) h += this.ghostRow(); h += this.row(l); });
      if (gi >= L.length) h += this.ghostRow();
      this.el.innerHTML = h;
      this.refresh();
      this.restoreFocus();
    }
    row(l) {
      const chk = this.o.check
        ? `<button type="button" class="chk" aria-pressed="${l.done}" aria-label="${l.done ? 'Mark not done' : 'Mark done'}"></button>`
        : '<span class="bullet" aria-hidden="true"></span>';
      return `<div class="row l${l.level}${l.done ? ' done' : ''}${l.moved ? ' moved' : ''}" data-id="${esc(l.id)}">` +
        `<span class="grip" draggable="${readOnly ? 'false' : 'true'}" title="Drag to reorder"></span>${chk}` +
        `<input class="txt" value="${esc(l.text)}" aria-label="${esc(this.o.label)}" ${INPUT_ATTRS}${readOnly ? ' readonly' : ''}>` +
        '<span class="aside"></span></div>';
    }
    ghostRow() {
      if (readOnly) return '';
      return `<div class="row l0 ghost"><span class="grip"></span>${this.o.check ? '<span class="chk" aria-hidden="true"></span>' : '<span class="bullet" aria-hidden="true"></span>'}` +
        `<input class="txt" data-ghost placeholder="${esc(this.o.ghost)}" aria-label="${esc(this.o.ghost)}" ${INPUT_ATTRS}><span class="aside"></span></div>`;
    }
    // Updates the right-hand notes (sums, goal links) without rebuilding the inputs.
    refresh() {
      if (!this.o.decorate) return;
      const L = this.read();
      for (const row of this.el.querySelectorAll('.row[data-id]')) {
        const i = L.findIndex(l => l.id === row.dataset.id);
        if (i < 0) continue;
        row.querySelector('.aside').innerHTML = this.o.decorate(L[i], i, L) || '';
      }
    }
    restoreFocus() {
      const f = this.focus;
      this.focus = null;
      if (!f) return;
      const input = f.ghost ? this.el.querySelector('input[data-ghost]') : this.el.querySelector(`.row[data-id="${CSS.escape(f.id)}"] input`);
      if (!input) return;
      input.focus();
      const p = f.pos == null ? input.value.length : Math.min(f.pos, input.value.length);
      try { input.setSelectionRange(p, p); } catch {}
    }
    commit(focus, kind = 'struct') {
      C.normalize(this.write(), this.o.maxLevel);
      this.focus = focus;
      this.render();
      this.o.onChange(kind);
    }
    lineOf(target) {
      const row = target.closest('.row[data-id]');
      if (!row) return null;
      const L = this.write();
      const i = L.findIndex(l => l.id === row.dataset.id);
      return i < 0 ? null : { L, i, line: L[i] };
    }
    toggle(id, keepFocus) {
      if (readOnly) return;
      const L = this.write();
      const i = L.findIndex(l => l.id === id);
      if (i < 0) return;
      const before = new Map(L.map(l => [l.id, l.done]));
      C.toggle(L, i, this.o.sink);
      if (this.o.onToggled) this.o.onToggled(L.filter(l => before.get(l.id) !== l.done));
      this.commit(keepFocus ? { id, pos: keepFocus.pos } : null);
    }
    onClick(e) {
      const chk = e.target.closest('button.chk');
      if (chk) { this.toggle(chk.closest('.row').dataset.id); return; }
      const row = e.target.closest('.row');
      if (row && !e.target.closest('input')) row.querySelector('input').focus();
    }
    onInput(e) {
      const input = e.target;
      if (!input.matches('input.txt') || readOnly) return;
      if (input.hasAttribute('data-ghost')) {
        const L = this.write();
        const line = { id: uid(), text: input.value, level: 0, done: false };
        L.splice(this.ghostIndex(L), 0, line);
        this.commit({ id: line.id, pos: input.value.length }, 'text');
        return;
      }
      const hit = this.lineOf(input);
      if (!hit) return;
      hit.line.text = input.value;
      this.refresh();
      this.o.onChange('text');
    }
    onKey(e) {
      const input = e.target;
      if (!input.matches('input.txt') || e.isComposing) return;
      const mod = e.metaKey || e.ctrlKey;
      const inputs = [...this.el.querySelectorAll('input.txt')];
      const idx = inputs.indexOf(input);
      const pos = input.selectionStart, end = input.selectionEnd;
      const go = (j, p) => { const t = inputs[j]; if (!t) return false; t.focus(); const q = p == null ? t.value.length : Math.min(p, t.value.length); t.setSelectionRange(q, q); return true; };

      if (e.key === 'Escape') { input.blur(); return; }
      if (e.key === 'ArrowUp' && !e.altKey && !mod && !e.shiftKey) { if (go(idx - 1, pos)) e.preventDefault(); return; }
      if (e.key === 'ArrowDown' && !e.altKey && !mod && !e.shiftKey) { if (go(idx + 1, pos)) e.preventDefault(); return; }
      if (input.hasAttribute('data-ghost')) {
        if (e.key === 'Enter') e.preventDefault();
        if (e.key === 'Backspace' && !input.value && idx > 0) { e.preventDefault(); go(idx - 1); }
        return;
      }
      if (readOnly) return;
      const hit = this.lineOf(input);
      if (!hit) return;
      const { L, i, line } = hit;
      const max = this.o.maxLevel;

      if (e.key === 'Enter' && mod) { e.preventDefault(); this.toggle(line.id, { pos }); return; }
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l' && this.o.onLink) { e.preventDefault(); this.o.onLink(line.id); return; }
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (!line.text && line.level > 0) { line.level = 0; this.commit({ id: line.id, pos: 0 }); return; }
        if (pos === 0 && end === 0 && line.text) {
          L.splice(i, 0, { id: uid(), text: '', level: line.level, done: false });
          this.commit({ id: line.id, pos: 0 });
          return;
        }
        const after = line.text.slice(end);
        line.text = line.text.slice(0, pos);
        const level = line.level === 0 && L[i + 1] && L[i + 1].level > 0 ? 1 : line.level;
        const nl = { id: uid(), text: after, level: Math.min(level, max), done: false };
        L.splice(i + 1, 0, nl);
        this.commit({ id: nl.id, pos: 0 });
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) { if (line.level > 0) { line.level = 0; this.commit({ id: line.id, pos }); } }
        else if (i > 0 && line.level < max) { line.level = 1; this.commit({ id: line.id, pos }); }
        return;
      }
      if (e.key === 'Backspace' && pos === 0 && end === 0) {
        if (line.level > 0) { e.preventDefault(); line.level = 0; this.commit({ id: line.id, pos: 0 }); return; }
        if (i > 0) {
          e.preventDefault();
          const prev = L[i - 1];
          const p = prev.text.length;
          prev.text += line.text;
          L.splice(i, 1);
          this.commit({ id: prev.id, pos: p });
          return;
        }
        if (!line.text) {
          e.preventDefault();
          L.splice(i, 1);
          this.commit(L.length ? { id: L[0].id, pos: 0 } : { ghost: true });
        }
        return;
      }
      if (e.key === 'Delete' && pos === line.text.length && end === pos && L[i + 1]) {
        e.preventDefault();
        line.text += L[i + 1].text;
        L.splice(i + 1, 1);
        this.commit({ id: line.id, pos });
        return;
      }
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        if (C.moveBlock(L, i, e.key === 'ArrowUp' ? -1 : 1) >= 0) this.commit({ id: line.id, pos });
      }
    }
    onDragStart(e) {
      const grip = e.target.closest && e.target.closest('.grip');
      const row = grip && grip.closest('.row[data-id]');
      if (!row || readOnly) return;
      this.drag = row.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.querySelector('input').value);
      try { e.dataTransfer.setDragImage(row, 12, 14); } catch {}
      row.classList.add('dragging');
    }
    clearDrop() { for (const r of this.el.querySelectorAll('.drop-before, .drop-after')) r.classList.remove('drop-before', 'drop-after'); }
    dropTarget(e) {
      const row = e.target.closest && e.target.closest('.row[data-id]');
      if (!row || row.dataset.id === this.drag) return null;
      const r = row.getBoundingClientRect();
      return { row, after: e.clientY > r.top + r.height / 2 };
    }
    onDragOver(e) {
      if (!this.drag) return;
      const t = this.dropTarget(e);
      this.clearDrop();
      if (!t) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      t.row.classList.add(t.after ? 'drop-after' : 'drop-before');
    }
    onDrop(e) {
      if (!this.drag) return;
      e.preventDefault();
      const t = this.dropTarget(e);
      const id = this.drag;
      this.endDrag();
      if (!t) return;
      const L = this.write();
      const from = L.findIndex(l => l.id === id), to = L.findIndex(l => l.id === t.row.dataset.id);
      if (C.dropBlock(L, from, to, t.after)) this.commit(null);
    }
    endDrag() {
      this.drag = null;
      this.clearDrop();
      for (const r of this.el.querySelectorAll('.dragging')) r.classList.remove('dragging');
    }
    focusGhost() { const g = this.el.querySelector('input[data-ghost]'); if (g) g.focus(); }
  }

  /* ---------- reordering lists by their grip ----------
     Works with a mouse, a trackpad or touch: press the dots and move. The arrow keys move a focused grip.
     opts.accept(dragEl, targetEl) says where an item may land; opts.drop(dragEl, targetEl, where) applies it,
     where is 'before', 'after' or 'into' (for opts.into targets, such as a category). */
  function sortable(container, opts) {
    let drag = null;
    const item = opts.item || '[data-sort-id]';
    const clear = () => { for (const el of container.querySelectorAll('.drop-before, .drop-after, .drop-into')) el.classList.remove('drop-before', 'drop-after', 'drop-into'); };
    const stop = () => {
      if (!drag) return;
      clear();
      drag.el.classList.remove('dragging');
      document.body.classList.remove('sorting');
      cancelAnimationFrame(drag.raf);
      drag = null;
    };
    container.addEventListener('pointerdown', e => {
      const g = e.target.closest('[data-grip]');
      if (!g || !container.contains(g) || e.button !== 0 || readOnly) return;
      const el = g.closest(item);
      if (!el) return;
      e.preventDefault();
      g.focus({ preventScroll: true });
      drag = { el, grip: g, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, target: null, raf: 0 };
      try { g.setPointerCapture(e.pointerId); } catch {}
    });
    const track = () => {
      if (!drag || !drag.moved) return;
      const edge = 56, y = drag.y;
      if (y < edge) window.scrollBy(0, -Math.ceil((edge - y) / 4));
      else if (y > window.innerHeight - edge) window.scrollBy(0, Math.ceil((y - window.innerHeight + edge) / 4));
      clear();
      drag.target = null;
      const under = document.elementFromPoint(drag.x, drag.y);
      const t = under && under.closest(item);
      if (t && t !== drag.el && container.contains(t) && !drag.el.contains(t) && opts.accept(drag.el, t)) {
        const r = t.getBoundingClientRect();
        const where = opts.into && opts.into(drag.el, t) ? 'into' : drag.y > r.top + r.height / 2 ? 'after' : 'before';
        t.classList.add(`drop-${where}`);
        drag.target = { el: t, where };
      }
      drag.raf = requestAnimationFrame(track);
    };
    container.addEventListener('pointermove', e => {
      if (!drag) return;
      drag.x = e.clientX; drag.y = e.clientY;
      if (!drag.moved) {
        if (Math.abs(e.clientY - drag.y0) < 4) return;
        drag.moved = true;
        drag.el.classList.add('dragging');
        document.body.classList.add('sorting');
        track();
      }
    });
    container.addEventListener('pointerup', () => {
      if (!drag) return;
      const { el, target, moved } = drag;
      stop();
      if (moved && target) opts.drop(el, target.el, target.where);
    });
    container.addEventListener('pointercancel', stop);
    container.addEventListener('keydown', e => {
      const g = e.target.closest && e.target.closest('[data-grip]');
      if (!g || readOnly || e.metaKey || e.ctrlKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const el = g.closest(item);
      if (el && opts.step) opts.step(el, e.key === 'ArrowUp' ? -1 : 1);
    });
  }
  // After a list is drawn again, put the focus back on the grip that was moved.
  function refocusGrip(container, id) {
    const g = container.querySelector(`[data-sort-id="${CSS.escape(id)}"] [data-grip]`);
    if (g) g.focus({ preventScroll: true });
  }

  /* ---------- outlines on the page ---------- */
  let goalsOL, tasksOL, projTodosOL;
  function onListChange(kind) {
    changed();
    renderBudget();
    goalsOL.refresh();
    tasksOL.refresh();
    if (kind !== 'text') renderBanners();
  }
  function setupOutlines() {
    goalsOL = new Outline($('#goals'), {
      maxLevel: 0, label: 'Week goal', ghost: 'Add a goal for this week',
      read: () => (D.weeks[week()] || {}).goals || [],
      write: () => ensureWeek(week()).goals,
      decorate: g => {
        if (g.done || !g.text.trim()) return '';
        const m = plannedForGoal(g.text);
        return m ? `<span class="note">${C.fmtDur(m)} planned</span>` : '';
      },
      onChange: onListChange
    });
    tasksOL = new Outline($('#tasks'), {
      maxLevel: 1, sink: true, label: 'Task', ghost: 'Add a project or task, like “Partena” or “15m FU”',
      read: () => viewDay(ui.date).lines,
      write: () => ensureDay(ui.date).lines,
      decorate: (l, i, L) => {
        if (l.moved) return `<span class="note">Moved to ${esc(C.fmtShort(l.moved))}</span>`;
        let h = linkChip(l, i, L);
        if (l.level) return h;
        const g = goalNumber(l);
        if (g) h += `<span class="goal" title="Serves week goal ${g}">Goal ${g}</span>`;
        const m = C.groupMinutes(L, i);
        if (m.kids) {
          if (m.open) h += `<span class="sum">${C.fmtDur(m.open)}</span>`;
          else if (m.done) h += `<span class="sum quiet">${C.fmtDur(m.done)}</span>`;
        }
        return h;
      },
      onToggled: syncFromDay,
      onLink: id => openPicker(id),
      onChange: onListChange
    });
    projTodosOL = new Outline($('#pTodos'), {
      maxLevel: 1, sink: true, label: 'Project to-do', ghost: 'Add a to-do for this project',
      read: () => (proj(ui.project) || { todos: [] }).todos,
      write: () => proj(ui.project).todos,
      decorate: l => {
        if (l.done) return '';
        if (l.planned && l.planned >= today()) return `<span class="note">Planned ${esc((relative(l.planned) || C.fmtShort(l.planned)).toLowerCase())}</span>`;
        return '<button type="button" class="link plan-btn" data-act="plan-todo">Plan today</button>';
      },
      onToggled: syncFromTodos,
      onChange: () => { changed(); renderSheetSub(); }
    });
  }

  /* ---------- rendering ---------- */
  const VIEWS = ['plan', 'projects', 'mail'];
  function render() {
    renderNotice();
    for (const v of VIEWS) {
      $('#view-' + v).hidden = ui.view !== v;
      $('#tab-' + v).setAttribute('aria-selected', String(ui.view === v));
    }
    $('#menuWrap').hidden = ui.view !== 'plan';
    if (ui.view !== 'plan') toggleMenu(false);
    if (ui.view === 'projects') renderProjects();
    else if (ui.view === 'mail') renderMail();
    else renderPlan();
  }
  function setView(v, opts = {}) {
    flush();
    closePicker();
    sugHide();
    if (v !== 'projects') { ui.selecting = false; ui.sel.clear(); }
    ui.view = v;
    if ('project' in opts) ui.project = opts.project;
    render();
    window.scrollTo(0, 0);
  }
  function renderPlan() {
    renderNav();
    renderAgenda();
    renderBudget();
    $('#weekRange').textContent = C.fmtRange(week());
    goalsOL.render();
    tasksOL.render();
    renderBanners();
    renderWeekDeadlines();
  }

  function relative(date) {
    const t = today();
    if (date === t) return 'Today';
    if (date === C.addDays(t, 1)) return 'Tomorrow';
    if (date === C.addDays(t, -1)) return 'Yesterday';
    return '';
  }
  function renderNav() {
    const t = today();
    const withYear = ui.date.slice(0, 4) !== t.slice(0, 4);
    $('#date').textContent = C.fmtLong(ui.date, withYear);
    $('#rel').textContent = relative(ui.date);
    $('#todayBtn').hidden = ui.date === t;
  }
  function renderNotice() {
    const n = $('#notice');
    n.hidden = !readOnly;
    n.textContent = readOnly;
  }

  function renderBudget() {
    const day = viewDay(ui.date);
    const t = today();
    const past = ui.date < t;
    const { left, done } = C.dayMinutes(day);
    const big = $('#left'), slack = $('#slack');
    if (past) {
      big.innerHTML = `${C.fmtDur(done)}<span class="unit"> done</span>`;
      slack.className = 'slack quiet';
      slack.textContent = left ? `${C.fmtDur(left)} not done` : '';
    } else {
      big.innerHTML = `${C.fmtDur(left)}<span class="unit"> left</span>`;
      const avail = C.available(day, ui.date, t, nowMin());
      const meet = meetingsLeft(day, ui.date);
      if (avail === null) { slack.className = 'slack'; slack.textContent = ''; }
      else {
        const f = avail - left - (meet || 0);
        slack.className = f >= 0 ? 'slack free' : 'slack over';
        slack.textContent = f >= 0 ? `${C.fmtDur(f)} free` : `${C.fmtDur(-f)} over`;
      }
    }
    const b = $('#begin'), e = $('#end');
    if (document.activeElement !== b) b.value = day.begin || '';
    if (document.activeElement !== e) e.value = day.end || '';
    b.disabled = e.disabled = !!readOnly;
    $('#doneTotal').textContent = !past && done ? `${C.fmtDur(done)} done` : '';
    const meet = past ? null : meetingsLeft(day, ui.date);
    $('#meetTotal').textContent = meet ? `${C.fmtDur(meet)} of meetings${ui.date === t ? ' left' : ''}` : '';
    $('#meetTotal').title = meet ? 'Meetings in your working hours count against the free time. Change this in Settings, under Calendars.' : '';
    renderRibbon(day, left, past);
  }

  // The day as a bar: time gone, work planned, the end of the day, and anything that spills past it.
  function renderRibbon(day, left, past) {
    const r = $('#ribbon');
    r.replaceChildren();
    const b = C.toMin(day.begin), e = C.toMin(day.end);
    if (past || b === null || e === null || e <= b) { r.hidden = true; return; }
    r.hidden = false;
    const total = e - b;
    const isToday = ui.date === today();
    const now = nowMin();
    const elapsed = isToday ? Math.min(Math.max(now - b, 0), total) : 0;
    const span = Math.max(total, elapsed + left);
    const pct = x => `${(x / span) * 100}%`;
    const add = (cls, from, to) => {
      if (to <= from) return;
      const s = document.createElement('span');
      s.className = cls;
      s.style.left = pct(from);
      s.style.width = pct(to - from);
      r.append(s);
    };
    for (let h = Math.ceil(b / 60) * 60; h < e; h += 60) if (h > b) add('tick', h - b, h - b + span / 900);
    add('seg gone', 0, elapsed);
    add('seg plan', elapsed, Math.min(elapsed + left, total));
    add('seg over', total, elapsed + left);
    if (span > total) {
      const m = document.createElement('span');
      m.className = 'endmark';
      m.style.left = pct(total);
      r.append(m);
    }
    // Meetings, at their own times, as a band along the bottom.
    if (D.settings.meetingsInBudget) {
      const base = C.parseYmd(ui.date).getTime();
      for (const o of dayEvents(ui.date)) {
        if (o.allDay || !o.busy) continue;
        const from = Math.max(0, (o.start - base) / 60000 - b), to = Math.min(total, (o.end - base) / 60000 - b);
        if (to > from) add('meet', from, to);
      }
    }
    if (isToday && now >= b && now <= e) {
      const m = document.createElement('span');
      m.className = 'nowmark';
      m.style.left = pct(elapsed);
      r.append(m);
    }
    r.title = `${day.begin}–${day.end}`;
  }

  function previousDayWithLines(date) {
    return Object.keys(D.days).filter(k => k < date && D.days[k].lines.length).sort().pop() || null;
  }
  function renderBanners() {
    const tb = $('#tasksBanner'), gb = $('#goalsBanner');
    tb.replaceChildren(); gb.replaceChildren();
    if (readOnly) return;
    if (ui.date >= today()) {
      const src = previousDayWithLines(ui.date);
      const n = src ? C.openCount(D.days[src].lines) : 0;
      const day = D.days[ui.date];
      if (n && !(day && day.dismissed === src)) {
        tb.innerHTML = `<div class="banner"><p>${n} open ${n === 1 ? 'task' : 'tasks'} from ${esc(relative(src).toLowerCase() || C.fmtLong(src))}.</p>` +
          `<button type="button" class="btn" data-act="carry" data-src="${src}">Bring ${n === 1 ? 'it' : 'them'} over</button>` +
          `<button type="button" class="link" data-act="carry-dismiss" data-src="${src}">Not now</button></div>`;
      }
    }
    const mon = week();
    const w = D.weeks[mon];
    const prev = D.weeks[C.addDays(mon, -7)];
    const open = prev ? prev.goals.filter(g => g.text.trim() && !g.done) : [];
    if (open.length && !weekGoals().length && !(w && w.dismissed)) {
      gb.innerHTML = `<div class="banner"><p>Last week had ${open.length} open ${open.length === 1 ? 'goal' : 'goals'}.</p>` +
        `<button type="button" class="btn" data-act="goals-carry">Bring ${open.length === 1 ? 'it' : 'them'} over</button>` +
        '<button type="button" class="link" data-act="goals-dismiss">Not now</button></div>';
    }
  }

  /* ---------- calendars ----------
     A calendar added by its secret address keeps only the address in the data file. Its events are fetched by the
     app (never by this page) and kept on this Mac, so a background refresh never rewrites your data file.
     A calendar imported from an .ics file keeps its events in the data file. */
  const FETCHED_KEY = 'valleverde-pm-calendar-events';
  const REFRESH_EVERY = 15 * 60 * 1000;
  let fetched = {};
  try { fetched = JSON.parse(localStorage.getItem(FETCHED_KEY) || '{}') || {}; } catch { fetched = {}; }
  const saveFetched = () => { try { localStorage.setItem(FETCHED_KEY, JSON.stringify(fetched)); } catch {} };
  const calCache = new Map();
  const calById = id => D.calendars.find(c => c.id === id) || null;
  const calSource = c => (c.url ? fetched[c.id] || { tz: {}, events: [] } : c);
  // Occurrences around a date, from every calendar that's shown, cached per calendar and week.
  function eventsAround(date) {
    const from = C.addDays(C.mondayOf(date), -1), to = C.addDays(from, 9);
    let out = [];
    for (const c of D.calendars) {
      if (c.hidden) continue;
      const src = calSource(c);
      const key = `${c.id}|${from}|${src.at || c.imported || 0}|${(src.events || []).length}`;
      let hit = calCache.get(c.id);
      if (!hit || hit.key !== key) {
        let occ = [];
        try { occ = C.expandCalendar({ id: c.id, tz: src.tz || {}, events: src.events || [] }, from, to); } catch (e) { console.error(e); }
        hit = { key, occ };
        calCache.set(c.id, hit);
      }
      out = out.concat(hit.occ);
    }
    return out;
  }
  // Meetings you type in the plan: one-off, kept per day in the data file, shown with your calendars.
  const MINE = { id: 'mine', name: 'My meetings', color: '#b08a2e' };
  const myMeetings = date => (D.meetings[date] || []);
  function myOccurrences(date) {
    const base = C.parseYmd(date).getTime();
    return myMeetings(date).map(m => ({
      id: `mine:${m.id}`, mid: m.id, mine: true, cal: 'mine', title: m.title, loc: '', allDay: false, busy: true,
      start: base + C.toMin(m.start) * 60000, end: base + (m.end === '24:00' ? 1440 : C.toMin(m.end)) * 60000, ref: m.ref
    }));
  }
  function dayEvents(date) {
    // The same event in two calendars (an invitation in a shared calendar, or a calendar imported twice) shows once.
    const seen = new Set();
    const theirs = (D.calendars.length ? C.eventsOn(eventsAround(date), date) : []).filter(o => {
      const k = `${o.title.trim().toLowerCase()}|${o.allDay ? `${o.sd}|${o.ed}` : `${o.start}|${o.end}`}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return theirs.concat(myOccurrences(date))
      .sort((a, b) => (a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : (a.start || 0) - (b.start || 0) || a.title.localeCompare(b.title)));
  }
  // Busy meeting minutes still ahead in the working day, or null when meetings don't count.
  function meetingsLeft(day, date) {
    if (!D.settings.meetingsInBudget || (!D.calendars.length && !myMeetings(date).length)) return null;
    const b = C.toMin(day.begin), e = C.toMin(day.end), t = today();
    if (b === null || e === null || e <= b || date < t) return null;
    return C.busyMinutes(dayEvents(date), date, date === t ? Math.max(b, nowMin()) : b, e);
  }

  let refreshing = null;
  async function refreshCalendars(force) {
    if (refreshing) return refreshing;
    const due = D.calendars.filter(c => c.url && (force || !fetched[c.id] || Date.now() - (fetched[c.id].at || 0) > REFRESH_EVERY));
    if (!due.length) return null;
    renderAgendaInfo(true);
    refreshing = (async () => {
      for (const c of due) {
        try {
          const parsed = C.parseIcs(await Backend.fetchCalendar(c.url), new Date(Date.now() - 62 * 864e5));
          fetched[c.id] = { at: Date.now(), ok: Date.now(), tz: parsed.tz, events: parsed.events, error: '' };
        } catch (e) {
          fetched[c.id] = { ...(fetched[c.id] || { tz: {}, events: [] }), at: Date.now(), error: String((e && e.message) || e) };
        }
        calCache.delete(c.id);
      }
      saveFetched();
    })();
    try { await refreshing; } finally {
      refreshing = null;
      if (ui.view === 'plan') { renderAgenda(); renderBudget(); }
      if ($('#settings').open) renderCalList();
    }
    return null;
  }

  const fmtClock = ms => new Date(ms).toTimeString().slice(0, 5);
  function renderAgendaInfo(busy) {
    const btn = $('#calRefreshBtn');
    btn.hidden = !D.calendars.some(c => c.url && !c.hidden);
    btn.disabled = !!busy;
    btn.textContent = busy ? 'Refreshing…' : 'Refresh';
    $('#calConnectBtn').hidden = !!D.calendars.length || !!readOnly;
  }
  // What's being typed in the agenda survives a redraw (the 30-second clock tick, a calendar refresh).
  const agendaFocus = () => {
    const el = document.activeElement;
    if (!el || !el.closest || !el.closest('#agenda') || el.tagName !== 'INPUT') return null;
    const row = el.closest('[data-mid]');
    return { mid: row ? row.dataset.mid : null,
      field: el.hasAttribute('data-mtime') ? 'mtime' : el.hasAttribute('data-mtitle') ? 'mtitle' : 'mghost',
      value: el.value, a: el.selectionStart, b: el.selectionEnd };
  };
  function renderAgenda() {
    const box = $('#agenda');
    const f = agendaFocus();
    $('#agendaBlock').hidden = !!readOnly && !dayEvents(ui.date).length;
    renderAgendaInfo(!!refreshing);
    const shown = D.calendars.filter(c => !c.hidden);
    const evs = dayEvents(ui.date);
    const now = Date.now();
    const timed = evs.filter(o => !o.allDay);
    const busy = C.busyMinutes(evs, ui.date, 0, 1440);
    $('#agendaInfo').textContent = timed.length ? `${timed.length} ${timed.length === 1 ? 'meeting' : 'meetings'}${busy ? `, ${C.fmtDur(busy)}` : ''}` : '';
    const errors = shown.filter(c => c.url && fetched[c.id] && fetched[c.id].error);
    const waiting = shown.filter(c => c.url && !(fetched[c.id] && fetched[c.id].ok));
    const ro = readOnly ? ' readonly' : '';
    let h = evs.map(o => {
      const c = o.mine ? MINE : calById(o.cal) || {};
      const link = C.eventLink(o);
      const past = !o.allDay && o.end <= now && o.end > o.start;
      const live = !o.allDay && o.start <= now && now < o.end;
      const cls = `ev${past ? ' past' : ''}${live ? ' live' : ''}${o.allDay ? ' allday' : ''}${o.busy || o.allDay ? '' : ' free'}${o.mine ? ' mine' : ''}`;
      const join = link ? `<button type="button" class="link ev-join" data-act="ev-open" data-url="${esc(link)}">${live || (!past && o.start - now < 15 * 60000) ? 'Join' : 'Link'}</button>` : '';
      if (o.mine) {
        const m = myMeetings(ui.date).find(x => x.id === o.mid);
        const p = m.ref && proj(m.ref.p);
        return `<div class="${cls}" data-mid="${esc(m.id)}">` +
          `<span class="ev-dot" style="background:${MINE.color}" title="${MINE.name}"></span>` +
          `<input class="ev-time-in" data-mtime value="${esc(C.meetingLabel(m))}" aria-label="Time of ${esc(m.title || 'the meeting')}" title="Change the time, like 10:00–11:00 or 10:00 1h" ${INPUT_ATTRS}${ro}>` +
          `<input class="ev-title-in" data-mtitle value="${esc(m.title)}" aria-label="Meeting" placeholder="Meeting" ${INPUT_ATTRS}${ro}>` +
          (p ? `<button type="button" class="pchip" data-act="open-project" data-pid="${esc(p.id)}" title="Open ${esc(projectTitle(p))}">${esc(projectTitle(p))}</button>` : '') +
          join + (readOnly ? '' : '<button type="button" class="link ev-del" data-act="meeting-remove" title="Remove this meeting">Remove</button>') + '</div>';
      }
      const where = o.loc && !/^https?:\/\//i.test(o.loc) ? o.loc : '';
      return `<div class="${cls}" title="${esc([o.title, where, c.name].filter(Boolean).join('\n'))}">` +
        `<span class="ev-dot" style="background:${esc(c.color || CAL_COLORS[0])}"></span>` +
        `<span class="ev-time">${esc(C.eventTime(o, ui.date))}</span>` +
        `<span class="ev-title">${esc(o.title || 'Busy')}${where ? `<span class="ev-where">${esc(where)}</span>` : ''}</span>` + join + '</div>';
    }).join('');
    if (!evs.length && shown.length) h = `<p class="empty">${waiting.length && refreshing ? 'Loading your calendar…' : waiting.length && !errors.length ? 'Not loaded yet.' : 'No meetings.'}</p>`;
    if (!readOnly) h += '<div class="ev ev-add"><span class="ev-dot add" aria-hidden="true"></span>' +
      `<input class="ev-ghost-in" data-mghost value="${esc(ui.meetingText || '')}" placeholder="Add a meeting, like “10:00 Partena kick-off”" aria-label="Add a meeting: start with its time" ${INPUT_ATTRS}>` +
      '<span class="note ev-hint" id="meetingHint"></span></div>';
    if (errors.length) h += `<p class="ev-error">Couldn’t refresh ${errors.map(c => esc(c.name || 'a calendar')).join(', ')}: ${esc(fetched[errors[0].id].error)} <button type="button" class="link" data-act="settings">Calendars</button></p>`;
    box.innerHTML = h;
    meetingHint();
    if (f) {
      const sel = f.field === 'mghost' ? '[data-mghost]' : `[data-mid="${CSS.escape(f.mid || '')}"] [data-${f.field}]`;
      const el = box.querySelector(sel);
      if (el) {
        if (f.field !== 'mghost') el.value = f.value;
        el.focus({ preventScroll: true });
        try { el.setSelectionRange(f.a, f.b); } catch {}
      }
    }
  }
  // Under the add line: what will be added, or how to write it.
  function meetingHint() {
    const el = $('#meetingHint');
    if (!el) return;
    const t = (ui.meetingText || '').trim();
    const m = t && C.parseMeeting(t);
    el.textContent = !t ? '' : m ? `${C.meetingLabel(m)}${m.title ? '' : ', add a title'}. Return to add it` : 'Start with the time, like 10:00 or 10:00–11:30';
    el.classList.toggle('bad', !!t && !m);
  }
  function addMeeting() {
    const t = (ui.meetingText || '').trim();
    const m = t && C.parseMeeting(t);
    if (!m || readOnly) { meetingHint(); return; }
    const p = ui.meetingRef && proj(ui.meetingRef);
    const meeting = { id: uid(), start: m.start, end: m.end, title: m.title || 'Meeting', ...(p && m.title.toLowerCase().includes(p.name.trim().toLowerCase()) ? { ref: { p: p.id } } : {}) };
    (D.meetings[ui.date] ||= []).push(meeting);
    D.meetings[ui.date].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    ui.meetingText = '';
    ui.meetingRef = null;
    changed();
    renderAgenda();
    renderBudget();
    const g = $('#agenda [data-mghost]');
    if (g) g.focus();
  }
  function removeMeeting(id) {
    const list = myMeetings(ui.date);
    const i = list.findIndex(x => x.id === id);
    if (i < 0 || readOnly) return;
    list.splice(i, 1);
    if (!list.length) delete D.meetings[ui.date];
    changed();
    renderAgenda();
    renderBudget();
  }
  const meetingOf = el => { const row = el.closest('[data-mid]'); return row ? myMeetings(ui.date).find(x => x.id === row.dataset.mid) : null; };
  $('#agenda').addEventListener('input', e => {
    const el = e.target;
    if (el.hasAttribute('data-mghost')) { ui.meetingText = el.value; if (!el.value.trim()) ui.meetingRef = null; meetingHint(); return; }
    const m = meetingOf(el);
    if (!m || readOnly || !el.hasAttribute('data-mtitle')) return;
    m.title = el.value;
    const p = m.ref && proj(m.ref.p);
    if (p && !m.title.toLowerCase().includes(p.name.trim().toLowerCase())) { delete m.ref; const chip = el.parentElement.querySelector('.pchip'); if (chip) chip.remove(); }
    changed();
  });
  $('#agenda').addEventListener('change', e => {
    const el = e.target;
    const m = el.hasAttribute('data-mtime') && meetingOf(el);
    if (!m || readOnly) return;
    const len = C.toMin(m.end === '24:00' ? '23:59' : m.end) - C.toMin(m.start);
    const t = C.parseMeetingTime(el.value, len > 0 ? len : 30);
    if (!t) { el.value = C.meetingLabel(m); toast('Write the time like 10:00, 10:00–11:30 or 10:00 1h'); return; }
    Object.assign(m, t);
    myMeetings(ui.date).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    changed();
    el.blur();
    renderAgenda();
    renderBudget();
  });
  $('#agenda').addEventListener('keydown', e => {
    const el = e.target;
    if (e.isComposing || el.tagName !== 'INPUT') return;
    if (e.key === 'Escape') { el.blur(); return; }
    if (el.hasAttribute('data-mghost')) { if (e.key === 'Enter') { e.preventDefault(); addMeeting(); } return; }
    if (e.key === 'Enter') { e.preventDefault(); if (el.hasAttribute('data-mtime')) el.blur(); else { const g = $('#agenda [data-mghost]'); if (g) g.focus(); } return; }
    if (e.key === 'Backspace' && el.hasAttribute('data-mtitle') && !el.value) {
      e.preventDefault();
      const m = meetingOf(el);
      if (m) { removeMeeting(m.id); const g = $('#agenda [data-mghost]'); if (g) g.focus(); }
    }
  });
  function agendaLines(date) {
    return dayEvents(date).map(o => `${C.eventTime(o, date)} ${o.title || 'Busy'}`);
  }

  /* the calendar list in Settings */
  function calStatus(c) {
    if (!c.url) {
      const n = (c.events || []).length;
      return `Imported${c.file ? ` from ${c.file}` : ''}${c.imported ? ` on ${C.fmtShort(C.ymd(new Date(c.imported)))}` : ''}, ${n} ${n === 1 ? 'event' : 'events'}`;
    }
    const f = fetched[c.id];
    if (refreshing && (!f || !f.ok)) return 'Loading…';
    if (!f) return 'Not loaded yet';
    if (f.error) return `Couldn’t refresh: ${f.error}`;
    return `Updated ${C.ymd(new Date(f.ok)) === today() ? `at ${fmtClock(f.ok)}` : C.fmtShort(C.ymd(new Date(f.ok)))}`;
  }
  function renderCalList() {
    const ro = readOnly ? ' disabled' : '';
    $('#calList').innerHTML = D.calendars.length ? D.calendars.map(c =>
      `<div class="cal" data-cal="${esc(c.id)}"><span class="ev-dot" style="background:${esc(c.color)}"></span>` +
      `<div class="cal-main"><input class="cal-name" data-cal-name value="${esc(c.name)}" aria-label="Calendar name" placeholder="Calendar" ${INPUT_ATTRS}${readOnly ? ' readonly' : ''}>` +
      `<span class="note${c.url && fetched[c.id] && fetched[c.id].error ? ' bad' : ''}">${esc(calStatus(c))}</span></div>` +
      `<label class="check small"><input type="checkbox" data-cal-show${c.hidden ? '' : ' checked'}${ro}> Show</label>` +
      (c.url ? `<button type="button" class="link" data-act="cal-refresh-one"${ro}>Refresh</button>` : `<button type="button" class="link" data-act="cal-file"${ro} title="Choose the file again to update this calendar">Update</button>`) +
      `<button type="button" class="link danger" data-act="cal-remove"${ro}>Remove</button></div>`).join('')
      : '<p class="hint">No calendars yet.</p>';
    $('#meetingsInBudget').checked = D.settings.meetingsInBudget;
    $('#meetingsInBudget').disabled = !!readOnly;
  }
  $('#calList').addEventListener('input', e => {
    const c = e.target.hasAttribute('data-cal-name') && calById(e.target.closest('[data-cal]').dataset.cal);
    if (!c || readOnly) return;
    c.name = e.target.value;
    changed();
  });
  $('#calList').addEventListener('change', e => {
    const c = e.target.hasAttribute('data-cal-show') && calById(e.target.closest('[data-cal]').dataset.cal);
    if (!c || readOnly) return;
    c.hidden = !e.target.checked;
    changed();
    if (ui.view === 'plan') { renderAgenda(); renderBudget(); }
    if (!c.hidden) refreshCalendars();
  });
  $('#meetingsInBudget').addEventListener('change', e => {
    if (readOnly) return;
    D.settings.meetingsInBudget = e.target.checked;
    changed();
    renderBudget();
  });

  function openCalAdd() {
    if (readOnly) return;
    $('#caUrl').value = '';
    $('#caName').value = '';
    $('#caState').textContent = '';
    $('#caGo').disabled = false;
    $('#calAdd').showModal();
    $('#caUrl').focus();
  }
  const nextColor = () => CAL_COLORS[D.calendars.length % CAL_COLORS.length];
  async function saveCalAdd() {
    const url = $('#caUrl').value.trim().replace(/^webcals?:\/\//i, 'https://');
    if (!/^https:\/\/\S+$/i.test(url)) { $('#caState').textContent = 'Paste an address that starts with https:// or webcal://.'; return; }
    if (D.calendars.some(c => c.url === url)) { $('#caState').textContent = 'That calendar is already in your list.'; return; }
    $('#caGo').disabled = true;
    $('#caState').textContent = 'Reading the calendar…';
    let parsed;
    try { parsed = C.parseIcs(await Backend.fetchCalendar(url), new Date(Date.now() - 62 * 864e5)); }
    catch (e) { $('#caState').textContent = String((e && e.message) || e); $('#caGo').disabled = false; return; }
    const c = { id: uid(), name: $('#caName').value.trim() || parsed.name || 'Calendar', url, color: nextColor(), hidden: false };
    D.calendars.push(c);
    fetched[c.id] = { at: Date.now(), ok: Date.now(), tz: parsed.tz, events: parsed.events, error: '' };
    saveFetched();
    D.settings.calendarHint = true;
    changed();
    $('#calAdd').close();
    if ($('#settings').open) renderCalList();
    if (ui.view === 'plan') { renderAgenda(); renderBudget(); }
    toast(`Added ${c.name}`);
  }
  $('#caUrl').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveCalAdd(); } });
  $('#caName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveCalAdd(); } });
  // One calendar from an iCalendar text. A file imported again under the same name updates its calendar.
  function importIcs(fileName, text) {
    const parsed = C.parseIcs(text, new Date(Date.now() - 62 * 864e5));
    let c = D.calendars.find(x => !x.url && x.file === fileName);
    const fresh = !c;
    if (!c) { c = { id: uid(), name: parsed.name || fileName.replace(/\.(ics|ical|icalendar|ifb|vcs)$/i, ''), url: '', color: nextColor(), hidden: false, file: fileName }; D.calendars.push(c); }
    Object.assign(c, { tz: parsed.tz, events: parsed.events, imported: Date.now() });
    calCache.delete(c.id);
    return { c, fresh, n: parsed.events.length };
  }
  const isCalendarText = t => /^\s*(\ufeff)?BEGIN:VCALENDAR/i.test(t.slice(0, 2000));
  $('#icsFile').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || readOnly) return;
    if (file.size > 150e6) { toast(`${file.name} is too large to import (${Math.round(file.size / 1e6)} MB).`); return; }
    let sources = [];
    try {
      const buf = await file.arrayBuffer();
      const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
      if (head[0] === 0x50 && head[1] === 0x4b) {
        // Google Calendar's export: a zip with one .ics file per calendar.
        let files;
        try { files = await C.unzip(buf, ['.ics', '.ical', '.icalendar']); }
        catch (err) {
          toast(String(err && err.message) === 'no inflate' ? 'This version of macOS can’t open the zip here. Double-click it in Finder, then import the .ics files inside.' : `${file.name} couldn’t be opened as a zip.`);
          return;
        }
        sources = files.map(f => ({ name: f.name, text: new TextDecoder().decode(f.bytes) })).filter(f => isCalendarText(f.text));
        if (!sources.length) { toast(`${file.name} has no calendar (.ics) files in it.`); return; }
      } else {
        const text = new TextDecoder().decode(buf);
        if (!isCalendarText(text)) { toast(`${file.name} isn’t a calendar file. Export the calendar as .ics, or as Google’s .zip.`); return; }
        sources = [{ name: file.name, text }];
      }
    } catch { toast(`${file.name} couldn’t be read.`); return; }
    const done = sources.map(f => importIcs(f.name, f.text));
    D.settings.calendarHint = true;
    changed();
    if ($('#settings').open) renderCalList();
    if (ui.view === 'plan') { renderAgenda(); renderBudget(); }
    if (done.length === 1) toast(`${done[0].fresh ? 'Added' : 'Updated'} ${done[0].c.name}: ${done[0].n} ${done[0].n === 1 ? 'event' : 'events'}`);
    else toast(`Imported ${done.length} calendars: ${done.map(x => x.c.name).join(', ')}`);
  });

  /* ---------- projects ---------- */
  const proj = id => D.projects.find(p => p.id === id) || null;
  const projectTitle = p => `#${p.num} ${p.name.trim() || 'Untitled project'}`;
  const nameEq = (a, b) => C.label(a).trim().toLowerCase() === C.label(b).trim().toLowerCase();
  const openTodos = p => p.todos.filter(t => !t.done && t.text.trim()).length;
  // The list order is the user's own: drag a project, and its number follows its place.
  const byNum = (a, b) => a.num - b.num;
  const activeProjects = () => D.projects.filter(p => !p.archived);
  const dueHtml = due => (due ? `<span class="due${due.late ? ' late' : due.soon ? ' soon' : ''}">${esc(due.text)}</span>` : '');

  // The project a plan line belongs to: its own link, or for an action, its project line's link.
  function lineProject(L, i) {
    const l = L[i];
    if (l.ref) return proj(l.ref.p);
    if (l.level) { const s = C.groupStart(L, i); if (L[s].ref) return proj(L[s].ref.p); }
    return null;
  }
  function linkChip(l, i, L) {
    const own = l.ref && proj(l.ref.p);
    const parent = l.level ? lineProject(L, C.groupStart(L, i)) : null;
    const todo = own && l.ref.t ? own.todos.find(t => t.id === l.ref.t) : null;
    const ro = readOnly ? ' disabled' : '';
    if (todo) {
      return `<button type="button" class="pchip todo" data-act="link-line" title="To-do of ${esc(projectTitle(own))}: ${esc(todo.text)}"${ro}>` +
        `${own !== parent ? `${esc(projectTitle(own))}, ` : ''}to-do</button>`;
    }
    if (own && own !== parent) return `<button type="button" class="pchip" data-act="link-line" title="Linked to ${esc(projectTitle(own))}"${ro}>${esc(projectTitle(own))}</button>`;
    if (readOnly || (l.level && parent)) return '';
    return '<button type="button" class="link link-btn" data-act="link-line" title="Link to a project (⌘L)">Link</button>';
  }

  // A to-do planned for today shows up in the day under its project, and checking either one checks both.
  function planTodo(p, todo) {
    const t = today();
    const L = ensureDay(t).lines;
    todo.planned = t;
    if (L.some(l => l.ref && l.ref.t === todo.id && !l.moved && !l.done)) return false;
    const g = C.groups(L).find(([s]) => !L[s].done && (L[s].ref ? L[s].ref.p === p.id && !L[s].ref.t : nameEq(p.name, L[s].text)));
    const line = { id: uid(), text: todo.text, level: 1, done: false, ref: { p: p.id, t: todo.id } };
    if (g) {
      if (!L[g[0]].ref) L[g[0]].ref = { p: p.id };
      L.splice(g[1], 0, line);
    } else {
      L.splice(C.firstDoneGroup(L), 0, { id: uid(), text: p.name.trim() || `Project ${p.num}`, level: 0, done: false, ref: { p: p.id } }, line);
    }
    return true;
  }
  function syncFromDay(lines) {
    for (const l of lines) {
      if (!l.ref || !l.ref.t) continue;
      const p = proj(l.ref.p);
      const i = p ? p.todos.findIndex(x => x.id === l.ref.t) : -1;
      if (i >= 0 && p.todos[i].done !== l.done) C.toggle(p.todos, i, true);
    }
  }
  function syncFromTodos(todos) {
    for (const t of todos) {
      for (const day of Object.values(D.days)) {
        const id = (day.lines.find(l => l.ref && l.ref.t === t.id && !l.moved && l.done !== t.done) || {}).id;
        if (!id) continue;
        C.toggle(day.lines, day.lines.findIndex(l => l.id === id), true);
      }
    }
  }

  /* ---------- suggestions while typing in the plan, like a Many2one ----------
     On a project line that isn't linked yet: your projects, filtered as you type, and Create project.
     On an action under a linked project: that project's open to-dos, and Add as a to-do.
     Nothing is chosen unless you pick it, so a line can always stay free text. */
  const sug = { items: [], active: -1, key: null, dismissed: null, head: '' };
  const sugBox = $('#suggest');
  const SUG_INPUTS = '#tasks input.txt, #agenda input[data-mghost], #agenda input[data-mtitle]';
  function sugContext() {
    const el = document.activeElement;
    if (readOnly || !el || !el.matches(SUG_INPUTS) || ui.view !== 'plan') return null;
    // A meeting: projects whose name matches its title, so typing "10:00 Par" offers Partena.
    if (el.closest('#agenda')) {
      const ghost = el.hasAttribute('data-mghost');
      const m = ghost ? null : meetingOf(el);
      if (!ghost && (!m || m.ref)) return null;
      if (ghost && ui.meetingRef) return null;
      const parsed = ghost ? C.parseMeeting(el.value) : { title: el.value };
      if (!parsed) return null;
      return { el, meeting: true, ghost, m, key: ghost ? 'mghost' : `m:${m.id}`, level: -1, text: el.value, title: parsed.title };
    }
    if (el.hasAttribute('data-ghost')) return { el, ghost: true, key: 'ghost', level: 0, text: el.value };
    const row = el.closest('.row[data-id]');
    const L = viewDay(ui.date).lines;
    const i = row ? L.findIndex(l => l.id === row.dataset.id) : -1;
    if (i < 0) return null;
    const line = L[i];
    if (line.done || line.moved) return null;
    const ctx = { el, ghost: false, key: line.id, line, i, L, level: line.level, text: el.value };
    if (line.level === 0) return line.ref ? null : ctx;
    if (line.ref && line.ref.t) return null;
    ctx.project = lineProject(L, C.groupStart(L, i));
    return ctx.project ? ctx : null;
  }
  const inPlan = p => viewDay(ui.date).lines.some(l => l.level === 0 && !l.done && l.ref && l.ref.p === p.id && !l.ref.t);
  function sugBuild(ctx) {
    if (ctx.meeting) {
      const q = ctx.title.trim();
      if (!q || q.length > 60) return { items: [], active: -1 };
      const k = q.toLowerCase().replace(/^#/, '');
      const found = activeProjects().filter(p => p.name.trim().toLowerCase().startsWith(k) || String(p.num) === k).slice(0, 12);
      return { items: found.map(p => ({ act: 'meeting-project', p, label: projectTitle(p) })), active: found.length ? 0 : -1, head: 'Link the meeting to a project' };
    }
    const q = ctx.text.trim();
    if (q.length > 60) return { items: [], active: -1 };
    if (ctx.level === 0) {
      if (C.duration(q)) return { items: [], active: -1 };
      const found = C.findProjects(activeProjects(), q).slice(0, 50);
      const items = found.map(p => ({ act: 'project', p, label: projectTitle(p), note: inPlan(p) ? 'In the plan' : '' }));
      if (q.length >= 2 && !D.projects.some(p => nameEq(p.name, q))) items.push({ act: 'create', label: `Create project “${q}”`, quiet: true });
      const k = q.toLowerCase().replace(/^#/, '');
      const top = found[0];
      const auto = !!(k && top && (top.name.trim().toLowerCase().startsWith(k) || String(top.num) === k));
      return { items, active: auto ? 0 : -1, head: 'Link to a project' };
    }
    const p = ctx.project;
    const used = new Set(ctx.L.filter(l => l.ref && l.ref.t && !l.moved).map(l => l.ref.t));
    const qq = C.stripDuration(q).toLowerCase();
    const todos = p.todos.filter(t => !t.done && t.text.trim() && !used.has(t.id) && (!qq || t.text.toLowerCase().includes(qq)));
    if (!todos.length) return { items: [], active: -1 };
    const items = todos.slice(0, 30).map(t => ({ act: 'todo', p, t, label: t.text }));
    if (qq.length >= 2 && !p.todos.some(t => t.text.trim().toLowerCase() === qq)) items.push({ act: 'new-todo', p, label: `Add “${C.stripDuration(q)}” as a to-do`, quiet: true });
    return { items, active: qq && todos[0].text.toLowerCase().startsWith(qq) ? 0 : -1, head: `To-dos of ${projectTitle(p)}` };
  }
  function sugHide() {
    if (sugBox.hidden) return;
    sugBox.hidden = true;
    sug.key = null;
    for (const el of document.querySelectorAll('#tasks input[aria-expanded="true"], #agenda input[aria-expanded="true"]')) { el.setAttribute('aria-expanded', 'false'); el.removeAttribute('aria-activedescendant'); }
  }
  function sugUpdate() {
    const ctx = sugContext();
    if (!ctx || sug.dismissed === `${ctx.key}|${ctx.text}` || !$('#picker').hidden) { sugHide(); return; }
    const r = sugBuild(ctx);
    if (!r.items.length) { sugHide(); return; }
    const same = sug.key === ctx.key && !sugBox.hidden;
    sug.items = r.items;
    sug.head = r.head;
    sug.active = same && sug.typed === ctx.text ? Math.min(sug.active, r.items.length - 1) : r.active;
    sug.typed = ctx.text;
    sug.key = ctx.key;
    sugPaint();
    sugBox.hidden = false;
    for (const x of document.querySelectorAll('#tasks input[aria-expanded="true"], #agenda input[aria-expanded="true"]')) if (x !== ctx.el) x.setAttribute('aria-expanded', 'false');
    ctx.el.setAttribute('aria-autocomplete', 'list');
    ctx.el.setAttribute('aria-controls', 'suggestList');
    ctx.el.setAttribute('aria-expanded', 'true');
    sugPlace(ctx.el);
  }
  function sugPaint() {
    $('#suggestHead').textContent = sug.head;
    $('#suggestList').innerHTML = sug.items.map((x, k) =>
      `<button type="button" role="option" tabindex="-1" id="sug-${k}" class="pick-item${x.quiet ? ' quiet' : ''}" data-k="${k}" aria-selected="${k === sug.active}">` +
      `<span>${esc(x.label)}</span>${x.note ? `<span class="note">${esc(x.note)}</span>` : ''}</button>`).join('');
    const el = document.activeElement;
    if (el && el.matches(SUG_INPUTS)) {
      if (sug.active >= 0) el.setAttribute('aria-activedescendant', `sug-${sug.active}`); else el.removeAttribute('aria-activedescendant');
    }
    const cur = $(`#sug-${sug.active}`);
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  function sugPlace(input) {
    const r = input.getBoundingClientRect();
    const w = Math.min(380, window.innerWidth - 24);
    sugBox.style.width = `${w}px`;
    sugBox.style.left = `${Math.max(12, Math.min(r.left - 8, window.innerWidth - w - 12))}px`;
    const h = sugBox.offsetHeight;
    const below = r.bottom + 4;
    sugBox.style.top = `${below + h > window.innerHeight - 12 && r.top - h - 4 > 12 ? r.top - h - 4 : below}px`;
  }
  function sugChoose(k) {
    const x = sug.items[k];
    const ctx = sugContext();
    if (!x || !ctx) return;
    if (ctx.meeting) {
      // The title becomes the project's name, ready to go on: "10:00 Partena " then "kick-off".
      const name = x.p.name.trim();
      sugHide();
      if (ctx.ghost) {
        const head = ctx.text.slice(0, ctx.text.length - ctx.title.length);
        ui.meetingText = `${head}${name} `;
        ui.meetingRef = x.p.id;
        ctx.el.value = ui.meetingText;
        meetingHint();
      } else {
        ctx.m.title = `${name} `;
        ctx.m.ref = { p: x.p.id };
        changed();
        renderAgenda();
        ctx.el = $(`#agenda [data-mid="${CSS.escape(ctx.m.id)}"] [data-mtitle]`);
      }
      sug.dismissed = `${ctx.key}|${ctx.el.value}`;
      ctx.el.focus();
      ctx.el.setSelectionRange(ctx.el.value.length, ctx.el.value.length);
      return;
    }
    const L = ensureDay(ui.date).lines;
    const q = ctx.text.trim();
    let line = ctx.ghost ? null : L.find(l => l.id === ctx.line.id);
    if (ctx.ghost) {
      line = { id: uid(), text: '', level: 0, done: false };
      L.splice(C.firstDoneGroup(L), 0, line);
    }
    let i = L.indexOf(line);
    sugHide();
    if (x.act === 'project' || x.act === 'create') {
      let p = x.p;
      if (x.act === 'create') {
        p = newProject();
        p.name = q;
        toast(`Created ${projectTitle(p)}. Its sheet is in Projects.`);
      }
      const hasKids = C.groupEnd(L, i) > i + 1;
      const other = C.groups(L).find(([s]) => L[s] !== line && !L[s].done && L[s].ref && L[s].ref.p === p.id && !L[s].ref.t);
      if (other && !hasKids) {
        // Already in the plan: add the new action under that project instead of a second copy of it.
        L.splice(i, 1);
        const g = C.groups(L).find(([s]) => L[s].ref && L[s].ref.p === p.id && !L[s].done && !L[s].ref.t);
        const child = { id: uid(), text: '', level: 1, done: false };
        L.splice(g[1], 0, child);
        if (x.act !== 'create') toast(`${projectTitle(p)} is already in the plan: write the next action under it`);
        tasksOL.commit({ id: child.id, pos: 0 });
        return;
      }
      line.text = p.name.trim() || `Project ${p.num}`;
      line.ref = { p: p.id };
      if (hasKids) { tasksOL.commit({ id: line.id, pos: null }); return; }
      const child = { id: uid(), text: '', level: 1, done: false };
      L.splice(i + 1, 0, child);
      tasksOL.commit({ id: child.id, pos: 0 });
      return;
    }
    const p = x.p;
    let todo = x.t;
    const mins = C.duration(q);
    if (x.act === 'new-todo') {
      todo = { id: uid(), text: C.stripDuration(q), level: 0, done: false };
      p.todos.splice(C.firstDoneGroup(p.todos), 0, todo);
    }
    line.ref = { p: p.id, t: todo.id };
    line.text = mins ? `${todo.text} - ${C.fmtDur(mins)}` : todo.text;
    todo.planned = ui.date;
    tasksOL.commit({ id: line.id, pos: null });
  }
  // Runs before the outline's own keys, so Return picks a highlighted suggestion and Esc closes the list first.
  const sugKeys = e => {
    if (sugBox.hidden || e.isComposing || !e.target.matches(SUG_INPUTS)) return;
    const n = sug.items.length;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'ArrowDown' && !e.altKey && !e.metaKey && !e.ctrlKey) { stop(); sug.active = Math.min(n - 1, sug.active + 1); sugPaint(); return; }
    if (e.key === 'ArrowUp' && !e.altKey && !e.metaKey && !e.ctrlKey) {
      if (sug.active < 0) { sugHide(); return; }
      stop(); sug.active--; sugPaint(); return;
    }
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && sug.active >= 0) { stop(); sugChoose(sug.active); return; }
    if (e.key === 'Escape') { stop(); const c = sugContext(); if (c) sug.dismissed = `${c.key}|${c.text}`; sugHide(); return; }
    if (e.key === 'Tab' || (e.metaKey || e.ctrlKey)) sugHide();
  };
  for (const box of [$('#tasks'), $('#agenda')]) {
    box.addEventListener('keydown', sugKeys, true);
    box.addEventListener('focusin', () => sugUpdate());
    box.addEventListener('input', () => sugUpdate());
    box.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement || !document.activeElement.matches(SUG_INPUTS)) sugHide(); }, 0));
  }
  sugBox.addEventListener('mousedown', e => e.preventDefault());
  sugBox.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) sugChoose(Number(b.dataset.k)); });
  sugBox.addEventListener('mousemove', e => {
    const b = e.target.closest('[data-k]');
    if (b && Number(b.dataset.k) !== sug.active) { sug.active = Number(b.dataset.k); sugPaint(); }
  });
  window.addEventListener('resize', () => { if (!sugBox.hidden) sugUpdate(); });
  document.addEventListener('scroll', () => { const el = document.activeElement; if (!sugBox.hidden && el && el.matches(SUG_INPUTS)) sugPlace(el); }, true);

  /* ---------- linking a plan line to a project or to-do ---------- */
  const pick = { lineId: null, step: 'project', project: null };
  function openPicker(lineId) {
    if (readOnly) return;
    sugHide();
    const L = viewDay(ui.date).lines;
    const i = L.findIndex(l => l.id === lineId);
    if (i < 0) return;
    pick.lineId = lineId;
    const inherited = L[i].level ? lineProject(L, C.groupStart(L, i)) : null;
    const own = L[i].ref && proj(L[i].ref.p);
    pick.project = own || inherited;
    pick.step = pick.project && canLinkTodo(L, i) ? 'todo' : 'project';
    const box = $('#picker');
    box.hidden = false;
    $('#pickQ').value = '';
    renderPicker();
    placePicker();
    $('#pickQ').focus();
  }
  const canLinkTodo = (L, i) => L[i].level > 0 || C.groupEnd(L, i) === i + 1;
  function placePicker() {
    const row = $(`#tasks .row[data-id="${CSS.escape(pick.lineId)}"]`);
    const box = $('#picker');
    if (!row) return;
    const r = row.getBoundingClientRect();
    const w = Math.min(360, window.innerWidth - 24);
    box.style.width = `${w}px`;
    box.style.left = `${Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12))}px`;
    const below = r.bottom + 6;
    const h = box.offsetHeight;
    box.style.top = `${below + h > window.innerHeight - 12 && r.top - h - 6 > 12 ? r.top - h - 6 : below}px`;
  }
  function closePicker(refocus) {
    if ($('#picker').hidden) return;
    $('#picker').hidden = true;
    const id = pick.lineId;
    pick.lineId = null;
    if (refocus && id) { tasksOL.focus = { id, pos: null }; tasksOL.restoreFocus(); }
  }
  function pickedLine() {
    const L = ensureDay(ui.date).lines;
    const i = L.findIndex(l => l.id === pick.lineId);
    return i < 0 ? null : { L, i, line: L[i] };
  }
  function renderPicker() {
    const hit = pickedLine();
    if (!hit) { closePicker(); return; }
    const { L, i, line } = hit;
    const q = $('#pickQ').value;
    const items = [];
    const own = line.ref && proj(line.ref.p);
    if (pick.step === 'project') {
      $('#pickQ').placeholder = 'Find a project by name or number';
      if (own) {
        items.push({ act: 'open', label: `Open ${projectTitle(own)}` });
        items.push({ act: 'unlink', label: 'Remove the link' });
      }
      const found = C.findProjects(activeProjects(), q);
      const suggest = !q.trim() ? found.filter(p => nameEq(p.name, line.text) || C.goalMatch(p.name, line.text)) : [];
      const list = suggest.concat(found.filter(p => !suggest.includes(p))).slice(0, 30);
      for (const p of list) items.push({ act: 'project', id: p.id, label: projectTitle(p), current: own === p && !line.ref.t });
      if (!list.length) items.push({ act: 'none', label: D.projects.length ? 'No project matches' : 'No projects yet: create them in Projects' });
    } else {
      const p = pick.project;
      $('#pickQ').placeholder = `Find a to-do of ${projectTitle(p)}`;
      const qq = q.trim().toLowerCase();
      const inherited = line.level ? lineProject(L, C.groupStart(L, i)) : null;
      items.push({ act: 'back', label: 'Another project' });
      if (own === p && line.ref.t) items.push({ act: 'project', id: p.id, label: `Just ${projectTitle(p)}, no to-do` });
      else if (inherited !== p) items.push({ act: 'project', id: p.id, label: `Just ${projectTitle(p)}`, current: own === p });
      const todos = p.todos.filter(t => t.text.trim() && !t.done && (!qq || t.text.toLowerCase().includes(qq)));
      for (const t of todos) items.push({ act: 'todo', id: t.id, label: t.text, current: line.ref && line.ref.t === t.id });
      const text = (q.trim() || line.text).trim();
      if (text && !p.todos.some(t => t.text.trim().toLowerCase() === text.toLowerCase())) items.push({ act: 'new-todo', label: `Add “${text}” as a to-do` });
      if (line.ref) items.push({ act: 'unlink', label: 'Remove the link' });
      if (!todos.length && qq) items.push({ act: 'none', label: 'No open to-do matches' });
    }
    pick.items = items;
    pick.active = Math.max(0, items.findIndex(x => x.act === 'project' || x.act === 'todo' || x.act === 'new-todo'));
    $('#pickHead').textContent = pick.step === 'project' ? 'Link to a project' : `Link to a to-do of ${projectTitle(pick.project)}`;
    paintPicker();
  }
  function paintPicker() {
    $('#pickList').innerHTML = pick.items.map((x, k) =>
      x.act === 'none'
        ? `<p class="pick-empty">${esc(x.label)}</p>`
        : `<button type="button" role="option" class="pick-item${x.act === 'unlink' ? ' quiet' : ''}${x.current ? ' current' : ''}" data-k="${k}" aria-selected="${k === pick.active}">${esc(x.label)}${x.current ? '<span class="note">Linked</span>' : ''}</button>`
    ).join('');
  }
  function choosePick(k) {
    const x = pick.items[k];
    const hit = pickedLine();
    if (!x || !hit || x.act === 'none') return;
    const { L, i, line } = hit;
    const done = () => { changed(); closePicker(true); tasksOL.render(); goalsOL.refresh(); renderBudget(); };
    if (x.act === 'back') { pick.step = 'project'; $('#pickQ').value = ''; renderPicker(); placePicker(); $('#pickQ').focus(); return; }
    if (x.act === 'open') { const id = line.ref.p; closePicker(); setView('projects', { project: id }); return; }
    if (x.act === 'unlink') { delete line.ref; done(); return; }
    if (x.act === 'project') {
      const p = proj(x.id);
      if (pick.step === 'project' && canLinkTodo(L, i) && (p.todos.some(t => !t.done && t.text.trim()) || line.text.trim())) {
        pick.project = p; pick.step = 'todo'; $('#pickQ').value = ''; renderPicker(); placePicker(); $('#pickQ').focus();
        return;
      }
      const inherited = line.level ? lineProject(L, C.groupStart(L, i)) : null;
      if (inherited === p) delete line.ref; else line.ref = { p: p.id };
      done();
      return;
    }
    const p = pick.project;
    let todo;
    if (x.act === 'todo') todo = p.todos.find(t => t.id === x.id);
    else {
      todo = { id: uid(), text: ($('#pickQ').value.trim() || line.text).trim(), level: 0, done: line.done };
      p.todos.splice(C.firstDoneGroup(p.todos), 0, todo);
    }
    if (!todo) return;
    line.ref = { p: p.id, t: todo.id };
    if (!line.text.trim()) line.text = todo.text;
    todo.planned = ui.date;
    if (todo.done && !line.done) { const j = p.todos.indexOf(todo); C.toggle(p.todos, j, true); }
    done();
  }
  $('#pickQ').addEventListener('input', renderPicker);
  $('#pickQ').addEventListener('keydown', e => {
    const n = pick.items ? pick.items.length : 0;
    const move = d => {
      let k = pick.active;
      for (let s = 0; s < n; s++) { k = (k + d + n) % n; if (pick.items[k].act !== 'none') break; }
      pick.active = k;
      paintPicker();
      const el = $(`#pickList [data-k="${k}"]`);
      if (el) el.scrollIntoView({ block: 'nearest' });
    };
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); choosePick(pick.active); }
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (pick.step === 'todo' && $('#pickQ').value) { $('#pickQ').value = ''; renderPicker(); }
      else closePicker(true);
    }
  });
  $('#pickList').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) choosePick(Number(b.dataset.k)); });
  document.addEventListener('mousedown', e => { if (!$('#picker').hidden && !e.target.closest('#picker, [data-act="link-line"]')) closePicker(); });
  window.addEventListener('resize', () => { if (!$('#picker').hidden) placePicker(); });
  document.addEventListener('scroll', () => { if (!$('#picker').hidden) placePicker(); }, true);

  /* ---------- project list ---------- */
  function renderProjects() {
    const p = proj(ui.project);
    if (!p) ui.project = null;
    $('#projList').hidden = !!p;
    $('#projSheet').hidden = !p;
    if (p) renderSheet(p); else renderProjectList();
  }
  function projectRow(p) {
    const t = today();
    const due = C.dueLabel(p.fields.deadline, t);
    const n = openTodos(p);
    const who = C.firstLine(p.fields.spoc);
    const next = C.nextPhase(p);
    const nextDue = next && C.dueLabel(next.date, t);
    const sel = ui.selecting;
    const on = ui.sel.has(p.id);
    const meta = [who && esc(who), next && !p.archived && `Next: ${esc(next.text)}${nextDue ? `, ${esc(nextDue.text.replace(/^Due /, '').replace(/^today$/, 'today'))}` : ''}`].filter(Boolean);
    const grip = !sel && !p.archived && !readOnly
      ? `<button type="button" class="grip" data-grip aria-label="Move ${esc(projectTitle(p))}" title="Drag to reorder, or use the arrow keys"></button>`
      : '<span class="grip-space"></span>';
    return `<div class="srow" data-sort-id="${esc(p.id)}" data-sort-kind="project">${grip}` +
      `<button type="button" class="prow${on ? ' picked' : ''}" data-act="${sel ? 'select-project' : 'open-project'}" data-pid="${esc(p.id)}"${sel ? ` role="checkbox" aria-checked="${on}"` : ''}>` +
      (sel ? `<span class="chk" aria-hidden="true"${on ? ' aria-pressed="true"' : ''}></span>` : '') +
      `<span class="pnum">${p.num}</span>` +
      `<span class="pmain"><span class="pname">${esc(p.name.trim() || 'Untitled project')}</span>` +
      meta.map(m => `<span class="pmeta">${m}</span>`).join('') + '</span>' +
      `<span class="pside">${n ? `<span class="note">${n} to ${n === 1 ? 'do' : 'dos'}</span>` : ''}${p.archived ? '' : dueHtml(due)}</span></button></div>`;
  }
  function renderProjectList() {
    const active = D.projects.filter(p => !p.archived);
    const archived = D.projects.filter(p => p.archived);
    for (const id of [...ui.sel]) if (!proj(id)) ui.sel.delete(id);
    const n = ui.sel.size;
    $('#projHead').innerHTML = ui.selecting
      ? `<h1>${n ? `${n} selected` : 'Select projects'}</h1>` +
        `<button type="button" class="link" data-act="select-all">${n === D.projects.length && n ? 'Select none' : 'Select all'}</button>` +
        `<button type="button" class="btn ghost" data-act="batch-duplicate"${n ? '' : ' disabled'}>Duplicate</button>` +
        `<button type="button" class="btn ghost" data-act="batch-export"${n ? '' : ' disabled'}>Export</button>` +
        `<button type="button" class="btn ghost" data-act="batch-archive"${n ? '' : ' disabled'}>${n && [...ui.sel].every(id => proj(id).archived) ? 'Restore' : 'Archive'}</button>` +
        `<button type="button" class="btn ghost danger" data-act="batch-delete"${n ? '' : ' disabled'}>Delete</button>` +
        '<button type="button" class="btn" data-act="select-done">Done</button>'
      : '<h1>Projects</h1>' +
        (D.projects.length ? `<button type="button" class="btn ghost" data-act="select-start"${readOnly ? ' disabled' : ''}>Select</button>` : '') +
        `<button type="button" class="btn ghost" data-act="md-open"${readOnly ? ' disabled' : ''} title="Import project notes saved as Markdown, for example from Notes">Import</button>` +
        `<button type="button" class="btn" data-act="project-new"${readOnly ? ' disabled' : ''}>New project</button>`;
    let h = active.length
      ? `<div class="plist" id="projOrder">${active.map(projectRow).join('')}</div>` +
        (active.length > 1 && !ui.selecting && !readOnly ? '<p class="hint list-hint">Drag a project by the dots to change its place. Its number follows its place in the list.</p>' : '')
      : `<p class="empty">${archived.length ? 'All your projects are archived.' : 'Keep each project’s contacts, links, schedule, notes, to-dos and website copy in one place. Create one with New project, or bring your project notes over from Notes with Import.'}</p>`;
    if (archived.length) h += `<details class="archived"${ui.selecting || ui.showArchived ? ' open' : ''}><summary>Archived (${archived.length})</summary><div class="plist">${archived.map(projectRow).join('')}</div></details>`;
    $('#projItems').innerHTML = h;
  }
  $('#projItems').addEventListener('toggle', e => { if (e.target.matches('details.archived')) ui.showArchived = e.target.open; }, true);
  sortable($('#projItems'), {
    accept: (a, t) => t.dataset.sortKind === 'project' && !!t.closest('#projOrder'),
    drop: (a, t, where) => { moveProject(a.dataset.sortId, t.dataset.sortId, where === 'after'); refocusGrip($('#projItems'), a.dataset.sortId); },
    step: (el, dir) => {
      const open = activeProjects();
      const i = open.findIndex(p => p.id === el.dataset.sortId);
      const to = open[i + dir];
      if (!to) return;
      moveProject(el.dataset.sortId, to.id, dir > 0);
      refocusGrip($('#projItems'), el.dataset.sortId);
    }
  });

  function newProject(base) {
    const p = base || {
      id: uid(), num: C.nextNumber(D.projects), name: '', archived: false, lang: D.settings.me.lang,
      fields: {}, schedule: C.scheduleFrom(D.settings.defaultSchedule, uid), todos: [], copy: normalizeCopy(null)
    };
    if (!p.copy) p.copy = normalizeCopy(null);
    const firstArchived = D.projects.findIndex(x => x.archived);
    D.projects.splice(firstArchived < 0 ? D.projects.length : firstArchived, 0, p);
    C.renumberProjects(D.projects);
    return p;
  }
  function deleteProjects(ids) {
    D.projects = D.projects.filter(p => !ids.includes(p.id));
    C.renumberProjects(D.projects);
    for (const id of ids) ui.sel.delete(id);
    for (const k of Object.keys(D.drafts)) if (ids.some(id => k.endsWith(`|${id}`))) delete D.drafts[k];
  }
  // Moves a project before or after another, or one place up or down; numbers follow.
  function moveProject(id, toId, after) {
    if (readOnly || !C.moveById(D.projects, id, toId, after)) return;
    C.renumberProjects(D.projects);
    changed();
    renderProjectList();
  }

  /* ---------- project sheet ---------- */
  function renderSheetSub() {
    const p = proj(ui.project);
    if (!p) return;
    const t = today();
    const due = C.dueLabel(p.fields.deadline, t);
    const next = C.nextPhase(p);
    const bits = [];
    if (p.archived) bits.push('<span class="note">Archived</span>');
    bits.push(due ? dueHtml(due) : '<span class="note">No deadline</span>');
    if (next) bits.push(`<span class="note">Next: ${esc(next.text)}${next.date ? `, ${esc(C.fmtShort(next.date))}` : ''}</span>`);
    $('#pSub').innerHTML = bits.join('');
    const n = openTodos(p);
    $('#pTodoCount').textContent = n ? `${n} open` : '';
    const sched = (p.schedule || []).filter(x => x.text.trim());
    const doneN = sched.filter(x => x.done).length;
    $('#pSchedCount').textContent = sched.length ? `${doneN} of ${sched.length} done` : '';
  }
  // A date that can be left empty: "No deadline" until one is chosen, with a way to remove it again.
  function dateField(key, value, emptyLabel, label) {
    const ro = readOnly ? ' disabled' : '';
    if (value || ui.dateEdit === key) {
      return `<input type="date" data-date="${esc(key)}" value="${esc(value || '')}" aria-label="${esc(label)}"${readOnly ? ' readonly' : ''}>` +
        (value ? `<button type="button" class="link clear-date" data-act="clear-date" data-key="${esc(key)}" title="Remove the date"${ro}>Remove</button>` : '');
    }
    return `<button type="button" class="link set-date" data-act="set-date" data-key="${esc(key)}"${ro}>${esc(emptyLabel)}</button>`;
  }
  function renderSheet(p) {
    const name = $('#pName');
    if (document.activeElement !== name) name.value = p.name;
    name.readOnly = !!readOnly;
    const num = $('#pNum');
    if (document.activeElement !== num) num.value = p.num;
    num.readOnly = !!readOnly || p.archived;
    num.title = p.archived ? 'Archived projects keep their last number' : 'Place in the project list: type another number to move it there';
    $('#archBtn').textContent = p.archived ? 'Restore' : 'Archive';
    for (const b of document.querySelectorAll('#projSheet .crumbs .link')) b.disabled = !!readOnly && b.dataset.act !== 'project-mail';
    const tab = ui.sheetTab;
    for (const t of ['project', 'copy']) $('#st-' + t).setAttribute('aria-selected', String(tab === t));
    $('#sheetProject').hidden = tab !== 'project';
    $('#sheetCopy').hidden = tab !== 'copy';
    if (tab === 'copy') { renderSheetSub(); renderCopy(p); return; }
    projTodosOL.render();
    renderSchedule(p);
    $('#pFields').innerHTML = C.PROJECT_FIELDS.map(f => {
      const v = p.fields[f.key] || '';
      const id = `pf-${f.key}`;
      const common = `id="${id}" data-pfield="${f.key}" ${INPUT_ATTRS}${readOnly ? ' readonly' : ''}`;
      let ctl;
      if (f.type === 'date') ctl = dateField('deadline', v, 'No deadline. Set one', f.label);
      else if (f.long) ctl = `<textarea ${common} rows="1" placeholder="${esc(f.hint || `Add ${f.label.toLowerCase()}`)}">${esc(v)}</textarea>`;
      else ctl = `<input ${common} value="${esc(v)}" placeholder="${esc(f.hint || '')}">`;
      const extra = f.long || f.type === 'date' ? '' :
        `<button type="button" class="link open" data-act="open-link" data-key="${f.key}"${C.linkOf(v) ? '' : ' hidden'}>Open</button>`;
      return `<div class="pf${f.long ? ' long' : ''}"><label for="${id}">${esc(f.label)}</label><div class="pv">${ctl}${extra}</div></div>`;
    }).join('') +
      `<div class="pf"><label for="pf-lang">Email language</label><div class="pv"><select id="pf-lang" data-plang${readOnly ? ' disabled' : ''}>` +
      C.LANGS.map(l => `<option value="${l}"${p.lang === l ? ' selected' : ''}>${esc(C.langName(l))}</option>`).join('') + '</select></div></div>';
    for (const ta of document.querySelectorAll('#pFields textarea')) grow(ta);
    renderSheetSub();
    focusDateEdit();
  }
  function renderSchedule(p) {
    const ro = readOnly ? ' disabled' : '';
    $('#pSchedule').innerHTML = (p.schedule || []).map((x, k) =>
      `<div class="phase${x.done ? ' done' : ''}" data-phase="${esc(x.id)}">` +
      `<span class="pstep">${k + 1}</span>` +
      `<button type="button" class="chk" data-act="phase-toggle" aria-pressed="${x.done}" aria-label="${x.done ? 'Mark not done' : 'Mark done'}"${ro}></button>` +
      `<input class="txt" data-phase-text value="${esc(x.text)}" aria-label="Phase ${k + 1}" placeholder="Phase name" ${INPUT_ATTRS}${readOnly ? ' readonly' : ''}>` +
      `<span class="pdate">${dateField(`phase:${x.id}`, x.date, 'No date', `Date for phase ${k + 1}`)}</span>` +
      `<button type="button" class="link remove" data-act="phase-remove" title="Remove this phase"${ro}>Remove</button></div>`
    ).join('') + (readOnly ? '' : '<button type="button" class="link add-phase" data-act="phase-add">Add a phase</button>');
  }
  function focusDateEdit() {
    if (!ui.dateEdit) return;
    const el = $(`#projSheet input[data-date="${CSS.escape(ui.dateEdit)}"]`);
    if (!el) return;
    el.focus();
    try { el.showPicker(); } catch {}
  }
  function setDate(p, key, value) {
    if (key === 'deadline') { if (value) p.fields.deadline = value; else delete p.fields.deadline; }
    else {
      const x = p.schedule.find(y => `phase:${y.id}` === key);
      if (x) x.date = value || '';
    }
    changed();
  }
  function grow(ta) { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; }

  $('#view-projects').addEventListener('input', e => {
    const p = proj(ui.project);
    if (!p || readOnly) return;
    const el = e.target;
    if (el.id === 'pName') { p.name = el.value; changed(); return; }
    if (el.id === 'pNum') return;
    if (el.hasAttribute('data-phase-text')) {
      const x = p.schedule.find(y => y.id === el.closest('.phase').dataset.phase);
      if (x) { x.text = el.value; changed(); renderSheetSub(); }
      return;
    }
    if (el.dataset.date) { if (el.value) { setDate(p, el.dataset.date, el.value); renderSheetSub(); } return; }
    const k = el.dataset.pfield;
    if (!k) return;
    if (el.value) p.fields[k] = el.value; else delete p.fields[k];
    changed();
    if (el.tagName === 'TEXTAREA') grow(el);
    const open = el.parentElement.querySelector('.open');
    if (open) open.hidden = !C.linkOf(el.value);
  });
  // The number on a sheet is its place in the list: type another one to move the project there.
  $('#pNum').addEventListener('change', e => {
    const p = proj(ui.project);
    if (!p || readOnly) return;
    const n = parseInt(e.target.value, 10);
    if (p.archived || !(n > 0)) { e.target.value = p.num; return; }
    C.moveProjectTo(D.projects, p.id, n);
    e.target.value = p.num;
    changed();
    toast(`Now #${p.num} in the list`);
  });
  $('#pNum').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
  $('#pFields').addEventListener('change', e => {
    const p = proj(ui.project);
    if (!p || readOnly || !e.target.hasAttribute('data-plang')) return;
    p.lang = okLang(e.target.value);
    changed();
  });
  $('#view-projects').addEventListener('focusout', e => {
    const el = e.target;
    const p = proj(ui.project);
    if (el.id === 'pNum' && p) { el.value = p.num; return; }
    if (!el.dataset || !el.dataset.date || !p) return;
    // Leaving an empty date puts the "No date" button back.
    setTimeout(() => {
      if (document.activeElement && document.activeElement.closest('.pv, .pdate') === el.closest('.pv, .pdate')) return;
      if (ui.dateEdit === el.dataset.date) { ui.dateEdit = null; if (!el.value) renderSheet(p); }
    }, 150);
  });
  $('#view-projects').addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.hasAttribute('data-phase-text') || e.isComposing) return;
    e.preventDefault();
    const p = proj(ui.project);
    if (!p || readOnly) return;
    const k = p.schedule.findIndex(y => y.id === e.target.closest('.phase').dataset.phase);
    const x = { id: uid(), text: '', date: '', done: false };
    p.schedule.splice(k + 1, 0, x);
    changed();
    renderSchedule(p);
    $(`.phase[data-phase="${x.id}"] input`).focus();
  });

  function renderWeekDeadlines() {
    const el = $('#weekDeadlines');
    const mon = week(), sun = C.addDays(mon, 6);
    const items = [];
    for (const p of D.projects) {
      if (p.archived) continue;
      if (p.fields.deadline >= mon && p.fields.deadline <= sun) items.push({ p, date: p.fields.deadline, what: 'deadline' });
      for (const x of p.schedule || []) if (!x.done && x.text.trim() && x.date >= mon && x.date <= sun) items.push({ p, date: x.date, what: x.text.trim() });
    }
    items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    el.hidden = !items.length;
    el.innerHTML = items.length ? '<span>This week:</span>' + items.map(x =>
      `<button type="button" class="link" data-act="open-project" data-pid="${esc(x.p.id)}">${esc(x.p.name.trim() || `#${x.p.num}`)} ${esc(x.what)}, ${esc(C.fmtShort(x.date))}</button>`).join('') : '';
  }

  /* ---------- projects as Markdown files ---------- */
  async function exportProjects(list) {
    if (!list.length) return;
    try {
      const where = list.length === 1
        ? await Backend.saveText(C.fileNameFor(list[0]), C.projectToMarkdown(list[0]))
        : await Backend.saveTexts(list.map(p => ({ name: C.fileNameFor(p), content: C.projectToMarkdown(p) })));
      if (where) toast(list.length === 1 ? `Exported to ${where}` : `Exported ${list.length} projects to ${where}`);
    } catch (e) { toast(`Couldn’t export: ${e}`); }
  }

  const mdImport = { files: [], parsed: [] };
  function openMdImport() {
    if (readOnly) return;
    mdImport.files = [];
    $('#miText').value = '';
    $('#miFiles').textContent = '';
    renderMdPreview();
    $('#mdImport').showModal();
  }
  function matchFor(x) {
    return D.projects.find(p => x.name && nameEq(p.name, x.name)) || (x.num ? D.projects.find(p => p.num === x.num && !x.name) : null) || null;
  }
  function renderMdPreview() {
    const sources = mdImport.files.slice();
    const pasted = $('#miText').value.trim();
    if (pasted) sources.push({ name: 'Pasted note', text: pasted });
    mdImport.parsed = sources.map(src => {
      const x = C.parseProjectMarkdown(src.text, uid);
      if (!x.name) x.name = src.name.replace(/\.(md|markdown|txt)$/i, '').replace(/^#?\d+\s+/, '').trim();
      return x;
    }).filter(x => x.name || Object.keys(x.fields).length || x.todos.length);
    const rows = mdImport.parsed.map(x => {
      const m = matchFor(x);
      const bits = [x.todos.length && `${x.todos.length} to-do${x.todos.length === 1 ? '' : 's'}`,
        x.schedule && x.schedule.length && `${x.schedule.length} phase${x.schedule.length === 1 ? '' : 's'}`,
        Object.keys(x.fields).length && `${Object.keys(x.fields).length} detail${Object.keys(x.fields).length === 1 ? '' : 's'}`].filter(Boolean);
      return `<li><b>${esc(x.num ? `#${x.num} ` : '')}${esc(x.name || 'Untitled project')}</b> <span class="note">${esc(bits.join(', ') || 'nothing recognised yet')}${m ? `; matches ${esc(projectTitle(m))}` : ''}</span></li>`;
    });
    const matches = mdImport.parsed.filter(matchFor).length;
    $('#miPreview').innerHTML = rows.length
      ? `<ul class="mi-list">${rows.join('')}</ul>` + (matches ? `<fieldset class="mi-mode"><legend>${matches === 1 ? 'One of these is' : `${matches} of these are`} already in your projects</legend>` +
        '<label><input type="radio" name="miMode" value="update" checked> Update them: add what the note has, keep everything else</label>' +
        '<label><input type="radio" name="miMode" value="new"> Add them as new projects</label></fieldset>' : '')
      : '';
    $('#miGo').disabled = !rows.length;
    $('#miGo').textContent = rows.length > 1 ? `Import ${rows.length} projects` : 'Import';
  }
  function mergeProject(p, x) {
    for (const [k, v] of Object.entries(x.fields)) {
      if (k === 'notes' && p.fields.notes && !p.fields.notes.includes(v)) p.fields.notes = `${p.fields.notes}\n\n${v}`;
      else p.fields[k] = v;
    }
    for (const t of x.todos) {
      const have = p.todos.find(y => y.text.trim().toLowerCase() === t.text.trim().toLowerCase());
      if (have) { if (t.done && !have.done) have.done = true; } else p.todos.push(t);
    }
    for (const ph of x.schedule || []) {
      const have = p.schedule.find(y => y.text.trim().toLowerCase() === ph.text.trim().toLowerCase());
      if (have) { if (ph.date) have.date = ph.date; if (ph.done) have.done = true; } else p.schedule.push(ph);
    }
  }
  function importParsed() {
    const mode = ($('input[name="miMode"]:checked') || {}).value || 'new';
    let added = 0, updated = 0;
    const touched = [];
    for (const x of mdImport.parsed) {
      const m = mode === 'update' ? matchFor(x) : null;
      if (m) { mergeProject(m, x); updated++; touched.push(m); continue; }
      const p = newProject({
        id: uid(), num: 0, name: x.name, archived: false,
        lang: (C.parseLanguages(x.fields.languages || '').find(l => C.LANGS.includes(l))) || D.settings.me.lang,
        fields: x.fields, schedule: x.schedule || C.scheduleFrom(D.settings.defaultSchedule, uid),
        todos: C.normalize(x.todos, 1), copy: normalizeCopy(null)
      });
      touched.push(p);
      added++;
    }
    changed();
    $('#mdImport').close();
    if (touched.length === 1) setView('projects', { project: touched[0].id }); else render();
    toast([added && `Added ${added} ${added === 1 ? 'project' : 'projects'}`, updated && `updated ${updated}`].filter(Boolean).join(', ').replace(/^u/, 'U'));
  }
  $('#miText').addEventListener('input', renderMdPreview);
  $('#mdFiles').addEventListener('change', async e => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    for (const f of files) {
      if (f.size > 2e6) { toast(`${f.name} is too large to be a note`); continue; }
      mdImport.files.push({ name: f.name, text: await f.text() });
    }
    $('#miFiles').textContent = mdImport.files.length ? mdImport.files.map(f => f.name).join(', ') : '';
    renderMdPreview();
  });

  /* ---------- website copy ---------- */
  const copyLangs = p => {
    const langs = C.parseLanguages(p.fields.languages || '');
    for (const pg of p.copy.pages) for (const b of pg.blocks) for (const [l, v] of Object.entries(b.text)) if (v.trim() && !langs.includes(l)) langs.push(l);
    return langs.length ? langs : [p.lang];
  };
  function copyLang(p) {
    const langs = copyLangs(p);
    if (!langs.includes(ui.copyLang)) ui.copyLang = langs[0];
    return ui.copyLang;
  }
  const pageWritten = (pg, l) => pg.blocks.filter(b => (b.text[l] || '').trim()).length;
  const pageById = (p, id) => p.copy.pages.find(x => x.id === id) || null;
  function counter(b, l) {
    const n = (b.text[l] || '').trim().length;
    const k = C.kindOf(b.kind);
    if (k.limit) return `<span class="count${n > k.limit ? ' over' : ''}">${n}/${k.limit}</span>`;
    return n ? `<span class="count">${n}</span>` : '';
  }
  function renderCopy(p) {
    const box = $('#sheetCopy');
    const langs = copyLangs(p), lang = copyLang(p);
    const ro = readOnly ? ' readonly' : '';
    const dis = readOnly ? ' disabled' : '';
    const fromField = C.parseLanguages(p.fields.languages || '').length > 0;
    const b = p.copy.brief;
    const sitemapNew = C.sitemapPages(p.fields.sitemap).filter(n => !p.copy.pages.some(pg => pg.name.trim().toLowerCase() === n.toLowerCase()));
    let h = '<div class="copy-top">' +
      (langs.length > 1 ? `<div class="seg" role="group" aria-label="Language">${langs.map(l => `<button type="button" data-act="copy-lang" data-lang="${l}" aria-pressed="${l === lang}" title="${esc(C.langName(l))}">${l.toUpperCase()}</button>`).join('')}</div>` : `<span class="note">Writing in ${esc(C.langName(lang))}</span>`) +
      '<span class="grow"></span>' +
      (p.copy.pages.length ? `<button type="button" class="link" data-act="copy-export" data-scope="lang">Export ${lang.toUpperCase()}</button>` +
        (langs.length > 1 ? '<button type="button" class="link" data-act="copy-export" data-scope="all">Export all languages</button>' : '') : '') +
      '</div>' +
      `<p class="hint">${fromField ? 'Languages come from Languages involved, in Details.' : 'To write in several languages, list them under Languages involved, in Details, for example ES, EN, FR.'}</p>`;
    h += `<details class="brief"${ui.briefOpen || !Object.keys(b).length ? ' open' : ''}><summary>Brief <span class="note">${Object.keys(b).length ? `${Object.keys(b).length} of ${C.BRIEF_FIELDS.length} filled` : 'used for every draft'}</span></summary>` +
      ((p.fields.goal || '').trim() ? `<div class="ef"><span>Goal, from Details</span><p class="ro">${esc(p.fields.goal.trim())}</p></div>` : '') +
      C.BRIEF_FIELDS.map(f => `<label class="ef">${esc(f.label)}<textarea data-brief="${f.key}" rows="1" placeholder="${esc(f.hint)}" ${PROSE_ATTRS}${ro}>${esc(b[f.key] || '')}</textarea></label>`).join('') +
      '</details>';
    if (!p.copy.pages.length) {
      h += `<div class="empty"><p>Write the copy for each page of the site here: headlines, body text, calls to action, and SEO titles and descriptions with their character limits. Draft or translate a page with ${esc(assistantName())}, paste the answer back, and export the copy as Markdown for the designer or the client.</p>` +
        `<div class="actions">${sitemapNew.length ? `<button type="button" class="btn" data-act="pages-from-sitemap"${dis}>Add ${sitemapNew.length} ${sitemapNew.length === 1 ? 'page' : 'pages'} from the sitemap</button>` : ''}` +
        `<button type="button" class="btn ${sitemapNew.length ? 'ghost' : ''}" data-act="page-add"${dis}>Add a page</button></div></div>`;
      box.innerHTML = h;
      growAll(box);
      return;
    }
    h += p.copy.pages.map((pg, k) => {
      const open = ui.openPages.has(pg.id);
      const n = pageWritten(pg, lang);
      const other = langs.find(l => l !== lang && pageWritten(pg, l));
      const head = `<div class="page-head"><button type="button" class="page-toggle" data-act="page-toggle" aria-expanded="${open}">` +
        `<span class="caret" aria-hidden="true"></span><span class="page-title">${esc(pg.name.trim() || 'Untitled page')}</span></button>` +
        `<span class="note">${n} of ${pg.blocks.length} written</span></div>`;
      if (!open) return `<section class="page" data-page="${esc(pg.id)}">${head}</section>`;
      const blocks = pg.blocks.map(bk => `<div class="blk" data-block="${esc(bk.id)}">` +
        `<div class="blk-head"><input class="blk-label" data-blk-label value="${esc(bk.label)}" aria-label="Block name" ${INPUT_ATTRS}${ro}>` +
        `<select data-blk-kind aria-label="Kind of text"${dis}>${C.COPY_KINDS.map(x => `<option value="${x.key}"${x.key === bk.kind ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select>` +
        `<span class="grow"></span>${counter(bk, lang)}<button type="button" class="link remove" data-act="block-remove"${dis}>Remove</button></div>` +
        `<textarea data-blk-text rows="1" lang="${lang}" placeholder="${esc(C.kindOf(bk.kind).hint || '')}" ${PROSE_ATTRS}${ro}>${esc(bk.text[lang] || '')}</textarea></div>`).join('');
      return `<section class="page open" data-page="${esc(pg.id)}">${head}` +
        `<label class="ef">Page name<input data-page-name value="${esc(pg.name)}" ${INPUT_ATTRS}${ro}></label>` +
        `<div class="actions page-actions">` +
        (other && !n ? `<button type="button" class="btn" data-act="copy-draft" data-from="${other}"${dis}>Translate from ${other.toUpperCase()} with ${esc(assistantName())}</button>` :
          `<button type="button" class="btn" data-act="copy-draft"${dis}>${n ? 'Improve' : 'Draft'} with ${esc(assistantName())}</button>`) +
        `<button type="button" class="btn ghost" data-act="copy-paste"${dis}>Paste the answer</button>` +
        `<button type="button" class="btn ghost" data-act="copy-page-text"${n ? '' : ' disabled'}>Copy page</button>` +
        `<span class="grow"></span><button type="button" class="link danger" data-act="page-remove"${dis}>Remove page</button></div>` +
        `<div class="blocks">${blocks}</div>` +
        `<button type="button" class="link add-phase" data-act="block-add"${dis}>Add a block</button></section>`;
    }).join('');
    h += `<div class="actions">${sitemapNew.length ? `<button type="button" class="btn ghost" data-act="pages-from-sitemap"${dis}>Add ${sitemapNew.length} ${sitemapNew.length === 1 ? 'page' : 'pages'} from the sitemap</button>` : ''}` +
      `<button type="button" class="btn ghost" data-act="page-add"${dis}>Add a page</button></div>`;
    box.innerHTML = h;
    growAll(box);
  }
  const growAll = el => { for (const ta of el.querySelectorAll('textarea')) grow(ta); };
  const copyCtx = el => {
    const p = proj(ui.project);
    const pg = p && el.closest('[data-page]') && pageById(p, el.closest('[data-page]').dataset.page);
    const bk = pg && el.closest('[data-block]') && pg.blocks.find(x => x.id === el.closest('[data-block]').dataset.block);
    return { p, pg, bk };
  };
  $('#sheetCopy').addEventListener('input', e => {
    const el = e.target;
    const { p, pg, bk } = copyCtx(el);
    if (!p || readOnly) return;
    if (el.tagName === 'TEXTAREA') grow(el);
    if (el.dataset.brief) { if (el.value) p.copy.brief[el.dataset.brief] = el.value; else delete p.copy.brief[el.dataset.brief]; }
    else if (el.hasAttribute('data-page-name') && pg) { pg.name = el.value; el.closest('.page').querySelector('.page-title').textContent = el.value.trim() || 'Untitled page'; }
    else if (el.hasAttribute('data-blk-label') && bk) bk.label = el.value;
    else if (el.hasAttribute('data-blk-text') && bk) {
      const l = copyLang(p);
      if (el.value) bk.text[l] = el.value; else delete bk.text[l];
      const head = el.closest('.blk').querySelector('.blk-head');
      const old = head.querySelector('.count');
      const html = counter(bk, l);
      if (old) old.outerHTML = html || '<span hidden></span>'; else if (html) head.querySelector('.remove').insertAdjacentHTML('beforebegin', html);
      el.closest('.page').querySelector('.page-head .note').textContent = `${pageWritten(pg, l)} of ${pg.blocks.length} written`;
    } else return;
    changed();
  });
  $('#sheetCopy').addEventListener('change', e => {
    if (!e.target.hasAttribute('data-blk-kind')) return;
    const { p, bk } = copyCtx(e.target);
    if (!bk || readOnly) return;
    const before = C.kindOf(bk.kind).label;
    bk.kind = C.kindOf(e.target.value).key;
    if (!bk.label.trim() || bk.label === before) bk.label = C.kindOf(bk.kind).label;
    changed();
    renderCopy(p);
  });
  $('#sheetCopy').addEventListener('toggle', e => { if (e.target.matches('details.brief')) ui.briefOpen = e.target.open; }, true);

  const paste = { page: null, lang: null };
  function openPaste(p, pg) {
    paste.page = pg.id;
    paste.lang = copyLang(p);
    $('#pd-title').textContent = `Paste the answer for ${pg.name.trim() || 'this page'}`;
    $('#pdHint').textContent = `Copy ${assistantName()}’s whole answer and paste it here. Each part under a [label] fills the block with that name, in ${C.langName(paste.lang)}; new labels become new blocks.`;
    $('#pdText').value = '';
    $('#pdPreview').textContent = '';
    $('#pdGo').disabled = true;
    $('#pasteDlg').showModal();
    $('#pdText').focus();
  }
  $('#pdText').addEventListener('input', () => {
    const parts = C.parseCopyAnswer($('#pdText').value);
    $('#pdGo').disabled = !parts.length;
    $('#pdPreview').textContent = parts.length ? `Found ${parts.length} ${parts.length === 1 ? 'part' : 'parts'}: ${parts.map(x => x.label).join(', ')}.` : ($('#pdText').value.trim() ? 'No [labels] found. Ask for the answer in the labelled format, or paste each part by hand.' : '');
  });

  /* ---------- mail ---------- */
  const tplById = id => D.templates.find(t => t.id === id) || null;
  const catById = id => D.templateCats.find(c => c.id === id) || null;
  const sameStarter = x => D.templates.find(t => t.name.trim().toLowerCase() === x.name.toLowerCase());
  const tplLangs = t => C.LANGS.filter(l => t[l] && (t[l].subject.trim() || t[l].body.trim()));
  const LANG = C.LANG_NAMES;
  // What the list shows under a name: the first subject written, or else the first line of the email.
  function tplSummary(t) {
    const langs = tplLangs(t);
    const withSubject = langs.find(l => t[l].subject.trim());
    if (withSubject) return C.plainMail(t[withSubject].subject).trim();
    const line = langs.length ? C.firstLine(C.plainMail(t[langs[0]].body)) : '';
    return line ? `No subject yet: “${line.length > 60 ? `${line.slice(0, 60)}…` : line}”` : 'Nothing written yet';
  }

  /* drafts: what you fill in or change in an email, kept per template and project until you clear it */
  const draftKey = () => `${ui.mail.tpl}|${ui.mail.project || '-'}`;
  const EMPTY_DRAFT = { to: '', toTouched: false, fields: {}, text: {} };
  const draft = () => D.drafts[draftKey()] || EMPTY_DRAFT;
  function draftForWrite() {
    const k = draftKey();
    if (!D.drafts[k]) D.drafts[k] = { at: Date.now(), to: '', toTouched: false, fields: {}, text: {} };
    D.drafts[k].at = Date.now();
    return D.drafts[k];
  }
  const draftUsed = d => d && (d.toTouched || Object.keys(d.fields).length || Object.keys(d.text).length);
  function tidyDrafts() { for (const [k, d] of Object.entries(D.drafts)) if (!draftUsed(d)) delete D.drafts[k]; }

  function renderMail() {
    const t = tplById(ui.mail.tpl);
    if (!t) { ui.mail.tpl = null; ui.mail.editing = false; }
    $('#mailList').hidden = !!t;
    $('#mailCompose').hidden = !t;
    if (t) renderCompose(t); else renderTemplateList();
  }

  // Templates grouped by category, in the order you set by dragging. Uncategorised ones come first.
  function tplGroups() {
    const groups = [{ id: '', name: 'Uncategorised', fixed: true }].concat(D.templateCats);
    return groups.map(g => ({ ...g, cat: g.fixed ? null : g, items: D.templates.filter(t => (t.cat || '') === g.id) }));
  }
  function templateRow(t) {
    const langs = tplLangs(t);
    const grip = readOnly ? '<span class="grip-space"></span>' : `<button type="button" class="grip" data-grip aria-label="Move ${esc(t.name.trim() || 'this template')}" title="Drag to reorder or to another category, or use the arrow keys"></button>`;
    return `<div class="srow" data-sort-id="${esc(t.id)}" data-sort-kind="tpl">${grip}` +
      `<button type="button" class="prow" data-act="tpl-open" data-tid="${esc(t.id)}">` +
      `<span class="pmain"><span class="pname">${esc(t.name.trim() || 'Untitled template')}</span>` +
      `<span class="pmeta">${esc(tplSummary(t))}</span></span>` +
      `<span class="pside">${C.LANGS.map(l => `<span class="lang${langs.includes(l) ? '' : ' off'}" title="${langs.includes(l) ? '' : 'Not written in '}${LANG[l]}">${l.toUpperCase()}</span>`).join('')}</span></button></div>`;
  }
  function renderTemplateList() {
    $('[data-act="tpl-new"]').disabled = !!readOnly;
    $('[data-act="cat-new"]').disabled = !!readOnly;
    $('[data-act="cat-new"]').hidden = !D.templates.length && !D.templateCats.length;
    if (!D.templates.length && !D.templateCats.length) {
      $('#tplItems').innerHTML = '<div class="empty"><p>Save the emails you send again and again, in English, Spanish, French or Italian. Write the parts that change in {{double braces}}: project details such as {{first_name}} or {{deadline}} fill in from the project, and anything else becomes a blank to fill in.</p>' +
        `<div class="actions"><button type="button" class="btn" data-act="tpl-new"${readOnly ? ' disabled' : ''}>Browse suggestions</button></div></div>`;
      return;
    }
    const ro = readOnly ? ' disabled' : '';
    const groups = tplGroups();
    const flat = !D.templateCats.length;
    let h = '<div class="plist tpl-list">';
    for (const g of groups) {
      if (flat) { h += g.items.map(templateRow).join(''); continue; }
      if (g.fixed && !g.items.length) {
        h += `<div class="srow cat-zone fixed" data-sort-id="" data-sort-kind="cat"><span class="grip-space"></span><span class="cat-name quiet">Uncategorised</span><span class="note">Drag a template here to take it out of its category</span></div>`;
        continue;
      }
      const c = g.cat;
      const open = g.fixed || !c.collapsed;
      const name = !g.fixed && ui.renameCat === c.id
        ? `<input class="cat-rename" data-cat-rename value="${esc(c.name)}" aria-label="Category name" ${INPUT_ATTRS}>`
        : `<button type="button" class="cat-toggle" data-act="cat-toggle"${g.fixed ? ' disabled' : ''} aria-expanded="${open}">${g.fixed ? '' : '<span class="caret" aria-hidden="true"></span>'}<span class="cat-name">${esc(g.fixed ? 'Uncategorised' : (c.name.trim() || 'Untitled category'))}</span></button>`;
      const grip = g.fixed || readOnly ? '<span class="grip-space"></span>' : `<button type="button" class="grip" data-grip aria-label="Move the ${esc(c.name.trim() || 'untitled')} category" title="Drag to reorder categories"></button>`;
      h += `<div class="srow cat-head${g.fixed ? ' fixed' : ''}" data-sort-id="${esc(g.id)}" data-sort-kind="cat">${grip}${name}` +
        `<span class="note">${g.items.length || ''}</span>` +
        (g.fixed ? '' : `<span class="cat-actions"><button type="button" class="link" data-act="cat-rename"${ro}>Rename</button><button type="button" class="link danger" data-act="cat-delete"${ro}>Delete</button></span>`) + '</div>';
      if (!open) continue;
      h += g.items.length ? g.items.map(templateRow).join('')
        : `<div class="srow cat-zone" data-sort-id="${esc(g.id)}" data-sort-kind="zone"><span class="grip-space"></span><span class="note">Drag templates here</span></div>`;
    }
    h += '</div>';
    if (!readOnly && D.templates.length > 1) h += `<p class="hint list-hint">Drag a template by the dots to reorder it${flat ? '' : ' or move it to another category'}. ${flat ? 'With New category, you can group them.' : ''}</p>`;
    $('#tplItems').innerHTML = h;
    const input = $('#tplItems [data-cat-rename]');
    if (input) { input.focus(); input.select(); }
  }
  function moveTemplateTo(id, target, after) {
    if (readOnly || !C.moveTemplate(D.templates, id, target, after)) return;
    changed();
    renderTemplateList();
    refocusGrip($('#tplItems'), id);
  }
  // Arrow keys on a template's grip: one place up or down, crossing into the next category at the ends.
  function stepTemplate(id, dir) {
    const groups = tplGroups().filter(g => g.fixed || !g.cat.collapsed);
    const gi = groups.findIndex(g => g.items.some(t => t.id === id));
    if (gi < 0) return;
    const items = groups[gi].items, i = items.findIndex(t => t.id === id), next = items[i + dir];
    if (next) { moveTemplateTo(id, { tpl: next.id }, dir > 0); return; }
    const other = groups[gi + dir];
    if (!other || !D.templateCats.length) return;
    if (dir < 0 && other.items.length) moveTemplateTo(id, { tpl: other.items[other.items.length - 1].id }, true);
    else moveTemplateTo(id, { cat: other.id }, false);
  }
  sortable($('#tplItems'), {
    accept: (a, t) => (a.dataset.sortKind === 'cat' ? t.dataset.sortKind === 'cat' && t.dataset.sortId !== '' : true),
    into: (a, t) => a.dataset.sortKind === 'tpl' && t.dataset.sortKind !== 'tpl',
    drop: (a, t, where) => {
      if (a.dataset.sortKind === 'cat') {
        if (C.moveById(D.templateCats, a.dataset.sortId, t.dataset.sortId, where === 'after')) { changed(); renderTemplateList(); refocusGrip($('#tplItems'), a.dataset.sortId); }
        return;
      }
      if (t.dataset.sortKind === 'tpl') moveTemplateTo(a.dataset.sortId, { tpl: t.dataset.sortId }, where === 'after');
      else {
        const c = catById(t.dataset.sortId);
        moveTemplateTo(a.dataset.sortId, { cat: t.dataset.sortId }, false);
        if (c && c.collapsed) toast(`Moved to ${c.name.trim() || 'the category'}`);
      }
    },
    step: (el, dir) => {
      if (el.dataset.sortKind === 'tpl') { stepTemplate(el.dataset.sortId, dir); return; }
      const i = D.templateCats.findIndex(c => c.id === el.dataset.sortId), to = D.templateCats[i + dir];
      if (to && C.moveById(D.templateCats, el.dataset.sortId, to.id, dir > 0)) { changed(); renderTemplateList(); refocusGrip($('#tplItems'), el.dataset.sortId); }
    }
  });
  $('#tplItems').addEventListener('input', e => {
    if (!e.target.hasAttribute('data-cat-rename') || readOnly) return;
    const c = catById(ui.renameCat);
    if (c) { c.name = e.target.value; changed(); }
  });
  $('#tplItems').addEventListener('keydown', e => {
    if (!e.target.hasAttribute('data-cat-rename')) return;
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.target.blur(); }
  });
  $('#tplItems').addEventListener('focusout', e => {
    if (!e.target.hasAttribute('data-cat-rename')) return;
    const c = catById(ui.renameCat);
    if (c && !c.name.trim()) { c.name = 'Untitled category'; changed(); }
    ui.renameCat = null;
    setTimeout(renderTemplateList, 0);
  });

  /* the suggestion picker behind New template */
  const pickTpl = { key: 'blank', lang: 'en' };
  function openTemplatePicker() {
    if (readOnly) return;
    pickTpl.key = 'blank';
    pickTpl.lang = D.settings.me.lang;
    renderTemplatePicker();
    $('#tplPick').showModal();
    const first = $('#tpList [aria-selected="true"]');
    if (first) first.focus();
  }
  function starterState(x) {
    const t = sameStarter(x);
    if (!t) return 'new';
    return C.LANGS.every(l => tplLangs(t).includes(l)) ? 'have' : 'partial';
  }
  function renderTemplatePicker() {
    const item = (key, name, about, badge) => `<button type="button" role="option" class="tp-item" data-tp="${esc(key)}" aria-selected="${pickTpl.key === key}">` +
      `<span class="tp-name">${esc(name)}${badge ? `<span class="tp-badge">${esc(badge)}</span>` : ''}</span><span class="tp-about">${esc(about)}</span></button>`;
    let h = item('blank', 'Blank template', 'Start from an empty page and write it yourself.', '');
    for (const cat of C.TEMPLATE_CATEGORIES) {
      const list = C.STARTER_TEMPLATES.filter(x => x.cat === cat);
      h += `<p class="tp-cat">${esc(cat)}</p>` + list.map(x => {
        const st = starterState(x);
        return item(x.name, x.name, x.about, st === 'have' ? 'Added' : st === 'partial' ? 'Some languages missing' : '');
      }).join('');
    }
    $('#tpList').innerHTML = h;
    const x = C.STARTER_TEMPLATES.find(y => y.name === pickTpl.key);
    const go = $('#tpUse');
    if (!x) {
      $('#tpPreview').innerHTML = '<p class="hint">A blank template in Uncategorised. Write it in one language or several, with the parts that change in {{double braces}}.</p>';
      go.textContent = 'Create a blank template';
      return;
    }
    const lang = pickTpl.lang;
    const st = starterState(x);
    $('#tpPreview').innerHTML = `<div class="seg" role="group" aria-label="Language">${C.LANGS.map(l => `<button type="button" data-tp-lang="${l}" aria-pressed="${l === lang}">${l.toUpperCase()}</button>`).join('')}</div>` +
      `<p class="psubj">${richHtml(x[lang].subject, {}, true)}</p><div class="pbody">${richHtml(x[lang].body, {})}</div>`;
    go.textContent = st === 'have' ? 'Open my copy' : st === 'partial' ? 'Add the missing languages' : `Add to ${x.cat}`;
  }
  $('#tpList').addEventListener('click', e => {
    const b = e.target.closest('[data-tp]');
    if (!b) return;
    pickTpl.key = b.dataset.tp;
    renderTemplatePicker();
    $(`#tpList [data-tp="${CSS.escape(pickTpl.key)}"]`).focus();
  });
  $('#tpList').addEventListener('dblclick', e => { if (e.target.closest('[data-tp]')) useTemplatePick(); });
  $('#tpList').addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
    e.preventDefault();
    if (e.key === 'Enter') { useTemplatePick(); return; }
    const items = [...$('#tpList').querySelectorAll('[data-tp]')];
    const i = items.findIndex(b => b.dataset.tp === pickTpl.key);
    const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    pickTpl.key = next.dataset.tp;
    renderTemplatePicker();
    $(`#tpList [data-tp="${CSS.escape(pickTpl.key)}"]`).focus();
  });
  $('#tpPreview').addEventListener('click', e => {
    const b = e.target.closest('[data-tp-lang]');
    if (b) { pickTpl.lang = b.dataset.tpLang; renderTemplatePicker(); }
  });
  function categoryNamed(name) {
    let c = D.templateCats.find(x => x.name.trim().toLowerCase() === name.toLowerCase());
    if (!c) { c = { id: uid(), name }; D.templateCats.push(c); }
    return c;
  }
  function useTemplatePick() {
    if (readOnly) return;
    const x = C.STARTER_TEMPLATES.find(y => y.name === pickTpl.key);
    $('#tplPick').close();
    if (!x) {
      const t = { id: uid(), name: '', cat: '', ...Object.fromEntries(C.LANGS.map(l => [l, { subject: '', body: '' }])) };
      D.templates.unshift(t);
      changed();
      openTemplate(t.id);
      ui.mail.editing = true;
      ui.mail.lang = D.settings.me.lang;
      renderMail();
      $('[data-tpl="name"]').focus();
      return;
    }
    let t = sameStarter(x);
    if (t) {
      const missing = C.LANGS.filter(l => !tplLangs(t).includes(l));
      for (const l of missing) t[l] = { ...x[l] };
      if (missing.length) { changed(); toast(`Added ${missing.map(l => LANG[l]).join(', ')}`); }
    } else {
      const c = categoryNamed(x.cat);
      t = { id: uid(), name: x.name, cat: c.id, ...Object.fromEntries(C.LANGS.map(l => [l, { ...x[l] }])) };
      const first = D.templates.findIndex(y => y.cat === c.id);
      D.templates.splice(first < 0 ? D.templates.length : first, 0, t);
      c.collapsed = false;
      changed();
      toast(`Added to ${c.name}`);
    }
    ui.mail.lang = pickTpl.lang;
    openTemplate(t.id);
    ui.mail.lang = pickTpl.lang;
    renderMail();
  }

  function openTemplate(id, projectId) {
    const m = ui.mail;
    m.tpl = id; m.editing = false; m.lang = null;
    if (projectId !== undefined) m.project = projectId;
    if (m.project && !proj(m.project)) m.project = '';
    renderMail();
    window.scrollTo(0, 0);
  }
  function mailLang(t) {
    const m = ui.mail, langs = tplLangs(t), p = proj(m.project);
    if (m.lang && (langs.includes(m.lang) || m.editing)) return m.lang;
    const want = (p && p.lang) || D.settings.me.lang;
    m.lang = langs.includes(want) || !langs.length ? want : langs[0];
    return m.lang;
  }
  function mailValues(t) {
    const lang = mailLang(t);
    const v = C.autoValues(proj(ui.mail.project), D.settings.me, lang, today());
    for (const [k, x] of Object.entries(draft().fields)) if (x && x.trim()) v[k] = x;
    return v;
  }
  const langSeg = (lang, langs, editing) => `<div class="seg" role="group" aria-label="Language">${C.LANGS.map(l =>
    `<button type="button" data-act="mail-lang" data-lang="${l}" aria-pressed="${lang === l}"${!editing && !langs.includes(l) ? ` disabled title="Not written in ${LANG[l]} yet"` : ''}>${LANG[l]}</button>`).join('')}</div>`;

  // Text with placeholders and [links], as HTML: links underlined, blanks still to fill marked.
  function richHtml(s, values, plain) {
    const filled = parts => parts.map(x => (x.blank ? `<mark class="blank">${esc(C.humanize(x.blank))}</mark>` : esc(x.text))).join('');
    if (plain) return filled(C.fillParts(C.plainMail(s), values)) || '<span class="note">No subject</span>';
    return C.linkParts(s).map(x => {
      if (!x.link) return filled(C.fillParts(x.text, values));
      const url = C.fill(x.url, values);
      const ok = C.linkHref(url);
      const tip = ok ? ok.replace(/^mailto:/i, '') : C.placeholders(x.url).length ? `Fill in ${C.placeholders(x.url).map(C.humanize).join(', ')}` : 'Not a web or email address';
      return `<a class="mlink${ok ? '' : ' broken'}" title="${esc(tip)}">${filled(C.fillParts(x.label, values))}</a>`;
    }).join('');
  }
  const hasLinks = s => C.linkParts(s).some(x => x.link) || /https?:\/\//i.test(s);

  function renderCompose(t) {
    const m = ui.mail;
    const btn = $('#tplEditBtn');
    btn.textContent = m.editing ? 'Done editing' : 'Edit template';
    btn.disabled = !!readOnly;
    if (m.editing) { renderEditor(t); return; }
    const langs = tplLangs(t);
    const box = $('#composeBody');
    if (!langs.length) {
      box.innerHTML = `<h1 class="ctitle">${esc(t.name.trim() || 'Untitled template')}</h1><p class="empty">This template is empty. Choose Edit template to write it in English, Spanish, French or Italian.</p>`;
      return;
    }
    const lang = mailLang(t);
    const c = t[lang];
    const p = proj(m.project);
    const d = draft();
    const own = d.text[lang];
    const auto = C.autoValues(p, D.settings.me, lang, today());
    const names = C.placeholders(c.subject + '\n' + c.body);
    const blanks = names.filter(n => !auto[n]);
    const filled = names.filter(n => auto[n]);
    const to = d.toTouched ? d.to : auto.spoc_email || '';
    const projOptions = activeProjects().concat(p && p.archived ? [p] : [])
      .map(x => `<option value="${esc(x.id)}"${x.id === m.project ? ' selected' : ''}>${esc(projectTitle(x))}</option>`).join('');
    let h =
      `<h1 class="ctitle">${esc(t.name.trim() || 'Untitled template')}</h1>` +
      '<div class="cgrid">' +
      `<label class="ef">Project<select data-mail="project"><option value="">No project</option>${projOptions}</select></label>` +
      `<div class="ef"><span>Language</span>${langSeg(lang, langs, false)}</div>` +
      `<label class="ef wide">To<input data-mail="to" type="email" value="${esc(to)}" placeholder="name@company.com" ${INPUT_ATTRS}${readOnly ? ' readonly' : ''}></label>` +
      '</div>';
    if (own) {
      h += '<div class="own"><p class="hint">You’re changing this email directly, so the template and its blanks no longer apply to it. Your changes are kept until you clear them.</p>' +
        `<label class="ef wide">Subject<input data-mtext="subject" value="${esc(own.subject)}" lang="${lang}" ${PROSE_ATTRS}${readOnly ? ' readonly' : ''}></label>` +
        `<label class="ef wide">Email<textarea data-mtext="body" rows="10" lang="${lang}" ${PROSE_ATTRS}${readOnly ? ' readonly' : ''}>${esc(own.body)}</textarea></label>` +
        `<div class="chips"><button type="button" class="chip" data-act="link-open"${readOnly ? ' disabled' : ''} title="Add a link (${MOD}K)">Link…</button>` +
        '<span class="hint">Select some text first to turn it into a link.</span></div></div>';
    } else {
      if (blanks.length) h += `<div class="blanks"><h2>Fill in</h2>${blanks.map(n => {
        const v = esc(d.fields[n] || '');
        const ctl = C.isLongBlank(n)
          ? `<textarea data-mfield="${esc(n)}" rows="3" lang="${lang}" ${PROSE_ATTRS}${readOnly ? ' readonly' : ''}>${v}</textarea>`
          : `<input data-mfield="${esc(n)}" value="${v}" lang="${lang}" ${PROSE_ATTRS}${readOnly ? ' readonly' : ''}>`;
        return `<label class="ef${C.isLongBlank(n) ? ' wide' : ''}">${esc(C.humanize(n))}${ctl}</label>`;
      }).join('')}</div>`;
      if (filled.length) h += `<p class="hint">Filled in from ${p ? esc(p.name.trim() || 'the project') : 'your details'}: ${filled.map(n => esc(/^[A-Z]{2,}/.test(C.humanize(n)) ? C.humanize(n) : C.humanize(n).toLowerCase())).join(', ')}.</p>`;
      h += '<div class="preview" aria-live="polite"><p class="psubj" id="pvSubject"></p><div class="pbody" id="pvBody"></div></div>';
    }
    const raw = own ? own.body : c.body;
    h += '<div class="actions"><button type="button" class="btn" data-act="mail-copy" data-what="body">Copy email</button>' +
      '<button type="button" class="btn ghost" data-act="mail-copy" data-what="subject">Copy subject</button>' +
      '<button type="button" class="btn ghost" data-act="mail-open">Open in mail app</button>' +
      `<button type="button" class="btn ghost" data-act="mail-review" title="Opens ${esc(assistantName())} with a request to check the language">Review with ${esc(assistantName())}</button>` +
      '<span class="missing" id="mailMissing"></span></div>' +
      '<div class="draft-bar">' +
      (own ? `<button type="button" class="link" data-act="mail-unedit"${readOnly ? ' disabled' : ''}>Back to the template’s text</button>`
        : `<button type="button" class="link" data-act="mail-edittext"${readOnly ? ' disabled' : ''}>Change the text of this email</button>`) +
      `<span class="note" id="draftNote"></span>` +
      `<button type="button" class="link" data-act="mail-clear" id="draftClear"${readOnly ? ' disabled' : ''}>Clear</button></div>` +
      (hasLinks(raw) ? '<p class="hint">Copy email keeps the links clickable when you paste. Open in mail app writes them as text with the address in brackets.</p>' : '');
    box.innerHTML = h;
    for (const ta of box.querySelectorAll('textarea')) grow(ta);
    renderPreview(t);
  }
  function renderDraftNote() {
    const used = draftUsed(D.drafts[draftKey()]);
    const p = proj(ui.mail.project);
    $('#draftNote').textContent = used ? `Kept for ${p ? p.name.trim() || 'this project' : 'when there’s no project'}` : '';
    $('#draftClear').hidden = !used;
  }
  function renderPreview(t) {
    const own = draft().text[mailLang(t)];
    const e = currentEmail();
    if (!own) {
      const c = t[mailLang(t)], v = mailValues(t);
      $('#pvSubject').innerHTML = richHtml(c.subject, v, true);
      $('#pvBody').innerHTML = richHtml(c.body, v);
    }
    $('#mailMissing').textContent = e.blanks ? `${e.blanks} ${e.blanks === 1 ? 'blank' : 'blanks'} left` : '';
    renderDraftNote();
  }

  let lastTplField = null;
  function renderEditor(t) {
    const lang = mailLang(t);
    const c = t[lang];
    const ro = readOnly ? ' readonly' : '';
    const chips = ['first_name', 'contact', 'project', 'deadline', 'db', 'website', 'task_link', 'version', 'ba', 'date', 'my_name', 'signature'];
    $('#composeBody').innerHTML =
      '<div class="cgrid">' +
      `<label class="ef">Template name<input data-tpl="name" value="${esc(t.name)}" placeholder="For example Weekly status" ${INPUT_ATTRS}${ro}></label>` +
      `<label class="ef">Category<select data-tpl-cat${readOnly ? ' disabled' : ''}><option value="">Uncategorised</option>${D.templateCats.map(x =>
        `<option value="${esc(x.id)}"${x.id === t.cat ? ' selected' : ''}>${esc(x.name.trim() || 'Untitled category')}</option>`).join('')}</select></label></div>` +
      `<div class="ef"><span>Language</span>${langSeg(lang, tplLangs(t), true)}</div>` +
      `<label class="ef wide">Subject<input data-tpl="subject" value="${esc(c.subject)}" lang="${lang}" ${PROSE_ATTRS}${ro}></label>` +
      `<label class="ef wide">Email<textarea data-tpl="body" rows="10" lang="${lang}" ${PROSE_ATTRS}${ro}>${esc(c.body)}</textarea></label>` +
      `<div class="chips" aria-label="Insert a project detail"><button type="button" class="chip link-chip" data-act="link-open"${readOnly ? ' disabled' : ''} title="Add a link (${MOD}K)">Link…</button><span class="hint">Insert:</span>${chips.map(n =>
        `<button type="button" class="chip" data-act="tpl-insert" data-name="${n}"${readOnly ? ' disabled' : ''}>${esc(C.humanize(n))}</button>`).join('')}</div>` +
      '<p class="hint">Project details fill in by themselves. Anything else you write in {{double braces}}, like {{next_steps}}, becomes a blank to fill in when you use the template. A link is written [text](address); select some text and choose Link to add one. The address can be a detail too, like {{task_link}}.</p>' +
      `<div class="actions"><button type="button" class="btn" data-act="tpl-edit">Done editing</button>` +
      `<button type="button" class="btn ghost" data-act="tpl-review"${(c.subject + c.body).trim() ? '' : ' disabled'}>Review with ${esc(assistantName())}</button><span class="grow"></span><button type="button" class="link danger" data-act="tpl-delete"${readOnly ? ' disabled' : ''}>Delete template</button></div>`;
    lastTplField = null;
    const body = $('#composeBody textarea');
    if (body) grow(body);
  }

  $('#view-mail').addEventListener('focusin', e => { if (e.target.matches('[data-tpl="subject"], [data-tpl="body"], [data-mtext]')) lastTplField = e.target; });
  $('#view-mail').addEventListener('input', e => {
    const t = tplById(ui.mail.tpl);
    if (!t || readOnly) return;
    const el = e.target;
    if (el.dataset.tpl) {
      if (el.dataset.tpl === 'name') t.name = el.value;
      else t[mailLang(t)][el.dataset.tpl] = el.value;
      if (el.tagName === 'TEXTAREA') grow(el);
      changed();
      return;
    }
    if (el.dataset.mfield) {
      const d = draftForWrite();
      if (el.value) d.fields[el.dataset.mfield] = el.value; else delete d.fields[el.dataset.mfield];
      if (el.tagName === 'TEXTAREA') grow(el);
      changed();
      renderPreview(t);
      return;
    }
    if (el.dataset.mtext) {
      const d = draftForWrite();
      const own = d.text[mailLang(t)] || (d.text[mailLang(t)] = { subject: '', body: '' });
      own[el.dataset.mtext] = el.value;
      if (el.tagName === 'TEXTAREA') grow(el);
      changed();
      renderPreview(t);
      return;
    }
    if (el.dataset.mail === 'to') { const d = draftForWrite(); d.to = el.value; d.toTouched = true; changed(); renderDraftNote(); }
  });
  $('#view-mail').addEventListener('change', e => {
    const t = tplById(ui.mail.tpl);
    if (e.target.hasAttribute('data-tpl-cat')) {
      if (!t || readOnly) return;
      t.cat = catById(e.target.value) ? e.target.value : '';
      changed();
      return;
    }
    if (e.target.dataset.mail !== 'project') return;
    tidyDrafts();
    ui.mail.project = e.target.value;
    ui.mail.lang = null;
    renderMail();
  });
  $('#view-mail').addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k' && e.target.matches('[data-tpl="body"], [data-mtext="body"]')) {
      e.preventDefault();
      openLinkDialog(e.target);
    }
  });

  function insertPlaceholder(name) {
    const t = tplById(ui.mail.tpl);
    const el = lastTplField && document.contains(lastTplField) ? lastTplField : $('[data-tpl="body"]');
    if (!t || !el || readOnly) return;
    const token = `{{${name}}}`;
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
    el.value = el.value.slice(0, a) + token + el.value.slice(b);
    el.focus();
    el.setSelectionRange(a + token.length, a + token.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* links: [text](address) in the email text, added or changed with a small dialog */
  const linkEdit = { el: null, start: 0, end: 0, existing: false };
  function openLinkDialog(el) {
    el = el && el.matches && el.matches('textarea') ? el : (lastTplField && document.contains(lastTplField) && lastTplField.tagName === 'TEXTAREA' ? lastTplField : $('#composeBody textarea'));
    if (!el || readOnly) return;
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
    const hit = C.linkAt(el.value, a);
    Object.assign(linkEdit, hit && b <= hit.end ? { el, start: hit.start, end: hit.end, existing: true } : { el, start: a, end: b, existing: false });
    $('#ldText').value = hit && linkEdit.existing ? hit.label : el.value.slice(a, b).replace(/\n/g, ' ');
    $('#ldUrl').value = hit && linkEdit.existing ? hit.url : '';
    $('#ld-title').textContent = linkEdit.existing ? 'Change the link' : 'Add a link';
    $('#ldGo').textContent = linkEdit.existing ? 'Save link' : 'Add link';
    $('#ldRemove').hidden = !linkEdit.existing;
    checkLinkDialog();
    $('#linkDlg').showModal();
    ($('#ldText').value ? $('#ldUrl') : $('#ldText')).focus();
  }
  function linkAddress() {
    const u = $('#ldUrl').value.trim();
    if (/^\{\{\s*[\w.-]+\s*\}\}$/.test(u)) return u.replace(/\s+/g, '');
    const href = C.linkHref(u);
    return href ? (href.startsWith('mailto:') && !/^mailto:/i.test(u) ? u : href) : '';
  }
  function checkLinkDialog() {
    const u = $('#ldUrl').value.trim();
    const ok = linkAddress();
    $('#ldHint').textContent = !u ? 'A web address, an email address, or a project detail such as {{task_link}} or {{website}}.'
      : ok ? (ok.startsWith('{{') ? `Filled in from the project when you use the template.` : `Opens ${ok.replace(/^mailto:/i, 'a new email to ')}`) : 'That isn’t a web or email address.';
    $('#ldGo').disabled = !ok;
  }
  $('#ldUrl').addEventListener('input', checkLinkDialog);
  function applyLink(remove) {
    const { el, start, end } = linkEdit;
    if (!el || !document.contains(el)) { $('#linkDlg').close(); return; }
    const url = linkAddress();
    if (!remove && !url) return;
    const label = $('#ldText').value.trim();
    const text = remove ? label : C.linkMarkup(label || url.replace(/^mailto:/i, ''), url);
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    $('#linkDlg').close();
    el.focus();
    el.setSelectionRange(start + text.length, start + text.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // The email as it will be sent: from your own changes when you made some, otherwise from the template.
  function currentEmail() {
    const t = tplById(ui.mail.tpl);
    const lang = mailLang(t);
    const own = draft().text[lang];
    const c = own || t[lang], v = mailValues(t);
    const subject = own ? own.subject : C.fill(c.subject, v);
    const body = own ? own.body : C.fill(c.body, v);
    return { subject: C.plainMail(subject), body: C.plainMail(body), raw: body, blanks: C.placeholders(subject + '\n' + body).length };
  }
  function mailTo() {
    const t = tplById(ui.mail.tpl);
    const d = draft();
    return d.toTouched ? d.to : C.autoValues(proj(ui.mail.project), D.settings.me, mailLang(t), today()).spoc_email || '';
  }

  /* ---------- asking an AI assistant ---------- */
  const assistantName = () => C.ASSISTANTS[D.settings.assistant].label;
  async function askAssistant(prompt, what) {
    const link = C.assistantLink(D.settings.assistant, prompt);
    if (link.copy) {
      await copy(prompt, `${what} copied. Paste it into ${assistantName()}${link.url ? ', which is opening now' : ''}.`);
      if (link.url) Backend.open(link.url).catch(e => toast(String(e)));
      return;
    }
    Backend.open(link.url).then(() => toast(`Opening ${assistantName()}: check the request and send it.`)).catch(async e => {
      await copy(prompt, `Couldn’t open ${assistantName()} (${e}). The request is copied instead.`);
    });
  }

  /* ---------- actions ---------- */
  function goToDate(date) {
    flush();
    closePicker();
    sugHide();
    ui.meetingText = '';
    ui.meetingRef = null;
    ui.date = date;
    render();
  }
  const actions = {
    prev: () => goToDate(C.addDays(ui.date, -1)),
    next: () => goToDate(C.addDays(ui.date, 1)),
    today: () => goToDate(today()),
    carry: el => {
      const src = el.dataset.src;
      const n = C.carryOver(D.days[src].lines, ensureDay(ui.date).lines, ui.date, uid);
      changed(); render();
      toast(`Brought over ${n} ${n === 1 ? 'task' : 'tasks'}`);
    },
    'carry-dismiss': el => { ensureDay(ui.date).dismissed = el.dataset.src; changed(); renderBanners(); },
    'goals-carry': () => {
      const mon = week();
      const open = D.weeks[C.addDays(mon, -7)].goals.filter(g => g.text.trim() && !g.done);
      ensureWeek(mon).goals.push(...open.map(g => ({ id: uid(), text: g.text, level: 0, done: false })));
      changed(); render();
    },
    'goals-dismiss': () => { ensureWeek(week()).dismissed = true; changed(); renderBanners(); },
    menu: el => toggleMenu(el.getAttribute('aria-expanded') !== 'true'),
    'copy-day': () => { toggleMenu(false); copy(C.dayAsText(viewDay(ui.date), ui.date, (D.weeks[week()] || {}).goals, today(), agendaLines(ui.date)), 'Day copied as text'); },
    'copy-week': () => { toggleMenu(false); copy(C.weekSummary(D.days, week(), id => { const p = proj(id); return p ? projectTitle(p) : ''; }), 'Week summary copied'); },
    settings: () => { toggleMenu(false); openSettings(); },
    'choose-folder': () => chooseFolder(),
    reveal: () => Backend.reveal && Backend.reveal().catch(e => toast(String(e))),
    'retry-save': () => { dirty = true; flush(); },
    view: el => setView(el.dataset.view),
    'open-project': el => { if (el.dataset.pid !== ui.project) { ui.sheetTab = 'project'; ui.openPages.clear(); } setView('projects', { project: el.dataset.pid }); },
    'projects-back': () => { ui.dateEdit = null; setView('projects', { project: null }); },
    'project-new': () => {
      if (readOnly) return;
      const p = newProject();
      changed();
      setView('projects', { project: p.id });
      $('#pName').focus();
    },
    'project-duplicate': () => {
      const p = proj(ui.project);
      if (!p || readOnly) return;
      const d = newProject(C.duplicateProject(p, D.projects, uid));
      changed();
      setView('projects', { project: d.id });
      toast(`Duplicated as #${d.num}`);
      $('#pName').select();
    },
    'select-start': () => { ui.selecting = true; ui.sel.clear(); renderProjectList(); },
    'select-done': () => { ui.selecting = false; ui.sel.clear(); renderProjectList(); },
    'select-all': () => {
      if (ui.sel.size === D.projects.length) ui.sel.clear(); else for (const p of D.projects) ui.sel.add(p.id);
      renderProjectList();
    },
    'select-project': el => {
      const id = el.dataset.pid;
      if (ui.sel.has(id)) ui.sel.delete(id); else ui.sel.add(id);
      renderProjectList();
      const again = $(`#projItems [data-pid="${CSS.escape(id)}"]`);
      if (again) again.focus();
    },
    'batch-duplicate': () => {
      if (readOnly || !ui.sel.size) return;
      const list = D.projects.filter(p => ui.sel.has(p.id)).sort(byNum);
      const made = list.map(p => newProject(C.duplicateProject(p, D.projects, uid)));
      ui.sel = new Set(made.map(p => p.id));
      changed();
      renderProjectList();
      toast(`Made ${made.length} ${made.length === 1 ? 'copy' : 'copies'}: ${made.map(p => '#' + p.num).join(', ')}. They’re selected now.`);
    },
    'batch-archive': () => {
      if (readOnly || !ui.sel.size) return;
      const list = D.projects.filter(p => ui.sel.has(p.id));
      const restore = list.every(p => p.archived);
      for (const p of list) p.archived = !restore;
      C.renumberProjects(D.projects);
      changed();
      renderProjectList();
      toast(`${restore ? 'Restored' : 'Archived'} ${list.length} ${list.length === 1 ? 'project' : 'projects'}`);
    },
    'batch-delete': async () => {
      if (readOnly || !ui.sel.size) return;
      const list = D.projects.filter(p => ui.sel.has(p.id));
      const ans = await ask({
        title: `Delete ${list.length === 1 ? projectTitle(list[0]) : `${list.length} projects`}?`,
        body: `${list.length === 1 ? 'Its' : 'Their'} details, schedule and to-dos will be removed. Tasks already in your daily plans stay, without the link. To keep ${list.length === 1 ? 'it' : 'them'} out of the way instead, archive ${list.length === 1 ? 'it' : 'them'}.`,
        a: 'Delete', b: 'Archive'
      });
      if (ans === 'a') { deleteProjects(list.map(p => p.id)); toast(`Deleted ${list.length} ${list.length === 1 ? 'project' : 'projects'}`); }
      else if (ans === 'b') { for (const p of list) p.archived = true; C.renumberProjects(D.projects); }
      else return;
      changed();
      renderProjectList();
    },
    'link-line': el => {
      const row = el.closest('.row[data-id]');
      if (!row) return;
      if (!$('#picker').hidden && pick.lineId === row.dataset.id) { closePicker(); return; }
      openPicker(row.dataset.id);
    },
    'set-date': el => { ui.dateEdit = el.dataset.key; const p = proj(ui.project); if (p) renderSheet(p); },
    'clear-date': el => {
      const p = proj(ui.project);
      if (!p || readOnly) return;
      setDate(p, el.dataset.key, '');
      ui.dateEdit = null;
      renderSheet(p);
    },
    'phase-toggle': el => {
      const p = proj(ui.project);
      const x = p && p.schedule.find(y => y.id === el.closest('.phase').dataset.phase);
      if (!x || readOnly) return;
      x.done = !x.done;
      changed();
      renderSchedule(p);
      renderSheetSub();
    },
    'phase-remove': el => {
      const p = proj(ui.project);
      if (!p || readOnly) return;
      p.schedule = p.schedule.filter(y => y.id !== el.closest('.phase').dataset.phase);
      changed();
      renderSchedule(p);
      renderSheetSub();
    },
    'phase-add': () => {
      const p = proj(ui.project);
      if (!p || readOnly) return;
      const x = { id: uid(), text: '', date: '', done: false };
      p.schedule.push(x);
      changed();
      renderSchedule(p);
      $(`.phase[data-phase="${x.id}"] input`).focus();
    },
    'project-archive': () => {
      const p = proj(ui.project);
      if (!p || readOnly) return;
      p.archived = !p.archived;
      C.renumberProjects(D.projects);
      changed();
      toast(p.archived ? 'Archived. It stays in the Archived list.' : `Restored to your projects, as #${p.num}`);
      renderProjects();
    },
    'project-delete': async () => {
      const p = proj(ui.project);
      if (!p || readOnly) return;
      const ans = await ask({ title: `Delete ${projectTitle(p)}?`, body: 'Its details, schedule and to-dos will be removed. Tasks already in your daily plans stay, without the link. To keep it out of the way instead, archive it.', a: 'Delete', b: 'Archive' });
      if (ans === 'a') { deleteProjects([p.id]); changed(); setView('projects', { project: null }); toast('Project deleted'); }
      else if (ans === 'b') { p.archived = true; C.renumberProjects(D.projects); changed(); renderProjects(); }
    },
    'project-mail': () => { ui.mail.project = ui.project; ui.mail.tpl = null; setView('mail'); },
    'open-link': el => {
      const p = proj(ui.project);
      const url = p && C.linkOf(p.fields[el.dataset.key]);
      if (url) Backend.open(url).catch(e => toast(String(e)));
    },
    'plan-todo': el => {
      const p = proj(ui.project);
      const todo = p && p.todos.find(x => x.id === el.closest('.row').dataset.id);
      if (!todo || readOnly || !todo.text.trim()) return;
      const added = planTodo(p, todo);
      changed();
      projTodosOL.refresh();
      toast(added ? 'Added to today’s plan' : 'Already in today’s plan');
    },
    'tpl-open': el => openTemplate(el.dataset.tid),
    'mail-back': () => { tidyDrafts(); flush(); ui.mail.tpl = null; ui.mail.editing = false; renderMail(); },
    'tpl-new': () => openTemplatePicker(),
    'cal-add': () => openCalAdd(),
    'cal-save': () => saveCalAdd(),
    'cal-file': () => { if (!readOnly) $('#icsFile').click(); },
    'cal-refresh': () => refreshCalendars(true),
    'cal-refresh-one': el => {
      const c = calById(el.closest('[data-cal]').dataset.cal);
      if (!c) return;
      if (fetched[c.id]) fetched[c.id].at = 0;
      refreshCalendars(false);
      renderCalList();
    },
    'cal-remove': async el => {
      const c = calById(el.closest('[data-cal]').dataset.cal);
      if (!c || readOnly) return;
      if (await ask({ title: `Remove ${c.name || 'this calendar'}?`, body: 'Its events stop showing in the plan. Your calendar itself isn’t changed.', a: 'Remove', b: '' }) !== 'a') return;
      D.calendars = D.calendars.filter(x => x !== c);
      delete fetched[c.id];
      saveFetched();
      calCache.delete(c.id);
      changed();
      renderCalList();
      if (ui.view === 'plan') { renderAgenda(); renderBudget(); }
    },
    'meeting-remove': el => { const m = meetingOf(el); if (m) removeMeeting(m.id); },
    'ev-open': el => Backend.open(el.dataset.url).catch(e => toast(String(e))),
    'tp-use': () => useTemplatePick(),
    'cat-new': () => {
      if (readOnly) return;
      const c = { id: uid(), name: 'New category' };
      D.templateCats.push(c);
      ui.renameCat = c.id;
      changed();
      renderTemplateList();
    },
    'cat-rename': el => { ui.renameCat = el.closest('[data-sort-id]').dataset.sortId; renderTemplateList(); },
    'cat-toggle': el => {
      const c = catById(el.closest('[data-sort-id]').dataset.sortId);
      if (!c) return;
      c.collapsed = !c.collapsed;
      if (!c.collapsed) delete c.collapsed;
      changed();
      renderTemplateList();
      const again = $(`#tplItems [data-sort-id="${CSS.escape(c.id)}"] .cat-toggle`);
      if (again) again.focus();
    },
    'cat-delete': async el => {
      const c = catById(el.closest('[data-sort-id]').dataset.sortId);
      if (!c || readOnly) return;
      const n = D.templates.filter(t => t.cat === c.id).length;
      if (n && await ask({ title: `Delete the ${c.name.trim() || 'untitled'} category?`, body: `Its ${n === 1 ? 'template moves' : `${n} templates move`} to Uncategorised. No template is deleted.`, a: 'Delete category', b: '' }) !== 'a') return;
      D.templateCats = D.templateCats.filter(x => x !== c);
      for (const t of D.templates) if (t.cat === c.id) t.cat = '';
      changed();
      renderTemplateList();
    },
    'tpl-edit': () => {
      if (readOnly) return;
      ui.mail.editing = !ui.mail.editing;
      flush();
      renderMail();
    },
    'tpl-delete': async () => {
      const t = tplById(ui.mail.tpl);
      if (!t || readOnly) return;
      const ans = await ask({ title: `Delete ${t.name.trim() || 'this template'}?`, body: 'Every language version of it will be removed.', a: 'Delete', b: '' });
      if (ans !== 'a') return;
      D.templates = D.templates.filter(x => x !== t);
      for (const k of Object.keys(D.drafts)) if (k.startsWith(`${t.id}|`)) delete D.drafts[k];
      changed();
      ui.mail.tpl = null;
      ui.mail.editing = false;
      renderMail();
    },
    'tpl-insert': el => insertPlaceholder(el.dataset.name),
    'mail-lang': el => {
      const t = tplById(ui.mail.tpl);
      if (!t) return;
      ui.mail.lang = el.dataset.lang;
      renderCompose(t);
    },
    'mail-copy': el => {
      const e = currentEmail();
      const left = e.blanks ? `, with ${e.blanks} ${e.blanks === 1 ? 'blank' : 'blanks'} still empty` : '';
      if (el.dataset.what === 'subject') copy(e.subject, 'Subject copied' + left);
      else if (C.htmlMail(e.raw).includes('<a ')) copyRich(C.htmlMail(e.raw), e.body, 'Email copied, with its links' + left);
      else copy(e.body, 'Email copied' + left);
    },
    'mail-edittext': () => {
      const t = tplById(ui.mail.tpl);
      if (!t || readOnly) return;
      const lang = mailLang(t), c = t[lang], v = mailValues(t);
      draftForWrite().text[lang] = { subject: C.fill(c.subject, v), body: C.fill(c.body, v) };
      changed();
      renderCompose(t);
      const body = $('[data-mtext="body"]');
      if (body) { body.focus(); body.setSelectionRange(0, 0); body.scrollTop = 0; }
    },
    'mail-unedit': async () => {
      const t = tplById(ui.mail.tpl);
      if (!t || readOnly) return;
      if (await ask({ title: 'Go back to the template’s text?', body: 'The changes you made to this email will be lost. What you filled in the blanks stays.', a: 'Go back', b: '' }) !== 'a') return;
      delete draftForWrite().text[mailLang(t)];
      tidyDrafts();
      changed();
      renderCompose(t);
    },
    'mail-clear': async () => {
      const t = tplById(ui.mail.tpl);
      if (!t || readOnly) return;
      if (await ask({ title: 'Clear this email?', body: 'What you filled in, the address and any changes to the text go back to the template.', a: 'Clear', b: '' }) !== 'a') return;
      delete D.drafts[draftKey()];
      changed();
      renderCompose(t);
    },
    'link-open': () => openLinkDialog(lastTplField),
    'link-apply': () => applyLink(false),
    'link-remove': () => applyLink(true),
    'mail-open': () => {
      const e = currentEmail();
      const url = C.mailto(mailTo().trim(), e.subject, e.body);
      Backend.open(url).catch(err => toast(String(err)));
      if (url.length > 2000) toast('Long email: if your mail app cuts it short, use Copy email instead.');
    },
    'md-open': () => openMdImport(),
    'md-choose': () => $('#mdFiles').click(),
    'md-import': () => importParsed(),
    'project-export': () => { const p = proj(ui.project); if (p) exportProjects([p]); },
    'batch-export': () => exportProjects(D.projects.filter(p => ui.sel.has(p.id)).sort(byNum)),
    'sheet-tab': el => {
      ui.sheetTab = el.dataset.tab;
      const p = proj(ui.project);
      if (ui.sheetTab === 'copy' && p && p.copy.pages[0] && !ui.openPages.size) ui.openPages.add(p.copy.pages[0].id);
      if (p) renderSheet(p);
    },
    'copy-lang': el => { ui.copyLang = el.dataset.lang; renderCopy(proj(ui.project)); },
    'page-toggle': el => {
      const { p, pg } = copyCtx(el);
      if (!pg) return;
      if (ui.openPages.has(pg.id)) ui.openPages.delete(pg.id); else ui.openPages.add(pg.id);
      renderCopy(p);
    },
    'page-add': () => {
      const p = proj(ui.project);
      if (!p || readOnly) return;
      const pg = C.newPage('', uid);
      p.copy.pages.push(pg);
      ui.openPages.add(pg.id);
      changed();
      renderCopy(p);
      $(`#sheetCopy [data-page="${pg.id}"] [data-page-name]`).focus();
    },
    'pages-from-sitemap': () => {
      const p = proj(ui.project);
      if (!p || readOnly) return;
      const names = C.sitemapPages(p.fields.sitemap).filter(n => !p.copy.pages.some(pg => pg.name.trim().toLowerCase() === n.toLowerCase()));
      const made = names.map(n => C.newPage(n, uid));
      p.copy.pages.push(...made);
      if (made[0] && !ui.openPages.size) ui.openPages.add(made[0].id);
      changed();
      renderCopy(p);
      toast(`Added ${made.length} ${made.length === 1 ? 'page' : 'pages'}`);
    },
    'page-remove': async el => {
      const { p, pg } = copyCtx(el);
      if (!pg || readOnly) return;
      const written = C.LANGS.concat(copyLangs(p)).some(l => pageWritten(pg, l));
      if (written && await ask({ title: `Remove ${pg.name.trim() || 'this page'}?`, body: 'Its copy, in every language, will be removed.', a: 'Remove', b: '' }) !== 'a') return;
      p.copy.pages = p.copy.pages.filter(x => x !== pg);
      changed();
      renderCopy(p);
    },
    'block-add': el => {
      const { p, pg } = copyCtx(el);
      if (!pg || readOnly) return;
      const bk = C.newBlock('body', uid);
      pg.blocks.push(bk);
      changed();
      renderCopy(p);
      $(`#sheetCopy [data-block="${bk.id}"] [data-blk-label]`).select();
    },
    'block-remove': el => {
      const { p, pg, bk } = copyCtx(el);
      if (!bk || readOnly) return;
      pg.blocks = pg.blocks.filter(x => x !== bk);
      changed();
      renderCopy(p);
    },
    'copy-draft': el => {
      const { p, pg } = copyCtx(el);
      if (!pg) return;
      flush();
      askAssistant(C.pagePrompt(p, pg, copyLang(p), el.dataset.from || null), 'Request');
    },
    'copy-paste': el => { const { p, pg } = copyCtx(el); if (pg) openPaste(p, pg); },
    'paste-apply': () => {
      const p = proj(ui.project);
      const pg = p && pageById(p, paste.page);
      if (!pg || readOnly) return;
      const r = C.applyCopyAnswer(pg, paste.lang, $('#pdText').value, uid);
      $('#pasteDlg').close();
      changed();
      ui.copyLang = paste.lang;
      renderCopy(p);
      toast(`Filled ${r.filled} ${r.filled === 1 ? 'block' : 'blocks'}${r.added ? `, ${r.added} of them new` : ''}`);
    },
    'copy-page-text': el => { const { p, pg } = copyCtx(el); if (pg) copy(C.pageAsText(pg, copyLang(p)), 'Page copied'); },
    'copy-export': async el => {
      const p = proj(ui.project);
      if (!p) return;
      const langs = el.dataset.scope === 'all' ? copyLangs(p) : [copyLang(p)];
      const suffix = ` website copy${langs.length === 1 ? ` ${langs[0].toUpperCase()}` : ''}`;
      try {
        const where = await Backend.saveText(C.fileNameFor(p, suffix), C.copyDeckMarkdown(p, langs));
        if (where) toast(`Exported to ${where}`);
      } catch (e) { toast(`Couldn’t export: ${e}`); }
    },
    'mail-review': () => {
      const t = tplById(ui.mail.tpl);
      if (!t) return;
      const e = currentEmail();
      askAssistant(C.reviewPrompt(mailLang(t), e.subject, e.raw, false), 'Review request');
    },
    'tpl-review': () => {
      const t = tplById(ui.mail.tpl);
      if (!t) return;
      const c = t[mailLang(t)];
      askAssistant(C.reviewPrompt(mailLang(t), c.subject, c.body, true), 'Review request');
    }
  };
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-act]');
    if (a && actions[a.dataset.act]) { actions[a.dataset.act](a); return; }
    if (!e.target.closest('#menu, [data-act="menu"]')) toggleMenu(false);
  });

  for (const id of ['begin', 'end']) {
    $('#' + id).addEventListener('change', e => {
      if (readOnly || !C.isTime(e.target.value)) return;
      ensureDay(ui.date)[id] = e.target.value;
      changed();
      renderBudget();
    });
  }

  function toggleMenu(open) {
    const btn = $('[data-act="menu"]'), menu = $('#menu');
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('button').focus();
  }

  // Copies the email as rich text, so links stay clickable when pasted into Mail, Gmail or Outlook.
  async function copyRich(html, text, done) {
    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        })]);
        toast(done);
        return;
      }
    } catch {}
    const box = document.createElement('div');
    box.contentEditable = 'true';
    box.innerHTML = html;
    box.style.cssText = 'position:fixed;left:-10000px;top:0;white-space:normal';
    document.body.append(box);
    const range = document.createRange();
    range.selectNodeContents(box);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    sel.removeAllRanges();
    box.remove();
    if (ok) toast(done); else copy(text, done);
  }

  async function copy(text, done) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) { toast('Couldn’t reach the clipboard'); return; }
    }
    toast(done);
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------- settings ---------- */
  function renderSettings() {
    const file = Backend.kind === 'file';
    $('#dataPath').textContent = file ? info.path || '' : 'Saved in this browser';
    $('#dataHint').textContent = file
      ? 'Saved as you type. Before the first change each day, a copy goes to the backups folder next to the file; the last 30 are kept. Put the folder in iCloud Drive to use the same data on another Mac.'
      : 'This is the browser preview. Your data stays in this browser only; the desktop app saves it to a file.';
    $('#dataActions').hidden = !file;
    $('[data-act="reveal"]').textContent = isMac ? 'Show in Finder' : /Win/.test(navigator.userAgent) ? 'Show in Explorer' : 'Open folder';
    $('#assistant').value = D.settings.assistant;
    $('#assistant').disabled = !!readOnly;
    $('#defSchedule').value = D.settings.defaultSchedule.join('\n');
    $('#defSchedule').disabled = !!readOnly;
    $('#meName').value = D.settings.me.name;
    $('#meSignature').value = D.settings.me.signature;
    $('#meLang').value = D.settings.me.lang;
    for (const id of ['meName', 'meSignature', 'meLang']) $('#' + id).disabled = !!readOnly;
    $('#defBegin').value = D.settings.begin;
    $('#defEnd').value = D.settings.end;
    $('#defBegin').disabled = $('#defEnd').disabled = !!readOnly;
    $('#version').textContent = `Valleverde PM ${APP_VERSION}`;
    renderCalList();
    for (const k of document.querySelectorAll('[data-mod]')) k.textContent = MOD;
    for (const k of document.querySelectorAll('[data-alt]')) k.textContent = isMac ? 'Option' : 'Alt';
  }
  function openSettings() { renderSettings(); $('#settings').showModal(); }
  for (const [id, key] of [['defBegin', 'begin'], ['defEnd', 'end']]) {
    $('#' + id).addEventListener('change', e => {
      if (readOnly || !C.isTime(e.target.value)) return;
      D.settings[key] = e.target.value;
      changed();
    });
  }

  $('#assistant').addEventListener('change', e => {
    if (readOnly || !C.ASSISTANTS[e.target.value]) return;
    D.settings.assistant = e.target.value;
    changed();
    render();
  });
  $('#defSchedule').addEventListener('input', e => {
    if (readOnly) return;
    D.settings.defaultSchedule = e.target.value.split('\n').map(x => x.trim()).filter(Boolean);
    changed();
  });
  for (const [id, key] of [['meName', 'name'], ['meSignature', 'signature'], ['meLang', 'lang']]) {
    $('#' + id).addEventListener(id === 'meLang' ? 'change' : 'input', e => {
      if (readOnly) return;
      D.settings.me[key] = key === 'lang' ? okLang(e.target.value) : e.target.value;
      changed();
    });
  }

  function ask({ title, body, a, b }) {
    const d = $('#confirm');
    $('#cf-title').textContent = title;
    $('#cf-body').textContent = body;
    $('#cf-a').textContent = a;
    $('#cf-b').textContent = b || '';
    $('#cf-b').hidden = !b;
    d.returnValue = '';
    d.showModal();
    return new Promise(res => d.addEventListener('close', () => res(d.returnValue), { once: true }));
  }

  async function chooseFolder() {
    await flush();
    let c;
    try { c = await Backend.chooseFolder(); } catch (e) { toast(String(e)); return; }
    if (!c) return;
    let mode = 'move';
    if (c.hasFile) {
      const ans = await ask({
        title: 'This folder already has Valleverde data',
        body: `${c.dir} already contains a valleverde.json file, perhaps from another computer. Open that file, or replace it with the data in this window? Replacing keeps a copy of the old file in its backups folder.`,
        a: 'Open it', b: 'Replace it'
      });
      if (ans === 'a') mode = 'open';
      else if (ans !== 'b') return;
    }
    if (mode === 'move' && readOnly) { toast('Fix the data file first; this window has nothing safe to save.'); return; }
    try {
      const r = await Backend.useFolder(mode, mode === 'move' ? JSON.stringify(D, null, 1) : null);
      applyLoaded(r);
      render();
      renderSettings();
      toast(mode === 'open' ? 'Opened the data in that folder' : 'Now saving to the new folder. The old file was left where it was.');
    } catch (e) { toast(String(e)); }
  }

  /* ---------- keyboard and lifecycle ---------- */
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettings(); return; }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && ['1', '2', '3'].includes(e.key) && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      setView(VIEWS[Number(e.key) - 1]);
      return;
    }
    if (e.key === 'Escape' && !$('#menu').hidden) { toggleMenu(false); $('[data-act="menu"]').focus(); return; }
    const el = document.activeElement;
    const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
    if (typing || document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') {
      if (ui.view === 'projects' && ui.project) actions['projects-back']();
      else if (ui.view === 'mail' && ui.mail.tpl) actions['mail-back']();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || ui.view !== 'plan') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); actions.prev(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); actions.next(); }
    else if (e.key === 't' || e.key === 'T') actions.today();
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); tasksOL.focusGhost(); }
  });
  window.addEventListener('blur', () => flush());
  window.addEventListener('focus', () => { checkExternalChange(); refreshCalendars(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); else { checkExternalChange(); refreshCalendars(); } });
  window.addEventListener('beforeunload', () => flush());

  function tick() {
    const t = today();
    if (t !== ui.today) {
      const follow = ui.date === ui.today;
      ui.today = t;
      if (follow) { goToDate(t); return; }
    }
    renderBudget();
    if (ui.view === 'plan') renderAgenda();
    refreshCalendars();
  }

  async function boot() {
    setupOutlines();
    try { applyLoaded(await Backend.load()); }
    catch (e) {
      readOnly = `Couldn’t open your data file: ${e}. Nothing will be saved until the app is restarted.`;
      D = blank();
    }
    $('#app').hidden = false;
    render();
    setInterval(tick, 30000);
    refreshCalendars();
    if (!readOnly && !D.days[ui.date] && !weekGoals().length && !Object.keys(D.days).length) tasksOL.focusGhost();
  }
  boot();
})();

/* Valleverde PM: the interface. Logic that doesn't touch the page lives in core.js. */
(() => {
  'use strict';
  const APP_VERSION = '0.3.0';
  const SCHEMA = 3;
  const C = globalThis.Core;

  const $ = (s, r = document) => r.querySelector(s);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => C.ymd(new Date());
  const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
  const isMac = /Mac/.test(navigator.platform || navigator.userAgent);
  const MOD = isMac ? '⌘' : 'Ctrl';
  const INPUT_ATTRS = 'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"';

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
        open: url => invoke('open_external', { url })
      };
    }
    const KEY = 'valleverde-pm-v2';
    return {
      kind: 'browser',
      load: async () => { let c = null; try { c = localStorage.getItem(KEY); } catch {} return { path: null, dir: null, content: c, mtime: 0 }; },
      save: async content => { localStorage.setItem(KEY, content); return 0; },
      mtime: async () => 0,
      open: async url => { window.open(url, '_blank', 'noopener'); }
    };
  })();

  /* ---------- data ---------- */
  let D = blank();
  let info = { path: null, dir: null };
  let readOnly = '';
  let lastMtime = 0, dirty = false, saveTimer = 0, saving = Promise.resolve();
  const ui = {
    view: 'plan', date: today(), today: today(), editRoutines: false,
    project: null,
    mail: { tpl: null, project: '', lang: null, to: '', toTouched: false, fields: {}, editing: false }
  };

  function blank() {
    return {
      app: 'valleverde-pm', schema: SCHEMA,
      settings: { begin: '09:30', end: '18:30', me: { name: '', signature: '', lang: 'en' } },
      routines: [], weeks: {}, days: {}, projects: [], templates: []
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
      if (x.ref && typeof x.ref === 'object' && x.ref.p && x.ref.t) l.ref = { p: String(x.ref.p), t: String(x.ref.t) };
      if (C.isDate(x.planned)) l.planned = x.planned;
      return l;
    };
    const str = v => (typeof v === 'string' ? v : '');
    const part = x => ({ subject: str(x && x.subject), body: str(x && x.body) });
    b.settings.begin = time(o.settings && o.settings.begin, b.settings.begin);
    b.settings.end = time(o.settings && o.settings.end, b.settings.end);
    const me = (o.settings && o.settings.me) || {};
    b.settings.me = { name: str(me.name), signature: str(me.signature), lang: me.lang === 'es' ? 'es' : 'en' };
    b.projects = arr(o.projects).map(p => {
      const fields = {};
      for (const { key } of C.PROJECT_FIELDS) if (str(p.fields && p.fields[key])) fields[key] = p.fields[key];
      return {
        id: String(p.id || uid()), name: str(p.name), archived: !!p.archived, lang: p.lang === 'es' ? 'es' : 'en',
        fields, todos: C.normalize(arr(p.todos).map(line), 1)
      };
    });
    b.templates = arr(o.templates).map(t => ({ id: String(t.id || uid()), name: str(t.name), en: part(t.en), es: part(t.es) }));
    b.routines = arr(o.routines).map(r => ({ id: String(r.id || uid()), text: String(r.text ?? '') }));
    for (const [k, w] of Object.entries(o.weeks || {})) {
      if (!C.isDate(k) || !w) continue;
      b.weeks[k] = { goals: arr(w.goals).map(g => ({ ...line(g), level: 0 })) };
      if (w.dismissed) b.weeks[k].dismissed = true;
    }
    for (const [k, d] of Object.entries(o.days || {})) {
      if (!C.isDate(k) || !d) continue;
      const day = {
        begin: time(d.begin, b.settings.begin), end: time(d.end, b.settings.end),
        lines: C.normalize(arr(d.lines).map(line), 1),
        routines: arr(d.routines).map(r => {
          const x = { id: String(r.id || uid()), rid: String(r.rid || ''), text: String(r.text ?? ''), done: !!r.done };
          if (r.skip) x.skip = true;
          return x;
        })
      };
      if (C.isDate(d.dismissed)) day.dismissed = d.dismissed;
      b.days[k] = day;
    }
    return b;
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
  }

  function changed() {
    if (readOnly) return;
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 300);
  }
  function flush() {
    clearTimeout(saveTimer);
    if (!dirty || readOnly) return saving;
    dirty = false;
    const content = JSON.stringify(D, null, 1);
    saving = saving
      .then(() => Backend.save(content))
      .then(m => { lastMtime = m || lastMtime; setSaveError(''); })
      .catch(e => { dirty = true; setSaveError(String(e && e.message || e)); });
    return saving;
  }
  function setSaveError(msg) {
    const el = $('#saveState');
    el.hidden = !msg;
    el.title = msg ? `${msg}\nClick to try again.` : '';
  }

  async function checkExternalChange() {
    if (Backend.kind !== 'file' || dirty) return;
    await saving;
    let m = 0;
    try { m = await Backend.mtime(); } catch { return; }
    if (!m || !lastMtime || m === lastMtime || dirty) return;
    try {
      applyLoaded(await Backend.load());
      render();
      toast('Updated with changes from the data file');
    } catch {}
  }

  /* ---------- days and weeks ---------- */
  const week = () => C.mondayOf(ui.date);
  const masterRoutines = () => D.routines.filter(r => r.text.trim());
  function ensureDay(date) {
    if (!D.days[date]) {
      D.days[date] = {
        begin: D.settings.begin, end: D.settings.end, lines: [],
        routines: date >= today() ? masterRoutines().map(r => ({ id: uid(), rid: r.id, text: r.text, done: false })) : []
      };
    }
    return D.days[date];
  }
  function viewDay(date) {
    if (D.days[date]) return D.days[date];
    const future = date >= today();
    return {
      begin: D.settings.begin, end: D.settings.end, lines: [],
      routines: future ? masterRoutines().map(r => ({ id: r.id, rid: r.id, text: r.text, done: false })) : []
    };
  }
  const ensureWeek = mon => (D.weeks[mon] ||= { goals: [] });
  function syncRoutines() {
    const t = today();
    for (const [date, day] of Object.entries(D.days)) {
      if (date < t) continue;
      day.routines = masterRoutines().map(r => {
        const ex = day.routines.find(x => x.rid === r.id);
        return ex ? { ...ex, text: r.text } : { id: uid(), rid: r.id, text: r.text, done: false };
      });
    }
  }
  const weekGoals = () => ((D.weeks[week()] || {}).goals || []).filter(g => g.text.trim());
  function goalNumber(text) {
    const i = weekGoals().findIndex(g => C.goalMatch(g.text, text));
    return i + 1;
  }
  function plannedForGoal(goalText) {
    const L = viewDay(ui.date).lines;
    let m = 0;
    for (const [s] of C.groups(L)) if (C.goalMatch(goalText, L[s].text)) m += C.groupMinutes(L, s).open;
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

  /* ---------- outlines on the page ---------- */
  let goalsOL, tasksOL, routinesOL, projTodosOL;
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
        if (l.level) return '';
        let h = '';
        const p = projectFor(l.text);
        if (p) h += `<button type="button" class="link plink" data-act="open-project" data-pid="${esc(p.id)}">Project</button>`;
        const g = goalNumber(l.text);
        if (g) h += `<span class="goal" title="Serves week goal ${g}">Goal ${g}</span>`;
        const m = C.groupMinutes(L, i);
        if (m.kids) {
          if (m.open) h += `<span class="sum">${C.fmtDur(m.open)}</span>`;
          else if (m.done) h += `<span class="sum quiet">${C.fmtDur(m.done)}</span>`;
        }
        return h;
      },
      onToggled: syncFromDay,
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
    routinesOL = new Outline($('#routinesEdit'), {
      maxLevel: 0, check: false, label: 'Routine', ghost: 'Add a routine, like “15m PM Formech”',
      read: () => D.routines,
      write: () => D.routines,
      onChange: () => { syncRoutines(); changed(); renderBudget(); }
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
    for (const el of document.querySelectorAll('[data-act="copy-day"], [data-act="copy-week"]')) el.hidden = ui.view !== 'plan';
    $('#menu hr').hidden = ui.view !== 'plan';
    if (ui.view === 'projects') renderProjects();
    else if (ui.view === 'mail') renderMail();
    else renderPlan();
  }
  function setView(v, opts = {}) {
    flush();
    ui.view = v;
    if ('project' in opts) ui.project = opts.project;
    render();
    window.scrollTo(0, 0);
  }
  function renderPlan() {
    renderNav();
    renderBudget();
    $('#weekRange').textContent = C.fmtRange(week());
    goalsOL.render();
    renderRoutines();
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
      if (avail === null) { slack.className = 'slack'; slack.textContent = ''; }
      else {
        const f = avail - left;
        slack.className = f >= 0 ? 'slack free' : 'slack over';
        slack.textContent = f >= 0 ? `${C.fmtDur(f)} free` : `${C.fmtDur(-f)} over`;
      }
    }
    const b = $('#begin'), e = $('#end');
    if (document.activeElement !== b) b.value = day.begin || '';
    if (document.activeElement !== e) e.value = day.end || '';
    b.disabled = e.disabled = !!readOnly;
    $('#doneTotal').textContent = !past && done ? `${C.fmtDur(done)} done` : '';
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
    if (isToday && now >= b && now <= e) {
      const m = document.createElement('span');
      m.className = 'nowmark';
      m.style.left = pct(elapsed);
      r.append(m);
    }
    r.title = `${day.begin}–${day.end}`;
  }

  function routineList() { return viewDay(ui.date).routines.filter(r => r.text.trim()); }
  function renderRoutines() {
    const btn = $('#routinesBtn');
    btn.textContent = ui.editRoutines ? 'Done' : 'Edit';
    btn.disabled = !!readOnly;
    $('#routinesEdit').hidden = !ui.editRoutines;
    const view = $('#routines');
    view.hidden = ui.editRoutines;
    if (ui.editRoutines) { routinesOL.render(); return; }
    const list = routineList();
    if (!list.length) {
      view.innerHTML = `<p class="empty">${ui.date < today() ? 'No routines on this day.' : 'Recurring blocks, like “15m PM Formech”, appear here every day. Add them with Edit.'}</p>`;
      return;
    }
    view.innerHTML = list.map(r =>
      `<div class="row l0 routine${r.done ? ' done' : ''}${r.skip ? ' skipped' : ''}" data-rid="${esc(r.rid)}">` +
      '<span class="grip"></span>' +
      `<button type="button" class="chk" aria-pressed="${r.done}" aria-label="${r.done ? 'Mark not done' : 'Mark done'}"${readOnly ? ' disabled' : ''}></button>` +
      `<span class="rtxt">${esc(r.text)}</span>` +
      `<span class="aside"><button type="button" class="link skip"${readOnly ? ' disabled' : ''}>${r.skip ? 'Restore' : 'Skip today'}</button></span></div>`
    ).join('');
  }
  function routineAction(rid, what) {
    if (readOnly) return;
    const day = ensureDay(ui.date);
    const r = day.routines.find(x => x.rid === rid);
    if (!r) return;
    if (what === 'toggle') { r.done = !r.done; if (r.done) delete r.skip; }
    else { if (r.skip) delete r.skip; else { r.skip = true; r.done = false; } }
    changed();
    renderRoutines();
    renderBudget();
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

  /* ---------- projects ---------- */
  const proj = id => D.projects.find(p => p.id === id) || null;
  const nameEq = (a, b) => C.label(a).trim().toLowerCase() === C.label(b).trim().toLowerCase();
  const matchesProject = (p, text) => !!p.name.trim() && (C.goalMatch(p.name, text) || nameEq(p.name, text));
  const projectFor = text => D.projects.find(p => !p.archived && matchesProject(p, text)) || null;
  const openTodos = p => p.todos.filter(t => !t.done && t.text.trim()).length;
  const activeProjects = () => D.projects.filter(p => !p.archived).sort((a, b) => {
    const da = a.fields.deadline || '9999', db = b.fields.deadline || '9999';
    return da < db ? -1 : da > db ? 1 : a.name.localeCompare(b.name);
  });

  // A to-do planned for today shows up in the day under its project, and checking either one checks both.
  function planTodo(p, todo) {
    const t = today();
    const L = ensureDay(t).lines;
    todo.planned = t;
    if (L.some(l => l.ref && l.ref.t === todo.id && !l.moved && !l.done)) return false;
    const name = p.name.trim() || 'Untitled project';
    const g = C.groups(L).find(([s]) => !L[s].done && matchesProject(p, L[s].text));
    const line = { id: uid(), text: todo.text, level: 1, done: false, ref: { p: p.id, t: todo.id } };
    if (g) L.splice(g[1], 0, line);
    else L.splice(C.firstDoneGroup(L), 0, { id: uid(), text: name, level: 0, done: false }, line);
    return true;
  }
  function syncFromDay(lines) {
    for (const l of lines) {
      if (!l.ref) continue;
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
    const who = C.nameIn(p.fields.spoc) || C.emailIn(p.fields.spoc);
    return `<button type="button" class="prow" data-act="open-project" data-pid="${esc(p.id)}">` +
      `<span class="pmain"><span class="pname">${esc(p.name.trim() || 'Untitled project')}</span>` +
      `${who ? `<span class="pmeta">${esc(who)}</span>` : ''}</span>` +
      `<span class="pside">${n ? `<span class="note">${n} to ${n === 1 ? 'do' : 'dos'}</span>` : ''}` +
      `${due && !p.archived ? `<span class="due${due.late ? ' late' : due.soon ? ' soon' : ''}">${esc(due.text)}</span>` : ''}</span></button>`;
  }
  function renderProjectList() {
    const active = activeProjects();
    const archived = D.projects.filter(p => p.archived).sort((a, b) => a.name.localeCompare(b.name));
    let h = active.length
      ? `<div class="plist">${active.map(projectRow).join('')}</div>`
      : '<p class="empty">Keep each project’s contact, links, deadline, notes and to-dos in one place. Create one with New project, or bring your projects over with Import from version 0.1 in the ⋯ menu.</p>';
    if (archived.length) h += `<details class="archived"><summary>Archived (${archived.length})</summary><div class="plist">${archived.map(projectRow).join('')}</div></details>`;
    $('#projItems').innerHTML = h;
    $('[data-act="project-new"]').disabled = !!readOnly;
  }
  function renderSheetSub() {
    const p = proj(ui.project);
    if (!p) return;
    const due = C.dueLabel(p.fields.deadline, today());
    const n = openTodos(p);
    const bits = [];
    if (p.archived) bits.push('<span class="note">Archived</span>');
    if (due) bits.push(`<span class="due${due.late ? ' late' : due.soon ? ' soon' : ''}">${esc(due.text)}</span>`);
    $('#pSub').innerHTML = bits.join('');
    $('#pSub').hidden = !bits.length;
    $('#pTodoCount').textContent = n ? `${n} open` : '';
  }
  function renderSheet(p) {
    const name = $('#pName');
    if (document.activeElement !== name) name.value = p.name;
    name.readOnly = !!readOnly;
    $('#archBtn').textContent = p.archived ? 'Restore' : 'Archive';
    for (const b of document.querySelectorAll('#projSheet .crumbs .link')) b.disabled = !!readOnly && b.dataset.act !== 'project-mail';
    projTodosOL.render();
    $('#pFields').innerHTML = C.PROJECT_FIELDS.map(f => {
      const v = p.fields[f.key] || '';
      const id = `pf-${f.key}`;
      const common = `id="${id}" data-pfield="${f.key}" ${INPUT_ATTRS}${readOnly ? ' readonly' : ''}`;
      const ctl = f.long
        ? `<textarea ${common} rows="1" placeholder="Add ${esc(f.label.toLowerCase())}">${esc(v)}</textarea>`
        : `<input ${common}${f.type === 'date' ? ' type="date"' : ''} value="${esc(v)}" placeholder="${esc(f.hint || '')}">`;
      const extra = f.long || f.type === 'date' ? '' :
        `<button type="button" class="link open" data-act="open-link" data-key="${f.key}"${C.linkOf(v) ? '' : ' hidden'}>Open</button>`;
      return `<div class="pf${f.long ? ' long' : ''}"><label for="${id}">${esc(f.label)}</label><div class="pv">${ctl}${extra}</div></div>`;
    }).join('');
    for (const ta of document.querySelectorAll('#pFields textarea')) grow(ta);
    renderSheetSub();
  }
  function grow(ta) { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; }

  $('#view-projects').addEventListener('input', e => {
    const p = proj(ui.project);
    if (!p || readOnly) return;
    const el = e.target;
    if (el.id === 'pName') { p.name = el.value; changed(); return; }
    const k = el.dataset.pfield;
    if (!k) return;
    if (el.value) p.fields[k] = el.value; else delete p.fields[k];
    changed();
    if (el.tagName === 'TEXTAREA') grow(el);
    const open = el.parentElement.querySelector('.open');
    if (open) open.hidden = !C.linkOf(el.value);
    if (k === 'deadline') renderSheetSub();
  });

  function renderWeekDeadlines() {
    const el = $('#weekDeadlines');
    const mon = week(), sun = C.addDays(mon, 6);
    const due = D.projects.filter(p => !p.archived && p.fields.deadline >= mon && p.fields.deadline <= sun)
      .sort((a, b) => (a.fields.deadline < b.fields.deadline ? -1 : 1));
    el.hidden = !due.length;
    el.innerHTML = due.length ? 'Deadlines: ' + due.map(p =>
      `<button type="button" class="link" data-act="open-project" data-pid="${esc(p.id)}">${esc(p.name.trim() || 'Untitled')}, ${esc(C.fmtShort(p.fields.deadline))}</button>`).join(' ') : '';
  }

  /* ---------- mail ---------- */
  const tplById = id => D.templates.find(t => t.id === id) || null;
  const missingStarters = () => C.STARTER_TEMPLATES.filter(x => !D.templates.some(t => t.name.trim().toLowerCase() === x.name.toLowerCase()));
  const tplLangs = t => ['en', 'es'].filter(l => t[l].subject.trim() || t[l].body.trim());
  const LANG = { en: 'English', es: 'Spanish' };

  function renderMail() {
    const t = tplById(ui.mail.tpl);
    if (!t) { ui.mail.tpl = null; ui.mail.editing = false; }
    $('#mailList').hidden = !!t;
    $('#mailCompose').hidden = !t;
    if (t) renderCompose(t); else renderTemplateList();
  }
  function renderTemplateList() {
    $('[data-act="tpl-new"]').disabled = !!readOnly;
    const list = D.templates.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) {
      $('#tplItems').innerHTML = '<div class="empty"><p>Save the emails you send again and again, in English and Spanish. Write the parts that change in {{double braces}}: project details such as {{first_name}} or {{deadline}} fill in from the project, and anything else becomes a blank to fill in.</p>' +
        `<div class="actions"><button type="button" class="btn" data-act="tpl-seed"${readOnly ? ' disabled' : ''}>Add example templates</button>` +
        `<button type="button" class="btn ghost" data-act="import-v01"${readOnly ? ' disabled' : ''}>Import from version 0.1…</button></div></div>`;
      return;
    }
    $('#tplItems').innerHTML = `<div class="plist">${list.map(t => `<button type="button" class="prow" data-act="tpl-open" data-tid="${esc(t.id)}">` +
      `<span class="pmain"><span class="pname">${esc(t.name.trim() || 'Untitled template')}</span>` +
      `<span class="pmeta">${esc(C.fill(t[tplLangs(t)[0] || 'en'].subject, {}).trim() || 'No subject yet')}</span></span>` +
      `<span class="pside">${['en', 'es'].map(l => `<span class="lang${tplLangs(t).includes(l) ? '' : ' off'}" title="${tplLangs(t).includes(l) ? '' : 'Not written in '}${LANG[l]}">${l.toUpperCase()}</span>`).join('')}</span></button>`).join('')}</div>` +
      (missingStarters().length && !readOnly ? `<p class="more"><button type="button" class="link" data-act="tpl-seed">Add the ${missingStarters().length === C.STARTER_TEMPLATES.length ? '' : 'missing '}example templates</button></p>` : '');
  }

  function openTemplate(id, projectId) {
    const m = ui.mail;
    m.tpl = id; m.fields = {}; m.editing = false; m.toTouched = false; m.to = ''; m.lang = null;
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
    const m = ui.mail, lang = mailLang(t);
    const v = C.autoValues(proj(m.project), D.settings.me, lang, today());
    for (const [k, x] of Object.entries(m.fields)) if (x && x.trim()) v[k] = x;
    return v;
  }
  const langSeg = (lang, langs, editing) => `<div class="seg" role="group" aria-label="Language">${['en', 'es'].map(l =>
    `<button type="button" data-act="mail-lang" data-lang="${l}" aria-pressed="${lang === l}"${!editing && !langs.includes(l) ? ` disabled title="Not written in ${LANG[l]} yet"` : ''}>${LANG[l]}</button>`).join('')}</div>`;

  function renderCompose(t) {
    const m = ui.mail;
    const btn = $('#tplEditBtn');
    btn.textContent = m.editing ? 'Done editing' : 'Edit template';
    btn.disabled = !!readOnly;
    if (m.editing) { renderEditor(t); return; }
    const langs = tplLangs(t);
    const box = $('#composeBody');
    if (!langs.length) {
      box.innerHTML = `<h1 class="ctitle">${esc(t.name.trim() || 'Untitled template')}</h1><p class="empty">This template is empty. Choose Edit template to write it in English or Spanish.</p>`;
      return;
    }
    const lang = mailLang(t);
    const c = t[lang];
    const p = proj(m.project);
    const auto = C.autoValues(p, D.settings.me, lang, today());
    const names = C.placeholders(c.subject + '\n' + c.body);
    const blanks = names.filter(n => !auto[n]);
    const filled = names.filter(n => auto[n]);
    if (!m.toTouched) m.to = auto.spoc_email || '';
    const projOptions = activeProjects().concat(p && p.archived ? [p] : [])
      .map(x => `<option value="${esc(x.id)}"${x.id === m.project ? ' selected' : ''}>${esc(x.name.trim() || 'Untitled project')}</option>`).join('');
    box.innerHTML =
      `<h1 class="ctitle">${esc(t.name.trim() || 'Untitled template')}</h1>` +
      '<div class="cgrid">' +
      `<label class="ef">Project<select data-mail="project"><option value="">No project</option>${projOptions}</select></label>` +
      `<div class="ef"><span>Language</span>${langSeg(lang, langs, false)}</div>` +
      `<label class="ef wide">To<input data-mail="to" type="email" value="${esc(m.to)}" placeholder="name@company.com" ${INPUT_ATTRS}></label>` +
      '</div>' +
      (blanks.length ? `<div class="blanks"><h2>Fill in</h2>${blanks.map(n => {
        const v = esc(m.fields[n] || '');
        const ctl = C.isLongBlank(n)
          ? `<textarea data-mfield="${esc(n)}" rows="3" ${INPUT_ATTRS}>${v}</textarea>`
          : `<input data-mfield="${esc(n)}" value="${v}" ${INPUT_ATTRS}>`;
        return `<label class="ef${C.isLongBlank(n) ? ' wide' : ''}">${esc(C.humanize(n))}${ctl}</label>`;
      }).join('')}</div>` : '') +
      (filled.length ? `<p class="hint">Filled in from ${p ? esc(p.name.trim() || 'the project') : 'your details'}: ${filled.map(n => esc(/^[A-Z]{2,}/.test(C.humanize(n)) ? C.humanize(n) : C.humanize(n).toLowerCase())).join(', ')}.</p>` : '') +
      '<div class="preview" aria-live="polite"><p class="psubj" id="pvSubject"></p><div class="pbody" id="pvBody"></div></div>' +
      '<div class="actions"><button type="button" class="btn" data-act="mail-copy" data-what="body">Copy email</button>' +
      '<button type="button" class="btn ghost" data-act="mail-copy" data-what="subject">Copy subject</button>' +
      '<button type="button" class="btn ghost" data-act="mail-open">Open in mail app</button>' +
      '<span class="missing" id="mailMissing"></span></div>';
    for (const ta of box.querySelectorAll('textarea')) grow(ta);
    renderPreview(t);
  }
  function partsHtml(parts) {
    return parts.map(x => (x.blank ? `<mark class="blank">${esc(C.humanize(x.blank))}</mark>` : esc(x.text))).join('');
  }
  function renderPreview(t) {
    const c = t[mailLang(t)], v = mailValues(t);
    $('#pvSubject').innerHTML = partsHtml(C.fillParts(c.subject, v)) || '<span class="note">No subject</span>';
    $('#pvBody').innerHTML = partsHtml(C.fillParts(c.body, v));
    const n = C.placeholders(c.subject + '\n' + c.body).filter(x => !v[x]).length;
    $('#mailMissing').textContent = n ? `${n} ${n === 1 ? 'blank' : 'blanks'} left` : '';
  }

  let lastTplField = null;
  function renderEditor(t) {
    const lang = mailLang(t);
    const c = t[lang];
    const ro = readOnly ? ' readonly' : '';
    const chips = ['first_name', 'contact', 'project', 'deadline', 'db', 'website', 'task_link', 'version', 'ba', 'date', 'my_name', 'signature'];
    $('#composeBody').innerHTML =
      `<label class="ef wide">Template name<input data-tpl="name" value="${esc(t.name)}" placeholder="For example Weekly status" ${INPUT_ATTRS}${ro}></label>` +
      `<div class="ef"><span>Language</span>${langSeg(lang, tplLangs(t), true)}</div>` +
      `<label class="ef wide">Subject<input data-tpl="subject" value="${esc(c.subject)}" ${INPUT_ATTRS}${ro}></label>` +
      `<label class="ef wide">Email<textarea data-tpl="body" rows="10" ${INPUT_ATTRS}${ro}>${esc(c.body)}</textarea></label>` +
      `<div class="chips" aria-label="Insert a project detail"><span class="hint">Insert:</span>${chips.map(n =>
        `<button type="button" class="chip" data-act="tpl-insert" data-name="${n}"${readOnly ? ' disabled' : ''}>${esc(C.humanize(n))}</button>`).join('')}</div>` +
      '<p class="hint">Project details fill in by themselves. Anything else you write in {{double braces}}, like {{next_steps}}, becomes a blank to fill in when you use the template.</p>' +
      `<div class="actions"><button type="button" class="btn" data-act="tpl-edit">Done editing</button><span class="grow"></span><button type="button" class="link danger" data-act="tpl-delete"${readOnly ? ' disabled' : ''}>Delete template</button></div>`;
    lastTplField = null;
    const body = $('#composeBody textarea');
    if (body) grow(body);
  }

  $('#view-mail').addEventListener('focusin', e => { if (e.target.matches('[data-tpl="subject"], [data-tpl="body"]')) lastTplField = e.target; });
  $('#view-mail').addEventListener('input', e => {
    const t = tplById(ui.mail.tpl);
    if (!t) return;
    const el = e.target, m = ui.mail;
    if (el.dataset.tpl) {
      if (readOnly) return;
      if (el.dataset.tpl === 'name') t.name = el.value;
      else t[mailLang(t)][el.dataset.tpl] = el.value;
      if (el.tagName === 'TEXTAREA') grow(el);
      changed();
      return;
    }
    if (el.dataset.mfield) { m.fields[el.dataset.mfield] = el.value; if (el.tagName === 'TEXTAREA') grow(el); renderPreview(t); return; }
    if (el.dataset.mail === 'to') { m.to = el.value; m.toTouched = true; }
  });
  $('#view-mail').addEventListener('change', e => {
    if (e.target.dataset.mail !== 'project') return;
    const m = ui.mail;
    m.project = e.target.value;
    m.lang = null;
    m.toTouched = false;
    renderMail();
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
  function currentEmail() {
    const t = tplById(ui.mail.tpl);
    const c = t[mailLang(t)], v = mailValues(t);
    return { subject: C.fill(c.subject, v), body: C.fill(c.body, v), blanks: C.placeholders(c.subject + '\n' + c.body).filter(x => !v[x]).length };
  }

  /* ---------- importing version 0.1 data ---------- */
  $('#importFile').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || readOnly) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { toast('That file isn’t a backup: it couldn’t be read as JSON.'); return; }
    const r = C.importV01(data, uid);
    const have = new Set(D.templates.map(t => t.name.trim().toLowerCase()));
    const haveP = new Set(D.projects.map(p => p.name.trim().toLowerCase()));
    const tpls = r.templates.filter(t => !have.has(t.name.trim().toLowerCase()));
    const projs = r.projects.filter(p => !haveP.has(p.name.trim().toLowerCase()));
    if (!r.templates.length && !r.projects.length) { toast('No templates or projects were found in that file.'); return; }
    D.templates.push(...tpls);
    D.projects.push(...projs);
    changed();
    render();
    const skipped = r.templates.length - tpls.length + r.projects.length - projs.length;
    toast(`Imported ${tpls.length} ${tpls.length === 1 ? 'template' : 'templates'} and ${projs.length} ${projs.length === 1 ? 'project' : 'projects'}` +
      (skipped ? `; ${skipped} already here were skipped` : ''));
  });

  /* ---------- actions ---------- */
  function goToDate(date) {
    flush();
    ui.date = date;
    ui.editRoutines = false;
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
    'edit-routines': () => {
      ui.editRoutines = !ui.editRoutines;
      if (!ui.editRoutines) syncRoutines();
      renderRoutines();
      if (ui.editRoutines) routinesOL.focusGhost();
    },
    menu: el => toggleMenu(el.getAttribute('aria-expanded') !== 'true'),
    'copy-day': () => { toggleMenu(false); copy(C.dayAsText(viewDay(ui.date), ui.date, (D.weeks[week()] || {}).goals, today()), 'Day copied as text'); },
    'copy-week': () => { toggleMenu(false); copy(C.weekSummary(D.days, week()), 'Week summary copied'); },
    settings: () => { toggleMenu(false); openSettings(); },
    'choose-folder': () => chooseFolder(),
    reveal: () => Backend.reveal && Backend.reveal().catch(e => toast(String(e))),
    'retry-save': () => { dirty = true; flush(); },
    view: el => setView(el.dataset.view),
    'open-project': el => setView('projects', { project: el.dataset.pid }),
    'projects-back': () => setView('projects', { project: null }),
    'project-new': () => {
      if (readOnly) return;
      const p = { id: uid(), name: '', archived: false, lang: D.settings.me.lang, fields: {}, todos: [] };
      D.projects.push(p);
      changed();
      setView('projects', { project: p.id });
      $('#pName').focus();
    },
    'project-archive': () => {
      const p = proj(ui.project);
      if (!p || readOnly) return;
      p.archived = !p.archived;
      changed();
      toast(p.archived ? 'Archived. It stays in the Archived list.' : 'Restored to your projects');
      renderProjects();
    },
    'project-delete': async () => {
      const p = proj(ui.project);
      if (!p || readOnly) return;
      const ans = await ask({ title: `Delete ${p.name.trim() || 'this project'}?`, body: 'Its details and to-dos will be removed. Tasks already in your daily plans stay. To keep it out of the way instead, archive it.', a: 'Delete', b: 'Archive' });
      if (ans === 'a') { D.projects = D.projects.filter(x => x !== p); changed(); setView('projects', { project: null }); toast('Project deleted'); }
      else if (ans === 'b') { p.archived = true; changed(); renderProjects(); }
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
    'mail-back': () => { flush(); ui.mail.tpl = null; ui.mail.editing = false; renderMail(); },
    'tpl-new': () => {
      if (readOnly) return;
      const t = { id: uid(), name: '', en: { subject: '', body: '' }, es: { subject: '', body: '' } };
      D.templates.push(t);
      changed();
      openTemplate(t.id);
      ui.mail.editing = true;
      ui.mail.lang = D.settings.me.lang;
      renderMail();
      $('[data-tpl="name"]').focus();
    },
    'tpl-seed': () => {
      if (readOnly) return;
      D.templates.push(...missingStarters().map(t => ({ id: uid(), name: t.name, en: { ...t.en }, es: { ...t.es } })));
      changed();
      renderMail();
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
      const ans = await ask({ title: `Delete ${t.name.trim() || 'this template'}?`, body: 'Both the English and Spanish versions will be removed.', a: 'Delete', b: '' });
      if (ans !== 'a') return;
      D.templates = D.templates.filter(x => x !== t);
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
      else copy(e.body, 'Email copied' + left);
    },
    'mail-open': () => {
      const e = currentEmail();
      const url = C.mailto(ui.mail.to.trim(), e.subject, e.body);
      Backend.open(url).catch(err => toast(String(err)));
      if (url.length > 2000) toast('Long email: if your mail app cuts it short, use Copy email instead.');
    },
    'import-v01': () => { toggleMenu(false); if ($('#settings').open) $('#settings').close(); $('#importFile').click(); }
  };
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-act]');
    if (a && actions[a.dataset.act]) { actions[a.dataset.act](a); return; }
    const r = e.target.closest('#routines .row[data-rid]');
    if (r) {
      if (e.target.closest('.skip')) routineAction(r.dataset.rid, 'skip');
      else if (e.target.closest('.chk')) routineAction(r.dataset.rid, 'toggle');
    }
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
    $('#meName').value = D.settings.me.name;
    $('#meSignature').value = D.settings.me.signature;
    $('#meLang').value = D.settings.me.lang;
    for (const id of ['meName', 'meSignature', 'meLang']) $('#' + id).disabled = !!readOnly;
    $('#defBegin').value = D.settings.begin;
    $('#defEnd').value = D.settings.end;
    $('#defBegin').disabled = $('#defEnd').disabled = !!readOnly;
    $('#version').textContent = `Valleverde PM ${APP_VERSION}`;
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

  for (const [id, key] of [['meName', 'name'], ['meSignature', 'signature'], ['meLang', 'lang']]) {
    $('#' + id).addEventListener(id === 'meLang' ? 'change' : 'input', e => {
      if (readOnly) return;
      D.settings.me[key] = key === 'lang' ? (e.target.value === 'es' ? 'es' : 'en') : e.target.value;
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
  window.addEventListener('focus', () => checkExternalChange());
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); else checkExternalChange(); });
  window.addEventListener('beforeunload', () => flush());

  function tick() {
    const t = today();
    if (t !== ui.today) {
      const follow = ui.date === ui.today;
      ui.today = t;
      if (follow) { goToDate(t); return; }
    }
    renderBudget();
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
    if (!readOnly && !D.days[ui.date] && !weekGoals().length && !Object.keys(D.days).length) tasksOL.focusGhost();
  }
  boot();
})();

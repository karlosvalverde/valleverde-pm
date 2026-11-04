/* Valleverde PM: the interface. Logic that doesn't touch the page lives in core.js. */
(() => {
  'use strict';
  const APP_VERSION = '0.2.0';
  const SCHEMA = 2;
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
        reveal: () => invoke('reveal_data_file')
      };
    }
    const KEY = 'valleverde-pm-v2';
    return {
      kind: 'browser',
      load: async () => { let c = null; try { c = localStorage.getItem(KEY); } catch {} return { path: null, dir: null, content: c, mtime: 0 }; },
      save: async content => { localStorage.setItem(KEY, content); return 0; },
      mtime: async () => 0
    };
  })();

  /* ---------- data ---------- */
  let D = blank();
  let info = { path: null, dir: null };
  let readOnly = '';
  let lastMtime = 0, dirty = false, saveTimer = 0, saving = Promise.resolve();
  const ui = { date: today(), today: today(), editRoutines: false };

  function blank() {
    return { app: 'valleverde-pm', schema: SCHEMA, settings: { begin: '09:30', end: '18:30' }, routines: [], weeks: {}, days: {} };
  }
  function normalizeData(o) {
    const b = blank();
    if (!o || typeof o !== 'object') return b;
    const arr = x => (Array.isArray(x) ? x.filter(v => v && typeof v === 'object') : []);
    const time = (t, d) => (C.isTime(t) ? t : d);
    const line = x => {
      const l = { id: String(x.id || uid()), text: String(x.text ?? ''), level: x.level === 1 ? 1 : 0, done: !!x.done };
      if (C.isDate(x.moved)) l.moved = x.moved;
      return l;
    };
    b.settings.begin = time(o.settings && o.settings.begin, b.settings.begin);
    b.settings.end = time(o.settings && o.settings.end, b.settings.end);
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
      C.toggle(L, i, this.o.sink);
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
  let goalsOL, tasksOL, routinesOL;
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
        const g = goalNumber(l.text);
        if (g) h += `<span class="goal" title="Serves week goal ${g}">Goal ${g}</span>`;
        const m = C.groupMinutes(L, i);
        if (m.kids) {
          if (m.open) h += `<span class="sum">${C.fmtDur(m.open)}</span>`;
          else if (m.done) h += `<span class="sum quiet">${C.fmtDur(m.done)}</span>`;
        }
        return h;
      },
      onChange: onListChange
    });
    routinesOL = new Outline($('#routinesEdit'), {
      maxLevel: 0, check: false, label: 'Routine', ghost: 'Add a routine, like “15m PM Formech”',
      read: () => D.routines,
      write: () => D.routines,
      onChange: () => { syncRoutines(); changed(); renderBudget(); }
    });
  }

  /* ---------- rendering ---------- */
  function render() {
    renderNav();
    renderNotice();
    renderBudget();
    $('#weekRange').textContent = C.fmtRange(week());
    goalsOL.render();
    renderRoutines();
    tasksOL.render();
    renderBanners();
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
    'retry-save': () => { dirty = true; flush(); }
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

  function ask({ title, body, a, b }) {
    const d = $('#confirm');
    $('#cf-title').textContent = title;
    $('#cf-body').textContent = body;
    $('#cf-a').textContent = a;
    $('#cf-b').textContent = b;
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
    if (e.key === 'Escape' && !$('#menu').hidden) { toggleMenu(false); $('[data-act="menu"]').focus(); return; }
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') || document.querySelector('dialog[open]')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
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

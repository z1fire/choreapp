'use strict';

// ── Constants ──────────────────────────────────────────────────────────────
const COLORS = [
  '#4CAF50','#2196F3','#FF9800','#9C27B0',
  '#F44336','#00BCD4','#FF5722','#E91E63',
  '#607D8B','#795548','#3F51B5','#009688'
];

const DEFAULT_LIBRARY = [
  'Change Bed Sheets', 'Clean Bathroom', 'Clean Ceiling Fan', 'Clean Fridge',
  'Clean Litter Box', 'Clean Microwave', 'Clean Mirrors', 'Clean Oven',
  'Clean Shower', 'Clean Windows', 'Declutter', 'Dishes', 'Dust Furniture',
  'Empty Dishwasher', 'Feed Pets', 'Fold Laundry', 'Grocery Shopping',
  'Iron Clothes', 'Laundry', 'Make Bed', 'Meal Prep', 'Mop',
  'Organize Pantry', 'Sanitize Surfaces', 'Scrub Toilet', 'Sweep',
  'Take Out Recycling', 'Take Out Trash', 'Vacuum', 'Walk Dog',
  'Water Plants', 'Wipe Appliances', 'Wipe Counters', 'Wipe Stove'
];

// ── State ──────────────────────────────────────────────────────────────────
const defaultState = () => ({
  chores: [],
  library: [...DEFAULT_LIBRARY],
  log: []
});

let state = defaultState();
let currentView = 'home';
let editMode = false;
let lastLogId = null;
let undoTimer = null;
let expandedDates = new Set();
let choreFilter = '';
let editingLogId = null;
let libraryEditMode = false;

// ── Storage ────────────────────────────────────────────────────────────────
function loadState() {
  try {
    const raw = localStorage.getItem('choreapp_state');
    if (raw) {
      const saved = JSON.parse(raw);
      state = { ...defaultState(), ...saved };

      // Migrate chores: v1 used `title`, v2+ uses `name`; also ensure color exists
      state.chores = (state.chores || [])
        .filter(c => c && (c.name || c.title))
        .map((c, i) => ({
          id: c.id || uid(),
          name: c.name || c.title,
          color: c.color || COLORS[i % COLORS.length]
        }));

      // Ensure library is a clean string array
      if (!Array.isArray(state.library) || !state.library.length) {
        state.library = [...DEFAULT_LIBRARY];
      } else {
        state.library = state.library.filter(n => typeof n === 'string' && n.trim());
      }

      // Ensure log entries have the notes field
      state.log = (state.log || [])
        .filter(e => e && e.id)
        .map(e => ({ notes: '', ...e }));
    }
  } catch {
    state = defaultState();
  }
}

function saveState() {
  localStorage.setItem('choreapp_state', JSON.stringify(state));
}

// ── Helpers ────────────────────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function todayStr() {
  return new Date().toLocaleDateString('en-CA');
}

function localDateStr(isoString) {
  return new Date(isoString).toLocaleDateString('en-CA');
}

function lastDoneText(choreId) {
  const entries = state.log.filter(e => e.choreId === choreId);
  if (!entries.length) return 'Never done';
  const last = entries[entries.length - 1];
  const lastDate = localDateStr(last.doneAt);
  const today = todayStr();
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
  if (lastDate === today) return 'Done today';
  if (lastDate === yesterday) return 'Yesterday';
  const diffDays = Math.round((new Date(today) - new Date(lastDate)) / 86400000);
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return '1 week ago';
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return `${Math.floor(diffDays / 30)} months ago`;
}

function countDoneToday(choreId) {
  return state.log.filter(e => e.choreId === choreId && localDateStr(e.doneAt) === todayStr()).length;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Chore Grid Actions ─────────────────────────────────────────────────────
function addChoreFromLibrary(name) {
  if (state.chores.some(c => c.name.toLowerCase() === name.toLowerCase())) return;
  state.chores.push({ id: uid(), name, color: COLORS[state.chores.length % COLORS.length] });
  saveState();
  renderHomeGrid();
}

function deleteFromLibrary(name) {
  state.library = state.library.filter(n => n.toLowerCase() !== name.toLowerCase());
  state.chores = state.chores.filter(c => c.name.toLowerCase() !== name.toLowerCase());
  saveState();
  renderHomeGrid();
  renderLibraryModal(document.getElementById('library-search').value);
}

function toggleLibraryEdit() {
  libraryEditMode = !libraryEditMode;
  const btn = document.getElementById('library-edit-btn');
  btn.textContent = libraryEditMode ? 'Done' : 'Edit';
  btn.classList.toggle('active', libraryEditMode);
  renderLibraryModal(document.getElementById('library-search').value);
}

function addCustomChore(name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  if (!state.library.some(n => n.toLowerCase() === trimmed.toLowerCase())) {
    state.library.push(trimmed);
    state.library.sort((a, b) => a.localeCompare(b));
  }
  addChoreFromLibrary(trimmed);
}

function deleteChore(choreId) {
  state.chores = state.chores.filter(c => c.id !== choreId);
  saveState();
  renderHomeGrid();
}

// ── Logging ────────────────────────────────────────────────────────────────
function logChore(choreId) {
  const chore = state.chores.find(c => c.id === choreId);
  if (!chore) return;
  const entry = { id: uid(), choreId, choreName: chore.name, doneAt: new Date().toISOString(), notes: '' };
  state.log.push(entry);
  lastLogId = entry.id;
  saveState();
  renderHomeGrid();
  showLogToast(chore.name);
}

function logQuick(choreName) {
  const entry = { id: uid(), choreId: null, choreName, doneAt: new Date().toISOString(), notes: '' };
  state.log.push(entry);
  lastLogId = entry.id;
  saveState();
  closeModal('add-modal');
  showLogToast(choreName);
}

function undoLog() {
  if (!lastLogId) return;
  state.log = state.log.filter(e => e.id !== lastLogId);
  lastLogId = null;
  clearTimeout(undoTimer);
  saveState();
  renderHomeGrid();
  hideToast();
}

function deleteLogEntry(logId) {
  state.log = state.log.filter(e => e.id !== logId);
  saveState();
  renderHistory();
}

// ── Edit Entry Modal ───────────────────────────────────────────────────────
function isoToLocalInput(isoString) {
  const d = new Date(isoString);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openEditEntryModal(logId) {
  const entry = state.log.find(e => e.id === logId);
  if (!entry) return;
  editingLogId = logId;
  hideToast();
  document.getElementById('edit-entry-chore').textContent = entry.choreName;
  document.getElementById('edit-entry-datetime').value = isoToLocalInput(entry.doneAt);
  document.getElementById('edit-entry-notes').value = entry.notes || '';
  openModal('edit-entry-modal');
}

function saveEditEntry() {
  const entry = state.log.find(e => e.id === editingLogId);
  if (entry) {
    const dtVal = document.getElementById('edit-entry-datetime').value;
    if (dtVal) entry.doneAt = new Date(dtVal).toISOString();
    entry.notes = document.getElementById('edit-entry-notes').value.trim();
    saveState();
    renderHomeGrid();
    if (currentView === 'history') renderHistory();
  }
  closeModal('edit-entry-modal');
  editingLogId = null;
}

// ── Render: Home ───────────────────────────────────────────────────────────
function renderHomeGrid() {
  const grid = document.getElementById('chore-grid');
  if (!state.chores.length) {
    grid.innerHTML = `<div class="empty-state">
      <div class="emoji">🧹</div>
      <h2>No chores yet</h2>
      <p>Tap <strong>+</strong> to pick chores from the library.</p>
    </div>`;
    return;
  }
  grid.innerHTML = state.chores.map(chore => {
    const count = countDoneToday(chore.id);
    const doneToday = count > 0;
    const lastText = doneToday ? `${count}× today` : lastDoneText(chore.id);
    return `
      <button type="button"
        class="chore-tile${doneToday ? ' done-today' : ''}${editMode ? ' edit-mode' : ''}"
        data-id="${chore.id}"
        style="--tile-color:${chore.color}"
        aria-label="${escHtml(chore.name)}"
      >
        ${editMode ? `<span class="delete-x" data-id="${chore.id}" role="button" aria-label="Delete ${escHtml(chore.name)}">✕</span>` : ''}
        <div class="tile-avatar">
          ${doneToday ? `<span class="tile-count">${count}</span>` : escHtml(chore.name[0].toUpperCase())}
        </div>
        <div class="tile-name">${escHtml(chore.name)}</div>
        <div class="tile-last${doneToday ? ' tile-last-done' : ''}">${escHtml(lastText)}</div>
      </button>`;
  }).join('');

  grid.querySelectorAll('.chore-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      if (editMode) return;
      logChore(tile.dataset.id);
      tile.classList.add('tapped');
      setTimeout(() => tile.classList.remove('tapped'), 300);
    });
  });

  grid.querySelectorAll('.delete-x').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deleteChore(btn.dataset.id);
    });
  });
}

// ── Render: Library Modal ──────────────────────────────────────────────────
function renderLibraryModal(searchTerm) {
  const term = (searchTerm || '').toLowerCase().trim();
  const activeNames = new Set(state.chores.map(c => c.name.toLowerCase()));

  const filtered = state.library.filter(name =>
    !term || name.toLowerCase().includes(term)
  );

  const list = document.getElementById('library-list');
  if (!filtered.length) {
    list.innerHTML = '<div class="library-empty">No matches</div>';
  } else {
    list.innerHTML = filtered.map(name => {
      const isActive = activeNames.has(name.toLowerCase());
      return `
        <div class="library-item${isActive ? ' library-item--added' : ''}${libraryEditMode ? ' library-item--editing' : ''}" data-name="${escHtml(name)}">
          <span class="library-item-name">${escHtml(name)}</span>
          <div class="library-item-actions">
            ${libraryEditMode
              ? `<button type="button" class="library-delete-btn" data-name="${escHtml(name)}" aria-label="Remove ${escHtml(name)}">✕</button>`
              : isActive
                ? '<span class="library-item-check">✓ On Grid</span>'
                : `<button type="button" class="library-log-btn" data-name="${escHtml(name)}">Log</button>
                   <button type="button" class="library-item-add" data-name="${escHtml(name)}">+ Add</button>`}
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.library-item-add').forEach(btn => {
      btn.addEventListener('click', () => {
        addChoreFromLibrary(btn.dataset.name);
        renderLibraryModal(searchTerm);
      });
    });
    list.querySelectorAll('.library-log-btn').forEach(btn => {
      btn.addEventListener('click', () => logQuick(btn.dataset.name));
    });
    list.querySelectorAll('.library-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteFromLibrary(btn.dataset.name));
    });
  }

  // Custom chore buttons — shown when search term doesn't exactly match a library item
  const exactMatch = state.library.some(n => n.toLowerCase() === term);
  const customWrap = document.getElementById('custom-add-wrap');
  if (term && !exactMatch) {
    const display = searchTerm.trim();
    customWrap.innerHTML = `
      <div class="custom-chore-actions">
        <button type="button" class="btn btn-ghost" id="log-custom-btn">Log "${escHtml(display)}" once</button>
        <button type="button" class="btn btn-primary" id="add-custom-btn">+ Add to Home</button>
      </div>`;
    document.getElementById('log-custom-btn').addEventListener('click', () => logQuick(display));
    document.getElementById('add-custom-btn').addEventListener('click', () => {
      addCustomChore(display);
      document.getElementById('library-search').value = '';
      renderLibraryModal('');
    });
  } else {
    customWrap.innerHTML = '';
  }
}

function openLibraryModal() {
  libraryEditMode = false;
  document.getElementById('library-edit-btn').textContent = 'Edit';
  document.getElementById('library-edit-btn').classList.remove('active');
  document.getElementById('library-search').value = '';
  renderLibraryModal('');
  openModal('add-modal');
}

// ── Render: History ────────────────────────────────────────────────────────
function renderHistory() {
  const el = document.getElementById('history-list');

  const filterTerm = choreFilter.toLowerCase().trim();
  const filteredLog = filterTerm
    ? state.log.filter(e => e.choreName.toLowerCase().includes(filterTerm))
    : state.log;

  if (!filteredLog.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="emoji">${filterTerm ? '🔍' : '📋'}</div>
      <h2>${filterTerm ? 'No matches' : 'No history yet'}</h2>
      <p>${filterTerm ? `No chores found matching "${escHtml(choreFilter)}".` : 'Log a chore on the Home tab and it\'ll appear here.'}</p>
    </div>`;
    return;
  }

  // Group entries by local date (reverse chron)
  const byDate = {};
  [...filteredLog].reverse().forEach(entry => {
    const date = localDateStr(entry.doneAt);
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(entry);
  });

  // Group dates by month
  const byMonth = {};
  Object.keys(byDate).forEach(date => {
    const month = date.slice(0, 7);
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push(date);
  });

  const today = todayStr();
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');

  el.innerHTML = Object.entries(byMonth)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, dates]) => {
      const monthLabel = new Date(month + '-15T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      return `
        <div class="cal-month">
          <div class="cal-month-label">${escHtml(monthLabel)}</div>
          ${dates.map(date => calDayHTML(date, byDate[date], today, yesterday, filterTerm)).join('')}
        </div>`;
    }).join('');

  el.querySelectorAll('.cal-day-header').forEach(btn => {
    btn.addEventListener('click', () => {
      const date = btn.dataset.date;
      if (expandedDates.has(date)) expandedDates.delete(date);
      else expandedDates.add(date);
      renderHistory();
    });
  });

  el.querySelectorAll('.history-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openEditEntryModal(btn.dataset.logId));
  });
  el.querySelectorAll('.history-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteLogEntry(btn.dataset.logId));
  });
}

function calDayHTML(date, entries, today, yesterday, filterTerm) {
  const isOpen = filterTerm ? true : expandedDates.has(date);
  const count = entries.length;

  let dayName, dayFull;
  if (date === today) { dayName = 'Today'; }
  else if (date === yesterday) { dayName = 'Yesterday'; }
  else { dayName = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }); }
  dayFull = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return `
    <div class="cal-day${isOpen ? ' cal-day--open' : ''}">
      <button type="button" class="cal-day-header" data-date="${date}">
        <div class="cal-day-left">
          <span class="cal-day-name">${escHtml(dayName)}</span>
          <span class="cal-day-date">${escHtml(dayFull)}</span>
        </div>
        <div class="cal-day-right">
          <span class="cal-day-count">${count} chore${count !== 1 ? 's' : ''}</span>
          <span class="cal-chevron">${isOpen ? '▾' : '▸'}</span>
        </div>
      </button>
      ${isOpen ? `<div class="cal-day-entries">${entries.map(entryHTML).join('')}</div>` : ''}
    </div>`;
}

function entryHTML(entry) {
  const chore = state.chores.find(c => c.id === entry.choreId);
  const color = chore ? chore.color : '#9E9E9E';
  const time = new Date(entry.doneAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `
    <div class="history-entry">
      <div class="history-dot" style="background:${color}"></div>
      <div class="history-info">
        <div class="history-chore-name">${escHtml(entry.choreName)}</div>
        <div class="history-time">${escHtml(time)}</div>
        ${entry.notes ? `<div class="history-note">${escHtml(entry.notes)}</div>` : ''}
      </div>
      <div class="history-entry-btns">
        <button type="button" class="history-edit-btn" data-log-id="${entry.id}" aria-label="Edit">✎</button>
        <button type="button" class="history-delete" data-log-id="${entry.id}" aria-label="Delete">✕</button>
      </div>
    </div>`;
}

// ── View Switching ─────────────────────────────────────────────────────────
function showView(view) {
  currentView = view;
  if (editMode && view !== 'home') toggleEditMode(false);
  document.getElementById('view-home').hidden = view !== 'home';
  document.getElementById('view-history').hidden = view !== 'history';
  document.getElementById('fab').classList.toggle('fab--hidden', view !== 'home');
  document.querySelectorAll('.nav-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.view === view)
  );
  if (view === 'history') {
    expandedDates.add(todayStr());
    renderHistory();
  }
}

// ── Edit Mode ──────────────────────────────────────────────────────────────
function toggleEditMode(force) {
  editMode = force !== undefined ? force : !editMode;
  const btn = document.getElementById('edit-btn');
  btn.textContent = editMode ? 'Done' : 'Edit';
  btn.classList.toggle('editing', editMode);
  renderHomeGrid();
}

// ── Modal Helpers ──────────────────────────────────────────────────────────
function openModal(id) {
  const overlay = document.getElementById(id);
  overlay.classList.add('open');
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(id);
  }, { once: true });
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// ── Export / Import ────────────────────────────────────────────────────────
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `choreapp-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showSimpleToast('Backup saved');
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported.chores) || !Array.isArray(imported.log)) throw new Error();
      state = { ...defaultState(), ...imported };
      saveState();
      renderHomeGrid();
      showSimpleToast(`Imported ${state.chores.length} chores, ${state.log.length} entries`);
    } catch {
      showSimpleToast('Invalid backup file');
    }
  };
  reader.readAsText(file);
}

// ── Toast ──────────────────────────────────────────────────────────────────
function showLogToast(choreName) {
  const t = document.getElementById('toast');
  t.innerHTML = `
    <span>${escHtml(choreName)} logged</span>
    <button type="button" class="toast-action-btn" id="edit-log-btn">Edit ✎</button>
    <button type="button" class="toast-action-btn" id="undo-btn">Undo</button>`;
  t.classList.add('show');
  document.getElementById('edit-log-btn').addEventListener('click', () => openEditEntryModal(lastLogId));
  document.getElementById('undo-btn').addEventListener('click', undoLog);
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideToast, 5000);
}

function showSimpleToast(msg) {
  const t = document.getElementById('toast');
  t.innerHTML = `<span>${escHtml(msg)}</span>`;
  t.classList.add('show');
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideToast, 2500);
}

function hideToast() {
  document.getElementById('toast').classList.remove('show');
}

// ── Service Worker ─────────────────────────────────────────────────────────
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    // Force immediate check for an updated SW
    reg.update();
  }).catch(() => {});

  // When a new SW takes control, reload once to serve fresh cached files
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

// ── Install Banner ─────────────────────────────────────────────────────────
function setupInstallBanner() {
  // Suppress Chrome's mini-infobar — install is available via browser menu
  window.addEventListener('beforeinstallprompt', e => e.preventDefault());
}

// ── Init ───────────────────────────────────────────────────────────────────
function init() {
  loadState();
  registerSW();
  setupInstallBanner();

  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => showView(tab.dataset.view));
  });

  document.getElementById('edit-btn').addEventListener('click', () => toggleEditMode());
  document.getElementById('fab').addEventListener('click', openLibraryModal);

  // Library modal
  document.getElementById('close-library').addEventListener('click', () => { libraryEditMode = false; closeModal('add-modal'); });
  document.getElementById('library-edit-btn').addEventListener('click', toggleLibraryEdit);
  document.getElementById('library-search').addEventListener('input', e => {
    renderLibraryModal(e.target.value);
  });

  // Edit entry modal
  document.getElementById('save-edit-entry').addEventListener('click', saveEditEntry);
  document.getElementById('cancel-edit-entry').addEventListener('click', () => closeModal('edit-entry-modal'));

  // History filter
  document.getElementById('history-filter').addEventListener('input', e => {
    choreFilter = e.target.value;
    renderHistory();
  });

  // Export / Import
  document.getElementById('export-btn').addEventListener('click', exportData);
  document.getElementById('import-input').addEventListener('change', e => {
    importData(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('import-btn').addEventListener('click', () =>
    document.getElementById('import-input').click()
  );

  showView('home');
  renderHomeGrid();
}

document.addEventListener('DOMContentLoaded', init);

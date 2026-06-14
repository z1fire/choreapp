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

function isDoneToday(choreId) {
  return state.log.some(e => e.choreId === choreId && localDateStr(e.doneAt) === todayStr());
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

// ── Notes ──────────────────────────────────────────────────────────────────
function openNoteModal() {
  const entry = state.log.find(e => e.id === lastLogId);
  if (!entry) { showSimpleToast('No recent log to add note to'); return; }
  hideToast();
  document.getElementById('note-chore-label').textContent = entry.choreName;
  document.getElementById('note-input').value = entry.notes || '';
  openModal('note-modal');
  setTimeout(() => document.getElementById('note-input').focus(), 300);
}

function saveNote() {
  const entry = state.log.find(e => e.id === lastLogId);
  if (entry) {
    entry.notes = document.getElementById('note-input').value.trim();
    saveState();
    if (currentView === 'history') renderHistory();
  }
  closeModal('note-modal');
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
    const doneToday = isDoneToday(chore.id);
    return `
      <button type="button"
        class="chore-tile${doneToday ? ' done-today' : ''}${editMode ? ' edit-mode' : ''}"
        data-id="${chore.id}"
        style="--tile-color:${chore.color}"
        aria-label="${escHtml(chore.name)}"
      >
        ${editMode ? `<span class="delete-x" data-id="${chore.id}" role="button" aria-label="Delete ${escHtml(chore.name)}">✕</span>` : ''}
        <div class="tile-avatar">
          ${doneToday ? '<span class="check-icon">✓</span>' : escHtml(chore.name[0].toUpperCase())}
        </div>
        <div class="tile-name">${escHtml(chore.name)}</div>
        <div class="tile-last${doneToday ? ' tile-last-done' : ''}">${escHtml(lastDoneText(chore.id))}</div>
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
        <div class="library-item${isActive ? ' library-item--added' : ''}" data-name="${escHtml(name)}">
          <span class="library-item-name">${escHtml(name)}</span>
          <div class="library-item-actions">
            ${isActive
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
  renderLibraryModal('');
  document.getElementById('library-search').value = '';
  openModal('add-modal');
}

// ── Render: History ────────────────────────────────────────────────────────
function renderHistory() {
  const el = document.getElementById('history-list');
  if (!state.log.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="emoji">📋</div>
      <h2>No history yet</h2>
      <p>Log a chore on the Home tab and it'll appear here.</p>
    </div>`;
    return;
  }

  const grouped = {};
  [...state.log].reverse().forEach(entry => {
    const date = localDateStr(entry.doneAt);
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(entry);
  });

  const today = todayStr();
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');

  el.innerHTML = Object.entries(grouped).map(([date, entries]) => {
    let label;
    if (date === today) label = 'Today';
    else if (date === yesterday) label = 'Yesterday';
    else label = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    return `
      <div class="history-group">
        <div class="history-date-label">${escHtml(label)}</div>
        ${entries.map(entry => {
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
              <button type="button" class="history-delete" data-log-id="${entry.id}" aria-label="Delete">✕</button>
            </div>`;
        }).join('')}
      </div>`;
  }).join('');

  el.querySelectorAll('.history-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteLogEntry(btn.dataset.logId));
  });
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
  if (view === 'history') renderHistory();
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
    <button type="button" class="toast-action-btn" id="note-btn">Note ✎</button>
    <button type="button" class="toast-action-btn" id="undo-btn">Undo</button>`;
  t.classList.add('show');
  document.getElementById('note-btn').addEventListener('click', openNoteModal);
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
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

// ── Install Banner ─────────────────────────────────────────────────────────
function setupInstallBanner() {
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('install-banner').classList.remove('install-banner--hidden');
  });
  document.getElementById('install-btn')?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    document.getElementById('install-banner').classList.add('install-banner--hidden');
    deferredPrompt = null;
  });
  document.getElementById('install-dismiss')?.addEventListener('click', () => {
    document.getElementById('install-banner').classList.add('install-banner--hidden');
  });
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
  document.getElementById('close-library').addEventListener('click', () => closeModal('add-modal'));
  document.getElementById('library-search').addEventListener('input', e => {
    renderLibraryModal(e.target.value);
  });

  // Note modal
  document.getElementById('save-note').addEventListener('click', saveNote);
  document.getElementById('cancel-note').addEventListener('click', () => closeModal('note-modal'));

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

'use strict';

// ── Constants ──────────────────────────────────────────────────────────────
const COLORS = [
  '#4CAF50','#2196F3','#FF9800','#9C27B0',
  '#F44336','#00BCD4','#FF5722','#E91E63',
  '#607D8B','#795548','#3F51B5','#009688'
];

const DEFAULT_CHORES = [
  { name: 'Dishes' },
  { name: 'Vacuum' },
  { name: 'Laundry' },
  { name: 'Mop' },
  { name: 'Trash' },
  { name: 'Clean Bathroom' },
  { name: 'Wipe Counters' },
  { name: 'Sweep' },
];

// ── State ──────────────────────────────────────────────────────────────────
const defaultState = () => ({
  chores: DEFAULT_CHORES.map((c, i) => ({
    id: uid(),
    name: c.name,
    color: COLORS[i % COLORS.length]
  })),
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
    if (raw) state = JSON.parse(raw);
  } catch {}
}

function saveState() {
  localStorage.setItem('choreapp_state', JSON.stringify(state));
}

// ── Helpers ────────────────────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function todayStr() {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
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

  if (lastDate === today) return `Done today`;
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

function colorForIndex(i) {
  return COLORS[i % COLORS.length];
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Actions ────────────────────────────────────────────────────────────────
function logChore(choreId) {
  const chore = state.chores.find(c => c.id === choreId);
  if (!chore) return;

  const entry = {
    id: uid(),
    choreId,
    choreName: chore.name,
    doneAt: new Date().toISOString()
  };
  state.log.push(entry);
  lastLogId = entry.id;
  saveState();
  renderHomeGrid();
  showToastWithUndo(`Logged: ${chore.name}`);
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

function addChore(name) {
  if (!name.trim()) return;
  const existing = state.chores.find(c => c.name.toLowerCase() === name.trim().toLowerCase());
  if (existing) { showSimpleToast('Chore already exists'); return; }
  state.chores.push({
    id: uid(),
    name: name.trim(),
    color: COLORS[state.chores.length % COLORS.length]
  });
  saveState();
  renderHomeGrid();
}

function deleteChore(choreId) {
  state.chores = state.chores.filter(c => c.id !== choreId);
  state.log = state.log.filter(e => e.choreId !== choreId);
  saveState();
  renderHomeGrid();
}

function deleteLogEntry(logId) {
  state.log = state.log.filter(e => e.id !== logId);
  saveState();
  renderHistory();
}

// ── Render: Home ───────────────────────────────────────────────────────────
function renderHomeGrid() {
  const grid = document.getElementById('chore-grid');
  if (!state.chores.length) {
    grid.innerHTML = `<div class="empty-state">
      <div class="emoji">🧹</div>
      <h2>No chores yet</h2>
      <p>Tap + to add your first chore.</p>
    </div>`;
    return;
  }

  grid.innerHTML = state.chores.map(chore => {
    const doneToday = isDoneToday(chore.id);
    const lastText = lastDoneText(chore.id);
    return `
      <button
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
        <div class="tile-last${doneToday ? ' tile-last-done' : ''}">${escHtml(lastText)}</div>
      </button>`;
  }).join('');

  grid.querySelectorAll('.chore-tile').forEach(tile => {
    tile.addEventListener('click', e => {
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

  // Group by local date, reverse chrono
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

    const chore = (choreId) => state.chores.find(c => c.id === choreId);

    return `
      <div class="history-group">
        <div class="history-date-label">${escHtml(label)}</div>
        ${entries.map(entry => {
          const c = chore(entry.choreId);
          const color = c ? c.color : '#9E9E9E';
          const time = new Date(entry.doneAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
          return `
            <div class="history-entry">
              <div class="history-dot" style="background:${color}"></div>
              <div class="history-info">
                <div class="history-chore-name">${escHtml(entry.choreName)}</div>
                <div class="history-time">${escHtml(time)}</div>
              </div>
              <button class="history-delete" data-log-id="${entry.id}" aria-label="Delete entry">✕</button>
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

// ── Add Chore Modal ────────────────────────────────────────────────────────
function openAddModal() {
  document.getElementById('new-chore-input').value = '';
  const overlay = document.getElementById('add-modal');
  overlay.classList.add('open');
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeAddModal();
  }, { once: true });
  setTimeout(() => document.getElementById('new-chore-input').focus(), 300);
}

function closeAddModal() {
  document.getElementById('add-modal').classList.remove('open');
}

function submitAddChore(e) {
  e.preventDefault();
  const name = document.getElementById('new-chore-input').value;
  addChore(name);
  closeAddModal();
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
      state = imported;
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
function showToastWithUndo(msg) {
  const t = document.getElementById('toast');
  t.innerHTML = `<span>${escHtml(msg)}</span><button class="undo-btn" id="undo-btn">Undo</button>`;
  t.classList.add('show');
  document.getElementById('undo-btn').addEventListener('click', undoLog);
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideToast, 4000);
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
    const banner = document.getElementById('install-banner');
    if (banner) banner.classList.remove('install-banner--hidden');
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

  // Bottom nav
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => showView(tab.dataset.view));
  });

  // Edit mode toggle
  document.getElementById('edit-btn').addEventListener('click', () => toggleEditMode());

  // FAB → add modal
  document.getElementById('fab').addEventListener('click', openAddModal);

  // Add chore form
  document.getElementById('add-chore-form').addEventListener('submit', submitAddChore);
  document.getElementById('cancel-add').addEventListener('click', closeAddModal);

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

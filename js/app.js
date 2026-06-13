'use strict';

// ── State ──────────────────────────────────────────────────────────────────
const defaultState = () => ({
  chores: [],
  people: ['Everyone', 'Me'],
  settings: { houseName: 'Our Home' }
});

let state = defaultState();
let activeFilter = 'all'; // 'all' | 'today' | 'done'
let deferredInstallPrompt = null;

// ── Storage ────────────────────────────────────────────────────────────────
function loadState() {
  try {
    const raw = localStorage.getItem('choreapp_state');
    if (raw) state = { ...defaultState(), ...JSON.parse(raw) };
  } catch {}
}

function saveState() {
  localStorage.setItem('choreapp_state', JSON.stringify(state));
}

// ── Helpers ────────────────────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(date) {
  if (!date) return null;
  const d = new Date(date + 'T00:00:00');
  const diff = Math.round((d - new Date(today() + 'T00:00:00')) / 86400000);
  if (diff < -1) return `${Math.abs(diff)}d overdue`;
  if (diff === -1) return 'Yesterday';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff < 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function dateBadgeClass(date) {
  if (!date) return '';
  const diff = Math.round((new Date(date + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  return '';
}

const RECURRING_LABELS = { none: '', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

// ── Filtering ──────────────────────────────────────────────────────────────
function filteredChores() {
  switch (activeFilter) {
    case 'today':
      return state.chores.filter(c => !c.completed && c.dueDate <= today());
    case 'done':
      return state.chores.filter(c => c.completed);
    default:
      return [...state.chores].sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;
        return b.createdAt.localeCompare(a.createdAt);
      });
  }
}

// ── Render ─────────────────────────────────────────────────────────────────
function render() {
  renderSubtitle();
  renderTabs();
  renderChores();
}

function renderSubtitle() {
  const pending = state.chores.filter(c => !c.completed).length;
  document.getElementById('subtitle').textContent =
    pending === 0 ? 'All done!' : `${pending} chore${pending !== 1 ? 's' : ''} pending`;
}

function renderTabs() {
  const todayCount = state.chores.filter(c => !c.completed && c.dueDate <= today()).length;
  document.getElementById('tab-today').textContent = `Today${todayCount ? ` (${todayCount})` : ''}`;
}

function renderChores() {
  const list = filteredChores();
  const el = document.getElementById('chores-list');

  if (list.length === 0) {
    el.innerHTML = emptyStateHTML();
    return;
  }

  el.innerHTML = list.map(choreCardHTML).join('');
  el.querySelectorAll('.chore-check').forEach(btn =>
    btn.addEventListener('click', () => toggleChore(btn.dataset.id))
  );
  el.querySelectorAll('.chore-delete').forEach(btn =>
    btn.addEventListener('click', () => deleteChore(btn.dataset.id))
  );
}

function choreCardHTML(c) {
  const dateLabel = fmt(c.dueDate);
  const dateClass = c.completed ? '' : dateBadgeClass(c.dueDate);
  const recurLabel = RECURRING_LABELS[c.recurring] || '';
  return `
    <div class="chore-card${c.completed ? ' completed' : ''}">
      <button class="chore-check" data-id="${c.id}" aria-label="Toggle complete"></button>
      <div class="chore-body">
        <div class="chore-title">${escHtml(c.title)}</div>
        <div class="chore-meta">
          ${c.assignedTo && c.assignedTo !== 'Everyone' ? `<span class="badge person">${escHtml(c.assignedTo)}</span>` : ''}
          ${dateLabel ? `<span class="badge ${dateClass}">${escHtml(dateLabel)}</span>` : ''}
          ${recurLabel ? `<span class="badge recurring">${escHtml(recurLabel)}</span>` : ''}
        </div>
      </div>
      <button class="chore-delete" data-id="${c.id}" aria-label="Delete">✕</button>
    </div>`;
}

function emptyStateHTML() {
  const msgs = {
    all: ['🎉', 'No chores yet!', 'Tap + to add your first chore.'],
    today: ['✅', 'Nothing due today!', 'Enjoy your free time.'],
    done: ['📋', 'Nothing completed yet', 'Mark chores done and they\'ll appear here.']
  };
  const [emoji, title, sub] = msgs[activeFilter];
  return `<div class="empty-state"><div class="emoji">${emoji}</div><h2>${title}</h2><p>${sub}</p></div>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Actions ────────────────────────────────────────────────────────────────
function addChore({ title, assignedTo, dueDate, recurring }) {
  if (!title.trim()) return;
  state.chores.push({
    id: uid(),
    title: title.trim(),
    assignedTo: assignedTo || 'Everyone',
    dueDate: dueDate || null,
    recurring: recurring || 'none',
    completed: false,
    completedAt: null,
    createdAt: new Date().toISOString()
  });
  saveState();
  render();
}

function toggleChore(id) {
  const chore = state.chores.find(c => c.id === id);
  if (!chore) return;
  chore.completed = !chore.completed;
  chore.completedAt = chore.completed ? new Date().toISOString() : null;

  if (chore.completed && chore.recurring !== 'none') {
    scheduleRecurring(chore);
  }

  saveState();
  render();
}

function scheduleRecurring(chore) {
  if (!chore.dueDate) return;
  const next = new Date(chore.dueDate + 'T00:00:00');
  if (chore.recurring === 'daily') next.setDate(next.getDate() + 1);
  else if (chore.recurring === 'weekly') next.setDate(next.getDate() + 7);
  else if (chore.recurring === 'monthly') next.setMonth(next.getMonth() + 1);
  state.chores.push({
    ...chore,
    id: uid(),
    completed: false,
    completedAt: null,
    createdAt: new Date().toISOString(),
    dueDate: next.toISOString().slice(0, 10)
  });
}

function deleteChore(id) {
  state.chores = state.chores.filter(c => c.id !== id);
  saveState();
  render();
  showToast('Chore deleted');
}

// ── Add Chore Modal ────────────────────────────────────────────────────────
function openAddModal() {
  populatePeopleSelect('chore-person');
  document.getElementById('chore-title').value = '';
  document.getElementById('chore-person').value = 'Everyone';
  document.getElementById('chore-date').value = '';
  document.getElementById('chore-recurring').value = 'none';
  showModal('add-modal');
  setTimeout(() => document.getElementById('chore-title').focus(), 300);
}

function submitAddChore(e) {
  e.preventDefault();
  addChore({
    title: document.getElementById('chore-title').value,
    assignedTo: document.getElementById('chore-person').value,
    dueDate: document.getElementById('chore-date').value,
    recurring: document.getElementById('chore-recurring').value
  });
  closeModal('add-modal');
}

function populatePeopleSelect(selectId) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = state.people.map(p => `<option value="${escHtml(p)}">${escHtml(p)}</option>`).join('');
}

// ── Settings Sheet ─────────────────────────────────────────────────────────
function openSettings() {
  renderPeopleList();
  document.getElementById('house-name-input').value = state.settings.houseName;
  showModal('settings-modal');
}

function renderPeopleList() {
  const list = document.getElementById('people-list');
  list.innerHTML = state.people.map(p => `
    <div class="person-chip">
      ${escHtml(p)}
      <button class="person-chip-remove" data-name="${escHtml(p)}" aria-label="Remove ${escHtml(p)}">×</button>
    </div>`).join('');
  list.querySelectorAll('.person-chip-remove').forEach(btn =>
    btn.addEventListener('click', () => removePerson(btn.dataset.name))
  );
}

function addPerson() {
  const input = document.getElementById('new-person-input');
  const name = input.value.trim();
  if (!name || state.people.includes(name)) {
    if (!name) return;
    showToast('Person already exists');
    return;
  }
  state.people.push(name);
  input.value = '';
  saveState();
  renderPeopleList();
}

function removePerson(name) {
  if (name === 'Everyone') { showToast('Cannot remove Everyone'); return; }
  state.people = state.people.filter(p => p !== name);
  saveState();
  renderPeopleList();
}

function saveHouseName() {
  const name = document.getElementById('house-name-input').value.trim();
  if (name) {
    state.settings.houseName = name;
    saveState();
    document.getElementById('house-name').textContent = name;
  }
}

// ── Export / Import ────────────────────────────────────────────────────────
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `choreapp-backup-${today()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup saved to Downloads');
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!imported.chores || !Array.isArray(imported.chores)) throw new Error();
      state = { ...defaultState(), ...imported };
      saveState();
      render();
      closeModal('settings-modal');
      showToast(`Imported ${state.chores.length} chores`);
    } catch {
      showToast('Invalid backup file');
    }
  };
  reader.readAsText(file);
}

function clearAllData() {
  if (!confirm('Delete ALL chores? This cannot be undone.')) return;
  state = defaultState();
  saveState();
  render();
  closeModal('settings-modal');
  showToast('All data cleared');
}

// ── Modal Helpers ──────────────────────────────────────────────────────────
function showModal(id) {
  const overlay = document.getElementById(id);
  overlay.classList.add('open');
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(id);
  }, { once: true });
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ── Install Banner ─────────────────────────────────────────────────────────
function setupInstallBanner() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const banner = document.getElementById('install-banner');
    if (banner) banner.style.display = 'flex';
  });

  const installBtn = document.getElementById('install-btn');
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        document.getElementById('install-banner').style.display = 'none';
      }
      deferredInstallPrompt = null;
    });
  }

  const dismissBtn = document.getElementById('install-dismiss');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      document.getElementById('install-banner').style.display = 'none';
    });
  }
}

// ── Service Worker ─────────────────────────────────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

// ── Init ───────────────────────────────────────────────────────────────────
function init() {
  loadState();
  registerSW();
  setupInstallBanner();

  document.getElementById('house-name').textContent = state.settings.houseName;

  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      activeFilter = tab.dataset.filter;
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
      renderChores();
    });
  });

  // FAB
  document.getElementById('fab').addEventListener('click', openAddModal);

  // Settings
  document.getElementById('settings-btn').addEventListener('click', openSettings);

  // Add chore form
  document.getElementById('add-chore-form').addEventListener('submit', submitAddChore);
  document.getElementById('cancel-add').addEventListener('click', () => closeModal('add-modal'));

  // Settings form
  document.getElementById('close-settings').addEventListener('click', () => closeModal('settings-modal'));
  document.getElementById('add-person-btn').addEventListener('click', addPerson);
  document.getElementById('new-person-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addPerson(); }
  });
  document.getElementById('house-name-input').addEventListener('change', saveHouseName);
  document.getElementById('export-btn').addEventListener('click', exportData);
  document.getElementById('import-input').addEventListener('change', e => importData(e.target.files[0]));
  document.getElementById('import-btn').addEventListener('click', () => document.getElementById('import-input').click());
  document.getElementById('clear-btn').addEventListener('click', clearAllData);

  render();
}

document.addEventListener('DOMContentLoaded', init);

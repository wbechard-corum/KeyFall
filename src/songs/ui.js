import { listSongs, saveSong, getSong, deleteSong, renameSong, setSongStarred } from '../trainer/library.js';

const TEMPLATE = `
  <div class="songs-root">
    <div class="songs-header">
      <div>
        <div class="songs-title">Song Library</div>
        <div class="songs-subtitle" data-role="subtitle">—</div>
      </div>
      <div class="songs-actions">
        <button class="songs-btn primary" data-action="upload">Upload MIDI</button>
        <input type="file" class="file-input" data-role="file-input" accept=".mid,.midi" multiple>
      </div>
    </div>

    <div class="songs-tabs">
      <button class="songs-tab active" data-tab="all">ALL</button>
      <button class="songs-tab" data-tab="starred">★ STARRED</button>
    </div>

    <div class="songs-body">
      <div class="songs-empty hidden" data-role="empty"></div>
      <div class="songs-error hidden" data-role="error"></div>
      <div class="songs-list-wrap">
        <div class="songs-list" data-role="list"></div>
        <div class="songs-jump" data-role="jump"></div>
      </div>
    </div>

    <div class="songs-modal hidden" data-role="rename-modal">
      <div class="songs-modal-backdrop" data-role="rename-backdrop"></div>
      <div class="songs-modal-card">
        <div class="songs-modal-title">Rename song</div>
        <input class="songs-modal-input" type="text" data-role="rename-input" maxlength="200">
        <div class="songs-modal-actions">
          <button class="songs-modal-btn" data-action="rename-cancel">Cancel</button>
          <button class="songs-modal-btn primary" data-action="rename-save">Save</button>
        </div>
      </div>
    </div>
  </div>
`;

export function mountSongs(root, { onLoadSong } = {}) {
  root.innerHTML = TEMPLATE;
  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => root.querySelectorAll(sel);

  const fileInput = $('[data-role="file-input"]');
  const list = $('[data-role="list"]');
  const empty = $('[data-role="empty"]');
  const errorEl = $('[data-role="error"]');
  const subtitle = $('[data-role="subtitle"]');
  const jumpHost = $('[data-role="jump"]');
  const renameModal = $('[data-role="rename-modal"]');
  const renameInput = $('[data-role="rename-input"]');

  let activeTab = 'all';
  let allRows = [];
  let renameTarget = null;

  $('[data-action="upload"]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => handleFiles(Array.from(e.target.files || [])));

  $$('.songs-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      $$('.songs-tab').forEach(b => b.classList.toggle('active', b === btn));
      renderList();
    });
  });

  $('[data-action="rename-cancel"]').addEventListener('click', closeRename);
  $('[data-action="rename-save"]').addEventListener('click', commitRename);
  $('[data-role="rename-backdrop"]').addEventListener('click', closeRename);
  renameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitRename();
    else if (e.key === 'Escape') closeRename();
  });

  const body = root.querySelector('.songs-body');
  body.addEventListener('dragover', (e) => { e.preventDefault(); body.classList.add('dragging'); });
  body.addEventListener('dragleave', () => body.classList.remove('dragging'));
  body.addEventListener('drop', (e) => {
    e.preventDefault();
    body.classList.remove('dragging');
    const files = Array.from(e.dataTransfer?.files || []).filter(f => /\.(mid|midi)$/i.test(f.name));
    if (files.length) handleFiles(files);
  });

  refresh();

  async function handleFiles(files) {
    errorEl.classList.add('hidden');
    for (const file of files) {
      try {
        const bytes = await file.arrayBuffer();
        const name = file.name.replace(/\.(mid|midi)$/i, '');
        await saveSong({ name, bytes });
      } catch (err) {
        showError(`Upload failed for ${file.name}: ${err.message}`);
      }
    }
    fileInput.value = '';
    refresh();
  }

  async function refresh() {
    try {
      allRows = await listSongs();
      renderList();
    } catch (err) {
      showError(`Failed to load library: ${err.message}`);
    }
  }

  function visibleRows() {
    const rows = activeTab === 'starred' ? allRows.filter(r => r.starred) : allRows;
    return [...rows].sort((a, b) => a.name.localeCompare(b.name));
  }

  function renderList() {
    list.innerHTML = '';
    const rows = visibleRows();
    const totalLabel = `${allRows.length} song${allRows.length === 1 ? '' : 's'}` +
      (activeTab === 'starred' ? ` · ${rows.length} starred` : '');
    subtitle.textContent = totalLabel;

    if (rows.length === 0) {
      empty.classList.remove('hidden');
      empty.textContent = activeTab === 'starred'
        ? 'No starred songs yet — tap the ☆ on any row to add one.'
        : 'No songs uploaded yet. Drop .mid files here or use the Upload button.';
      jumpHost.innerHTML = '';
      return;
    }
    empty.classList.add('hidden');

    let lastLetter = null;
    const letterAnchors = {};
    for (const row of rows) {
      const letter = (row.name[0] || '#').toUpperCase();
      if (letter !== lastLetter) {
        const header = document.createElement('div');
        header.className = 'songs-section';
        header.textContent = letter;
        header.dataset.letter = letter;
        list.appendChild(header);
        letterAnchors[letter] = header;
        lastLetter = letter;
      }
      list.appendChild(buildRow(row));
    }
    renderJumpIndex(letterAnchors);
  }

  function buildRow(row) {
    const item = document.createElement('div');
    item.className = 'songs-item';

    const star = document.createElement('button');
    star.className = 'songs-item-star' + (row.starred ? ' on' : '');
    star.setAttribute('aria-label', row.starred ? `Unstar ${row.name}` : `Star ${row.name}`);
    star.textContent = row.starred ? '★' : '☆';
    star.addEventListener('click', async (e) => {
      e.stopPropagation();
      const next = !row.starred;
      // Optimistic UI; revert on failure.
      row.starred = next;
      star.classList.toggle('on', next);
      star.textContent = next ? '★' : '☆';
      try { await setSongStarred(row.id, next); }
      catch (err) {
        row.starred = !next;
        star.classList.toggle('on', !next);
        star.textContent = !next ? '★' : '☆';
        showError(`Star failed: ${err.message}`);
      }
      if (activeTab === 'starred' && !row.starred) renderList();
      else subtitle.textContent =
        `${allRows.length} song${allRows.length === 1 ? '' : 's'}` +
        (activeTab === 'starred' ? ` · ${visibleRows().length} starred` : '');
    });

    const info = document.createElement('button');
    info.className = 'songs-item-info';
    info.innerHTML = `
      <div class="songs-item-name"></div>
      <div class="songs-item-meta">${formatBytes(row.size)} · ${formatDate(row.addedAt)}</div>
    `;
    info.querySelector('.songs-item-name').textContent = row.name;
    info.addEventListener('click', () => loadSong(row));

    const renameBtn = document.createElement('button');
    renameBtn.className = 'songs-item-rename';
    renameBtn.setAttribute('aria-label', `Rename ${row.name}`);
    renameBtn.textContent = '✎';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openRename(row);
    });

    const del = document.createElement('button');
    del.className = 'songs-item-del';
    del.setAttribute('aria-label', `Delete ${row.name}`);
    del.textContent = '×';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${row.name}"?`)) return;
      try { await deleteSong(row.id); refresh(); }
      catch (err) { showError(`Delete failed: ${err.message}`); }
    });

    item.appendChild(star);
    item.appendChild(info);
    item.appendChild(renameBtn);
    item.appendChild(del);
    return item;
  }

  function renderJumpIndex(letterAnchors) {
    jumpHost.innerHTML = '';
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
    for (const letter of letters) {
      const present = !!letterAnchors[letter];
      const btn = document.createElement('button');
      btn.className = 'songs-jump-letter' + (present ? '' : ' faint');
      btn.textContent = letter;
      btn.disabled = !present;
      btn.addEventListener('click', () => {
        const target = letterAnchors[letter];
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      jumpHost.appendChild(btn);
    }
  }

  async function loadSong(row) {
    try {
      const record = await getSong(row.id);
      if (!record) { showError('Song not found.'); return; }
      onLoadSong?.({ id: row.id, name: row.name, bytes: record.bytes });
    } catch (err) {
      showError(`Load failed: ${err.message}`);
    }
  }

  function openRename(row) {
    renameTarget = row;
    renameInput.value = row.name;
    renameModal.classList.remove('hidden');
    setTimeout(() => { renameInput.focus(); renameInput.select(); }, 30);
  }

  function closeRename() {
    renameTarget = null;
    renameModal.classList.add('hidden');
  }

  async function commitRename() {
    if (!renameTarget) return;
    const next = renameInput.value.trim();
    if (!next || next === renameTarget.name) { closeRename(); return; }
    try {
      await renameSong(renameTarget.id, next);
      renameTarget.name = next;
      closeRename();
      renderList();
    } catch (err) {
      showError(`Rename failed: ${err.message}`);
      closeRename();
    }
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  }

  return {
    refresh,
    destroy() {},
  };
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

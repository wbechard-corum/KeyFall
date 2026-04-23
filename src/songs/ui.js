import { listSongs, saveSong, getSong, deleteSong } from '../trainer/library.js';

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

    <div class="songs-body">
      <div class="songs-empty hidden" data-role="empty">
        No songs uploaded yet. Drop .mid files here or use the Upload button.
      </div>
      <div class="songs-error hidden" data-role="error"></div>
      <div class="songs-list" data-role="list"></div>
    </div>
  </div>
`;

export function mountSongs(root, { onLoadSong } = {}) {
  root.innerHTML = TEMPLATE;
  const $ = (sel) => root.querySelector(sel);

  const fileInput = $('[data-role="file-input"]');
  const list = $('[data-role="list"]');
  const empty = $('[data-role="empty"]');
  const errorEl = $('[data-role="error"]');
  const subtitle = $('[data-role="subtitle"]');

  $('[data-action="upload"]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => handleFiles(Array.from(e.target.files || [])));

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
      const rows = await listSongs();
      renderList(rows);
    } catch (err) {
      showError(`Failed to load library: ${err.message}`);
    }
  }

  function renderList(rows) {
    list.innerHTML = '';
    if (rows.length === 0) {
      empty.classList.remove('hidden');
      subtitle.textContent = 'Empty';
      return;
    }
    empty.classList.add('hidden');
    subtitle.textContent = `${rows.length} song${rows.length === 1 ? '' : 's'}`;

    for (const row of rows) {
      const item = document.createElement('div');
      item.className = 'songs-item';

      const info = document.createElement('button');
      info.className = 'songs-item-info';
      info.innerHTML = `
        <div class="songs-item-name">${escapeHtml(row.name)}</div>
        <div class="songs-item-meta">${formatBytes(row.size)} · ${formatDate(row.addedAt)}</div>
      `;
      info.addEventListener('click', () => loadSong(row));

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

      item.appendChild(info);
      item.appendChild(del);
      list.appendChild(item);
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

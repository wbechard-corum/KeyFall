const API = '/api/songs';

export async function listSongs() {
  const res = await fetch(API);
  if (!res.ok) throw new Error(`list failed: ${res.status}`);
  return await res.json();
}

export async function saveSong({ name, bytes }) {
  const res = await fetch(`${API}?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: bytes,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return await res.json();
}

export async function getSong(id) {
  const res = await fetch(`${API}/${encodeURIComponent(id)}`);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`get failed: ${res.status}`);
  }
  const bytes = await res.arrayBuffer();
  // API returns raw .mid bytes; callers parse them. Recover the name from
  // the content-disposition header so callers that only have an id (the
  // mirror client's "load this song" command) can still label it.
  return { id, bytes, name: filenameFromDisposition(res.headers.get('content-disposition')) };
}

function filenameFromDisposition(header) {
  if (!header) return null;
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  if (!m) return null;
  try { return decodeURIComponent(m[1]).replace(/\.midi?$/i, '') || null; }
  catch { return m[1].replace(/\.midi?$/i, '') || null; }
}

export async function deleteSong(id) {
  const res = await fetch(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`delete failed: ${res.status}`);
}

async function patchSongFields(id, patch) {
  const res = await fetch(`${API}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`patch failed: ${res.status}`);
  return await res.json();
}

export function renameSong(id, name) {
  return patchSongFields(id, { name });
}

export function setSongStarred(id, starred) {
  return patchSongFields(id, { starred });
}

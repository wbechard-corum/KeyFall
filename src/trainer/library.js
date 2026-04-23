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
  // API returns raw .mid bytes; callers parse them. Preserve the name
  // from the content-disposition header when available, otherwise the
  // caller should have tracked it from the list.
  return { id, bytes };
}

export async function deleteSong(id) {
  const res = await fetch(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`delete failed: ${res.status}`);
}

let dbPromise;
function cloudEnabled() { return !location.hostname.endsWith('.github.io') && location.protocol !== 'file:'; }
function database() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('seichi-frame', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('photos');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('他のタブを閉じて再度お試しください。'));
  });
  return dbPromise;
}
async function localStore(action, key, value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', action === 'get' ? 'readonly' : 'readwrite');
    const store = tx.objectStore('photos');
    const request = action === 'put' ? store.put(value, key) : action === 'delete' ? store.delete(key) : store.get(key);
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('保存が中断されました。'));
  });
}

function mediaEndpoint(key) {
  const [kind, spotId] = key.split(':');
  if (!['own', 'reference'].includes(kind) || !/^[a-f0-9]{16}$/.test(spotId || '')) throw new Error('保存先が不正です。');
  return `/api/media?spotId=${encodeURIComponent(spotId)}&kind=${kind}`;
}

export async function compressImage(blob) {
  let bitmap;
  try { bitmap = await createImageBitmap(blob); } catch { return blob; }
  const longest = Math.max(bitmap.width, bitmap.height);
  if (blob.size <= 1.5 * 1024 * 1024 && longest <= 2048) { bitmap.close(); return blob; }
  const scale = Math.min(1, 2048 / longest);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const output = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .86));
  return output || blob;
}

export function getBackground() {
  return localStore('get', 'appearance:background');
}

export function saveBackground(choice) {
  return localStore('put', 'appearance:background', choice);
}

export async function photoStore(action, key, value) {
  const endpoint = mediaEndpoint(key);
  if (action === 'get') {
    if (!cloudEnabled()) return localStore('get', key);
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      if (response.ok) {
        const blob = await response.blob();
        await localStore('put', key, blob);
        return blob;
      }
      if (response.status !== 404) throw new Error('Cloud read failed');
    } catch { /* Offline and local development fall back to the device copy. */ }
    return localStore('get', key);
  }
  if (action === 'put') {
    const blob = await compressImage(value);
    await localStore('put', key, blob);
    if (!cloudEnabled()) return { cloud: false, blob };
    try {
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'content-type': blob.type || 'image/jpeg' }, body: blob });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Cloud upload failed');
      return { cloud: true, blob };
    } catch (error) { return { cloud: false, blob, error }; }
  }
  await localStore('delete', key);
  if (!cloudEnabled()) return { cloud: false };
  try {
    const response = await fetch(endpoint, { method: 'DELETE' });
    return { cloud: response.ok };
  } catch { return { cloud: false }; }
}

function collectionKey(spotId) {
  if (!/^[a-f0-9]{16}$/.test(spotId || '')) throw new Error('保存先が不正です。');
  return `own-list:${spotId}`;
}

function photosEndpoint(spotId, photoId = '') {
  const query = new URLSearchParams({ spotId });
  if (photoId) query.set('photoId', photoId);
  return `/api/photos?${query}`;
}

async function localCollection(spotId) {
  const value = await localStore('get', collectionKey(spotId));
  return Array.isArray(value) ? value : [];
}

export async function photoCollection(action, spotId, value) {
  const key = collectionKey(spotId);
  if (action === 'list') {
    if (!cloudEnabled()) return localCollection(spotId);
    try {
      const response = await fetch(photosEndpoint(spotId), { cache: 'no-store' });
      if (!response.ok) throw new Error('Cloud read failed');
      const metadata = (await response.json()).photos || [];
      const remotePhotos = (await Promise.all(metadata.map(async item => {
        const image = await fetch(photosEndpoint(spotId, item.id), { cache: 'no-store' });
        if (!image.ok) return null;
        return { id: item.id, blob: await image.blob(), createdAt: item.created_at };
      }))).filter(Boolean);
      const deviceOnly = (await localCollection(spotId)).filter(photo => photo.localOnly);
      const photos = [...remotePhotos, ...deviceOnly];
      await localStore('put', key, photos);
      return photos;
    } catch { return localCollection(spotId); }
  }
  if (action === 'add') {
    const blob = await compressImage(value);
    const provisional = { id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, blob, createdAt: new Date().toISOString(), localOnly: true };
    let local = [];
    let storedLocally = false;
    try {
      local = await localCollection(spotId);
      local.push(provisional);
      await localStore('put', key, local);
      storedLocally = true;
    } catch { /* Cloud upload or the in-memory preview can still succeed. */ }
    if (!cloudEnabled()) {
      if (!storedLocally) throw new Error('Device storage unavailable');
      return { cloud: false, photo: provisional };
    }
    try {
      const response = await fetch(photosEndpoint(spotId), { method: 'POST', headers: { 'content-type': blob.type || 'image/jpeg' }, body: blob });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Cloud upload failed');
      const remote = (await response.json()).photo;
      provisional.id = remote.id;
      provisional.createdAt = remote.created_at;
      delete provisional.localOnly;
      try { await localStore('put', key, local); } catch { /* The cloud copy is authoritative. */ }
      return { cloud: true, photo: provisional };
    } catch (error) {
      if (!storedLocally) throw error;
      return { cloud: false, photo: provisional, error };
    }
  }
  if (action === 'delete') {
    try {
      const local = await localCollection(spotId);
      await localStore('put', key, local.filter(photo => photo.id !== value));
    } catch { /* Keep deletion effective in the current in-memory gallery. */ }
    if (!cloudEnabled()) return { cloud: false };
    try {
      const response = await fetch(photosEndpoint(spotId, value), { method: 'DELETE' });
      return { cloud: response.ok };
    } catch { return { cloud: false }; }
  }
  throw new Error('操作が不正です。');
}

let dbPromise;
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

async function compressImage(blob) {
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

export async function photoStore(action, key, value) {
  const endpoint = mediaEndpoint(key);
  if (action === 'get') {
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
    try {
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'content-type': blob.type || 'image/jpeg' }, body: blob });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Cloud upload failed');
      return { cloud: true, blob };
    } catch (error) { return { cloud: false, blob, error }; }
  }
  await localStore('delete', key);
  try {
    const response = await fetch(endpoint, { method: 'DELETE' });
    return { cloud: response.ok };
  } catch { return { cloud: false }; }
}

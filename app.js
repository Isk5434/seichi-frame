import { photoCollection, photoStore } from './storage.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = { spots: [], selected: null, photoIndex: 0, view: 'map', mode: 'side', visited: new Set(), map: null, markers: new Map(), ownUrl: null, ownBlob: null, ownPhotos: [], ownPhotoIndex: -1, ownGalleryUrls: [], combinedGalleryUrls: [], referenceUrl: null, customReference: null, stream: null, cameraRequest: 0, selectionRequest: 0, position: null, referenceRequest: 0, uploadRequest: 0 };
let noticeTimer;
function notice(message) { clearTimeout(noticeTimer); $('#status').textContent = message; $('#status').hidden = false; noticeTimer = setTimeout(() => { $('#status').hidden = true; }, 8500); }
function element(tag, className, text) { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; }
function referenceSrc(url, asset) { return asset || (url ? `/api/reference?url=${encodeURIComponent(url)}` : ''); }
async function loadVisits() {
  let local = [];
  try { local = JSON.parse(localStorage.getItem('seichi-frame:visited') || '[]'); } catch { /* Ignore malformed device data. */ }
  if (!Array.isArray(local)) local = [];
  try {
    const response = await fetch('/api/visits', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const cloud = (await response.json()).visits || [];
    const merged = [...new Set([...cloud, ...local])];
    const missing = local.filter(id => !cloud.includes(id) && /^[a-f0-9]{16}$/.test(id));
    await Promise.allSettled(missing.map(spotId => fetch('/api/visits', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spotId, visited: true }) })));
    localStorage.setItem('seichi-frame:visited', JSON.stringify(merged));
    $('#sync-status').textContent = '☁ 写真・訪問記録をクラウド同期';
    return new Set(merged);
  } catch {
    $('#sync-status').textContent = '端末内に保存中（再接続時に同期）';
    return new Set(local);
  }
}
async function saveVisit(spotId, visited) {
  try {
    const response = await fetch('/api/visits', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spotId, visited }) });
    if (!response.ok) throw new Error();
    $('#sync-status').textContent = '☁ 写真・訪問記録をクラウド同期';
  } catch { $('#sync-status').textContent = '端末内に保存中（再接続時に同期）'; }
}
function distance(spot) {
  if (!state.position) return null;
  const rad = Math.PI / 180, [lat, lng] = state.position;
  const a = Math.sin((spot.lat - lat) * rad / 2) ** 2 + Math.cos(lat * rad) * Math.cos(spot.lat * rad) * Math.sin((spot.lng - lng) * rad / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}
function filteredSpots() {
  const query = $('#search').value.normalize('NFKC').trim().toLowerCase();
  const layer = $('#layer').value;
  const result = state.spots.filter(s => (!layer || s.layer === layer) && (!$('#visited-only').checked || state.visited.has(s.id)) && (!query || `${s.name} ${s.layer} ${s.location || ''} ${s.description}`.normalize('NFKC').toLowerCase().includes(query)));
  if (state.position) result.sort((a, b) => distance(a) - distance(b));
  return result;
}
function renderList() {
  const spots = filteredSpots();
  $('#result-count').textContent = `${spots.length} 件${state.position ? '・近い順' : ''}`;
  $('#visited-count').textContent = state.spots.filter(s => state.visited.has(s.id)).length;
  const fragment = document.createDocumentFragment();
  spots.forEach((spot, index) => {
    const button = element('button', `spot-card${state.selected?.id === spot.id ? ' active' : ''}`);
    button.setAttribute('aria-pressed', String(state.selected?.id === spot.id));
    button.dataset.spotId = spot.id;
    button.append(element('span', 'spot-number', state.visited.has(spot.id) ? '✓' : String(index + 1).padStart(2, '0')));
    const info = element('span', 'spot-info');
    info.append(element('strong', '', spot.name), element('span', 'spot-location', spot.location || '所在地不明'), element('small', '', `${spot.photos.length} 枚の参考写真${state.position ? ` · ${distance(spot).toFixed(1)} km` : ''}`));
    button.append(info); button.onclick = () => selectSpot(spot, true); fragment.append(button);
  });
  if (!spots.length) fragment.append(element('p', 'list-empty', '該当する場所がありません。検索語やフィルターを変更してください。'));
  $('#spot-list').replaceChildren(fragment);
  if (state.map) {
    const ids = new Set(spots.map(s => s.id));
    state.markers.forEach((marker, id) => {
      if (ids.has(id)) marker.addTo(state.map); else marker.remove();
      marker.setIcon(pinIcon(id));
    });
  }
}
function pinIcon(id) {
  return L.divIcon({ className: '', html: `<div class="map-pin${state.selected?.id === id ? ' selected' : ''}${state.visited.has(id) ? ' visited' : ''}"></div>`, iconSize: state.selected?.id === id ? [20, 20] : [14, 14], iconAnchor: state.selected?.id === id ? [10, 10] : [7, 7] });
}
function initMap() {
  if (!window.L) { $('#map').textContent = '地図を読み込めませんでした。地点一覧から選択してください。'; return; }
  state.map = L.map('map', { zoomControl: true, scrollWheelZoom: false }).setView([36.2, 137.0], 5);
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors' }).addTo(state.map);
  let tileErrors = 0;
  tiles.on('tileerror', () => { if (++tileErrors === 4) notice('背景地図を読み込めません。地点一覧とGoogle マップへの経路リンクは利用できます。'); });
  state.spots.forEach(spot => {
    const tooltip = element('span', '', spot.name);
    const marker = L.marker([spot.lat, spot.lng], { icon: pinIcon(spot.id), title: spot.name }).bindTooltip(tooltip).addTo(state.map);
    marker.on('click', () => selectSpot(spot, false)); state.markers.set(spot.id, marker);
  });
  fitMap();
}
function fitMap() { const spots = filteredSpots(); if (spots.length && state.map) state.map.fitBounds(spots.map(s => [s.lat, s.lng]), { padding: [30, 30], maxZoom: 15 }); }

async function selectSpot(spot, fly) {
  stopCamera();
  const request = ++state.selectionRequest;
  const uploadRequest = ++state.uploadRequest;
  state.selected = spot; state.photoIndex = 0;
  state.customReference = null;
  if (state.referenceUrl) URL.revokeObjectURL(state.referenceUrl);
  state.referenceUrl = null;
  setOwnPhotos([]);
  resetAdjustments();
  $('#spot-name').textContent = spot.name;
  $('#spot-layer').textContent = spot.layer;
  $('#administrative-area').textContent = spot.location || '所在地不明';
  $('#coordinates').textContent = `${spot.lat.toFixed(5)}° N / ${spot.lng.toFixed(5)}° E`;
  $('#description').textContent = spot.description || '説明文はありません。';
  $('#directions').href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${spot.lat},${spot.lng}`)}`;
  updateVisit(); renderList(); renderGallery(); showReference();
  if (fly && state.map) state.map.setView([spot.lat, spot.lng], 15);
  try {
    let [ownPhotos, reference] = await Promise.all([photoCollection('list', spot.id), photoStore('get', `reference:${spot.id}`)]);
    if (request !== state.selectionRequest || uploadRequest !== state.uploadRequest) return;
    if (!ownPhotos.length) {
      const legacyOwn = await photoStore('get', `own:${spot.id}`);
      if (legacyOwn) {
        const migrated = await photoCollection('add', spot.id, legacyOwn);
        ownPhotos = [migrated.photo];
        await photoStore('delete', `own:${spot.id}`);
      }
    }
    if (request !== state.selectionRequest || uploadRequest !== state.uploadRequest) return;
    setOwnPhotos(ownPhotos);
    if (reference) { state.customReference = reference; state.referenceUrl = URL.createObjectURL(reference); showReference(); }
  } catch { if (request === state.selectionRequest) notice('このブラウザでは保存済み写真を読み込めません。写真の比較は引き続き利用できます。'); }
}
function updateVisit() {
  const visited = state.visited.has(state.selected.id);
  $('#visit').textContent = visited ? '✓ 訪問済み' : '♡ 訪問済みにする';
  $('#visit').setAttribute('aria-pressed', String(visited));
}
function renderGallery() {
  const photos = state.selected.photos;
  state.combinedGalleryUrls.forEach(url => URL.revokeObjectURL(url));
  state.combinedGalleryUrls = [];
  $('#photo-count').textContent = `参考 ${photos.length} 枚${state.ownPhotos.length ? ` · 自分 ${state.ownPhotos.length} 枚` : ''} · タップして選択`;
  const gallery = $('#gallery');
  gallery.replaceChildren();
  if (!photos.length && !state.ownPhotos.length) { gallery.append(element('p', 'gallery-empty', 'この地点には写真がありません。端末から写真を追加できます。')); return; }
  photos.forEach((url, index) => {
    const button = element('button', `photo-card${index === state.photoIndex && !state.customReference ? ' active' : ''}`);
    button.setAttribute('aria-label', `参考写真 ${index + 1} を選択`);
    button.setAttribute('aria-pressed', String(index === state.photoIndex && !state.customReference));
    const img = element('img'); img.src = referenceSrc(url, state.selected.photoAssets?.[index]); img.alt = `${state.selected.name} の参考写真 ${index + 1}`; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    img.onerror = () => { img.hidden = true; button.append(element('span', 'photo-failed', '画像を表示できません')); };
    button.append(img, element('span', '', String(index + 1)));
    button.onclick = () => { state.photoIndex = index; state.customReference = null; resetAdjustments(); renderGallery(); showReference(); };
    gallery.append(button);
  });
  state.ownPhotos.forEach((photo, index) => {
    const active = index === state.ownPhotoIndex;
    const button = element('button', `photo-card user-photo-card${active ? ' user-active' : ''}`);
    button.type = 'button';
    button.setAttribute('aria-label', `自分が追加した写真 ${index + 1} を選択`);
    button.setAttribute('aria-pressed', String(active));
    const url = URL.createObjectURL(photo.blob);
    state.combinedGalleryUrls.push(url);
    const img = element('img'); img.src = url; img.alt = `自分が追加した写真 ${index + 1}`;
    button.append(img, element('span', 'user-photo-label', 'MY PHOTO'));
    button.onclick = () => { selectOwnPhoto(index); setView('compare'); };
    gallery.append(button);
  });
}
function showReference() {
  const originalUrl = state.selected?.photos[state.photoIndex];
  const url = state.customReference ? state.referenceUrl : referenceSrc(originalUrl, state.selected?.photoAssets?.[state.photoIndex]);
  const oldImage = $('#reference-image');
  const img = oldImage.cloneNode(false); img.removeAttribute('src'); oldImage.replaceWith(img);
  const request = ++state.referenceRequest;
  img.hidden = true; img.referrerPolicy = 'no-referrer';
  $('#reference-empty').hidden = false;
  $('#reference-empty').textContent = url ? '参考写真を読み込み中…' : 'この地点には参考写真がありません。端末の画像を選んでください。';
  $('#original-photo').hidden = !url || Boolean(state.customReference);
  if (originalUrl && !state.customReference) $('#original-photo').href = originalUrl;
  $('#restore-reference').hidden = !state.referenceUrl;
  if (!url) return;
  img.onload = () => { if (request !== state.referenceRequest) return; img.hidden = false; $('#reference-empty').hidden = true; };
  img.onerror = () => { if (request !== state.referenceRequest) return; img.hidden = true; $('#reference-empty').hidden = false; $('#reference-empty').textContent = '参考写真を表示できません。配信元を開くか、端末から参考画像を選んでください。'; };
  img.src = url;
}
function setOwnPhoto(blob) {
  if (state.ownUrl) URL.revokeObjectURL(state.ownUrl);
  state.ownBlob = blob; state.ownUrl = blob ? URL.createObjectURL(blob) : null;
  const img = $('#own-image');
  if (blob) img.src = state.ownUrl; else img.removeAttribute('src');
  img.hidden = !blob || Boolean(state.stream);
  $('#own-empty').hidden = Boolean(blob) || Boolean(state.stream);
  $('#download').disabled = !blob; $('#delete-photo').disabled = !blob;
}

function clearOwnGalleryUrls() {
  state.ownGalleryUrls.forEach(url => URL.revokeObjectURL(url));
  state.ownGalleryUrls = [];
}

function renderOwnGallery() {
  clearOwnGalleryUrls();
  $('#my-photo-count').textContent = `${state.ownPhotos.length} 枚`;
  const gallery = $('#my-photo-gallery');
  gallery.replaceChildren();
  if (!state.ownPhotos.length) {
    gallery.append(element('p', 'gallery-empty', 'このスポットで撮った写真はまだありません。'));
    renderGallery();
    return;
  }
  state.ownPhotos.forEach((photo, index) => {
    const button = element('button', `my-photo-card${index === state.ownPhotoIndex ? ' active' : ''}`);
    button.type = 'button';
    button.setAttribute('aria-label', `自分が追加した写真 ${index + 1} を選択`);
    button.setAttribute('aria-pressed', String(index === state.ownPhotoIndex));
    const url = URL.createObjectURL(photo.blob);
    state.ownGalleryUrls.push(url);
    const img = element('img'); img.src = url; img.alt = `自分が追加した写真 ${index + 1}`;
    const date = new Date(photo.createdAt);
    const dateText = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' });
    button.append(img, element('span', 'my-photo-badge', 'MY PHOTO'));
    if (dateText) button.append(element('span', 'my-photo-date', dateText));
    button.onclick = () => selectOwnPhoto(index);
    gallery.append(button);
  });
  renderGallery();
}

function selectOwnPhoto(index) {
  state.ownPhotoIndex = index >= 0 && index < state.ownPhotos.length ? index : -1;
  setOwnPhoto(state.ownPhotoIndex >= 0 ? state.ownPhotos[state.ownPhotoIndex].blob : null);
  renderOwnGallery();
}

function setOwnPhotos(photos, selectedIndex = 0) {
  state.ownPhotos = Array.isArray(photos) ? photos : [];
  selectOwnPhoto(state.ownPhotos.length ? Math.min(selectedIndex, state.ownPhotos.length - 1) : -1);
}
function setView(view) {
  if (view !== 'camera') stopCamera();
  state.view = view;
  $$('[data-view]').forEach(button => { const active = button.dataset.view === view; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  $('#map-view').hidden = view !== 'map'; $('#photo-view').hidden = view === 'map';
  $('#compare-modes').hidden = view === 'camera';
  $('#camera-start').hidden = view !== 'camera' || Boolean(state.stream);
  $('#capture').hidden = view !== 'camera';
  $('#camera-stop').hidden = view !== 'camera' || !state.stream;
  $('#mode-help').textContent = view === 'camera'
    ? '参考写真を半透明に重ねて、立つ位置・向き・高さを調整します。拡大や移動は参考写真だけに適用されます。撮影するのはカメラの原画像です。'
    : '横並び・重ね合わせ・スライダーで比較できます。調整は参考写真だけに適用され、保存する自分の写真は変更しません。';
  applyMode();
  if (view === 'map') requestAnimationFrame(() => state.map?.invalidateSize());
}
function applyMode() {
  const mode = state.view === 'camera' ? 'overlay' : state.mode;
  $('#stage').className = `stage ${mode}`;
  $('#adjustments').hidden = mode === 'side';
  $('#opacity-control').hidden = mode !== 'overlay'; $('#wipe-control').hidden = mode !== 'wipe';
  $('#wipe-line').hidden = mode !== 'wipe';
  $$('[data-mode]').forEach(button => { const active = button.dataset.mode === state.mode; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
}
function adjust() {
  const stage = $('#stage');
  stage.style.setProperty('--opacity', $('#opacity').value / 100);
  stage.style.setProperty('--zoom', $('#zoom').value / 100);
  stage.style.setProperty('--x', `${$('#offset-x').value}%`); stage.style.setProperty('--y', `${$('#offset-y').value}%`);
  stage.style.setProperty('--rotation', `${$('#rotation').value}deg`); stage.style.setProperty('--wipe', `${$('#wipe').value}%`);
  $('#opacity-value').textContent = `${$('#opacity').value}%`; $('#zoom-value').textContent = `${$('#zoom').value}%`; $('#wipe-value').textContent = `${$('#wipe').value}%`; $('#rotation-value').textContent = `${$('#rotation').value}°`;
}
function resetAdjustments() { Object.entries({ opacity: 45, zoom: 100, 'offset-x': 0, 'offset-y': 0, rotation: 0, wipe: 50 }).forEach(([id, value]) => { $(`#${id}`).value = value; }); adjust(); }

function stopCamera() {
  ++state.cameraRequest;
  state.stream?.getTracks().forEach(track => track.stop()); state.stream = null;
  const video = $('#video'); video.pause(); video.srcObject = null; video.hidden = true;
  $('#capture').disabled = true; $('#camera-stop').hidden = true;
  $('#camera-start').disabled = false; $('#camera-start').textContent = 'カメラを起動';
  $('#camera-start').hidden = state.view !== 'camera';
  $('#own-image').hidden = !state.ownBlob; $('#own-empty').hidden = Boolean(state.ownBlob);
}
async function startCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { notice('カメラにはHTTPS接続と対応ブラウザが必要です。写真を選ぶ機能も利用できます。'); return; }
  stopCamera();
  const request = ++state.cameraRequest;
  $('#camera-start').disabled = true; $('#camera-start').textContent = 'カメラを接続中…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
    if (request !== state.cameraRequest || state.view !== 'camera') { stream.getTracks().forEach(track => track.stop()); return; }
    state.stream = stream;
    const video = $('#video'); video.srcObject = stream; video.hidden = false;
    $('#own-image').hidden = true; $('#own-empty').hidden = true;
    await video.play();
    if (request !== state.cameraRequest) return;
    $('#capture').disabled = false; $('#camera-start').hidden = true; $('#camera-stop').hidden = false;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (state.stream === stream) { stopCamera(); notice('カメラとの接続が切れました。もう一度起動してください。'); } });
  } catch (error) {
    if (request !== state.cameraRequest) return;
    stopCamera();
    notice(error.name === 'NotAllowedError' ? 'カメラが許可されていません。ブラウザのサイト設定で許可するか、自分の写真を選んでください。' : error.name === 'NotFoundError' ? 'カメラが見つかりません。自分の写真を選んで比較できます。' : 'カメラを起動できません。他のアプリで使用中でないか確認してください。');
  }
}
async function persistOwn(blob, spotId, request) {
  const visible = state.selected?.id === spotId && request === state.selectionRequest;
  const optimistic = { id: `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`, blob, createdAt: new Date().toISOString(), localOnly: true };
  if (visible) {
    state.ownPhotos.push(optimistic);
    selectOwnPhoto(state.ownPhotos.length - 1);
    notice('写真を反映しています…');
  }
  try {
    const saved = await photoCollection('add', spotId, blob);
    if (state.selected?.id === spotId && request === state.selectionRequest) {
      const currentIndex = state.ownPhotos.findIndex(photo => photo.id === optimistic.id);
      if (currentIndex >= 0) state.ownPhotos[currentIndex] = saved.photo;
      else state.ownPhotos.push(saved.photo);
      selectOwnPhoto(currentIndex >= 0 ? currentIndex : state.ownPhotos.length - 1);
    }
    notice(saved.cloud ? '写真をクラウドへ同期しました。MY PHOTOの枠から選べます。' : '写真を端末内に保存しました。MY PHOTOの枠から選べます。');
  }
  catch { notice('写真は画面に反映しましたが、端末へ保存できませんでした。必要なら「写真を保存」からダウンロードしてください。'); }
}
async function validateImage(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('画像ファイルを選んでください。');
  if (file.size > 30 * 1024 * 1024) throw new Error('画像は30MB以下のファイルを選んでください。');
  const url = URL.createObjectURL(file);
  try { const img = new Image(); img.src = url; await img.decode(); if (!img.naturalWidth) throw new Error(); }
  catch { throw new Error('この画像形式を開けません。JPEG・PNG・WebPなどに変換してください。'); }
  finally { URL.revokeObjectURL(url); }
  return file;
}
async function upload(event, reference) {
  const files = [...event.target.files]; event.target.value = '';
  if (!files.length || !state.selected) return;
  const spotId = state.selected.id, selectionRequest = state.selectionRequest, uploadRequest = ++state.uploadRequest;
  try {
    if (reference) {
      const file = await validateImage(files[0]);
      if (uploadRequest !== state.uploadRequest || selectionRequest !== state.selectionRequest) return;
      if (state.referenceUrl) URL.revokeObjectURL(state.referenceUrl);
      state.customReference = file; state.referenceUrl = URL.createObjectURL(file); renderGallery(); showReference(); resetAdjustments();
      try { const saved = await photoStore('put', `reference:${spotId}`, file); notice(saved.cloud ? '参考画像をクラウドへ同期しました。' : '参考画像を端末内に保存しました。オンライン時に再度選ぶと同期できます。'); }
      catch { notice('参考画像は表示できましたが、保存に失敗しました。'); }
    } else {
      stopCamera(); setView('compare');
      for (const file of files) {
        await validateImage(file);
        if (uploadRequest !== state.uploadRequest || selectionRequest !== state.selectionRequest) return;
        await persistOwn(file, spotId, selectionRequest);
      }
    }
  } catch (error) { notice(error.message); }
}

$$('[data-view]').forEach(button => { button.onclick = () => setView(button.dataset.view); });
$$('[data-mode]').forEach(button => { button.onclick = () => { state.mode = button.dataset.mode; applyMode(); }; });
['search', 'layer', 'visited-only'].forEach(id => $(`#${id}`).addEventListener('input', renderList));
$$('.adjustments input').forEach(input => input.addEventListener('input', adjust));
$('#reset').onclick = resetAdjustments;
$('#fit-map').onclick = fitMap;
$('#grid-toggle').onclick = () => { const grid = $('.grid'); grid.hidden = !grid.hidden; $('#grid-toggle').setAttribute('aria-pressed', String(!grid.hidden)); };
$('#own-file').onchange = event => upload(event, false);
$('#reference-file').onchange = event => upload(event, true);
$('#camera-start').onclick = startCamera; $('#camera-stop').onclick = stopCamera;
$('#visit').onclick = () => {
  if (!state.selected) return;
  const id = state.selected.id;
  if (state.visited.has(id)) state.visited.delete(id); else state.visited.add(id);
  try { localStorage.setItem('seichi-frame:visited', JSON.stringify([...state.visited])); } catch { notice('訪問記録を保存できませんでした。この画面を閉じると記録が失われる場合があります。'); }
  void saveVisit(id, state.visited.has(id));
  updateVisit(); renderList();
};
$('#restore-reference').onclick = async () => {
  if (!state.selected) return;
  const id = state.selected.id;
  state.customReference = null;
  if (state.referenceUrl) URL.revokeObjectURL(state.referenceUrl);
  state.referenceUrl = null; renderGallery(); showReference(); resetAdjustments();
  try { await photoStore('delete', `reference:${id}`); } catch { notice('保存済み参考画像の削除に失敗しました。'); }
};
$('#capture').onclick = async () => {
  const video = $('#video'); if (!state.stream || !video.videoWidth) return;
  const id = state.selected.id, request = state.selectionRequest;
  $('#capture').disabled = true;
  try {
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .94));
    if (!blob) throw new Error('撮影画像を作成できませんでした。');
    if (request === state.selectionRequest) { stopCamera(); setView('compare'); state.mode = 'overlay'; applyMode(); }
    await persistOwn(blob, id, request);
  } catch { notice('撮影に失敗しました。もう一度お試しください。'); }
  finally { $('#capture').disabled = !state.stream; }
};
$('#download').onclick = () => {
  if (!state.ownUrl) return;
  const a = element('a'); a.href = state.ownUrl;
  const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/heic': 'heic' };
  a.download = `${state.selected.name.replace(/[<>:"/\\|?*]/g, '_')}.${extensions[state.ownBlob.type] || 'img'}`;
  document.body.append(a); a.click(); a.remove();
};
$('#delete-photo').onclick = async () => {
  if (!state.selected || state.ownPhotoIndex < 0) return;
  const spotId = state.selected.id;
  const photo = state.ownPhotos[state.ownPhotoIndex];
  const next = state.ownPhotos.filter(item => item.id !== photo.id);
  const nextIndex = Math.min(state.ownPhotoIndex, next.length - 1);
  setOwnPhotos(next, nextIndex);
  try { await photoCollection('delete', spotId, photo.id); notice('選択したMY PHOTOを削除しました。'); } catch { notice('ブラウザ内の写真を削除できませんでした。'); }
};
$('#locate').onclick = () => {
  if (!navigator.geolocation) { notice('このブラウザでは現在地を取得できません。'); return; }
  $('#locate').disabled = true;
  navigator.geolocation.getCurrentPosition(position => {
    state.position = [position.coords.latitude, position.coords.longitude]; renderList();
    if (state.map) {
      if (state.locationMarker) state.locationMarker.remove();
      state.locationMarker = L.circleMarker(state.position, { radius: 8, color: '#fff', weight: 3, fillColor: '#2676db', fillOpacity: 1 }).addTo(state.map).bindTooltip('現在地');
      state.map.setView(state.position, 12);
    }
    $('#locate').disabled = false; notice('現在地から近い順に並べました。距離は直線距離です。');
  }, () => { $('#locate').disabled = false; notice('現在地を取得できませんでした。位置情報の許可と通信状況を確認してください。'); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
};
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
window.addEventListener('pagehide', stopCamera);

async function boot() {
  state.visited = await loadVisits();
  try {
    const response = await fetch('data/spots.json');
    if (!response.ok) throw new Error();
    const data = await response.json(); state.spots = data.spots;
    if (!state.spots.length) throw new Error();
    $('#total').textContent = state.spots.length;
    $('#source-top').href = data.sourceUrl; $('#source-bottom').href = data.sourceUrl;
    [...new Set(state.spots.map(s => s.layer))].forEach(layer => { const option = element('option', '', layer); option.value = layer; $('#layer').append(option); });
    initMap();
    await selectSpot(state.spots[0], false);
  } catch {
    $('#spot-name').textContent = '地点データを読み込めませんでした';
    $('#result-count').textContent = '読み込みエラー';
    notice('地点データを読み込めませんでした。ネットワーク接続を確認して再読み込みしてください。');
  }
}
boot();

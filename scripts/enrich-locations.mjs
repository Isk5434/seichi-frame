import { readFile, writeFile } from 'node:fs/promises';

const dataPath = new URL('../legacy/data/spots.json', import.meta.url);
const data = JSON.parse(await readFile(dataPath, 'utf8'));

const municipalitySource = await fetch('https://maps.gsi.go.jp/js/muni.js');
if (!municipalitySource.ok) throw new Error(`市区町村一覧を取得できませんでした: ${municipalitySource.status}`);
const municipalityText = await municipalitySource.text();
const municipalities = new Map();
for (const match of municipalityText.matchAll(/MUNI_ARRAY\["(\d+)"\]\s*=\s*'([^']+)'/g)) {
  const [, code, value] = match;
  const [, prefecture, , city] = value.split(',');
  municipalities.set(code.padStart(5, '0'), { prefecture: prefecture.trim(), city: city.replace(/[\s　]+/g, '') });
}
if (!municipalities.size) throw new Error('市区町村一覧を解析できませんでした。');

async function reverseGeocode(spot) {
  const offsets = [[0, 0], [.001, 0], [-.001, 0], [0, .001], [0, -.001], [.001, .001], [.001, -.001], [-.001, .001], [-.001, -.001], [.003, 0], [-.003, 0], [0, .003], [0, -.003]];
  for (const [latOffset, lngOffset] of offsets) {
    const endpoint = new URL('https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress');
    endpoint.searchParams.set('lat', spot.lat + latOffset);
    endpoint.searchParams.set('lon', spot.lng + lngOffset);
    const response = await fetch(endpoint);
    if (response.ok) {
      const result = (await response.json()).results;
      const municipality = municipalities.get(result?.muniCd);
      if (municipality) return municipality;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${spot.name} (${spot.lat}, ${spot.lng}) の住所を取得できませんでした。`);
}

let completed = 0;
for (const spot of data.spots) {
  const location = await reverseGeocode(spot);
  spot.prefecture = location.prefecture;
  spot.city = location.city;
  spot.location = `${location.prefecture}${location.city}`;
  completed += 1;
  if (completed % 20 === 0 || completed === data.spots.length) console.log(`${completed}/${data.spots.length}`);
  await new Promise(resolve => setTimeout(resolve, 100));
}

await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`);
console.log('都道府県・市区町村を地点データへ追加しました。');

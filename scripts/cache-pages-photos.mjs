import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const dataPath = path.resolve('legacy/data/spots.json');
const imageDir = path.resolve('legacy/images');
const data = JSON.parse(await readFile(dataPath, 'utf8'));
await mkdir(imageDir, { recursive: true });

const jobs = [];
for (const spot of data.spots) {
  spot.photoAssets = [];
  for (const url of spot.photos) {
    const name = `${createHash('sha256').update(url).digest('hex').slice(0, 20)}.webp`;
    spot.photoAssets.push(`images/${name}`);
    jobs.push({ url, file: path.join(imageDir, name) });
  }
}

let cursor = 0;
let completed = 0;
async function worker() {
  while (cursor < jobs.length) {
    const job = jobs[cursor++];
    if (!existsSync(job.file)) {
      const source = job.url.replace(/([?&])fife=[^&]+/, '$1fife=s1600');
      const response = await fetch(source);
      if (!response.ok) throw new Error(`${response.status} ${source}`);
      const input = Buffer.from(await response.arrayBuffer());
      await sharp(input).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 76 }).toFile(job.file);
    }
    completed += 1;
    if (completed % 25 === 0 || completed === jobs.length) console.log(`${completed}/${jobs.length}`);
  }
}

await Promise.all(Array.from({ length: 6 }, worker));
await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Cached ${jobs.length} reference photos for GitHub Pages.`);

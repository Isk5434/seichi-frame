import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const source = path.resolve(root, "legacy");
const target = path.resolve(root, "public", "legacy");
if (path.dirname(target) !== path.resolve(root, "public")) throw new Error("Unexpected legacy target");
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
const dataPath = path.join(target, "data", "spots.json");
const data = JSON.parse(await readFile(dataPath, "utf8"));
for (const spot of data.spots) delete spot.photoAssets;
await writeFile(dataPath, JSON.stringify(data), "utf8");

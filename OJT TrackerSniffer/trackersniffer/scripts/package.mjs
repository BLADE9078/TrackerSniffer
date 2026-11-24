// Builds a clean copy of the extension in dist/extension/ and a zip in dist/ (for sharing or the
// Chrome Web Store). Pure Node: no zip tool needed. Usage: npm run package
import { readFile, writeFile, mkdir, rm, readdir, stat, copyFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(ROOT, 'manifest.json'), 'utf8'));
const INCLUDE = ['manifest.json', 'src', 'vendor', 'icons', 'data/trackers.json', 'README.md'];
const OUT = path.join(ROOT, 'dist', 'extension');

async function walk(rel) {
  const abs = path.join(ROOT, rel);
  if ((await stat(abs)).isDirectory()) return (await Promise.all((await readdir(abs)).map((n) => walk(path.join(rel, n))))).flat();
  return [rel];
}
const files = (await Promise.all(INCLUDE.map(walk))).flat().map((f) => f.split(path.sep).join('/')).sort();

await rm(path.join(ROOT, 'dist'), { recursive: true, force: true });
for (const f of files) {
  await mkdir(path.dirname(path.join(OUT, f)), { recursive: true });
  await copyFile(path.join(ROOT, f), path.join(OUT, f));
}

// minimal ZIP writer (deflate)
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const locals = [];
const centrals = [];
let offset = 0;
for (const f of files) {
  const data = await readFile(path.join(ROOT, f));
  const comp = deflateRawSync(data, { level: 9 });
  const name = Buffer.from(f);
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  locals.push(local, name, comp);
  centrals.push(central, name);
  offset += local.length + name.length + comp.length;
}
const cd = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
const zipPath = path.join(ROOT, 'dist', `trackersniffer-v${manifest.version}.zip`);
await writeFile(zipPath, Buffer.concat([...locals, cd, end]));
console.log(`dist/extension/ (${files.length} files) and ${path.relative(ROOT, zipPath)}`);

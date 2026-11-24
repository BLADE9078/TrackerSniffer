// Copies the two runtime libraries from node_modules into vendor/ (MV3 forbids loading remote code).
// Usage: npm install && npm run vendor
import { readFile, writeFile } from 'node:fs/promises';

const files = [
  ['node_modules/tldts/dist/index.esm.min.js', 'vendor/tldts.mjs'],
  ['node_modules/chart.js/dist/chart.umd.min.js', 'vendor/chart.umd.min.js'],
];
for (const [from, to] of files) {
  const text = (await readFile(new URL(`../${from}`, import.meta.url), 'utf8')).replace(/\n?\/\/# sourceMappingURL=.*$/gm, '');
  await writeFile(new URL(`../${to}`, import.meta.url), text);
  console.log(`${from} -> ${to}`);
}

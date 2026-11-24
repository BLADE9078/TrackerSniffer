// Downloads the raw Disconnect tracking-protection list into data/raw/.
// Usage: npm run fetch-list   (then: npm run build-catalog)
import { writeFile, mkdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';

const REPO = 'https://github.com/disconnectme/disconnect-tracking-protection';
const RAW_URL = 'https://raw.githubusercontent.com/disconnectme/disconnect-tracking-protection/master/services.json';

await mkdir(new URL('../data/raw/', import.meta.url), { recursive: true });

const res = await fetch(RAW_URL);
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
const text = await res.text();
JSON.parse(text); // fail fast on a broken download
await writeFile(new URL('../data/raw/disconnect-services.json', import.meta.url), text);

let commit = 'unknown';
try {
  commit = execSync(`git ls-remote ${REPO} HEAD`, { encoding: 'utf8' }).split(/\s+/)[0];
} catch { /* git not available: leave as unknown */ }

const source = {
  name: 'Disconnect tracking-protection list (services.json)',
  url: RAW_URL,
  repository: REPO,
  commit,
  retrieved_at: new Date().toISOString(),
  license: 'CC BY-NC-SA 4.0 (Disconnect, Inc.)',
  bytes: text.length,
};
await writeFile(new URL('../data/raw/source.json', import.meta.url), JSON.stringify(source, null, 2) + '\n');
console.log(`Saved ${text.length} bytes from ${RAW_URL} (commit ${commit}).`);

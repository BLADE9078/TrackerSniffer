// Cleans data/raw/disconnect-services.json into the offline catalog data/trackers.json
// and writes the cleaning statistics to data/catalog-build-log.json.
// Usage: npm run build-catalog
import { readFile, writeFile } from 'node:fs/promises';
import { normalizeHostname } from '../src/lib/domain.js';

const raw = JSON.parse(await readFile(new URL('../data/raw/disconnect-services.json', import.meta.url), 'utf8'));
const source = JSON.parse(await readFile(new URL('../data/raw/source.json', import.meta.url), 'utf8'));

// Disconnect category -> project category
const CATEGORY_MAP = {
  Advertising: 'advertising',
  Analytics: 'analytics',
  Social: 'social',
  FingerprintingInvasive: 'fingerprinting',
  FingerprintingGeneral: 'fingerprinting',
  Cryptomining: 'cryptomining',
  Email: 'email',
  EmailAggressive: 'email',
  Content: 'content',
  'Anti-fraud': 'anti-fraud',
  ConsentManagers: 'consent',
};
// When a domain is listed in several categories, the primary (displayed) one is the first here.
const PRIORITY = ['advertising', 'analytics', 'social', 'fingerprinting', 'cryptomining', 'email', 'content', 'anti-fraud', 'consent'];

const log = {
  raw_domain_entries: 0,
  path_entries_dropped: 0,
  invalid_entries_dropped: 0,
  entries_normalized: 0,
  duplicate_entries_merged: 0,
  multi_category_domains_reconciled: 0,
  owner_conflicts: 0,
  unmapped_categories: [],
  examples: { path_entries: [], invalid: [], normalized: [] },
};

const acc = new Map(); // domain -> { categories:Set, owners:Map(category->owner), tags:Set }
for (const [rawCategory, entities] of Object.entries(raw.categories)) {
  const category = CATEGORY_MAP[rawCategory];
  if (!category) { log.unmapped_categories.push(rawCategory); continue; }
  for (const entity of entities) {
    for (const [owner, props] of Object.entries(entity)) {
      const tags = [];
      for (const [k, v] of Object.entries(props)) {
        if (!Array.isArray(v) && (v === 'true' || v === true)) tags.push(k); // e.g. session-replay
      }
      for (const [, domains] of Object.entries(props)) {
        if (!Array.isArray(domains)) continue;
        for (const rawDomain of domains) {
          log.raw_domain_entries++;
          if (typeof rawDomain === 'string' && rawDomain.includes('/')) {
            // Path-scoped rules (e.g. google.com/pagead/...) can't be applied to hostnames alone;
            // keeping the host part would wrongly flag the whole site.
            log.path_entries_dropped++;
            if (log.examples.path_entries.length < 5) log.examples.path_entries.push(rawDomain);
            continue;
          }
          const d = normalizeHostname(rawDomain);
          if (!d) {
            log.invalid_entries_dropped++;
            if (log.examples.invalid.length < 5) log.examples.invalid.push(rawDomain);
            continue;
          }
          if (d !== rawDomain) {
            log.entries_normalized++;
            if (log.examples.normalized.length < 5) log.examples.normalized.push(`${rawDomain} -> ${d}`);
          }
          let rec = acc.get(d);
          if (rec) log.duplicate_entries_merged++;
          else { rec = { categories: new Set(), owners: new Map(), tags: new Set() }; acc.set(d, rec); }
          rec.categories.add(category);
          if (!rec.owners.has(category)) rec.owners.set(category, owner);
          tags.forEach((t) => rec.tags.add(t));
        }
      }
    }
  }
}

const trackers = {};
const categoryCounts = {};
for (const domain of [...acc.keys()].sort()) {
  const rec = acc.get(domain);
  const categories = PRIORITY.filter((c) => rec.categories.has(c));
  const category = categories[0];
  if (categories.length > 1) log.multi_category_domains_reconciled++;
  const owners = new Set(rec.owners.values());
  if (owners.size > 1) log.owner_conflicts++;
  const entry = { category, owner: rec.owners.get(category) };
  if (categories.length > 1) entry.categories = categories;
  if (rec.tags.size) entry.tags = [...rec.tags].sort();
  trackers[domain] = entry;
  categoryCounts[category] = (categoryCounts[category] || 0) + 1;
}

const meta = {
  source: source.name,
  source_url: source.url,
  source_commit: source.commit,
  retrieved_at: source.retrieved_at,
  license: source.license,
  built_at: new Date().toISOString(),
  domain_count: Object.keys(trackers).length,
  primary_category_counts: categoryCounts,
  version: `disconnect@${String(source.commit).slice(0, 7)}`,
};

await writeFile(new URL('../data/trackers.json', import.meta.url), JSON.stringify({ meta, trackers }) + '\n');
await writeFile(new URL('../data/catalog-build-log.json', import.meta.url), JSON.stringify({ meta, cleaning: log }, null, 2) + '\n');
console.log(JSON.stringify({ domains: meta.domain_count, ...log, examples: undefined }, null, 2));

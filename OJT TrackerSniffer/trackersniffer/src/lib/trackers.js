// Offline tracker-list matching with domain-boundary-aware rules.
import { normalizeHostname } from './domain.js';

/** Display groups required by the PRD: advertising, analytics, social, other. */
export const DISPLAY_GROUPS = ['advertising', 'analytics', 'social', 'other'];

export const CATEGORY_LABELS = {
  advertising: 'Advertising',
  analytics: 'Analytics',
  social: 'Social media',
  fingerprinting: 'Fingerprinting',
  cryptomining: 'Cryptomining',
  email: 'Email tracking',
  content: 'Embedded content',
  'anti-fraud': 'Anti-fraud',
  consent: 'Consent manager',
  unknown: 'Unknown',
};

/** Plain-language explanations shown in the "Why does this matter?" tooltips. */
export const CATEGORY_EXPLANATIONS = {
  advertising: 'Ad networks record which pages you visit so they can build an interest profile and target ads across sites.',
  analytics: 'Analytics services measure how you use the page (clicks, scrolls, time spent). Some share data across many sites.',
  social: 'Social widgets and pixels let social networks know you visited this page, often even if you never click them.',
  fingerprinting: 'Listed for fingerprinting: identifying your browser from device traits (canvas, fonts, screen) without cookies.',
  cryptomining: 'Listed for running cryptocurrency mining scripts that use your device’s CPU.',
  email: 'Listed for email tracking (open/click tracking pixels and link redirectors).',
  content: 'Embedded content providers (video, maps, widgets) that the list says also track visitors.',
  'anti-fraud': 'Anti-fraud and bot-detection services. They collect device signals, usually for security.',
  consent: 'Consent-management platforms that record your cookie-banner choices.',
  unknown: 'Not on the tracker list. This does NOT prove it is safe — it may be a CDN, a payment provider, or an unlisted tracker.',
};

/** Map a normalized category to a PRD display group. */
export function displayGroup(category) {
  return ['advertising', 'analytics', 'social'].includes(category) ? category : 'other';
}

/**
 * Build a lookup index from the catalog produced by scripts/build-tracker-catalog.mjs.
 * Catalog shape: { meta: {...}, trackers: { "<domain>": { category, categories, owner, tags } } }
 */
export function createTrackerIndex(catalog) {
  if (!catalog || typeof catalog.trackers !== 'object') throw new Error('Invalid tracker catalog');
  const map = new Map();
  for (const [domain, entry] of Object.entries(catalog.trackers)) {
    const d = normalizeHostname(domain);
    if (d && entry && entry.category) map.set(d, entry);
  }
  return { map, meta: catalog.meta || {}, size: map.size };
}

/**
 * Match a hostname against the index.
 * Rule: exact hostname match, or the hostname is a subdomain of a listed domain
 * (walk up one label at a time). "notexample.com" therefore never matches "example.com".
 * @returns {{matched:boolean, rule:'exact'|'subdomain'|'unmatched', entry:string|null,
 *            category:string, categories:string[], owner:string|null, tags:string[]}}
 */
export function matchTracker(hostname, index) {
  const h = normalizeHostname(hostname);
  const miss = { matched: false, rule: 'unmatched', entry: null, category: 'unknown', categories: [], owner: null, tags: [] };
  if (!h || !index) return miss;
  let candidate = h;
  let rule = 'exact';
  while (candidate.includes('.')) {
    const e = index.map.get(candidate);
    if (e) {
      return {
        matched: true,
        rule,
        entry: candidate,
        category: e.category,
        categories: e.categories || [e.category],
        owner: e.owner || null,
        tags: e.tags || [],
      };
    }
    candidate = candidate.slice(candidate.indexOf('.') + 1);
    rule = 'subdomain';
  }
  return miss;
}

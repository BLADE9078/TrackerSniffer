import { readFileSync } from 'node:fs';
import { createTrackerIndex } from '../src/lib/trackers.js';

export const catalog = JSON.parse(readFileSync(new URL('../data/trackers.json', import.meta.url), 'utf8'));
export const index = createTrackerIndex(catalog);
export const labeled = JSON.parse(readFileSync(new URL('./fixtures/labeled-domains.json', import.meta.url), 'utf8'));

/** Small hand-made index for tests that must not depend on the real list. */
export const miniIndex = createTrackerIndex({
  meta: { version: 'test' },
  trackers: {
    'doubleclick.net': { category: 'advertising', owner: 'Google', categories: ['advertising', 'fingerprinting'] },
    'google-analytics.com': { category: 'analytics', owner: 'Google' },
    'facebook.net': { category: 'social', owner: 'Meta' },
    'cdn.jsdelivr.net': { category: 'content', owner: 'jsDelivr' },
    'example.com': { category: 'advertising', owner: 'Example Ads' },
  },
});

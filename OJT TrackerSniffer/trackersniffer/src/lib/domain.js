// Hostname parsing, normalization and first-/third-party classification.
// Pure functions: shared by the extension (service worker, popup) and Node tests.
import { parse } from '../../vendor/tldts.mjs';

/** URL schemes the extension can audit. Everything else is "unsupported". */
export const SUPPORTED_SCHEMES = new Set(['http:', 'https:']);
/** Schemes whose requests carry a network hostname we can classify. */
const REQUEST_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:']);

const HOST_RE = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/; // after normalization (punycode is ASCII)
const IPV6_RE = /^\[[0-9a-f:.]+\]$/;

/**
 * Normalize a hostname for comparison.
 * Documented, safe changes only: trim whitespace, lowercase, remove leading/trailing dots.
 * Returns null for anything that is not a plausible hostname (never guesses).
 */
export function normalizeHostname(input) {
  if (typeof input !== 'string') return null;
  let h = input.trim().toLowerCase();
  h = h.replace(/^\.+/, '').replace(/\.+$/, '');
  if (!h || h.length > 253) return null;
  if (IPV6_RE.test(h)) return h;
  if (!HOST_RE.test(h)) return null;
  if (h.split('.').some((label) => label.length === 0 || label.length > 63)) return null;
  return h;
}

/**
 * Extract a normalized hostname from a URL using the URL parser (never string splitting).
 * @returns {{hostname: string|null, error: string|null}}
 */
export function hostnameFromUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return { hostname: null, error: 'missing-url' };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { hostname: null, error: 'malformed-url' };
  }
  if (!REQUEST_SCHEMES.has(parsed.protocol)) return { hostname: null, error: 'unsupported-scheme' };
  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) return { hostname: null, error: 'invalid-hostname' };
  return { hostname, error: null };
}

/** True when a page URL can be audited (http/https only). */
export function isSupportedPageUrl(url) {
  try {
    const u = new URL(url);
    return SUPPORTED_SCHEMES.has(u.protocol) && !!normalizeHostname(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Registrable domain (eTLD+1) using the Public Suffix List, including its private section,
 * so user1.github.io and user2.github.io are different sites, like browsers treat them.
 * IP addresses and single-label hosts (localhost) are their own boundary.
 */
export function registrableDomain(hostname) {
  const h = normalizeHostname(hostname);
  if (!h) return null;
  if (IPV6_RE.test(h)) return h;
  const info = parse(h, { allowPrivateDomains: true });
  if (info.isIp) return h;
  return info.domain || h;
}

/**
 * First-party boundary rule (documented in README):
 * a hostname is first-party when its registrable domain equals the audited site's registrable domain.
 * Returns 'first-party' | 'third-party' | 'uncertain' (when either side can't be parsed).
 */
export function classifyParty(hostname, siteHostname) {
  const a = registrableDomain(hostname);
  const b = registrableDomain(siteHostname);
  if (!a || !b) return 'uncertain';
  return a === b ? 'first-party' : 'third-party';
}

// Cookie METADATA only. Cookie values are never read, copied or stored:
// toCookieMetadata() builds a new object from an explicit allow-list of fields.
import { normalizeHostname, classifyParty } from './domain.js';
import { matchTracker } from './trackers.js';

/**
 * @param {chrome.cookies.Cookie} c   cookie object from chrome.cookies.getAll
 * @param {string} siteHostname       audited site hostname
 * @param {object} index              tracker index
 * @param {number} nowMs
 */
export function toCookieMetadata(c, siteHostname, index, nowMs = Date.now()) {
  const host = normalizeHostname(c && c.domain);
  let expiration_status = 'unknown';
  if (c && c.session) expiration_status = 'session';
  else if (c && typeof c.expirationDate === 'number') {
    expiration_status = c.expirationDate * 1000 > nowMs ? 'unexpired' : 'expired';
  }
  const same_site = c && c.sameSite ? c.sameSite : 'unspecified';
  const secure = !!(c && c.secure);
  const http_only = !!(c && c.httpOnly);
  const risk_flags = [];
  if (!secure) risk_flags.push('missing-secure');
  if (!http_only) risk_flags.push('missing-httponly');
  if (same_site === 'unspecified') risk_flags.push('samesite-unspecified');
  if (same_site === 'no_restriction' && !secure) risk_flags.push('samesite-none-without-secure');

  return {
    cookie_domain: c && typeof c.domain === 'string' ? c.domain : '',
    normalized_domain: host,
    cookie_name: c && typeof c.name === 'string' ? c.name : '', // local display only
    host_only: !!(c && c.hostOnly),
    is_session: !!(c && c.session),
    secure,
    http_only,
    same_site,
    partitioned: !!(c && c.partitionKey),
    expiration_status,
    party_classification: host ? classifyParty(host, siteHostname) : 'uncertain',
    tracker_match: host ? matchTracker(host, index).matched : false,
    risk_flags,
  };
}

/** Deduplicate cookies that were returned by more than one getAll() query. */
export function cookieKey(c) {
  return `${c.domain}|${c.path}|${c.name}|${c.storeId || ''}|${c.partitionKey ? JSON.stringify(c.partitionKey) : ''}`;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHostname, hostnameFromUrl, registrableDomain, classifyParty, isSupportedPageUrl } from '../src/lib/domain.js';

test('normalizeHostname: case, whitespace and leading/trailing dots', () => {
  assert.equal(normalizeHostname('  WWW.Example.COM. '), 'www.example.com');
  assert.equal(normalizeHostname('.doubleclick.net'), 'doubleclick.net');
  assert.equal(normalizeHostname('..a.b..'), 'a.b');
});

test('normalizeHostname rejects non-hostnames instead of guessing', () => {
  for (const bad of ['', '   ', 'exa mple.com', 'a/b.com', 'a..b.com', null, undefined, 42, 'x'.repeat(64) + '.com']) {
    assert.equal(normalizeHostname(bad), null, String(bad));
  }
});

test('hostnameFromUrl uses the URL parser (paths, queries, ports, userinfo ignored)', () => {
  assert.deepEqual(hostnameFromUrl('https://Ads.Example.com:8443/path?q=1#x'), { hostname: 'ads.example.com', error: null });
  assert.equal(hostnameFromUrl('https://user:pw@cdn.site.in/a').hostname, 'cdn.site.in');
  assert.equal(hostnameFromUrl('wss://socket.site.com/').hostname, 'socket.site.com');
  assert.equal(hostnameFromUrl('http://[::1]:8080/').hostname, '[::1]');
  assert.equal(hostnameFromUrl('http://xn--80ak6aa92e.com/').hostname, 'xn--80ak6aa92e.com');
  assert.equal(hostnameFromUrl('http://пример.рф/').hostname, 'xn--e1afmkfd.xn--p1ai', 'IDN converted to punycode by the URL parser');
});

test('hostnameFromUrl reports missing / malformed / unsupported URLs', () => {
  assert.equal(hostnameFromUrl('').error, 'missing-url');
  assert.equal(hostnameFromUrl(undefined).error, 'missing-url');
  assert.equal(hostnameFromUrl('not a url').error, 'malformed-url');
  assert.equal(hostnameFromUrl('http://').error, 'malformed-url');
  assert.equal(hostnameFromUrl('data:image/png;base64,AAAA').error, 'unsupported-scheme');
  assert.equal(hostnameFromUrl('chrome-extension://abc/x.html').error, 'unsupported-scheme');
  assert.equal(hostnameFromUrl('blob:https://site.com/uuid').error, 'unsupported-scheme');
});

test('registrableDomain is Public-Suffix-List aware', () => {
  assert.equal(registrableDomain('a.b.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('www.flipkart.com'), 'flipkart.com');
  assert.equal(registrableDomain('static.ndtv.co.in'), 'ndtv.co.in');
  assert.equal(registrableDomain('user1.github.io'), 'user1.github.io', 'private PSL section: github.io sites are separate');
  assert.equal(registrableDomain('192.168.0.1'), '192.168.0.1');
  assert.equal(registrableDomain('localhost'), 'localhost');
});

test('classifyParty: first-party subdomains, third parties, lookalikes, uncertain', () => {
  assert.equal(classifyParty('static.ndtv.com', 'www.ndtv.com'), 'first-party');
  assert.equal(classifyParty('ndtv.com', 'www.ndtv.com'), 'first-party');
  assert.equal(classifyParty('ndtvimg.com', 'www.ndtv.com'), 'third-party', 'sister CDN brands are third-party by the eTLD+1 rule');
  assert.equal(classifyParty('notndtv.com', 'www.ndtv.com'), 'third-party');
  assert.equal(classifyParty('ndtv.com.evil.io', 'www.ndtv.com'), 'third-party');
  assert.equal(classifyParty('user2.github.io', 'user1.github.io'), 'third-party');
  assert.equal(classifyParty('bad host', 'www.ndtv.com'), 'uncertain');
});

test('isSupportedPageUrl only accepts http/https pages', () => {
  assert.ok(isSupportedPageUrl('https://www.amazon.in/'));
  assert.ok(isSupportedPageUrl('http://localhost:3000/'));
  for (const u of ['chrome://extensions', 'about:blank', 'file:///home/a.html', 'chrome-extension://x/y', 'view-source:https://a.com', '', 'https://chromewebstore.google.com'.replace('https', 'ftp')]) {
    assert.equal(isSupportedPageUrl(u), false, u);
  }
});

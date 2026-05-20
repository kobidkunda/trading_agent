'use strict';

const assert = require('node:assert/strict');
const { resolveTargetUrl, PROVIDERS } = require('../src/proxy-core');

// ─── resolveTargetUrl: provider-path mode ─────────────────────────────────────

{
  const r = resolveTargetUrl({
    pathname: '/api/polymarket/markets',
    searchParams: new URLSearchParams('limit=10'),
  });
  assert.equal(r.provider, 'polymarket');
  assert.equal(r.targetUrl, 'https://clob.polymarket.com/markets?limit=10');
  console.log('✓ polymarket path route');
}

{
  const r = resolveTargetUrl({
    pathname: '/api/kalshi/markets',
    searchParams: new URLSearchParams('limit=20'),
  });
  assert.equal(r.provider, 'kalshi');
  assert.match(r.targetUrl, /kalshi\.com.*\/markets/);
  console.log('✓ kalshi path route');
}

{
  const r = resolveTargetUrl({
    pathname: '/api/sxbet/markets',
    searchParams: new URLSearchParams(),
  });
  assert.equal(r.provider, 'sxbet');
  assert.match(r.targetUrl, /sx\.bet.*\/markets/);
  console.log('✓ sxbet path route');
}

{
  const r = resolveTargetUrl({
    pathname: '/api/manifold/markets',
    searchParams: new URLSearchParams('limit=5'),
  });
  assert.equal(r.provider, 'manifold');
  assert.match(r.targetUrl, /manifold\.markets.*\/markets/);
  console.log('✓ manifold path route');
}

// ─── resolveTargetUrl: query-param mode ───────────────────────────────────────

{
  const r = resolveTargetUrl({
    pathname: '/api/proxy',
    searchParams: new URLSearchParams('target=kalshi&path=/markets&limit=20'),
  });
  assert.equal(r.provider, 'kalshi');
  assert.match(r.targetUrl, /\/markets\?limit=20/);
  console.log('✓ kalshi query-param route');
}

// ─── aliases ─────────────────────────────────────────────────────────────────

{
  const r = resolveTargetUrl({
    pathname: '/api/poly/markets',
    searchParams: new URLSearchParams(),
  });
  assert.equal(r.provider, 'polymarket', 'alias "poly" should map to polymarket');
  console.log('✓ alias "poly" → polymarket');
}

{
  const r = resolveTargetUrl({
    pathname: '/api/sx/markets',
    searchParams: new URLSearchParams(),
  });
  assert.equal(r.provider, 'sxbet', 'alias "sx" should map to sxbet');
  console.log('✓ alias "sx" → sxbet');
}

// ─── health check ─────────────────────────────────────────────────────────────

{
  const r = resolveTargetUrl({
    pathname: '/api/health',
    searchParams: new URLSearchParams(),
  });
  assert.ok(r.health, '/api/health should return health:true');
  console.log('✓ health route');
}

// ─── error cases ─────────────────────────────────────────────────────────────

{
  assert.throws(
    () => resolveTargetUrl({ pathname: '/api/unknown/markets', searchParams: new URLSearchParams() }),
    /Unknown provider/
  );
  console.log('✓ unknown provider throws');
}

{
  assert.throws(
    () => resolveTargetUrl({ pathname: '/api/polymarket/../../etc', searchParams: new URLSearchParams() }),
    /Invalid proxy path/
  );
  console.log('✓ path traversal blocked');
}

// ─── ALLOW_ANY_TARGET guard ────────────────────────────────────────────────────

{
  delete process.env.ALLOW_ANY_TARGET;
  assert.throws(
    () => resolveTargetUrl({ pathname: '/api/proxy', searchParams: new URLSearchParams('url=https://example.com') }),
    /disabled/
  );
  console.log('✓ direct URL blocked without ALLOW_ANY_TARGET');
}

{
  process.env.ALLOW_ANY_TARGET = 'true';
  const r = resolveTargetUrl({
    pathname: '/api/proxy',
    searchParams: new URLSearchParams('url=https://example.com/data'),
  });
  assert.equal(r.provider, 'direct');
  assert.equal(r.targetUrl, 'https://example.com/data');
  delete process.env.ALLOW_ANY_TARGET;
  console.log('✓ direct URL allowed with ALLOW_ANY_TARGET=true');
}

// ─── All providers covered ────────────────────────────────────────────────────

const expected = ['polymarket', 'kalshi', 'sxbet', 'manifold'];
for (const p of expected) {
  assert.ok(PROVIDERS[p], `PROVIDERS should include ${p}`);
}
console.log('✓ all expected providers present');

console.log('\nAll proxy-core tests passed ✓');

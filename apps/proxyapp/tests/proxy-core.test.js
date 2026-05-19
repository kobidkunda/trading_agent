const assert = require('node:assert/strict');
const { resolveTargetUrl } = require('../src/proxy-core');

{
  const result = resolveTargetUrl({
    pathname: '/api/polymarket/markets',
    searchParams: new URLSearchParams('limit=10'),
  });
  assert.equal(result.provider, 'polymarket');
  assert.equal(result.targetUrl, 'https://clob.polymarket.com/markets?limit=10');
}

{
  const result = resolveTargetUrl({
    pathname: '/api/proxy',
    searchParams: new URLSearchParams('target=kalshi&path=/markets&limit=20'),
  });
  assert.equal(result.provider, 'kalshi');
  assert.equal(result.targetUrl, 'https://external-api.kalshi.com/trade-api/v2/markets?limit=20');
}

{
  assert.throws(() => resolveTargetUrl({
    pathname: '/api/unknown/markets',
    searchParams: new URLSearchParams(),
  }), /Unknown provider/);
}

console.log('proxy-core tests passed');

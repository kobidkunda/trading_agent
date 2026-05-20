'use strict';

// ─── Provider registry ────────────────────────────────────────────────────────
const PROVIDERS = {
  polymarket: {
    baseUrl: 'https://clob.polymarket.com',
    aliases: ['poly', 'clob', 'polymarket-clob', 'polymarket_clob'],
  },
  kalshi: {
    baseUrl: 'https://external-api.kalshi.com/trade-api/v2',
    aliases: ['kalshi-v2', 'kalshi_v2'],
  },
  sxbet: {
    baseUrl: 'https://api.sx.bet',
    aliases: ['sx', 'sx-bet', 'sx_bet', 'sportsxbet'],
  },
  manifold: {
    baseUrl: 'https://api.manifold.markets/v0',
    aliases: ['manifoldmarkets', 'manifold-markets'],
  },
};

// ─── Headers that must not be forwarded ──────────────────────────────────────
const HOP_BY_HOP = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
    'access-control-allow-headers':
      'authorization,content-type,x-api-key,x-proxy-token,x-requested-with,accept,accept-encoding',
    'access-control-expose-headers':
      'x-proxy-provider,x-proxy-duration-ms,x-upstream-status,x-ratelimit-limit,x-ratelimit-remaining,x-ratelimit-reset,retry-after',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function jsonResponse(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      ...corsHeaders(),
      'content-type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function normalizeProvider(value) {
  const v = String(value || '').trim().toLowerCase();
  if (PROVIDERS[v]) return v;
  return (
    Object.entries(PROVIDERS).find(([, cfg]) => cfg.aliases.includes(v))?.[0] ??
    null
  );
}

function getProviderBaseUrl(provider) {
  const envKey = `${provider.toUpperCase()}_BASE_URL`;
  return (process.env[envKey] || PROVIDERS[provider]?.baseUrl || '').replace(/\/$/, '');
}

function assertProxyToken(headers) {
  const expected = process.env.PROXY_TOKEN;
  if (!expected) return null;
  const received =
    headers['x-proxy-token'] ||
    headers['X-Proxy-Token'] ||
    (headers.authorization || headers.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (received === expected) return null;
  return jsonResponse(401, { ok: false, error: 'Invalid or missing proxy token' });
}

function sanitizePath(pathname) {
  const decoded = decodeURIComponent(pathname || '');
  if (decoded.includes('..') || decoded.includes('\\')) {
    throw new Error('Invalid proxy path: path traversal not allowed');
  }
  return decoded.startsWith('/') ? decoded : `/${decoded}`;
}

function stripKnownPrefixes(pathname) {
  return pathname
    .replace(/^\/api\/proxy\/?/, '/')
    .replace(/^\/\.netlify\/functions\/proxy\/?/, '/')
    .replace(/^\/api\/?/, '/');
}

/**
 * Resolves the upstream target URL from the incoming request's path/query.
 *
 * Supported patterns:
 *   /api/<provider>/<path...>             → provider-specific proxy
 *   /api/proxy?target=<provider>&path=... → explicit params
 *   /api/proxy?url=<full-url>             → direct URL (requires ALLOW_ANY_TARGET=true)
 *   /api/health                           → health check shortcut
 */
function resolveTargetUrl({ pathname, searchParams }) {
  if (pathname === '/api/health' || pathname.endsWith('/health')) {
    return { health: true };
  }

  // ── Direct URL mode ──────────────────────────────────────────────────────
  const directUrl = searchParams.get('url');
  if (directUrl) {
    if (process.env.ALLOW_ANY_TARGET !== 'true') {
      throw new Error(
        'Direct URL proxying is disabled. Set ALLOW_ANY_TARGET=true to enable it.'
      );
    }
    const target = new URL(directUrl);
    if (!['https:', 'http:'].includes(target.protocol)) {
      throw new Error('Only http(s) targets are allowed');
    }
    return { targetUrl: target.toString(), provider: 'direct' };
  }

  // ── Provider-path mode ────────────────────────────────────────────────────
  const stripped = stripKnownPrefixes(pathname);
  const segments = stripped.split('/').filter(Boolean);

  const queryProvider = searchParams.get('target') || searchParams.get('provider');
  const providerRaw = queryProvider || segments.shift();
  const provider = normalizeProvider(providerRaw);

  if (!provider) {
    throw new Error(
      `Unknown provider "${providerRaw}". Use one of: ${Object.keys(PROVIDERS).join(', ')}`
    );
  }

  const queryPath = searchParams.get('path');
  const providerPath = sanitizePath(queryPath || `/${segments.join('/')}`);
  const baseUrl = getProviderBaseUrl(provider);
  const target = new URL(`${baseUrl}${providerPath}`);

  for (const [key, value] of searchParams.entries()) {
    if (['target', 'provider', 'path', 'url'].includes(key)) continue;
    target.searchParams.append(key, value);
  }

  return { targetUrl: target.toString(), provider };
}

/**
 * Builds headers to forward upstream.
 * Strips hop-by-hop, cookie, and proxy-token fields.
 * Passes through auth, content-type, and rate-limit-relevant headers.
 */
function buildUpstreamHeaders(incoming) {
  const out = {};
  for (const [key, value] of Object.entries(incoming || {})) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower === 'cookie' || lower === 'x-proxy-token') continue;
    out[lower] = value;
  }
  out.accept = out.accept || 'application/json, text/plain, */*';
  out['user-agent'] = out['user-agent'] || 'prediction-market-proxy/2.0';
  // Ensure accept-encoding is passed so upstream can compress if desired
  // but we decode it before responding (no transparent compression for now)
  delete out['accept-encoding'];
  return out;
}

/**
 * Selects rate-limit and retry headers to expose to the caller.
 */
function pickRateLimitHeaders(upstreamHeaders) {
  const out = {};
  const pass = [
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
    'x-ratelimit-used',
    'retry-after',
    'ratelimit-limit',
    'ratelimit-remaining',
    'ratelimit-reset',
  ];
  for (const key of pass) {
    const val = upstreamHeaders.get ? upstreamHeaders.get(key) : upstreamHeaders[key];
    if (val != null) out[key] = String(val);
  }
  return out;
}

/**
 * Core request handler.
 * Works both in Netlify Functions (event-style) and Vercel/Node (req/res-style)
 * as long as the caller normalises to { method, url, headers, body }.
 */
async function proxyRequest(request) {
  const originHeader = (request.headers || {})['origin'] || (request.headers || {})['Origin'];

  const tokenDenied = assertProxyToken(request.headers || {});
  if (tokenDenied) return tokenDenied;

  if (request.method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(originHeader), body: '' };
  }

  let parsed;
  try {
    parsed = new URL(request.url);
  } catch {
    return jsonResponse(400, { ok: false, error: 'Invalid request URL' });
  }

  let resolved;
  try {
    resolved = resolveTargetUrl({
      pathname: parsed.pathname,
      searchParams: parsed.searchParams,
    });
  } catch (err) {
    return jsonResponse(400, { ok: false, error: err.message });
  }

  if (resolved.health) {
    return jsonResponse(200, {
      ok: true,
      service: 'prediction-market-proxy',
      version: '2.0',
      providers: Object.keys(PROVIDERS),
      providerUrls: Object.fromEntries(
        Object.entries(PROVIDERS).map(([k]) => [k, getProviderBaseUrl(k)])
      ),
      allowAnyTarget: process.env.ALLOW_ANY_TARGET === 'true',
      tokenRequired: Boolean(process.env.PROXY_TOKEN),
    });
  }

  const upstreamHeaders = buildUpstreamHeaders(request.headers);
  const timeoutMs = Number(process.env.PROXY_TIMEOUT_MS || 30000);

  const init = {
    method: request.method,
    headers: upstreamHeaders,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  };

  if (!['GET', 'HEAD'].includes(request.method) && request.body != null) {
    init.body = request.body;
  }

  const startedAt = Date.now();

  let upstream;
  try {
    upstream = await fetch(resolved.targetUrl, init);
  } catch (err) {
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    return jsonResponse(isTimeout ? 504 : 502, {
      ok: false,
      error: isTimeout ? `Upstream timed out after ${timeoutMs}ms` : err.message,
      provider: resolved.provider,
    });
  }

  const durationMs = Date.now() - startedAt;
  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  const responseHeaders = {
    ...corsHeaders(originHeader),
    'content-type': contentType,
    'x-proxy-provider': resolved.provider || 'unknown',
    'x-proxy-duration-ms': String(durationMs),
    'x-upstream-status': String(upstream.status),
    ...pickRateLimitHeaders(upstream.headers),
  };

  // Passthrough upstream cache headers
  for (const cacheHeader of ['cache-control', 'etag', 'last-modified', 'expires']) {
    const val = upstream.headers.get(cacheHeader);
    if (val) responseHeaders[cacheHeader] = val;
  }

  const isText = /^(application\/json|text\/|application\/xml|application\/xhtml|text\/xml|text\/csv|application\/javascript)/i.test(
    contentType
  );

  let body;
  let isBase64Encoded = false;

  try {
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (isText) {
      body = bytes.toString('utf8');
    } else {
      body = bytes.toString('base64');
      isBase64Encoded = true;
    }
  } catch (err) {
    return jsonResponse(502, {
      ok: false,
      error: `Failed to read upstream response: ${err.message}`,
      provider: resolved.provider,
    });
  }

  return {
    statusCode: upstream.status,
    headers: responseHeaders,
    body,
    isBase64Encoded,
  };
}

module.exports = {
  PROVIDERS,
  proxyRequest,
  resolveTargetUrl,
  jsonResponse,
  corsHeaders,
};

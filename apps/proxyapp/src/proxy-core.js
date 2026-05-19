const PROVIDERS = {
  polymarket: {
    baseUrl: 'https://clob.polymarket.com',
    aliases: ['poly', 'polymarket-clob'],
  },
  kalshi: {
    baseUrl: 'https://external-api.kalshi.com/trade-api/v2',
    aliases: ['kalshi-v2'],
  },
  sxbet: {
    baseUrl: 'https://api.sx.bet',
    aliases: ['sx', 'sx-bet', 'sx_bet'],
  },
  manifold: {
    baseUrl: 'https://api.manifold.markets/v0',
    aliases: ['manifoldmarkets'],
  },
};

const HOP_BY_HOP_HEADERS = new Set([
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

function corsHeaders(origin = '*') {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-api-key,x-proxy-token,x-requested-with',
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
  };
}

function normalizeProvider(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (PROVIDERS[normalized]) return normalized;
  return Object.entries(PROVIDERS).find(([, config]) => config.aliases.includes(normalized))?.[0] || null;
}

function getProviderBaseUrl(provider) {
  const envKey = `${provider.toUpperCase()}_BASE_URL`;
  return (process.env[envKey] || PROVIDERS[provider]?.baseUrl || '').replace(/\/$/, '');
}

function assertProxyToken(headers) {
  const expected = process.env.PROXY_TOKEN;
  if (!expected) return null;
  const received = headers['x-proxy-token'] || headers['X-Proxy-Token'] || headers.authorization?.replace(/^Bearer\s+/i, '');
  if (received === expected) return null;
  return jsonResponse(401, { ok: false, error: 'Invalid or missing proxy token' });
}

function sanitizePath(pathname) {
  const decoded = decodeURIComponent(pathname || '');
  if (decoded.includes('..') || decoded.includes('\\')) {
    throw new Error('Invalid proxy path');
  }
  return decoded.startsWith('/') ? decoded : `/${decoded}`;
}

function stripPrefix(pathname) {
  return pathname
    .replace(/^\/api\/proxy\/?/, '/')
    .replace(/^\/\.netlify\/functions\/proxy\/?/, '/')
    .replace(/^\/api\/?/, '/');
}

function resolveTargetUrl({ rawUrl, pathname, searchParams }) {
  if (pathname === '/api/health' || pathname.endsWith('/health')) {
    return { health: true };
  }

  const directUrl = searchParams.get('url');
  if (directUrl) {
    if (process.env.ALLOW_ANY_TARGET !== 'true') {
      throw new Error('Direct url proxying is disabled. Set ALLOW_ANY_TARGET=true to enable it.');
    }
    const target = new URL(directUrl);
    if (!['https:', 'http:'].includes(target.protocol)) {
      throw new Error('Only http and https targets are allowed');
    }
    return { targetUrl: target.toString(), provider: 'direct' };
  }

  const stripped = stripPrefix(pathname);
  const segments = stripped.split('/').filter(Boolean);
  const queryProvider = searchParams.get('target') || searchParams.get('provider');
  const provider = normalizeProvider(queryProvider || segments.shift());
  if (!provider) {
    throw new Error(`Unknown provider. Use one of: ${Object.keys(PROVIDERS).join(', ')}`);
  }

  const queryPath = searchParams.get('path');
  const providerPath = sanitizePath(queryPath || segments.join('/'));
  const target = new URL(`${getProviderBaseUrl(provider)}${providerPath}`);

  for (const [key, value] of searchParams.entries()) {
    if (['target', 'provider', 'path', 'url'].includes(key)) continue;
    target.searchParams.append(key, value);
  }

  return { targetUrl: target.toString(), provider };
}

function buildUpstreamHeaders(headers) {
  const output = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower === 'cookie' || lower === 'x-proxy-token') continue;
    output[key] = value;
  }
  output.accept = output.accept || 'application/json, text/plain, */*';
  output['user-agent'] = output['user-agent'] || 'prediction-market-proxy/1.0';
  return output;
}

async function proxyRequest(request) {
  const tokenDenied = assertProxyToken(request.headers);
  if (tokenDenied) return tokenDenied;

  if (request.method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  const parsed = new URL(request.url);
  const resolved = resolveTargetUrl({
    rawUrl: request.url,
    pathname: parsed.pathname,
    searchParams: parsed.searchParams,
  });

  if (resolved.health) {
    return jsonResponse(200, {
      ok: true,
      service: 'prediction-market-proxy',
      providers: Object.keys(PROVIDERS),
      allowAnyTarget: process.env.ALLOW_ANY_TARGET === 'true',
      tokenRequired: Boolean(process.env.PROXY_TOKEN),
    });
  }

  const upstreamHeaders = buildUpstreamHeaders(request.headers);
  const init = {
    method: request.method,
    headers: upstreamHeaders,
    redirect: 'follow',
    signal: AbortSignal.timeout(Number(process.env.PROXY_TIMEOUT_MS || 20000)),
  };

  if (!['GET', 'HEAD'].includes(request.method) && request.body) {
    init.body = request.body;
  }

  const startedAt = Date.now();
  const upstream = await fetch(resolved.targetUrl, init);
  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  const responseHeaders = {
    ...corsHeaders(),
    'content-type': contentType,
    'x-proxy-provider': resolved.provider || 'unknown',
    'x-proxy-duration-ms': String(Date.now() - startedAt),
    'x-upstream-status': String(upstream.status),
  };

  const bytes = Buffer.from(await upstream.arrayBuffer());
  const isText = /^application\/json\b|^text\/|javascript|xml|csv/i.test(contentType);
  return {
    statusCode: upstream.status,
    headers: responseHeaders,
    body: isText ? bytes.toString('utf8') : bytes.toString('base64'),
    isBase64Encoded: !isText,
  };
}

module.exports = {
  PROVIDERS,
  proxyRequest,
  resolveTargetUrl,
  jsonResponse,
};

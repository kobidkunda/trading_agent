const PROVIDERS = {
  polymarket: {
    baseUrl: 'https://clob.polymarket.com',
    aliases: ['poly', 'clob', 'polymarket-clob', 'polymarket_clob'],
  },
  kalshi: {
    baseUrl: 'https://api.elections.kalshi.com/trade-api/v2',
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

const HOP_BY_HOP = new Set([
  'connection', 'content-length', 'host', 'keep-alive',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'transfer-encoding', 'upgrade',
]);

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-api-key,x-proxy-token,x-requested-with,accept',
    'access-control-expose-headers': 'x-proxy-provider,x-proxy-duration-ms,x-upstream-status',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders('*'), 'content-type': 'application/json' },
  });
}

function env(key, fallback) {
  return typeof globalThis !== 'undefined' && globalThis[key] ? globalThis[key] : fallback;
}

function normalizeProvider(raw) {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [name, cfg] of Object.entries(PROVIDERS)) {
    if (name === key) return name;
    if (cfg.aliases.some(a => a.replace(/[^a-z0-9]/g, '') === key)) return name;
  }
  return null;
}

function getProviderBaseUrl(provider) {
  return env(`${provider.toUpperCase()}_BASE_URL`, PROVIDERS[provider]?.baseUrl);
}

function sanitizePath(pathname) {
  const decoded = decodeURIComponent(pathname || '');
  if (decoded.includes('..') || decoded.includes('\\')) {
    throw new Error('Invalid proxy path');
  }
  return decoded.startsWith('/') ? decoded : `/${decoded}`;
}

function stripKnownPrefixes(pathname) {
  return pathname
    .replace(/^\/api\/proxy\/?/, '/')
    .replace(/^\/api\/?/, '/');
}

function resolveTargetUrl(pathname, searchParams) {
  if (pathname === '/api/health' || pathname === '/health' || pathname.endsWith('/health')) {
    return { health: true };
  }

  const directUrl = searchParams.get('url');
  if (directUrl) {
    if (env('ALLOW_ANY_TARGET') !== 'true') {
      throw new Error('Direct URL proxying disabled');
    }
    const target = new URL(directUrl);
    if (!['https:', 'http:'].includes(target.protocol)) {
      throw new Error('Only http(s) targets allowed');
    }
    return { targetUrl: target.toString(), provider: 'direct' };
  }

  const stripped = stripKnownPrefixes(pathname);
  const segments = stripped.split('/').filter(Boolean);

  const queryProvider = searchParams.get('target') || searchParams.get('provider');
  const providerRaw = queryProvider || segments.shift();
  const provider = normalizeProvider(providerRaw);

  if (!provider) {
    throw new Error(`Unknown provider "${providerRaw}"`);
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

function buildUpstreamHeaders(incoming) {
  const out = {};
  for (const [key, value] of Object.entries(incoming || {})) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower === 'cookie' || lower === 'x-proxy-token') continue;
    out[lower] = value;
  }
  out.accept = out.accept || 'application/json, text/plain, */*';
  out['user-agent'] = out['user-agent'] || 'prediction-market-proxy/2.0-cf';
  delete out['accept-encoding'];
  return out;
}

function pickRateLimitHeaders(upstreamHeaders) {
  const out = {};
  for (const key of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after']) {
    const val = upstreamHeaders.get(key);
    if (val) out[key] = val;
  }
  return out;
}

function checkProxyToken(headers) {
  const token = env('PROXY_TOKEN');
  if (!token) return true;
  const provided = (headers.get('x-proxy-token') || '');
  return provided === token;
}

export default {
  async fetch(request, envVars) {
    try {
      const url = new URL(request.url);

      // Set env for other functions
      globalThis.PROXY_TOKEN = envVars.PROXY_TOKEN;
      globalThis.PROXY_TIMEOUT_MS = envVars.PROXY_TIMEOUT_MS || '30000';
      globalThis.ALLOW_ANY_TARGET = envVars.ALLOW_ANY_TARGET || 'false';

      const originHeader = request.headers.get('origin') || '*';

      // Health check
      if (url.pathname === '/api/health' || url.pathname === '/health') {
        return jsonResponse(200, {
          ok: true,
          version: '2.0-cf',
          providers: Object.keys(PROVIDERS),
          providerUrls: Object.fromEntries(
            Object.entries(PROVIDERS).map(([k]) => [k, getProviderBaseUrl(k)])
          ),
          allowAnyTarget: globalThis.ALLOW_ANY_TARGET === 'true',
          tokenRequired: Boolean(globalThis.PROXY_TOKEN),
          deployed: 'cloudflare-pages',
        });
      }

      // Token check
      if (!checkProxyToken(request.headers)) {
        return jsonResponse(401, { ok: false, error: 'Invalid or missing proxy token' });
      }

      // CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(originHeader) });
      }

      // Resolve target
      let resolved;
      try {
        resolved = resolveTargetUrl(url.pathname, url.searchParams);
        if (resolved.health) {
          return jsonResponse(200, {
            ok: true,
            version: '2.0-cf',
            providers: Object.keys(PROVIDERS),
            providerUrls: Object.fromEntries(
              Object.entries(PROVIDERS).map(([k]) => [k, getProviderBaseUrl(k)])
            ),
            deployed: 'cloudflare-pages',
          });
        }
      } catch (err) {
        return jsonResponse(400, { ok: false, error: err.message });
      }

      const upstreamHeaders = buildUpstreamHeaders(Object.fromEntries(request.headers));
      const timeoutMs = Number(globalThis.PROXY_TIMEOUT_MS || 30000);

      const init = {
        method: request.method,
        headers: upstreamHeaders,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      };

      if (!['GET', 'HEAD'].includes(request.method) && request.body) {
        init.body = await request.arrayBuffer();
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

      const responseHeaders = new Headers({
        ...corsHeaders(originHeader),
        'content-type': contentType,
        'x-proxy-provider': resolved.provider || 'unknown',
        'x-proxy-duration-ms': String(durationMs),
        'x-upstream-status': String(upstream.status),
      });

      const rateLimitHeaders = pickRateLimitHeaders(upstream.headers);
      for (const [k, v] of Object.entries(rateLimitHeaders)) {
        responseHeaders.set(k, v);
      }

      for (const cacheHeader of ['cache-control', 'etag', 'last-modified', 'expires']) {
        const val = upstream.headers.get(cacheHeader);
        if (val) responseHeaders.set(cacheHeader, val);
      }

      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: err.message, stack: err.stack }), {
        status: 500,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      });
    }
  },
};

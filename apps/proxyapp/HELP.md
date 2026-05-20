# Prediction Market Proxy — Deployment Guide

This is a zero-dependency, serverless-first CORS proxy for prediction-market APIs.  
Deploy one or more copies to Netlify/Vercel/Railway/Render, then paste the deployed
URL into **Tradingbot → Credentials → Polymarket Proxy** (or Kalshi, SX Bet, Manifold).

---

## Supported Routes

| Pattern | Effect |
|---|---|
| `GET /api/health` | Health check — lists providers, token requirement |
| `GET /api/polymarket/markets?limit=100` | Proxies to Polymarket CLOB |
| `GET /api/kalshi/markets?limit=100` | Proxies to Kalshi API |
| `GET /api/sxbet/markets` | Proxies to SX Bet |
| `GET /api/manifold/markets?limit=50` | Proxies to Manifold |
| `GET /api/proxy?target=polymarket&path=/markets&limit=10` | Explicit param mode |
| `GET /api/proxy?url=https://...` | Direct URL (requires `ALLOW_ANY_TARGET=true`) |
| `POST /api/polymarket/order` | POST proxied verbatim |

Aliases work too: `/api/poly/...`, `/api/sx/...`, `/api/kalshi-v2/...`

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PROXY_TOKEN` | *(unset)* | If set, every request must send `x-proxy-token: <value>` or `Authorization: Bearer <value>` |
| `PROXY_TIMEOUT_MS` | `30000` | Upstream request timeout in ms |
| `ALLOW_ANY_TARGET` | `false` | Enable `?url=https://...` direct-URL mode |
| `POLYMARKET_BASE_URL` | `https://clob.polymarket.com` | Override Polymarket endpoint |
| `KALSHI_BASE_URL` | `https://trading-api.kalshi.com/trade-api/v2` | Override Kalshi endpoint |
| `SXBET_BASE_URL` | `https://api.sx.bet` | Override SX Bet endpoint |
| `MANIFOLD_BASE_URL` | `https://api.manifold.markets/v0` | Override Manifold endpoint |

---

## Deploy to Netlify (recommended)

### One-command deploy

```bash
cd apps/proxyapp
npm install
npm test                            # verify everything works locally
netlify login                       # opens browser for auth
netlify init                        # creates a new site OR links to existing
netlify env:set PROXY_TIMEOUT_MS 30000
# optional: netlify env:set PROXY_TOKEN your-shared-secret
netlify deploy --prod --dir=public --functions=netlify/functions
```

Your proxy will be at `https://<site-name>.netlify.app`.

### Local dev

```bash
cd apps/proxyapp
npm install
netlify dev                         # proxy runs on http://localhost:8888
```

### Deploy a second instance (e.g. dedicated Polymarket proxy)

```bash
netlify init --name polymarket-proxy-prod
netlify deploy --prod --dir=public --functions=netlify/functions
```

Paste the new URL into **Credentials → Polymarket Proxy → Service URL**.

---

## Deploy to Vercel

### First time

```bash
cd apps/proxyapp
npm install
npm test
vercel login                        # opens browser for auth
vercel                              # guided setup, creates project
vercel env add PROXY_TIMEOUT_MS     # enter: 30000
vercel --prod                       # deploy to production
```

Your proxy will be at `https://<project-name>.vercel.app`.

### Local dev

```bash
cd apps/proxyapp
vercel dev                          # proxy runs on http://localhost:3000
```

### Second/third instance (per-platform)

```bash
cd apps/proxyapp
vercel --name kalshi-proxy-prod --prod
```

---

## Deploy to Railway

1. Push `apps/proxyapp` to a GitHub repo (or a sub-repo with just this folder).
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub.
3. Select the repo/folder and Railway will auto-detect Node.
4. Set env vars in Railway dashboard (`PROXY_TIMEOUT_MS`, `PROXY_TOKEN`, etc.).
5. Railway auto-deploys on every `git push`.

---

## Deploy to Render (free tier)

1. Push `apps/proxyapp` to a GitHub repo.
2. Render Dashboard → **New Web Service** → connect repo.
3. **Build Command**: `npm install`
4. **Start Command**: `node render-server.js` — see inline script below.
5. Add env vars in Render dashboard.

Create `apps/proxyapp/render-server.js`:

```js
'use strict';
const http = require('http');
const { proxyRequest, jsonResponse } = require('./src/proxy-core');

const PORT = process.env.PORT || 3000;

http.createServer(async (req, res) => {
  try {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const host  = req.headers.host;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : null;

    const result = await proxyRequest({
      method: req.method,
      url: `${proto}://${host}${req.url}`,
      headers: req.headers,
      body,
    });

    for (const [k, v] of Object.entries(result.headers || {})) res.setHeader(k, v);
    res.statusCode = result.statusCode;
    res.end(result.isBase64Encoded ? Buffer.from(result.body, 'base64') : result.body ?? '');
  } catch (err) {
    const r = jsonResponse(502, { ok: false, error: err.message });
    for (const [k, v] of Object.entries(r.headers || {})) res.setHeader(k, v);
    res.statusCode = r.statusCode;
    res.end(r.body);
  }
}).listen(PORT, () => console.log(`Proxy listening on port ${PORT}`));
```

---

## Adding multiple proxy instances in Tradingbot

You can deploy the same proxy app multiple times (different Netlify/Vercel sites)
and configure each URL in **Tradingbot → Settings → Credentials**:

| Credential service | Service URL field | Example |
|---|---|---|
| `Polymarket Proxy` | `https://poly-proxy.netlify.app/api/polymarket` | provider-specific base |
| `Kalshi Proxy` | `https://kalshi-proxy.vercel.app/api/kalshi` | provider-specific base |
| `SX Bet Proxy` | `https://sxbet-proxy.netlify.app/api/sxbet` | provider-specific base |
| `Manifold Proxy` | `https://manifold-proxy.vercel.app/api/manifold` | provider-specific base |
| `Generic Proxy App` | `https://shared-proxy.netlify.app` | shared instance |

The path suffix (`/markets`, `/orderbook`, etc.) is appended automatically by each scanner.

---

## Securing with a shared token

Set `PROXY_TOKEN=some-secret` in your Netlify/Vercel env vars.  
In Tradingbot → Credentials, add the same token as the **Proxy Token** value  
for each proxy credential. The proxy rejects any request without the header.

---

## Testing your deployment

```bash
# Health check
curl https://your-proxy.netlify.app/api/health

# Fetch Polymarket markets
curl "https://your-proxy.netlify.app/api/polymarket/markets?limit=5"

# Fetch Kalshi markets
curl "https://your-proxy.netlify.app/api/kalshi/markets?limit=5"

# With proxy token
curl -H "x-proxy-token: your-secret" \
     "https://your-proxy.netlify.app/api/polymarket/markets"
```

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `502 Bad Gateway` | Upstream unreachable | Check provider API status; increase `PROXY_TIMEOUT_MS` |
| `401 Invalid or missing proxy token` | `PROXY_TOKEN` set but not sent | Add the token to the credential in Tradingbot UI |
| `400 Unknown provider` | Bad provider name in path | Use `polymarket`, `kalshi`, `sxbet`, or `manifold` |
| `400 path traversal` | `..` in path | Fix the path in the caller |
| `504 Gateway Timeout` | Upstream too slow | Increase `PROXY_TIMEOUT_MS` (Netlify max ≈26 s, Vercel max 30 s) |
| CORS error in browser | Missing CORS headers | Confirm you're hitting the proxy URL, not the upstream directly |

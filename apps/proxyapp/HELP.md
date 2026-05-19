# Prediction Market Proxy App

This is a standalone serverless proxy for prediction-market APIs. Deploy one or many copies, then add the deployed URLs in the Tradingbot Credentials page.

## Supported Provider URLs

- Polymarket: `/api/polymarket/markets?limit=100`
- Kalshi: `/api/kalshi/markets?limit=100`
- SX Bet: `/api/sxbet/...`
- Manifold: `/api/manifold/...`
- Generic form: `/api/proxy?target=polymarket&path=/markets&limit=100`

Use provider-specific base URLs in Tradingbot Credentials:

- `Polymarket Proxy`: `https://your-proxy.netlify.app/api/polymarket`
- `Kalshi Proxy`: `https://your-proxy.netlify.app/api/kalshi`
- `SX Bet Proxy`: `https://your-proxy.netlify.app/api/sxbet`
- `Manifold Proxy`: `https://your-proxy.netlify.app/api/manifold`

## Environment Variables

- `PROXY_TOKEN`: optional shared token. If set, requests must include `x-proxy-token` or `Authorization: Bearer <token>`.
- `PROXY_TIMEOUT_MS`: upstream timeout, default `20000`.
- `ALLOW_ANY_TARGET`: set to `true` only if you need `/api/proxy?url=https://...`.
- `POLYMARKET_BASE_URL`: override default Polymarket CLOB URL.
- `KALSHI_BASE_URL`: override default Kalshi URL.
- `SXBET_BASE_URL`: override default SX Bet URL.
- `MANIFOLD_BASE_URL`: override default Manifold URL.

## Netlify Deploy

```bash
cd apps/proxyapp
npm install
npm run test
netlify login
netlify init
netlify env:set PROXY_TIMEOUT_MS 20000
netlify deploy --prod --dir=public --functions=netlify/functions
```

For local Netlify development:

```bash
cd apps/proxyapp
npm install
netlify dev
```

## Vercel Deploy

```bash
cd apps/proxyapp
npm install
npx vercel login
npx vercel --prod
```

Set environment variables in the Vercel dashboard or with:

```bash
npx vercel env add PROXY_TIMEOUT_MS production
npx vercel --prod
```

## Tradingbot Configuration

1. Open Tradingbot Credentials.
2. Add `Polymarket Proxy` and paste the deployed URL ending in `/api/polymarket`.
3. Add `Kalshi Proxy` and paste the deployed URL ending in `/api/kalshi`.
4. Keep direct venue credentials if needed; proxy credentials only control routing.
5. You can deploy several Netlify/Vercel proxy apps and switch URLs from Credentials without changing code.

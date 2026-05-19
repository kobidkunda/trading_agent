# Prediction Market Proxy App

Health:

```txt
/api/health
```

Provider URLs:

```txt
/api/polymarket/markets?limit=100
/api/kalshi/markets?limit=100
/api/sxbet/...
/api/manifold/...
/api/proxy?target=polymarket&path=/markets&limit=100
```

Tradingbot Credentials URLs:

```txt
Polymarket Proxy = https://your-proxy.netlify.app/api/polymarket
Kalshi Proxy     = https://your-proxy.netlify.app/api/kalshi
SX Bet Proxy     = https://your-proxy.netlify.app/api/sxbet
Manifold Proxy   = https://your-proxy.netlify.app/api/manifold
```

Deploy with Netlify:

```bash
cd apps/proxyapp
npm install
npm run test
netlify login
netlify init
netlify deploy --prod --dir=public --functions=netlify/functions --no-build
```

Deploy with Vercel:

```bash
cd apps/proxyapp
npm install
npx vercel login
npx vercel --prod
```

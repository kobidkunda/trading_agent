const { proxyRequest, jsonResponse } = require('../../../src/proxy-core');

module.exports = async function handler(req, res) {
  try {
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const result = await proxyRequest({
      method: req.method || 'GET',
      url: `${protocol}://${host}${req.url}`,
      headers: req.headers || {},
      body: req.body,
    });

    for (const [key, value] of Object.entries(result.headers || {})) {
      res.setHeader(key, value);
    }
    res.status(result.statusCode);
    if (result.isBase64Encoded) {
      res.send(Buffer.from(result.body || '', 'base64'));
      return;
    }
    res.send(result.body || '');
  } catch (error) {
    const result = jsonResponse(502, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    for (const [key, value] of Object.entries(result.headers || {})) {
      res.setHeader(key, value);
    }
    res.status(result.statusCode).send(result.body);
  }
};

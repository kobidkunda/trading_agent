'use strict';

const { proxyRequest, jsonResponse } = require('../../../src/proxy-core');

/**
 * Vercel Serverless Function handler.
 *
 * Works for both /api/proxy/[...proxy].js and any route under /api/.
 * Vercel provides a Node.js IncomingMessage (req) and ServerResponse (res).
 */
module.exports = async function handler(req, res) {
  try {
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const fullUrl = `${protocol}://${host}${req.url}`;

    // Read body for non-GET/HEAD methods
    let body = null;
    if (!['GET', 'HEAD'].includes(req.method || 'GET') && req.body != null) {
      body = req.body;
    }

    const result = await proxyRequest({
      method: req.method || 'GET',
      url: fullUrl,
      headers: req.headers || {},
      body,
    });

    // Set response headers
    for (const [key, value] of Object.entries(result.headers || {})) {
      res.setHeader(key, value);
    }

    res.status(result.statusCode);

    if (result.isBase64Encoded) {
      res.send(Buffer.from(result.body || '', 'base64'));
    } else {
      res.send(result.body ?? '');
    }
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

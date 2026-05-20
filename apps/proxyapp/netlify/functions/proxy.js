'use strict';

const { proxyRequest, jsonResponse } = require('../../src/proxy-core');

/**
 * Netlify Functions handler.
 *
 * Netlify passes `event.rawUrl` which is the full URL including path + query.
 * For streaming/binary responses we return isBase64Encoded=true.
 */
exports.handler = async (event) => {
  try {
    // Reconstruct the full URL
    const rawUrl =
      event.rawUrl ||
      `https://${event.headers.host}${event.path}${event.rawQuery ? `?${event.rawQuery}` : ''}`;

    // Body: Netlify may base64-encode binary POST bodies
    let body = null;
    if (event.body) {
      body = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64')
        : event.body;
    }

    return await proxyRequest({
      method: event.httpMethod || 'GET',
      url: rawUrl,
      headers: event.headers || {},
      body,
    });
  } catch (error) {
    return jsonResponse(502, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

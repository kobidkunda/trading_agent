const { proxyRequest, jsonResponse } = require('../../src/proxy-core');

exports.handler = async (event) => {
  try {
    return await proxyRequest({
      method: event.httpMethod || 'GET',
      url: event.rawUrl || `https://${event.headers.host}${event.path}${event.rawQuery ? `?${event.rawQuery}` : ''}`,
      headers: event.headers || {},
      body: event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : event.body,
    });
  } catch (error) {
    return jsonResponse(502, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const DEFAULT_DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';
const REQUEST_TIMEOUT_MS = 55_000;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function toRequestBody(body) {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') return JSON.stringify(body);
  return '{}';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: { message: 'Method Not Allowed' } });
    return;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, { error: { message: 'DEEPSEEK_API_KEY 未配置' } });
    return;
  }

  const apiBase = (process.env.DEEPSEEK_API_BASE || DEFAULT_DEEPSEEK_API_BASE).trim().replace(/\/+$/, '');
  const url = `${apiBase}/chat/completions`;
  const body = toRequestBody(req.body);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstreamResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body,
      signal: controller.signal,
    });

    const text = await upstreamResponse.text();
    res.statusCode = upstreamResponse.status;
    res.setHeader(
      'Content-Type',
      upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8'
    );
    res.setHeader('Cache-Control', 'no-store');
    res.end(text);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      sendJson(res, 504, { error: { message: 'Upstream DeepSeek request timeout' } });
      return;
    }
    sendJson(res, 502, {
      error: {
        message: `DeepSeek proxy failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}


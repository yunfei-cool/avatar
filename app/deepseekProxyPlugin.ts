import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

interface DeepSeekProxyOptions {
  apiKey: string;
  apiBase: string;
  proxyPath: string;
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, payload: Record<string, unknown>) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function deepseekProxyPlugin(options: DeepSeekProxyOptions): Plugin {
  const proxyPath = options.proxyPath;
  const apiBase = options.apiBase.replace(/\/+$/, '');
  const apiKey = options.apiKey.trim();
  const upstreamUrl = `${apiBase}/chat/completions`;

  const middleware = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (error?: unknown) => void
  ) => {
    const pathname = (req.url || '').split('?')[0];
    if (pathname !== proxyPath) {
      next();
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: { message: 'Method Not Allowed' } });
      return;
    }

    if (!apiKey) {
      sendJson(res, 500, { error: { message: 'DEEPSEEK_API_KEY 未配置' } });
      return;
    }

    try {
      const requestBody = await readRequestBody(req);
      const upstreamResponse = await fetch(upstreamUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: requestBody,
      });

      const responseText = await upstreamResponse.text();
      res.statusCode = upstreamResponse.status;
      res.setHeader(
        'Content-Type',
        upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8'
      );
      res.end(responseText);
    } catch (error) {
      next(error);
    }
  };

  return {
    name: 'deepseek-proxy-plugin',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}


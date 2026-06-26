#!/usr/bin/env node

import http from 'node:http';
import net from 'node:net';

const port = Number(process.env.PORT || 3014);
const frontendOrigin = new URL(
  process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:3012',
);
const backendOrigin = new URL(
  process.env.BACKEND_ORIGIN || 'http://127.0.0.1:3010',
);

const backendPrefixes = [
  '/api/',
  '/auth/',
  '/download/',
  '/uploads/',
  '/mcp/',
  '/socket.io/',
];

const logRequests = process.env.LOG_REQUESTS === '1';

function pickTarget(reqUrl) {
  const pathname = new URL(reqUrl || '/', 'http://local.test').pathname;
  return backendPrefixes.some((prefix) => pathname.startsWith(prefix))
    ? backendOrigin
    : frontendOrigin;
}

function proxyHeaders(req, target) {
  const headers = {
    ...req.headers,
    host: target.host,
    'x-forwarded-host': req.headers.host || '',
    'x-forwarded-proto': 'http',
  };

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) delete headers[key];
  }

  return headers;
}

function rewriteHeaderLocation(value, publicOrigin) {
  if (typeof value === 'string') {
    return value
      .replace(backendOrigin.origin, publicOrigin)
      .replace(frontendOrigin.origin, publicOrigin);
  }

  if (Array.isArray(value)) {
    return value.map((item) => rewriteHeaderLocation(item, publicOrigin));
  }

  return value;
}

const server = http.createServer((clientReq, clientRes) => {
  const target = pickTarget(clientReq.url);
  const targetUrl = new URL(clientReq.url || '/', target);
  const publicOrigin = `http://${clientReq.headers.host || `127.0.0.1:${port}`}`;

  const proxyReq = http.request(
    {
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      method: clientReq.method,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      headers: proxyHeaders(clientReq, targetUrl),
    },
    (proxyRes) => {
      const headers = { ...proxyRes.headers };
      if (headers.location !== undefined) {
        headers.location = rewriteHeaderLocation(headers.location, publicOrigin);
      }
      if (logRequests) {
        console.log(
          `${proxyRes.statusCode || 502} ${clientReq.method} ${
            clientReq.url
          } -> ${target.origin}`,
        );
      }
      clientRes.writeHead(proxyRes.statusCode || 502, headers);
      proxyRes.pipe(clientRes);
    },
  );

  proxyReq.on('error', (error) => {
    clientRes.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    clientRes.end(`Proxy error: ${error.message}`);
  });

  clientReq.pipe(proxyReq);
});

server.on('upgrade', (req, socket, head) => {
  const target = pickTarget(req.url);
  let targetSocket;
  const closeSockets = () => {
    socket.destroy();
    targetSocket?.destroy();
  };
  targetSocket = net.connect(Number(target.port), target.hostname, () => {
    targetSocket.write(
      `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${Object.entries(
        proxyHeaders(req, target),
      )
        .map(([key, value]) => `${key}: ${value}`)
        .join('\r\n')}\r\n\r\n`,
    );
    targetSocket.write(head);
    socket.pipe(targetSocket).pipe(socket);
  });

  socket.on('error', closeSockets);
  targetSocket.on('error', closeSockets);
});

server.listen(port, '127.0.0.1', () => {
  console.log(
    `Corporate SSO same-origin proxy listening on http://127.0.0.1:${port}`,
  );
  console.log(`  frontend -> ${frontendOrigin.origin}`);
  console.log(`  backend  -> ${backendOrigin.origin}`);
});

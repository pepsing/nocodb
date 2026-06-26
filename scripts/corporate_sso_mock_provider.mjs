#!/usr/bin/env node

import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

const config = {
  host: process.env.MOCK_SSO_HOST || '127.0.0.1',
  port: Number(process.env.MOCK_SSO_PORT || 3099),
  appKey: process.env.MOCK_SSO_APP_KEY || 'mock-client',
  appSecret: process.env.MOCK_SSO_APP_SECRET || 'mock-secret',
  omitState: process.env.MOCK_SSO_OMIT_STATE === 'true',
  invalidState: process.env.MOCK_SSO_INVALID_STATE === 'true',
  subject: process.env.MOCK_SSO_SUBJECT || 'mock-subject-state-e2e',
  name: process.env.MOCK_SSO_NAME || 'Mock State User',
  email: process.env.MOCK_SSO_EMAIL || 'mock-state-e2e@example.invalid',
  employeeCode: process.env.MOCK_SSO_EMPLOYEE_CODE || 'MOCK_STATE_E2E',
  department: process.env.MOCK_SSO_DEPARTMENT || 'Engineering',
};

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function redirect(res, target) {
  res.writeHead(302, { location: target });
  res.end();
}

function buildToken() {
  return jwt.sign(
    {
      id: config.subject,
      name: config.name,
      mail: config.email,
      code: config.employeeCode,
      department: config.department,
    },
    `${config.appKey}${config.appSecret}`,
    { algorithm: 'HS256', expiresIn: '10m' },
  );
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${config.host}:${config.port}`);

  if (url.pathname === '/healthz') {
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/login/v2/auth/login') {
    const appKey = url.searchParams.get('appKey');
    const redirectUrl = url.searchParams.get('redirectUrl');
    const state = url.searchParams.get('state');

    if (appKey !== config.appKey) {
      return json(res, 401, { errno: 401, reason: 'invalid appKey' });
    }
    if (!redirectUrl) {
      return json(res, 400, { errno: 400, reason: 'missing redirectUrl' });
    }

    const target = new URL(redirectUrl);
    target.searchParams.set('code', 'mock-code');
    if (state && !config.omitState) {
      target.searchParams.set(
        'state',
        config.invalidState ? 'invalid-provider-state' : state,
      );
    }
    return redirect(res, target.toString());
  }

  if (url.pathname === '/login/v2/auth/get_token') {
    const appKey = url.searchParams.get('app_key');
    const appSecret = url.searchParams.get('app_secret');
    const code = url.searchParams.get('code');

    if (!code) {
      return json(res, 400, { errno: 400, reason: 'missing code' });
    }
    if (appKey !== config.appKey || appSecret !== config.appSecret) {
      return json(res, 401, { errno: 401, reason: 'invalid client' });
    }

    return json(res, 200, { errno: 0, token: buildToken() });
  }

  json(res, 404, { errno: 404, reason: 'not found' });
});

server.listen(config.port, config.host, () => {
  console.log(`mock SSO provider listening on http://${config.host}:${config.port}`);
  console.log(`appKey=${config.appKey}`);
  console.log(`employeeCode=${config.employeeCode}`);
  console.log(`omitState=${config.omitState}`);
  console.log(`invalidState=${config.invalidState}`);
});

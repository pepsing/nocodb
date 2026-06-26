#!/usr/bin/env node

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith('--') && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
    args.set(arg, process.argv[i + 1]);
    i += 1;
  } else if (arg.startsWith('--')) {
    args.set(arg, true);
  }
}

const config = {
  apiBase:
    args.get('--api-base') ||
    process.env.NOCODB_API_BASE ||
    'http://localhost:3002',
  nextPath:
    args.get('--next') ||
    process.env.NOCODB_SSO_NEXT_PATH ||
    '/nc/mock-sso-smoke',
  cleanup: args.has('--cleanup') || process.env.NOCODB_SSO_SMOKE_CLEANUP === 'true',
  cleanupOnly: args.has('--cleanup-only'),
  metaDbUrl:
    args.get('--meta-db-url') ||
    process.env.NOCODB_META_DB_URL ||
    ncDbToPostgresUrl(process.env.NC_DB) ||
    'postgresql://nocodb:nocodb_dev_password@localhost:5432/nocodb',
  provider:
    args.get('--provider') ||
    process.env.NC_CORP_SSO_PROVIDER ||
    'corporate',
  mockSubject:
    args.get('--mock-subject') ||
    process.env.MOCK_SSO_SUBJECT ||
    'mock-subject-state-e2e',
  mockEmail:
    args.get('--mock-email') ||
    process.env.MOCK_SSO_EMAIL ||
    'mock-state-e2e@example.invalid',
  mockEmployeeCode:
    args.get('--mock-employee-code') ||
    process.env.MOCK_SSO_EMPLOYEE_CODE ||
    'MOCK_STATE_E2E',
};

function usage() {
  return `Usage:
  node scripts/corporate_sso_smoke.mjs [--api-base http://localhost:3002] [--next /nc/mock-sso-smoke] [--cleanup]
  node scripts/corporate_sso_smoke.mjs --cleanup-only

Run this after starting NocoDB in hybrid mode against
scripts/corporate_sso_mock_provider.mjs. --cleanup removes only local mock
NocoDB users, tokens, workspace links, and corporate mappings for the configured
mock email, employee_code, and subject.`;
}

function ncDbToPostgresUrl(value) {
  if (!value) return undefined;
  if (value.startsWith('postgresql://') || value.startsWith('postgres://')) {
    return value;
  }
  if (!value.startsWith('pg://')) return undefined;

  const parsed = new URL(value);
  const user = parsed.searchParams.get('u') || '';
  const password = parsed.searchParams.get('p') || '';
  const database = parsed.searchParams.get('d') || '';
  const auth =
    user || password
      ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@`
      : '';
  return `postgresql://${auth}${parsed.hostname}:${parsed.port || 5432}/${encodeURIComponent(database)}`;
}

async function requestManual(url) {
  return await fetch(url, { redirect: 'manual' });
}

function locationOf(response, label) {
  const location = response.headers.get('location');
  if (!location) {
    throw new Error(`${label} did not return a redirect location`);
  }
  return location;
}

function assertRedirect(response, label) {
  if (response.status < 300 || response.status >= 400) {
    throw new Error(`${label} expected redirect, got HTTP ${response.status}`);
  }
}

async function main() {
  if (args.has('--help') || args.has('-h')) {
    console.log(usage());
    return;
  }

  if (config.cleanupOnly) {
    const cleanup = await cleanupMockRows();
    console.log('cleanup');
    printCleanup(cleanup);
    return;
  }

  const loginUrl = new URL('/auth/corporate', config.apiBase);
  loginUrl.searchParams.set('next', config.nextPath);

  const loginResponse = await requestManual(loginUrl);
  assertRedirect(loginResponse, 'NocoDB SSO login');
  const providerLoginUrl = locationOf(loginResponse, 'NocoDB SSO login');

  const providerResponse = await requestManual(providerLoginUrl);
  assertRedirect(providerResponse, 'mock provider login');
  const callbackUrl = locationOf(providerResponse, 'mock provider login');

  const callbackResponse = await requestManual(callbackUrl);
  assertRedirect(callbackResponse, 'NocoDB SSO callback');
  const finalUrl = locationOf(callbackResponse, 'NocoDB SSO callback');

  if (finalUrl.includes('corporateSsoError=')) {
    throw new Error(`callback failed: ${finalUrl}`);
  }

  const setCookie =
    typeof callbackResponse.headers.getSetCookie === 'function'
      ? callbackResponse.headers.getSetCookie().join('\n')
      : callbackResponse.headers.get('set-cookie') || '';

  if (!setCookie.includes('nc_token=')) {
    throw new Error('callback response did not set nc_token');
  }
  if (!setCookie.includes('refresh_token=')) {
    throw new Error('callback response did not set refresh_token');
  }

  const provisioned = await assertProvisionedRows();

  console.log('ok');
  console.log(`provider_login\t${providerLoginUrl}`);
  console.log(`callback\t${callbackUrl}`);
  console.log(`final\t${finalUrl}`);
  console.log('cookies\tnc_token,refresh_token');
  console.log(
    `provisioned\tuser=${provisioned.user.id}\tmapping=${provisioned.mapping.id}\tworkspace_role=${provisioned.workspaceRole}`,
  );

  if (config.cleanup) {
    const cleanup = await cleanupMockRows();
    console.log('cleanup');
    printCleanup(cleanup);
  }
}

async function assertProvisionedRows() {
  const client = new Client({
    connectionString: config.metaDbUrl,
    statement_timeout: 10_000,
    query_timeout: 10_000,
  });

  await client.connect();
  try {
    const userResult = await client.query(
      'select id, email, roles from nc_users_v2 where email = $1 limit 1',
      [config.mockEmail],
    );
    const user = userResult.rows[0];
    if (!user) {
      throw new Error(`SSO user was not provisioned for ${config.mockEmail}`);
    }

    const mappingResult = await client.query(
      `
        select id, fk_user_id, subject, employee_code, last_login_at
        from nc_corp_identity_mappings
        where provider = $1 and (subject = $2 or employee_code = $3 or email = $4)
        order by updated_at desc
        limit 1
      `,
      [
        config.provider,
        config.mockSubject,
        config.mockEmployeeCode,
        config.mockEmail,
      ],
    );
    const mapping = mappingResult.rows[0];
    if (!mapping) {
      throw new Error('SSO identity mapping was not persisted');
    }
    if (mapping.fk_user_id !== user.id) {
      throw new Error('SSO mapping is not linked to the provisioned user');
    }
    if (!mapping.last_login_at) {
      throw new Error('SSO mapping last_login_at was not updated');
    }

    const workspaceResult = await client.query(
      `
        select roles
        from workspace_user
        where fk_user_id = $1
        order by created_at asc
        limit 1
      `,
      [user.id],
    );
    const workspaceUser = workspaceResult.rows[0];
    if (!workspaceUser) {
      throw new Error('SSO user was not added to a workspace');
    }

    return {
      user,
      mapping,
      workspaceRole: workspaceUser.roles,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function cleanupMockRows() {
  const client = new Client({
    connectionString: config.metaDbUrl,
    statement_timeout: 10_000,
    query_timeout: 10_000,
  });

  await client.connect();
  try {
    await client.query('begin');
    const users = await client.query(
      'select id from nc_users_v2 where email = $1',
      [config.mockEmail],
    );
    const userIds = users.rows.map((row) => row.id);

    const result = {};
    result.refreshTokens = userIds.length
      ? Number(
          (
            await client.query(
              'delete from nc_user_refresh_tokens where fk_user_id = any($1::text[])',
              [userIds],
            )
          ).rowCount,
        )
      : 0;
    result.workspaceUsers = userIds.length
      ? Number(
          (
            await client.query(
              'delete from workspace_user where fk_user_id = any($1::text[])',
              [userIds],
            )
          ).rowCount,
        )
      : 0;
    result.orgUsers = userIds.length
      ? Number(
          (
            await client.query(
              'delete from nc_org_users where fk_user_id = any($1::text[])',
              [userIds],
            )
          ).rowCount,
        )
      : 0;
    result.baseUsers = userIds.length
      ? Number(
          (
            await client.query(
              'delete from nc_base_users_v2 where fk_user_id = any($1::text[])',
              [userIds],
            )
          ).rowCount,
        )
      : 0;

    const mappingDelete = userIds.length
      ? await client.query(
          `
            delete from nc_corp_identity_mappings
            where provider = $1
              and (
                subject = $2
                or employee_code = $3
                or email = $4
                or fk_user_id = any($5::text[])
              )
          `,
          [
            config.provider,
            config.mockSubject,
            config.mockEmployeeCode,
            config.mockEmail,
            userIds,
          ],
        )
      : await client.query(
          `
            delete from nc_corp_identity_mappings
            where provider = $1
              and (subject = $2 or employee_code = $3 or email = $4)
          `,
          [
            config.provider,
            config.mockSubject,
            config.mockEmployeeCode,
            config.mockEmail,
          ],
        );
    result.mappings = Number(mappingDelete.rowCount);

    result.users = userIds.length
      ? Number(
          (
            await client.query(
              'delete from nc_users_v2 where id = any($1::text[])',
              [userIds],
            )
          ).rowCount,
        )
      : 0;

    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    await client.end().catch(() => undefined);
  }
}

function printCleanup(cleanup) {
  for (const [key, value] of Object.entries(cleanup)) {
    console.log(`${key}\t${value}`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

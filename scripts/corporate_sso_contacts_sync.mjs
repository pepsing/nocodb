#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
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
  apply: args.has('--apply'),
  limit: Math.min(Math.max(Number(args.get('--limit') || 20), 1), 1000),
  employeeCode: args.get('--employee-code'),
  provider: args.get('--provider') || process.env.NC_CORP_SSO_PROVIDER || 'corporate',
  contactsDbUrl:
    args.get('--contacts-db-url') ||
    process.env.NC_CORP_SSO_CONTACTS_DB_URL ||
    process.env.NC_CORP_SSO_CONTACTS_DATABASE_URL ||
    process.env.CONTACTS_DB_URL,
  metaDbUrl:
    args.get('--meta-db-url') ||
    process.env.NOCODB_META_DB_URL ||
    ncDbToPostgresUrl(process.env.NC_DB) ||
    'postgresql://nocodb:nocodb_dev_password@localhost:5432/nocodb',
  contactsTable:
    args.get('--contacts-table') ||
    process.env.NC_CORP_SSO_CONTACTS_TABLE ||
    'user_contacts',
  employeeCodeColumn:
    args.get('--employee-code-column') ||
    process.env.NC_CORP_SSO_CONTACTS_EMPLOYEE_CODE_COLUMN ||
    'employee_code',
  displayNameColumn:
    args.get('--display-name-column') ||
    process.env.NC_CORP_SSO_CONTACTS_DISPLAY_NAME_COLUMN ||
    'name',
  emailColumn:
    args.get('--email-column') ||
    process.env.NC_CORP_SSO_CONTACTS_EMAIL_COLUMN,
  departmentColumn:
    args.get('--department-column') ||
    process.env.NC_CORP_SSO_CONTACTS_DEPARTMENT_COLUMN,
  orgRoles:
    args.get('--org-roles') ||
    process.env.NC_CORP_SSO_DEFAULT_ORG_ROLES ||
    'org-level-viewer',
  workspaceRoles:
    args.get('--workspace-roles') ||
    process.env.NC_CORP_SSO_DEFAULT_WORKSPACE_ROLES ||
    'workspace-level-viewer',
};

function usage() {
  return `Usage:
  node scripts/corporate_sso_contacts_sync.mjs [--apply] [--limit 20] [--employee-code E001]

Environment:
  CONTACTS_DB_URL or NC_CORP_SSO_CONTACTS_DB_URL     read-only corporate contacts database
  NOCODB_META_DB_URL or NC_DB                        local NocoDB meta database

The contacts database is always read-only. Local NocoDB mappings are changed
only when --apply is present.`;
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

function quoteIdentifier(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteQualifiedIdentifier(identifier) {
  return identifier
    .split('.')
    .map((part) => quoteIdentifier(part))
    .join('.');
}

function mappingId() {
  return randomBytes(15).toString('base64url').slice(0, 20);
}

function selectedColumns() {
  const columns = [
    ['employee_code', config.employeeCodeColumn],
    ['display_name', config.displayNameColumn],
  ];
  if (config.emailColumn) columns.push(['email', config.emailColumn]);
  if (config.departmentColumn) {
    columns.push(['department', config.departmentColumn]);
  }
  return columns;
}

async function fetchContacts(client) {
  const selectList = selectedColumns()
    .map(([alias, column]) => `${quoteIdentifier(column)} as ${quoteIdentifier(alias)}`)
    .join(', ');
  const table = quoteQualifiedIdentifier(config.contactsTable);
  const employeeColumn = quoteIdentifier(config.employeeCodeColumn);
  const params = [];
  let where = '';

  if (config.employeeCode) {
    params.push(config.employeeCode);
    where = `where ${employeeColumn} = $1`;
  }

  params.push(config.limit);
  const sql = `
    select ${selectList}
    from ${table}
    ${where}
    order by ${employeeColumn}
    limit $${params.length}
  `;

  const result = await client.query(sql, params);
  return result.rows.map((row) => ({
    employee_code: clean(row.employee_code),
    display_name: clean(row.display_name),
    email: clean(row.email),
    department: clean(row.department),
  }));
}

async function getExistingMapping(client, employeeCode) {
  const result = await client.query(
    `
      select id, provider, subject, employee_code, email, display_name,
             department, fk_user_id, org_roles, workspace_roles, is_disabled
      from nc_corp_identity_mappings
      where provider = $1 and employee_code = $2
      order by updated_at desc
      limit 1
    `,
    [config.provider, employeeCode],
  );
  return result.rows[0] || null;
}

async function upsertMapping(client, contact, existing) {
  if (existing) {
    await client.query(
      `
        update nc_corp_identity_mappings
        set display_name = coalesce($2, display_name),
            email = coalesce($3, email),
            department = coalesce($4, department),
            org_roles = coalesce(org_roles, $5),
            workspace_roles = coalesce(workspace_roles, $6),
            updated_at = now()
        where id = $1
      `,
      [
        existing.id,
        contact.display_name,
        contact.email,
        contact.department,
        config.orgRoles,
        config.workspaceRoles,
      ],
    );
    return 'updated';
  }

  await client.query(
    `
      insert into nc_corp_identity_mappings (
        id, provider, employee_code, display_name, email, department,
        org_roles, workspace_roles, is_super_admin, is_disabled,
        auto_provisioned, created_at, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, false, false, false, now(), now())
    `,
    [
      mappingId(),
      config.provider,
      contact.employee_code,
      contact.display_name,
      contact.email,
      contact.department,
      config.orgRoles,
      config.workspaceRoles,
    ],
  );
  return 'inserted';
}

function clean(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function printRows(rows) {
  for (const row of rows) {
    console.log(
      [
        row.action,
        row.employee_code,
        row.display_name || '',
        row.email || '',
        row.department || '',
        row.mapping_id || '',
      ].join('\t'),
    );
  }
}

async function main() {
  if (args.has('--help') || args.has('-h')) {
    console.log(usage());
    return;
  }
  if (!config.contactsDbUrl) {
    throw new Error(`Missing contacts database URL.\n\n${usage()}`);
  }

  const contactsClient = new Client({
    connectionString: config.contactsDbUrl,
    statement_timeout: 10_000,
    query_timeout: 10_000,
  });
  const metaClient = new Client({
    connectionString: config.metaDbUrl,
    statement_timeout: 10_000,
    query_timeout: 10_000,
  });

  await contactsClient.connect();
  await metaClient.connect();

  try {
    const contacts = await fetchContacts(contactsClient);
    const rows = [];

    if (config.apply) {
      await metaClient.query('begin');
    }

    for (const contact of contacts) {
      if (!contact.employee_code) {
        rows.push({ ...contact, action: 'skipped_missing_employee_code' });
        continue;
      }
      const existing = await getExistingMapping(metaClient, contact.employee_code);
      const action = existing ? 'update' : 'insert';

      if (config.apply) {
        rows.push({
          ...contact,
          action: await upsertMapping(metaClient, contact, existing),
          mapping_id: existing?.id,
        });
      } else {
        rows.push({
          ...contact,
          action,
          mapping_id: existing?.id,
        });
      }
    }

    if (config.apply) {
      await metaClient.query('commit');
    }

    console.log(config.apply ? 'mode\tapply' : 'mode\tdry-run');
    console.log(`provider\t${config.provider}`);
    console.log(`contacts\t${contacts.length}`);
    console.log('action\temployee_code\tdisplay_name\temail\tdepartment\tmapping_id');
    printRows(rows);
  } catch (e) {
    if (config.apply) {
      await metaClient.query('rollback').catch(() => undefined);
    }
    throw e;
  } finally {
    await contactsClient.end().catch(() => undefined);
    await metaClient.end().catch(() => undefined);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

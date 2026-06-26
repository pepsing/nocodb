# Corporate SSO

This integration adds a switchable company SSO login path while keeping the
local NocoDB email login available in `local` and `hybrid` modes.

## Recommended user lifecycle

Do not pre-create every corporate employee as a NocoDB user. Use the corporate
provider for authentication, keep the local `nc_corp_identity_mappings` table as
the authorization and role boundary, and create or link a NocoDB user on first
successful SSO login.

This keeps unused corporate identities out of NocoDB and makes disable, role
change, and audit decisions local to the NocoDB deployment.

## Core environment variables

```bash
NC_AUTH_MODE=hybrid
NC_CORP_SSO_PROVIDER=corporate
NC_CORP_SSO_PROVIDER_NAME="Company Login"
NC_CORP_SSO_BASE_URL=https://sso.example.com
NC_CORP_SSO_LOGIN_PATH=/login/v2/auth/login
NC_CORP_SSO_TOKEN_PATH=/login/v2/auth/get_token
NC_CORP_SSO_APP_KEY=replace-me
NC_CORP_SSO_APP_SECRET=replace-me
NC_CORP_SSO_REDIRECT_URI=https://nocodb.example.com/auth/corporate/callback
NC_CORP_SSO_STATE_SECRET=replace-with-a-long-random-secret
```

`NC_AUTH_MODE` supports:

- `local`: local NocoDB login only.
- `hybrid`: local NocoDB login plus company SSO.
- `corporate_sso`: company SSO only; the email/password UI is hidden.

The implementation is compatible with the reference app's variable names:
`SSO_URL`, `SSO_LOGIN_PATH`, `SSO_TOKEN_PATH`, `SSO_APP_KEY`,
`SSO_APP_SECRET`, `SSO_REDIRECT_URI`, and `AUTH_SESSION_SECRET`.

The callback `state` is verified by default. NocoDB sends the signed state as
the provider `state` parameter, embeds the same signed value into the callback
`redirectUrl` as `sso_state`, and also sets an httpOnly same-site callback
cookie. This supports company gateways that omit the standard query `state` but
preserve the callback URL's own query string. During callback handling, NocoDB
accepts the first valid signed state from the provider `state`, callback
`sso_state`, or httpOnly cookie. If a gateway drops all of those, temporarily
set `NC_CORP_SSO_ALLOW_UNSAFE_STATE_FALLBACK=true` while fixing the gateway.
Leaving this off is the safer default.

## Mapping and provisioning

By default `NC_CORP_SSO_REQUIRE_MAPPING` is enabled. A user who passes company
SSO still needs a local mapping row unless you explicitly enable automatic
mapping creation.

For a given provider, `employee_code` is unique in the local mapping table.
This keeps one corporate employee tied to one local authorization record and
avoids ambiguous role resolution during login.

```bash
NC_CORP_SSO_REQUIRE_MAPPING=true
NC_CORP_SSO_AUTO_CREATE_MAPPING=false
NC_CORP_SSO_AUTO_PROVISION_USER=true
NC_CORP_SSO_DEFAULT_ORG_ROLES=org-level-viewer
NC_CORP_SSO_DEFAULT_WORKSPACE_ROLES=workspace-level-viewer
```

Manage mappings with a super-admin NocoDB session token:

```bash
curl -X POST "$NC_SITE_URL/api/v1/auth/corporate/mappings" \
  -H "xc-auth: $NC_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "employee_code": "E001",
    "subject": "sso-subject",
    "email": "user@example.com",
    "display_name": "User One",
    "workspace_roles": "workspace-level-viewer"
  }'
```

Set `"provision_user": true` to create or link the NocoDB user immediately.
Otherwise the user is created or linked during the first successful SSO login.

On a fresh self-hosted instance, the first auto-provisioned corporate SSO user
follows NocoDB's normal first-user behavior: the user becomes the initial
creator/super admin and creates the default workspace as workspace owner. Later
SSO users are assigned from their mapping row, or from
`NC_CORP_SSO_DEFAULT_ORG_ROLES` and `NC_CORP_SSO_DEFAULT_WORKSPACE_ROLES`.

## Optional user_contacts gate

The corporate contact table can be used as an additional read-only gate. This
is optional and off by default.

```bash
NC_CORP_SSO_REQUIRE_CONTACT=true
NC_CORP_SSO_CONTACTS_DB_URL=postgresql://readonly-user:readonly-password@db.example.com:5432/postgres
NC_CORP_SSO_CONTACTS_TABLE=user_contacts
NC_CORP_SSO_CONTACTS_EMPLOYEE_CODE_COLUMN=employee_code
NC_CORP_SSO_CONTACTS_DISPLAY_NAME_COLUMN=name
```

When enabled, SSO login is denied if the SSO token has no `employee_code` claim
or if that code cannot be found in the contact table. The contact table is never
modified.

To populate a local mapping from the contact table without creating a NocoDB
user:

```bash
curl -X POST "$NC_SITE_URL/api/v1/auth/corporate/mappings" \
  -H "xc-auth: $NC_TOKEN" \
  -H "content-type: application/json" \
  -d '{"employee_code":"E001","sync_contact":true}'
```

For batch preview or controlled seeding, use the helper script. It only reads
the corporate contacts database. It changes local NocoDB mappings only when
`--apply` is present.

```bash
CONTACTS_DB_URL=postgresql://readonly-user:readonly-password@db.example.com:5432/postgres \
NOCODB_META_DB_URL=postgresql://nocodb:nocodb_dev_password@localhost:5432/nocodb \
node scripts/corporate_sso_contacts_sync.mjs --limit 20
```

Seed a single local mapping after reviewing the dry-run output:

```bash
CONTACTS_DB_URL=postgresql://readonly-user:readonly-password@db.example.com:5432/postgres \
NOCODB_META_DB_URL=postgresql://nocodb:nocodb_dev_password@localhost:5432/nocodb \
node scripts/corporate_sso_contacts_sync.mjs --employee-code E001 --apply
```

## Claim mapping

The default claim names match the reference implementation.

```bash
NC_CORP_SSO_SUBJECT_CLAIM=id
NC_CORP_SSO_DISPLAY_NAME_CLAIM=name
NC_CORP_SSO_EMAIL_CLAIM=mail
NC_CORP_SSO_EMPLOYEE_CODE_CLAIM=code
NC_CORP_SSO_DEPARTMENT_CLAIM=department
```

For local or internal deployments where the SSO certificate chain and JWT
signature validation are not ready, the defaults match the reference app:

```bash
NC_CORP_SSO_HTTP_VERIFY_TLS=false
NC_CORP_SSO_JWT_VERIFY_SIGNATURE=false
```

Enable them once the SSO endpoint and token signing policy are stable.

## Local development startup

Start middleware first:

```bash
docker compose -f docker-compose/local-dev/docker-compose.yml up -d
```

Then start the backend against local Postgres, Redis, and MinIO:

```bash
cd packages/nocodb
NODE_ENV=development \
NC_DISABLE_TELE=true \
ENTRYPOINT=src/run/docker \
PORT=3002 \
NC_DB='pg://localhost:5432?u=nocodb&p=nocodb_dev_password&d=nocodb' \
NC_REDIS_URL='redis://localhost:6379' \
NC_S3_BUCKET_NAME='nocodb' \
NC_S3_ENDPOINT='http://localhost:9000' \
NC_S3_ACCESS_KEY='nocodb_minio' \
NC_S3_ACCESS_SECRET='nocodb_minio_secret' \
NC_S3_FORCE_PATH_STYLE='true' \
NC_DASHBOARD_URL='http://localhost:3005' \
./node_modules/.bin/rspack --config rspack.dev.config.js
```

Add the `NC_AUTH_MODE=hybrid` and `NC_CORP_SSO_*` variables from the sections
above when validating the real company SSO callback.

## Local same-origin SSO check

When the frontend and backend run on different local ports, use a same-origin
proxy so browser cookies, SSO callback redirects, and frontend API calls all use
one public origin.

Start the proxy:

```bash
PORT=3014 \
FRONTEND_ORIGIN=http://127.0.0.1:3012 \
BACKEND_ORIGIN=http://127.0.0.1:3010 \
node scripts/corporate_sso_same_origin_proxy.mjs
```

Start the backend with the public URLs pointed at that proxy:

```bash
NC_SITE_URL=http://127.0.0.1:3014
NC_PUBLIC_URL=http://127.0.0.1:3014
NC_DASHBOARD_URL=http://127.0.0.1:3014
NC_CORP_SSO_FRONTEND_URL=http://127.0.0.1:3014
NC_CORP_SSO_REDIRECT_URI=http://127.0.0.1:3014/auth/corporate/callback
```

The browser entrypoint is then `http://127.0.0.1:3014/signin`. The company SSO
provider must redirect back to the 3014 callback URL.

## Local mock SSO smoke test

Start the mock provider in a separate shell:

```bash
node scripts/corporate_sso_mock_provider.mjs
```

To simulate gateways that omit or corrupt the standard provider `state`, set
`MOCK_SSO_OMIT_STATE=true` or `MOCK_SSO_INVALID_STATE=true` on the mock
provider. The callback should still pass when the embedded callback
`sso_state` is preserved.

Start the backend with these additional variables:

```bash
NC_AUTH_MODE=hybrid
NC_CORP_SSO_BASE_URL=http://127.0.0.1:3099
NC_CORP_SSO_APP_KEY=mock-client
NC_CORP_SSO_APP_SECRET=mock-secret
NC_CORP_SSO_STATE_SECRET=mock-state-secret
NC_CORP_SSO_REQUIRE_MAPPING=false
NC_CORP_SSO_AUTO_CREATE_MAPPING=true
NC_CORP_SSO_FRONTEND_URL=http://localhost:3005
```

Then run:

```bash
node scripts/corporate_sso_smoke.mjs --api-base http://localhost:3002 --next /nc/mock-sso-smoke --cleanup
```

The smoke test checks the NocoDB login redirect, mock provider redirect,
callback redirect, `state` round trip, `nc_token` / `refresh_token` cookies,
the persisted corporate mapping, and the provisioned user's workspace
membership. Because `NC_CORP_SSO_AUTO_CREATE_MAPPING=true` creates local mock
rows, `--cleanup` removes the mock user, tokens, workspace links, and corporate
mapping after a successful smoke test.

If a manual test was interrupted after callback login, clean the same mock rows
without running the login flow:

```bash
node scripts/corporate_sso_smoke.mjs --cleanup-only
```

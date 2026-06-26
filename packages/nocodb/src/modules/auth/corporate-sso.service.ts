import https from 'https';
import axios from 'axios';
import * as jwt from 'jsonwebtoken';
import { Client } from 'pg';
import { Injectable } from '@nestjs/common';
import {
  EnterpriseOrgUserRoles,
  OrgUserRoles,
  WorkspaceUserRoles,
  extractRolesObj,
  type UserType,
} from 'nocodb-sdk';
import Noco from '~/Noco';
import { NcError } from '~/helpers/catchError';
import { CorporateIdentityMapping, User } from '~/models';
import { randomTokenString } from '~/services/users/helpers';
import {
  ensureUserInDefaultWorkspace,
  verifyDefaultWorkspace,
} from '~/helpers/verifyDefaultWorkspace';
import { ensureUserInDefaultOrg } from '~/helpers/verifyDefaultOrg';
import { MetaTable } from '~/utils/globals';

const STATE_PURPOSE = 'corporate_sso_state';
const STATE_COOKIE_NAME = 'nc_corp_sso_state';
const STATE_MAX_AGE_MS = 10 * 60 * 1000;
const DEFAULT_PROVIDER = 'corporate';

type CorporateSsoConfig = {
  enabled: boolean;
  mode: 'local' | 'corporate_sso' | 'hybrid';
  provider: string;
  providerName: string;
  baseUrl?: string;
  loginPath: string;
  tokenPath: string;
  appKey: string;
  appSecret: string;
  redirectUri?: string;
  subjectClaim: string;
  displayNameClaim: string;
  emailClaim: string;
  employeeCodeClaim: string;
  departmentClaim: string;
  verifyTls: boolean;
  verifyTokenSignature: boolean;
  requireMapping: boolean;
  autoCreateMapping: boolean;
  autoProvisionUser: boolean;
  hideEmailAuth: boolean;
  defaultOrgRoles: string;
  defaultWorkspaceRoles: WorkspaceUserRoles;
  requireContact: boolean;
  contactsDbUrl?: string;
  contactsTable: string;
  contactsEmployeeCodeColumn: string;
  contactsDisplayNameColumn: string;
  contactsEmailColumn?: string;
  contactsDepartmentColumn?: string;
  allowUnsafeStateFallback: boolean;
  debug: boolean;
};

type CorporateSsoUser = {
  subject: string;
  employee_code?: string;
  email?: string;
  display_name?: string;
  department?: string;
  claims: Record<string, any>;
};

type CorporateContact = {
  employee_code: string;
  display_name?: string;
  email?: string;
  department?: string;
};

type CorporateIdentityMappingInput = Partial<CorporateIdentityMapping> & {
  provision_user?: boolean;
  sync_contact?: boolean;
};

@Injectable()
export class CorporateSsoService {
  getConfig(): CorporateSsoConfig {
    const mode = (process.env.NC_AUTH_MODE ||
      (process.env.NC_CORP_SSO_ENABLED === 'true'
        ? 'corporate_sso'
        : 'local')) as CorporateSsoConfig['mode'];

    const enabled =
      mode === 'corporate_sso' ||
      mode === 'hybrid' ||
      process.env.NC_CORP_SSO_ENABLED === 'true';

    return {
      enabled,
      mode,
      provider: process.env.NC_CORP_SSO_PROVIDER || DEFAULT_PROVIDER,
      providerName: process.env.NC_CORP_SSO_PROVIDER_NAME || 'Company Login',
      baseUrl: process.env.NC_CORP_SSO_BASE_URL || process.env.SSO_URL,
      loginPath:
        process.env.NC_CORP_SSO_LOGIN_PATH ||
        process.env.SSO_LOGIN_PATH ||
        '/login/v2/auth/login',
      tokenPath:
        process.env.NC_CORP_SSO_TOKEN_PATH ||
        process.env.SSO_TOKEN_PATH ||
        '/login/v2/auth/get_token',
      appKey: process.env.NC_CORP_SSO_APP_KEY || process.env.SSO_APP_KEY || '',
      appSecret:
        process.env.NC_CORP_SSO_APP_SECRET || process.env.SSO_APP_SECRET || '',
      redirectUri:
        process.env.NC_CORP_SSO_REDIRECT_URI || process.env.SSO_REDIRECT_URI,
      subjectClaim:
        process.env.NC_CORP_SSO_SUBJECT_CLAIM ||
        process.env.SSO_SUBJECT_CLAIM ||
        'id',
      displayNameClaim:
        process.env.NC_CORP_SSO_DISPLAY_NAME_CLAIM ||
        process.env.SSO_DISPLAY_NAME_CLAIM ||
        'name',
      emailClaim:
        process.env.NC_CORP_SSO_EMAIL_CLAIM ||
        process.env.SSO_EMAIL_CLAIM ||
        'mail',
      employeeCodeClaim:
        process.env.NC_CORP_SSO_EMPLOYEE_CODE_CLAIM ||
        process.env.SSO_EMPLOYEE_CODE_CLAIM ||
        'code',
      departmentClaim:
        process.env.NC_CORP_SSO_DEPARTMENT_CLAIM ||
        process.env.SSO_DEPARTMENT_CLAIM ||
        'department',
      verifyTls:
        process.env.NC_CORP_SSO_HTTP_VERIFY_TLS === 'true' ||
        process.env.SSO_HTTP_VERIFY_TLS === 'true',
      verifyTokenSignature:
        process.env.NC_CORP_SSO_JWT_VERIFY_SIGNATURE === 'true' ||
        process.env.SSO_JWT_VERIFY_SIGNATURE === 'true',
      requireMapping: process.env.NC_CORP_SSO_REQUIRE_MAPPING !== 'false',
      autoCreateMapping: process.env.NC_CORP_SSO_AUTO_CREATE_MAPPING === 'true',
      autoProvisionUser:
        process.env.NC_CORP_SSO_AUTO_PROVISION_USER !== 'false',
      hideEmailAuth:
        process.env.NC_CORP_SSO_HIDE_EMAIL_AUTH === 'true' ||
        mode === 'corporate_sso',
      defaultOrgRoles:
        process.env.NC_CORP_SSO_DEFAULT_ORG_ROLES || OrgUserRoles.VIEWER,
      defaultWorkspaceRoles: (process.env.NC_CORP_SSO_DEFAULT_WORKSPACE_ROLES ||
        WorkspaceUserRoles.VIEWER) as WorkspaceUserRoles,
      requireContact:
        process.env.NC_CORP_SSO_REQUIRE_CONTACT === 'true' ||
        process.env.AUTH_REQUIRE_USER_CONTACT === 'true',
      contactsDbUrl:
        process.env.NC_CORP_SSO_CONTACTS_DB_URL ||
        process.env.NC_CORP_SSO_CONTACTS_DATABASE_URL,
      contactsTable:
        process.env.NC_CORP_SSO_CONTACTS_TABLE || 'user_contacts',
      contactsEmployeeCodeColumn:
        process.env.NC_CORP_SSO_CONTACTS_EMPLOYEE_CODE_COLUMN ||
        'employee_code',
      contactsDisplayNameColumn:
        process.env.NC_CORP_SSO_CONTACTS_DISPLAY_NAME_COLUMN || 'name',
      contactsEmailColumn: process.env.NC_CORP_SSO_CONTACTS_EMAIL_COLUMN,
      contactsDepartmentColumn:
        process.env.NC_CORP_SSO_CONTACTS_DEPARTMENT_COLUMN,
      allowUnsafeStateFallback:
        process.env.NC_CORP_SSO_ALLOW_UNSAFE_STATE_FALLBACK === 'true' ||
        process.env.SSO_ALLOW_UNSAFE_STATE_FALLBACK === 'true',
      debug: process.env.NC_CORP_SSO_DEBUG === 'true',
    };
  }

  publicInfo(req: any) {
    const config = this.getConfig();
    const configError =
      config.enabled && !this.isReady(config)
        ? 'Company login is enabled but not fully configured'
        : null;

    return {
      corporateSsoAuthEnabled: this.isReady(config),
      corporateSsoProviderName: config.providerName,
      corporateSsoLoginUrl: this.loginEndpoint(req),
      corporateSsoHideEmailAuth: this.shouldDisableEmailAuth(config),
      corporateSsoMode: config.mode,
      corporateSsoConfigError: configError,
    };
  }

  shouldDisableEmailAuth(config = this.getConfig()) {
    return config.enabled && config.hideEmailAuth;
  }

  isReady(config = this.getConfig()) {
    return !!(
      config.enabled &&
      config.baseUrl &&
      config.appKey &&
      config.appSecret
    );
  }

  async listMappings(query: any = {}) {
    const config = this.getConfig();
    const provider = query.provider || config.provider;
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const qb = Noco.ncMeta.knex(MetaTable.CORP_IDENTITY_MAPPINGS).where({
      provider,
    });

    if (query.subject) {
      qb.andWhere('subject', query.subject);
    }
    if (query.employee_code) {
      qb.andWhere('employee_code', query.employee_code);
    }
    if (query.email) {
      qb.andWhere('email', query.email);
    }

    const [{ count }] = await qb.clone().count({ count: '*' });
    const list = await qb
      .orderBy('updated_at', 'desc')
      .limit(limit)
      .offset(offset);

    return {
      list: list.map(CorporateIdentityMapping.castType),
      pageInfo: {
        totalRows: Number(count) || 0,
        limit,
        offset,
      },
    };
  }

  async upsertMapping(input: CorporateIdentityMappingInput) {
    const config = this.getConfig();
    const provider = input.provider || config.provider;
    const subject = this.cleanString(input.subject);
    const employee_code = this.cleanString(input.employee_code);

    if (!subject && !employee_code) {
      NcError.badRequest(
        'Corporate identity mapping requires subject or employee_code',
      );
    }

    let mapping = await this.findMappingByIdentity({
      provider,
      subject,
      employee_code,
    });

    const contact =
      input.sync_contact && employee_code
        ? await this.getContactByEmployeeCode(employee_code, config)
        : null;

    if (input.sync_contact && employee_code && !contact) {
      NcError.forbidden('Corporate SSO employee_code is not in user_contacts');
    }

    const data: Partial<CorporateIdentityMapping> = {
      provider,
      subject,
      employee_code,
      email: this.cleanString(input.email) || contact?.email,
      display_name:
        this.cleanString(input.display_name) || contact?.display_name,
      department: this.cleanString(input.department) || contact?.department,
      fk_user_id: this.cleanString(input.fk_user_id),
      org_roles: this.cleanString(input.org_roles),
      workspace_roles: this.cleanString(input.workspace_roles),
      base_roles: this.cleanString(input.base_roles),
      is_super_admin: input.is_super_admin,
      is_disabled: input.is_disabled,
      auto_provisioned: false,
    };

    mapping = mapping
      ? await CorporateIdentityMapping.update(mapping.id, data)
      : await CorporateIdentityMapping.insert(data);

    if (!input.provision_user) {
      return { mapping };
    }

    const user = await this.resolveNocoUser(
      {
        subject: mapping.subject || mapping.employee_code,
        employee_code: mapping.employee_code,
        email: mapping.email,
        display_name: mapping.display_name,
        department: mapping.department,
        claims: {
          source: 'manual_mapping',
          provider,
        },
      },
      mapping,
      config,
    );

    mapping = await CorporateIdentityMapping.update(mapping.id, {
      fk_user_id: user.id,
    });

    return {
      mapping,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        roles: user.roles,
      },
    };
  }

  async buildProviderLoginRedirect(req: any, nextPath?: string) {
    const config = this.getConfig();
    if (!this.isReady(config)) {
      NcError.badRequest('Corporate SSO is not configured');
    }

    const normalizedNextPath = this.normalizeNextPath(nextPath || '/nc');
    const state = this.createStateToken(normalizedNextPath);
    const redirectUri = this.resolveRedirectUri(
      req,
      config,
      normalizedNextPath,
      state,
    );
    const loginUrl = new URL(this.resolveUrl(config.loginPath, config));
    loginUrl.searchParams.set('appKey', config.appKey);
    loginUrl.searchParams.set('redirectUrl', redirectUri);
    loginUrl.searchParams.set('state', state);
    return {
      loginUrl: loginUrl.toString(),
      state,
    };
  }

  async buildProviderLoginUrl(req: any, nextPath?: string) {
    return (await this.buildProviderLoginRedirect(req, nextPath)).loginUrl;
  }

  setStateCookie(req: any, res: any, state: string) {
    res.cookie?.(STATE_COOKIE_NAME, state, {
      httpOnly: true,
      maxAge: STATE_MAX_AGE_MS,
      path: '/',
      sameSite: 'lax',
      secure: this.isSecureRequest(req),
    });
  }

  clearStateCookie(res: any) {
    res.clearCookie?.(STATE_COOKIE_NAME, { path: '/' });
  }

  async loginFromCallback(param: {
    req: any;
    code?: string;
    state?: string;
    callbackState?: string;
    next?: string;
  }): Promise<UserType & { provider?: string }> {
    const config = this.getConfig();
    if (!this.isReady(config)) {
      NcError.badRequest('Corporate SSO is not configured');
    }
    if (!param.code) {
      NcError.badRequest('Missing authorization code');
    }

    const stateNextPath = this.verifyCallbackStateToken(param, config);
    const nextPath =
      stateNextPath ||
      (config.allowUnsafeStateFallback
        ? this.normalizeNextPath(param.next)
        : '/');
    const corporateUser = await this.resolveContactForUser(
      await this.getUserFromCode(param.code, config),
      config,
    );
    const mapping = await this.resolveMapping(corporateUser, config);
    const user = await this.resolveNocoUser(corporateUser, mapping, config);

    await CorporateIdentityMapping.update(mapping.id, {
      subject: corporateUser.subject,
      employee_code: corporateUser.employee_code,
      email: corporateUser.email,
      display_name: corporateUser.display_name,
      department: corporateUser.department,
      fk_user_id: user.id,
      last_claims: this.safeJson(corporateUser.claims),
      last_login_at: new Date(),
    });

    (user as any).provider = 'corporate_sso';
    (user as any).extra = {
      corporate_sso_provider: config.provider,
      corporate_sso_employee_code: corporateUser.employee_code,
    };
    (user as any).corporateSsoNextPath = nextPath;
    return user;
  }

  normalizeNextPath(nextPath?: string | null) {
    if (!nextPath || !nextPath.startsWith('/') || nextPath.startsWith('//')) {
      return '/';
    }
    return nextPath;
  }

  resolveFrontendRedirectUrl(req: any, nextPath?: string | null) {
    const normalizedNextPath = this.normalizeNextPath(nextPath);
    const frontendUrl =
      process.env.NC_CORP_SSO_FRONTEND_URL || process.env.NC_DASHBOARD_URL;

    if (
      frontendUrl?.startsWith('http://') ||
      frontendUrl?.startsWith('https://')
    ) {
      return new URL(normalizedNextPath, frontendUrl).toString();
    }

    const base = (req?.ncSiteUrl || '').replace(/\/+$/, '');
    if (!base) return normalizedNextPath;

    if (frontendUrl && frontendUrl !== '/') {
      return `${base}/${frontendUrl.replace(/^\/+|\/+$/g, '')}${
        normalizedNextPath === '/' ? '' : normalizedNextPath
      }`;
    }

    return `${base}${normalizedNextPath}`;
  }

  private loginEndpoint(req: any) {
    const base = (req?.ncSiteUrl || '').replace(/\/+$/, '');
    return `${base}/auth/corporate`;
  }

  private resolveRedirectUri(
    req: any,
    config: CorporateSsoConfig,
    nextPath: string,
    state?: string,
  ) {
    const redirectUri =
      config.redirectUri ||
      (() => {
        const base = (req?.ncSiteUrl || '').replace(/\/+$/, '');
        return `${base}/auth/corporate/callback`;
      })();

    const url = new URL(redirectUri);
    url.searchParams.set('next', nextPath);
    if (state) {
      url.searchParams.set('sso_state', state);
    }
    return url.toString();
  }

  private resolveUrl(pathOrUrl: string, config: CorporateSsoConfig) {
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
      return pathOrUrl;
    }
    if (!config.baseUrl) {
      NcError.badRequest('Corporate SSO base URL is missing');
    }
    return `${config.baseUrl.replace(/\/+$/, '')}/${pathOrUrl.replace(
      /^\/+/,
      '',
    )}`;
  }

  private stateSecret() {
    return (
      process.env.NC_CORP_SSO_STATE_SECRET ||
      process.env.AUTH_SESSION_SECRET ||
      Noco.getConfig().auth.jwt.secret
    );
  }

  private getStateCookie(req: any) {
    return req?.cookies?.[STATE_COOKIE_NAME];
  }

  private isSecureRequest(req: any) {
    const forwardedProto = req?.headers?.['x-forwarded-proto'];
    return (
      req?.secure === true ||
      req?.protocol === 'https' ||
      (typeof forwardedProto === 'string' &&
        forwardedProto.split(',').map((v) => v.trim()).includes('https'))
    );
  }

  private createStateToken(nextPath: string) {
    return jwt.sign(
      {
        purpose: STATE_PURPOSE,
        next_path: nextPath,
      },
      this.stateSecret(),
      { expiresIn: '10m' },
    );
  }

  private verifyStateToken(
    state: string | null | undefined,
    config: CorporateSsoConfig,
  ) {
    if (!state) {
      if (config.allowUnsafeStateFallback) return null;
      NcError.unauthorized('Invalid or missing corporate SSO state');
    }
    try {
      const payload = jwt.verify(state, this.stateSecret()) as any;
      if (payload?.purpose !== STATE_PURPOSE) {
        if (config.allowUnsafeStateFallback) return null;
        NcError.unauthorized('Invalid or missing corporate SSO state');
      }
      return this.normalizeNextPath(payload.next_path);
    } catch {
      if (config.allowUnsafeStateFallback) return null;
      NcError.unauthorized('Invalid or expired corporate SSO state');
    }
  }

  private verifyCallbackStateToken(
    param: {
      req: any;
      state?: string;
      callbackState?: string;
    },
    config: CorporateSsoConfig,
  ) {
    const candidates = [
      param.state,
      param.callbackState,
      this.getStateCookie(param.req),
    ].filter((state): state is string => !!state);

    if (!candidates.length) {
      return this.verifyStateToken(undefined, config);
    }

    let lastError: any;
    for (const candidate of candidates) {
      try {
        return this.verifyStateToken(candidate, {
          ...config,
          allowUnsafeStateFallback: false,
        });
      } catch (e) {
        lastError = e;
      }
    }

    if (config.allowUnsafeStateFallback) return null;
    throw lastError;
  }

  private async getUserFromCode(
    code: string,
    config: CorporateSsoConfig,
  ): Promise<CorporateSsoUser> {
    const response = await axios.get(
      this.resolveUrl(config.tokenPath, config),
      {
        params: {
          code,
          app_key: config.appKey,
          app_secret: config.appSecret,
        },
        timeout: 20_000,
        httpsAgent: config.verifyTls
          ? undefined
          : new https.Agent({ rejectUnauthorized: false }),
      },
    );

    const payload = response.data;
    if (payload?.errno && payload.errno !== 0) {
      NcError.unauthorized(
        payload.reason || 'Corporate SSO token exchange failed',
      );
    }

    const token = payload?.token || payload?.id_token || payload?.access_token;
    if (!token) {
      NcError.unauthorized('Corporate SSO response is missing token');
    }

    const claims = this.decodeProviderToken(token, config);
    return this.normalizeUser(claims, config);
  }

  private decodeProviderToken(token: string, config: CorporateSsoConfig) {
    const secret = `${config.appKey}${config.appSecret}`;
    const claims = config.verifyTokenSignature
      ? jwt.verify(token, secret, {
          algorithms: ['HS256'],
          ignoreExpiration: true,
        })
      : jwt.decode(token);

    if (!claims || typeof claims !== 'object') {
      NcError.unauthorized('Corporate SSO token contains invalid claims');
    }

    return claims as Record<string, any>;
  }

  private normalizeUser(
    claims: Record<string, any>,
    config: CorporateSsoConfig,
  ): CorporateSsoUser {
    const subject = claims[config.subjectClaim];
    if (!subject) {
      NcError.unauthorized('Corporate SSO claims are missing subject');
    }

    const value = (key: string) =>
      claims[key] === undefined || claims[key] === null
        ? undefined
        : String(claims[key]);

    return {
      subject: String(subject),
      employee_code: value(config.employeeCodeClaim),
      email: value(config.emailClaim),
      display_name: value(config.displayNameClaim),
      department: value(config.departmentClaim),
      claims,
    };
  }

  private async resolveMapping(
    user: CorporateSsoUser,
    config: CorporateSsoConfig,
  ) {
    let mapping = await this.findMappingByIdentity({
      provider: config.provider,
      subject: user.subject,
      employee_code: user.employee_code,
    });

    if (!mapping && config.autoCreateMapping) {
      mapping = await CorporateIdentityMapping.insert({
        provider: config.provider,
        subject: user.subject,
        employee_code: user.employee_code,
        email: user.email,
        display_name: user.display_name,
        department: user.department,
        org_roles: config.defaultOrgRoles,
        workspace_roles: config.defaultWorkspaceRoles,
        auto_provisioned: true,
        last_claims: this.safeJson(user.claims),
      });
    }

    if (!mapping && config.requireMapping) {
      NcError.forbidden('Corporate SSO user is not allowlisted');
    }

    if (!mapping) {
      mapping = await CorporateIdentityMapping.insert({
        provider: config.provider,
        subject: user.subject,
        employee_code: user.employee_code,
        email: user.email,
        display_name: user.display_name,
        department: user.department,
        org_roles: config.defaultOrgRoles,
        workspace_roles: config.defaultWorkspaceRoles,
        auto_provisioned: true,
        last_claims: this.safeJson(user.claims),
      });
    }

    if (mapping.is_disabled) {
      NcError.forbidden('Corporate SSO user is disabled');
    }

    return mapping;
  }

  private async findMappingByIdentity({
    provider,
    subject,
    employee_code,
  }: {
    provider: string;
    subject?: string | null;
    employee_code?: string | null;
  }) {
    const subjectMapping = subject
      ? await CorporateIdentityMapping.findForLogin({
          provider,
          subject,
        })
      : null;
    const employeeMapping = employee_code
      ? await CorporateIdentityMapping.findForLogin({
          provider,
          employee_code,
        })
      : null;

    if (
      subjectMapping &&
      employeeMapping &&
      subjectMapping.id !== employeeMapping.id
    ) {
      NcError.forbidden(
        'Corporate SSO identity mapping conflict for subject and employee_code',
      );
    }

    return subjectMapping || employeeMapping;
  }

  private async resolveContactForUser(
    user: CorporateSsoUser,
    config: CorporateSsoConfig,
  ): Promise<CorporateSsoUser> {
    if (!config.requireContact) return user;

    if (!user.employee_code) {
      NcError.forbidden('Corporate SSO employee_code is missing');
    }

    const contact = await this.getContactByEmployeeCode(
      user.employee_code,
      config,
    );

    if (!contact) {
      NcError.forbidden('Corporate SSO user is not in user_contacts');
    }

    return {
      ...user,
      display_name: user.display_name || contact.display_name,
      email: user.email || contact.email,
      department: user.department || contact.department,
      claims: {
        ...user.claims,
        user_contact: {
          employee_code: contact.employee_code,
          display_name: contact.display_name,
          email: contact.email,
          department: contact.department,
        },
      },
    };
  }

  private async getContactByEmployeeCode(
    employeeCode: string,
    config: CorporateSsoConfig,
  ): Promise<CorporateContact | null> {
    if (!config.contactsDbUrl) {
      NcError.forbidden('Corporate SSO contact lookup is not configured');
    }

    const selectedColumns: Array<{
      alias: keyof CorporateContact;
      column: string;
    }> = [
      {
        alias: 'employee_code',
        column: config.contactsEmployeeCodeColumn,
      },
      {
        alias: 'display_name',
        column: config.contactsDisplayNameColumn,
      },
    ];

    if (config.contactsEmailColumn) {
      selectedColumns.push({
        alias: 'email',
        column: config.contactsEmailColumn,
      });
    }
    if (config.contactsDepartmentColumn) {
      selectedColumns.push({
        alias: 'department',
        column: config.contactsDepartmentColumn,
      });
    }

    const selectList = selectedColumns
      .map(
        ({ alias, column }) =>
          `${this.quoteIdentifier(column)} as ${this.quoteIdentifier(alias)}`,
      )
      .join(', ');
    const tableName = this.quoteQualifiedIdentifier(config.contactsTable);
    const employeeCodeColumn = this.quoteIdentifier(
      config.contactsEmployeeCodeColumn,
    );

    const client = new Client({
      connectionString: config.contactsDbUrl,
      statement_timeout: 10_000,
      query_timeout: 10_000,
    });

    try {
      await client.connect();
      const result = await client.query(
        `select ${selectList} from ${tableName} where ${employeeCodeColumn} = $1 limit 1`,
        [employeeCode],
      );
      return result.rows[0] || null;
    } catch (e) {
      NcError.forbidden('Corporate SSO contact lookup failed');
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private quoteIdentifier(identifier: string) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
      NcError.badRequest(`Invalid corporate contact identifier: ${identifier}`);
    }
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private quoteQualifiedIdentifier(identifier: string) {
    return identifier
      .split('.')
      .map((part) => this.quoteIdentifier(part))
      .join('.');
  }

  private async resolveNocoUser(
    corporateUser: CorporateSsoUser,
    mapping: CorporateIdentityMapping,
    config: CorporateSsoConfig,
  ) {
    let user = mapping.fk_user_id ? await User.get(mapping.fk_user_id) : null;
    let bootstrapLocalAdmin = false;
    const bootstrapAdminRoles = `${OrgUserRoles.CREATOR},${OrgUserRoles.SUPER_ADMIN}`;

    if (!user && corporateUser.email) {
      user = await User.getByEmail(corporateUser.email);
    }

    bootstrapLocalAdmin =
      process.env.NC_CLOUD !== 'true' && !(await this.hasSuperAdminUser());

    if (bootstrapLocalAdmin && !mapping.is_super_admin) {
      mapping = await CorporateIdentityMapping.update(mapping.id, {
        is_super_admin: true,
        org_roles: bootstrapAdminRoles,
        workspace_roles: WorkspaceUserRoles.OWNER,
      });
    }

    if (!user) {
      if (!config.autoProvisionUser) {
        NcError.forbidden('Corporate SSO user is not linked to a NocoDB user');
      }

      user = await User.insert({
        email: this.emailForUser(corporateUser),
        roles: bootstrapLocalAdmin
          ? bootstrapAdminRoles
          : this.rolesForUser(mapping, config),
        email_verified: true,
        is_new_user: false,
        token_version: randomTokenString(),
        meta: {
          corporate_sso: {
            provider: config.provider,
            subject: corporateUser.subject,
            employee_code: corporateUser.employee_code,
          },
        },
      });
    }

    const nextRoles = bootstrapLocalAdmin
      ? bootstrapAdminRoles
      : this.rolesForUser(mapping, config);
    const update: Partial<User> = {};
    if (
      corporateUser.display_name &&
      user.display_name !== corporateUser.display_name
    ) {
      update.display_name = corporateUser.display_name;
    }
    if (user.is_new_user) {
      update.is_new_user = false;
    }
    const currentRoles = extractRolesObj(user.roles);
    if (
      nextRoles &&
      user.roles !== nextRoles &&
      (mapping.is_super_admin || !currentRoles[OrgUserRoles.SUPER_ADMIN])
    ) {
      update.roles = nextRoles;
    }
    if (Object.keys(update).length) {
      user = await User.update(user.id, update);
    }

    if (bootstrapLocalAdmin) {
      await verifyDefaultWorkspace(user, Noco.ncMeta);
    } else {
      await ensureUserInDefaultWorkspace(
        user.id,
        this.workspaceRoleForUser(mapping, config),
      );
    }
    await ensureUserInDefaultOrg(user.id, EnterpriseOrgUserRoles.VIEWER);

    return user;
  }

  private async hasSuperAdminUser() {
    return !!(await Noco.ncMeta
      .knex(MetaTable.USERS)
      .where('roles', 'like', `%${OrgUserRoles.SUPER_ADMIN}%`)
      .first());
  }

  private rolesForUser(
    mapping: CorporateIdentityMapping,
    config: CorporateSsoConfig,
  ) {
    if (mapping.is_super_admin) {
      return `${OrgUserRoles.CREATOR},${OrgUserRoles.SUPER_ADMIN}`;
    }
    return mapping.org_roles || config.defaultOrgRoles;
  }

  private workspaceRoleForUser(
    mapping: CorporateIdentityMapping,
    config: CorporateSsoConfig,
  ) {
    if (mapping.is_super_admin) {
      return WorkspaceUserRoles.OWNER;
    }
    return (mapping.workspace_roles ||
      config.defaultWorkspaceRoles) as WorkspaceUserRoles;
  }

  private emailForUser(user: CorporateSsoUser) {
    if (user.email) return user.email;
    const seed = user.employee_code || user.subject;
    const local = seed.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    return `${local || `corp-${Date.now()}`}@corp.local`;
  }

  private safeJson(value: any) {
    try {
      return JSON.stringify(value);
    } catch {
      return '{}';
    }
  }

  private cleanString(value: any) {
    if (value === undefined || value === null) return undefined;
    const text = String(value).trim();
    return text || undefined;
  }
}

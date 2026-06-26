jest.mock('~/Noco', () => ({
  __esModule: true,
  default: {
    getConfig: () => ({ auth: { jwt: { secret: 'test-jwt-secret' } } }),
    ncMeta: {
      knex: jest.fn(),
    },
  },
}));

jest.mock('~/models', () => ({
  CorporateIdentityMapping: {
    findForLogin: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
  },
  User: {
    get: jest.fn(),
    getByEmail: jest.fn(),
    isFirst: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock('~/helpers/verifyDefaultWorkspace', () => ({
  ensureUserInDefaultWorkspace: jest.fn(),
  verifyDefaultWorkspace: jest.fn(),
}));

jest.mock('~/helpers/verifyDefaultOrg', () => ({
  ensureUserInDefaultOrg: jest.fn(),
}));

import {
  ensureUserInDefaultWorkspace,
  verifyDefaultWorkspace,
} from '~/helpers/verifyDefaultWorkspace';
import Noco from '~/Noco';
import { CorporateIdentityMapping, User } from '~/models';
import { CorporateSsoService } from './corporate-sso.service';

const CORP_ENV_KEYS = [
  'NC_AUTH_MODE',
  'NC_CORP_SSO_ENABLED',
  'NC_CORP_SSO_PROVIDER',
  'NC_CORP_SSO_PROVIDER_NAME',
  'NC_CORP_SSO_BASE_URL',
  'SSO_URL',
  'NC_CORP_SSO_LOGIN_PATH',
  'SSO_LOGIN_PATH',
  'NC_CORP_SSO_TOKEN_PATH',
  'SSO_TOKEN_PATH',
  'NC_CORP_SSO_APP_KEY',
  'SSO_APP_KEY',
  'NC_CORP_SSO_APP_SECRET',
  'SSO_APP_SECRET',
  'NC_CORP_SSO_REDIRECT_URI',
  'SSO_REDIRECT_URI',
  'NC_CORP_SSO_STATE_SECRET',
  'AUTH_SESSION_SECRET',
  'NC_CORP_SSO_REQUIRE_MAPPING',
  'NC_CORP_SSO_AUTO_CREATE_MAPPING',
  'NC_CORP_SSO_AUTO_PROVISION_USER',
  'NC_CORP_SSO_HIDE_EMAIL_AUTH',
  'NC_CORP_SSO_DEFAULT_ORG_ROLES',
  'NC_CORP_SSO_DEFAULT_WORKSPACE_ROLES',
  'NC_CORP_SSO_REQUIRE_CONTACT',
  'AUTH_REQUIRE_USER_CONTACT',
  'NC_CORP_SSO_CONTACTS_DB_URL',
  'NC_CORP_SSO_CONTACTS_DATABASE_URL',
  'NC_CORP_SSO_CONTACTS_TABLE',
  'NC_CORP_SSO_CONTACTS_EMPLOYEE_CODE_COLUMN',
  'NC_CORP_SSO_CONTACTS_DISPLAY_NAME_COLUMN',
  'NC_CORP_SSO_CONTACTS_EMAIL_COLUMN',
  'NC_CORP_SSO_CONTACTS_DEPARTMENT_COLUMN',
  'NC_CORP_SSO_ALLOW_UNSAFE_STATE_FALLBACK',
  'SSO_ALLOW_UNSAFE_STATE_FALLBACK',
  'NC_CORP_SSO_DEBUG',
  'NC_CLOUD',
] as const;

describe('CorporateSsoService', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = { ...process.env };
    for (const key of CORP_ENV_KEYS) {
      delete process.env[key];
    }
    (User.isFirst as jest.Mock).mockResolvedValue(false);
    (Noco.ncMeta.knex as jest.Mock).mockReturnValue({
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(null),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = originalEnv;
  });

  it('keeps local auth by default', () => {
    const service = new CorporateSsoService();

    const config = service.getConfig();
    const publicInfo = service.publicInfo({ ncSiteUrl: 'http://localhost:3002' });

    expect(config.enabled).toBe(false);
    expect(config.mode).toBe('local');
    expect(config.requireMapping).toBe(true);
    expect(publicInfo).toMatchObject({
      corporateSsoAuthEnabled: false,
      corporateSsoLoginUrl: 'http://localhost:3002/auth/corporate',
      corporateSsoHideEmailAuth: false,
      corporateSsoMode: 'local',
    });
  });

  it('disables email auth only for corporate-only or explicit hidden email modes', () => {
    const service = new CorporateSsoService();

    expect(service.shouldDisableEmailAuth()).toBe(false);

    process.env.NC_AUTH_MODE = 'hybrid';
    expect(service.shouldDisableEmailAuth()).toBe(false);

    process.env.NC_CORP_SSO_HIDE_EMAIL_AUTH = 'true';
    expect(service.shouldDisableEmailAuth()).toBe(true);

    delete process.env.NC_CORP_SSO_HIDE_EMAIL_AUTH;
    process.env.NC_AUTH_MODE = 'corporate_sso';
    expect(service.shouldDisableEmailAuth()).toBe(true);
  });

  it('surfaces a config error when company login is enabled but incomplete', () => {
    process.env.NC_AUTH_MODE = 'corporate_sso';
    process.env.NC_CORP_SSO_BASE_URL = 'https://sso.example.com/';

    const service = new CorporateSsoService();

    expect(service.publicInfo({ ncSiteUrl: 'http://localhost:3002' })).toMatchObject({
      corporateSsoAuthEnabled: false,
      corporateSsoHideEmailAuth: true,
      corporateSsoConfigError:
        'Company login is enabled but not fully configured',
    });
  });

  it('builds a company SSO login URL compatible with the reference app', async () => {
    process.env.NC_AUTH_MODE = 'hybrid';
    process.env.NC_CORP_SSO_BASE_URL = 'https://sso.example.com/';
    process.env.NC_CORP_SSO_APP_KEY = 'client-id';
    process.env.NC_CORP_SSO_APP_SECRET = 'client-secret';
    process.env.NC_CORP_SSO_STATE_SECRET = 'state-secret';

    const service = new CorporateSsoService();
    const loginUrl = await service.buildProviderLoginUrl(
      { ncSiteUrl: 'http://localhost:3002' },
      '/nc/base',
    );
    const parsed = new URL(loginUrl);
    const redirectUrl = new URL(parsed.searchParams.get('redirectUrl'));

    expect(`${parsed.origin}${parsed.pathname}`).toBe(
      'https://sso.example.com/login/v2/auth/login',
    );
    expect(parsed.searchParams.get('appKey')).toBe('client-id');
    expect(parsed.searchParams.get('state')).toBeTruthy();
    expect(redirectUrl.origin + redirectUrl.pathname).toBe(
      'http://localhost:3002/auth/corporate/callback',
    );
    expect(redirectUrl.searchParams.get('next')).toBe('/nc/base');
    expect(redirectUrl.searchParams.get('sso_state')).toBe(
      parsed.searchParams.get('state'),
    );
  });

  it('defaults company SSO login back to the NocoDB workspace route', async () => {
    process.env.NC_AUTH_MODE = 'hybrid';
    process.env.NC_CORP_SSO_BASE_URL = 'https://sso.example.com/';
    process.env.NC_CORP_SSO_APP_KEY = 'client-id';
    process.env.NC_CORP_SSO_APP_SECRET = 'client-secret';
    process.env.NC_CORP_SSO_STATE_SECRET = 'state-secret';

    const service = new CorporateSsoService();
    const loginUrl = await service.buildProviderLoginUrl({
      ncSiteUrl: 'http://localhost:3002',
    });
    const parsed = new URL(loginUrl);
    const redirectUrl = new URL(parsed.searchParams.get('redirectUrl'));

    expect(redirectUrl.searchParams.get('next')).toBe('/nc');
  });


  it('sets a secure http-only callback state cookie behind HTTPS proxies', () => {
    const service = new CorporateSsoService();
    const res = {
      cookie: jest.fn(),
    };

    service.setStateCookie(
      { headers: { 'x-forwarded-proto': 'https,http' } },
      res,
      'signed-state',
    );

    expect(res.cookie).toHaveBeenCalledWith(
      'nc_corp_sso_state',
      'signed-state',
      expect.objectContaining({
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: true,
      }),
    );
  });

  it('normalizes unsafe next paths', () => {
    const service = new CorporateSsoService();

    expect(service.normalizeNextPath('/nc/base')).toBe('/nc/base');
    expect(service.normalizeNextPath('https://example.com')).toBe('/');
    expect(service.normalizeNextPath('//example.com')).toBe('/');
    expect(service.normalizeNextPath(null)).toBe('/');
  });

  it('requires a valid callback state by default', async () => {
    process.env.NC_AUTH_MODE = 'hybrid';
    process.env.NC_CORP_SSO_BASE_URL = 'https://sso.example.com/';
    process.env.NC_CORP_SSO_APP_KEY = 'client-id';
    process.env.NC_CORP_SSO_APP_SECRET = 'client-secret';

    const service = new CorporateSsoService();

    await expect(
      service.loginFromCallback({
        req: { ncSiteUrl: 'http://localhost:3002' },
        code: 'callback-code',
        next: '/nc/base',
      }),
    ).rejects.toThrow('Invalid or missing corporate SSO state');
  });

  it('allows explicit callback state fallback for legacy SSO gateways', () => {
    process.env.NC_CORP_SSO_ALLOW_UNSAFE_STATE_FALLBACK = 'true';

    const service = new CorporateSsoService();
    const config = service.getConfig();

    expect(config.allowUnsafeStateFallback).toBe(true);
    expect((service as any).verifyStateToken(undefined, config)).toBeNull();
  });

  it('accepts a valid callback state from the http-only cookie', async () => {
    process.env.NC_AUTH_MODE = 'hybrid';
    process.env.NC_CORP_SSO_BASE_URL = 'https://sso.example.com/';
    process.env.NC_CORP_SSO_APP_KEY = 'client-id';
    process.env.NC_CORP_SSO_APP_SECRET = 'client-secret';
    process.env.NC_CORP_SSO_STATE_SECRET = 'state-secret';

    const service = new CorporateSsoService();
    const { state } = await service.buildProviderLoginRedirect(
      { ncSiteUrl: 'http://localhost:3002' },
      '/nc/base',
    );
    jest.spyOn(service as any, 'getUserFromCode').mockResolvedValue({
      subject: 'sso-subject-1',
      employee_code: 'E001',
      email: 'user.one@example.com',
      display_name: 'User One',
      claims: { id: 'sso-subject-1' },
    });
    jest.spyOn(service as any, 'resolveMapping').mockResolvedValue({
      id: 'mapping-1',
      provider: 'corporate',
      subject: 'sso-subject-1',
      employee_code: 'E001',
    });
    jest.spyOn(service as any, 'resolveNocoUser').mockResolvedValue({
      id: 'user-1',
      email: 'user.one@example.com',
      roles: 'org-level-viewer',
    });
    jest
      .spyOn(CorporateIdentityMapping, 'update')
      .mockResolvedValue({ id: 'mapping-1' } as any);

    const user = await service.loginFromCallback({
      req: {
        ncSiteUrl: 'http://localhost:3002',
        cookies: {
          nc_corp_sso_state: state,
        },
      },
      code: 'callback-code',
    });

    expect((user as any).corporateSsoNextPath).toBe('/nc/base');
    expect((user as any).provider).toBe('corporate_sso');
    expect(CorporateIdentityMapping.update).toHaveBeenCalledWith(
      'mapping-1',
      expect.objectContaining({
        subject: 'sso-subject-1',
        employee_code: 'E001',
        fk_user_id: 'user-1',
      }),
    );
  });

  it('accepts callback state embedded in redirectUrl when provider omits standard state', async () => {
    process.env.NC_AUTH_MODE = 'hybrid';
    process.env.NC_CORP_SSO_BASE_URL = 'https://sso.example.com/';
    process.env.NC_CORP_SSO_APP_KEY = 'client-id';
    process.env.NC_CORP_SSO_APP_SECRET = 'client-secret';
    process.env.NC_CORP_SSO_STATE_SECRET = 'state-secret';

    const service = new CorporateSsoService();
    const { loginUrl } = await service.buildProviderLoginRedirect(
      { ncSiteUrl: 'http://localhost:3002' },
      '/nc/base',
    );
    const providerUrl = new URL(loginUrl);
    const redirectUrl = new URL(providerUrl.searchParams.get('redirectUrl'));
    const callbackState = redirectUrl.searchParams.get('sso_state');
    jest.spyOn(service as any, 'getUserFromCode').mockResolvedValue({
      subject: 'sso-subject-1',
      employee_code: 'E001',
      email: 'user.one@example.com',
      display_name: 'User One',
      claims: { id: 'sso-subject-1' },
    });
    jest.spyOn(service as any, 'resolveMapping').mockResolvedValue({
      id: 'mapping-1',
      provider: 'corporate',
      subject: 'sso-subject-1',
      employee_code: 'E001',
    });
    jest.spyOn(service as any, 'resolveNocoUser').mockResolvedValue({
      id: 'user-1',
      email: 'user.one@example.com',
      roles: 'org-level-viewer',
    });
    jest
      .spyOn(CorporateIdentityMapping, 'update')
      .mockResolvedValue({ id: 'mapping-1' } as any);

    const user = await service.loginFromCallback({
      req: { ncSiteUrl: 'http://localhost:3002' },
      code: 'callback-code',
      callbackState,
    });

    expect((user as any).corporateSsoNextPath).toBe('/nc/base');
    expect((user as any).provider).toBe('corporate_sso');
  });

  it('accepts embedded callback state when the provider returns an invalid state value', async () => {
    process.env.NC_AUTH_MODE = 'hybrid';
    process.env.NC_CORP_SSO_BASE_URL = 'https://sso.example.com/';
    process.env.NC_CORP_SSO_APP_KEY = 'client-id';
    process.env.NC_CORP_SSO_APP_SECRET = 'client-secret';
    process.env.NC_CORP_SSO_STATE_SECRET = 'state-secret';

    const service = new CorporateSsoService();
    const { loginUrl } = await service.buildProviderLoginRedirect(
      { ncSiteUrl: 'http://localhost:3002' },
      '/nc/base',
    );
    const providerUrl = new URL(loginUrl);
    const redirectUrl = new URL(providerUrl.searchParams.get('redirectUrl'));

    expect(
      (service as any).verifyCallbackStateToken(
        {
          req: { ncSiteUrl: 'http://localhost:3002' },
          state: 'invalid-provider-state',
          callbackState: redirectUrl.searchParams.get('sso_state'),
        },
        service.getConfig(),
      ),
    ).toBe('/nc/base');
  });

  it('can sync local mapping data from a read-only corporate contact lookup', async () => {
    const service = new CorporateSsoService();
    const contactLookup = jest
      .spyOn(service as any, 'getContactByEmployeeCode')
      .mockResolvedValue({
        employee_code: 'E001',
        display_name: 'User One',
        email: 'user.one@example.com',
        department: 'Engineering',
      });
    const findForLogin = jest
      .spyOn(CorporateIdentityMapping, 'findForLogin')
      .mockResolvedValue(null);
    const insert = jest
      .spyOn(CorporateIdentityMapping, 'insert')
      .mockImplementation(async (data: any) => ({ id: 'map1', ...data }) as any);

    const result = await service.upsertMapping({
      employee_code: 'E001',
      sync_contact: true,
    });

    expect(contactLookup).toHaveBeenCalledWith(
      'E001',
      expect.objectContaining({ contactsTable: 'user_contacts' }),
    );
    expect(findForLogin).toHaveBeenCalledWith({
      provider: 'corporate',
      employee_code: 'E001',
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'corporate',
        employee_code: 'E001',
        display_name: 'User One',
        email: 'user.one@example.com',
        department: 'Engineering',
        auto_provisioned: false,
      }),
    );
    expect(result.mapping).toMatchObject({
      id: 'map1',
      employee_code: 'E001',
      display_name: 'User One',
    });
  });

  it('honors the reference app contact gate environment alias', () => {
    process.env.AUTH_REQUIRE_USER_CONTACT = 'true';

    const service = new CorporateSsoService();

    expect(service.getConfig().requireContact).toBe(true);
  });

  it('rejects conflicting mappings for subject and employee_code during SSO login', async () => {
    const service = new CorporateSsoService();
    const findForLogin = jest
      .spyOn(CorporateIdentityMapping, 'findForLogin')
      .mockImplementation(async (query: any) => {
        if (query.subject) {
          return {
            id: 'mapping-by-subject',
            provider: 'corporate',
            subject: query.subject,
          } as any;
        }
        if (query.employee_code) {
          return {
            id: 'mapping-by-employee',
            provider: 'corporate',
            employee_code: query.employee_code,
          } as any;
        }
        return null;
      });
    const insert = jest.spyOn(CorporateIdentityMapping, 'insert');

    await expect(
      (service as any).resolveMapping(
        {
          subject: 'sso-subject-1',
          employee_code: 'E001',
          claims: {},
        },
        service.getConfig(),
      ),
    ).rejects.toThrow(
      'Corporate SSO identity mapping conflict for subject and employee_code',
    );

    expect(findForLogin).toHaveBeenCalledWith({
      provider: 'corporate',
      subject: 'sso-subject-1',
    });
    expect(findForLogin).toHaveBeenCalledWith({
      provider: 'corporate',
      employee_code: 'E001',
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it('accepts one mapping when subject and employee_code resolve to the same row', async () => {
    const service = new CorporateSsoService();
    const mapping = {
      id: 'mapping-1',
      provider: 'corporate',
      subject: 'sso-subject-1',
      employee_code: 'E001',
    };
    jest
      .spyOn(CorporateIdentityMapping, 'findForLogin')
      .mockResolvedValue(mapping as any);

    await expect(
      (service as any).resolveMapping(
        {
          subject: 'sso-subject-1',
          employee_code: 'E001',
          claims: {},
        },
        service.getConfig(),
      ),
    ).resolves.toMatchObject(mapping);
  });

  it('provisions the first corporate SSO user as the initial admin with a default workspace', async () => {
    const service = new CorporateSsoService();
    (User.get as jest.Mock).mockResolvedValue(null);
    (User.getByEmail as jest.Mock).mockResolvedValue(null);
    (User.isFirst as jest.Mock).mockResolvedValue(true);
    (CorporateIdentityMapping.update as jest.Mock).mockImplementation(
      async (id: string, data: any) => ({
        id,
        provider: 'corporate',
        subject: 'sso-subject-1',
        employee_code: 'E001',
        ...data,
      }),
    );
    (User.insert as jest.Mock).mockImplementation(async (data: any) => ({
      id: 'user-1',
      ...data,
    }));
    (User.update as jest.Mock).mockImplementation(
      async (id: string, data: any) => ({
        id,
        email: 'user.one@example.com',
        roles: 'org-level-creator,org-level-super',
        ...data,
      }),
    );

    const user = await (service as any).resolveNocoUser(
      {
        subject: 'sso-subject-1',
        employee_code: 'E001',
        email: 'user.one@example.com',
        display_name: 'User One',
        claims: {},
      },
      {
        id: 'mapping-1',
        provider: 'corporate',
        subject: 'sso-subject-1',
        employee_code: 'E001',
      },
      service.getConfig(),
    );

    expect(User.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'user.one@example.com',
        is_new_user: false,
        roles: expect.stringContaining('super'),
      }),
    );
    expect(User.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        roles: expect.stringContaining('creator'),
      }),
    );
    expect(verifyDefaultWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      expect.anything(),
    );
    expect(ensureUserInDefaultWorkspace).not.toHaveBeenCalled();
    expect(user).toMatchObject({ id: 'user-1' });
  });

  it('promotes an existing SSO-created user when the instance has no local super admin', async () => {
    const service = new CorporateSsoService();
    (User.get as jest.Mock).mockResolvedValue({
      id: 'user-1',
      email: 'user.one@example.com',
      roles: 'org-level-viewer',
      email_verified: true,
      is_new_user: true,
    });
    (CorporateIdentityMapping.update as jest.Mock).mockImplementation(
      async (id: string, data: any) => ({
        id,
        provider: 'corporate',
        subject: 'sso-subject-1',
        employee_code: 'E001',
        ...data,
      }),
    );
    (User.update as jest.Mock).mockImplementation(
      async (id: string, data: any) => ({
        id,
        email: 'user.one@example.com',
        roles: 'org-level-viewer',
        ...data,
      }),
    );

    const user = await (service as any).resolveNocoUser(
      {
        subject: 'sso-subject-1',
        employee_code: 'E001',
        email: 'user.one@example.com',
        display_name: 'User One',
        claims: {},
      },
      {
        id: 'mapping-1',
        provider: 'corporate',
        subject: 'sso-subject-1',
        employee_code: 'E001',
        fk_user_id: 'user-1',
        is_super_admin: false,
      },
      service.getConfig(),
    );

    expect(CorporateIdentityMapping.update).toHaveBeenCalledWith(
      'mapping-1',
      expect.objectContaining({
        is_super_admin: true,
        org_roles: expect.stringContaining('super'),
        workspace_roles: 'workspace-level-owner',
      }),
    );
    expect(User.update).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        is_new_user: false,
        roles: expect.stringContaining('super'),
      }),
    );
    expect(verifyDefaultWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      expect.anything(),
    );
    expect(ensureUserInDefaultWorkspace).not.toHaveBeenCalled();
    expect(user).toMatchObject({ id: 'user-1' });
  });
});

jest.mock('src/models', () => ({
  PresignedUrl: {
    signMetaIconImage: jest.fn(),
  },
}));

jest.mock('~/services/users/users.service', () => ({
  UsersService: class UsersService {},
}));

jest.mock('~/services/app-hooks/app-hooks.service', () => ({
  AppHooksService: class AppHooksService {},
}));

jest.mock('~/services/users/helpers', () => ({
  clearAuthCookie: jest.fn(),
  setAuthCookie: jest.fn(),
}));

jest.mock('~/guards/global/global.guard', () => ({
  GlobalGuard: class GlobalGuard {},
}));

jest.mock('~/guards/meta-api-limiter.guard', () => ({
  MetaApiLimiterGuard: class MetaApiLimiterGuard {},
}));

jest.mock('~/guards/public-api-limiter.guard', () => ({
  PublicApiLimiterGuard: class PublicApiLimiterGuard {},
}));

jest.mock('~/middlewares/extract-ids/extract-ids.middleware', () => ({
  Acl: () => () => undefined,
}));

jest.mock('~/modules/auth/corporate-sso.service', () => ({
  CorporateSsoService: class CorporateSsoService {},
}));

jest.mock('~/modules/auth/email-auth.guard', () => ({
  EmailAuthGuard: class EmailAuthGuard {},
}));

import { AuthController } from './auth.controller';

describe('AuthController corporate SSO email auth boundary', () => {
  const makeController = () => {
    const usersService = {
      signup: jest.fn(),
      login: jest.fn(),
      passwordChange: jest.fn(),
      passwordForgot: jest.fn(),
      tokenValidate: jest.fn(),
      passwordReset: jest.fn(),
      emailVerification: jest.fn(),
    };
    const config = {
      get: jest.fn(() => ({ disableEmailAuth: false })),
    };
    const corporateSsoService = {
      shouldDisableEmailAuth: jest.fn(() => true),
    };

    return {
      controller: new AuthController(
        usersService as any,
        {} as any,
        config as any,
        corporateSsoService as any,
      ),
      usersService,
    };
  };

  it('blocks local credential account flows when corporate-only auth disables email auth', async () => {
    const { controller, usersService } = makeController();
    const req = {
      body: {},
      user: { email: 'user@example.com' },
      isAuthenticated: () => true,
    };
    const res = {
      json: jest.fn(),
      send: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    await expect(controller.signup(req as any, res as any)).rejects.toThrow(
      'Email authentication is disabled',
    );
    await expect(controller.signin(req as any, res as any)).rejects.toThrow(
      'Email authentication is disabled',
    );
    await expect(
      controller.passwordChange(req as any, res as any),
    ).rejects.toThrow('Email authentication is disabled');
    await expect(controller.passwordForgot(req as any)).rejects.toThrow(
      'Email authentication is disabled',
    );
    await expect(controller.tokenValidate('token')).rejects.toThrow(
      'Email authentication is disabled',
    );
    await expect(
      controller.passwordReset(req as any, 'token', {}),
    ).rejects.toThrow('Email authentication is disabled');
    await expect(
      controller.emailVerification(req as any, 'token'),
    ).rejects.toThrow('Email authentication is disabled');
    await expect(
      controller.renderPasswordReset(req as any, res as any, 'token'),
    ).rejects.toThrow('Email authentication is disabled');

    expect(usersService.signup).not.toHaveBeenCalled();
    expect(usersService.login).not.toHaveBeenCalled();
    expect(usersService.passwordChange).not.toHaveBeenCalled();
    expect(usersService.passwordForgot).not.toHaveBeenCalled();
    expect(usersService.tokenValidate).not.toHaveBeenCalled();
    expect(usersService.passwordReset).not.toHaveBeenCalled();
    expect(usersService.emailVerification).not.toHaveBeenCalled();
  });
});

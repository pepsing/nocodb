import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { OrgUserRoles, extractRolesObj } from 'nocodb-sdk';
import * as ejs from 'ejs';
import { PresignedUrl } from 'src/models';
import type { AppConfig } from '~/interface/config';

import { UsersService } from '~/services/users/users.service';
import { AppHooksService } from '~/services/app-hooks/app-hooks.service';
import { clearAuthCookie, setAuthCookie } from '~/services/users/helpers';

import { GlobalGuard } from '~/guards/global/global.guard';
import { NcError } from '~/helpers/catchError';
import { ncSiteUrl } from '~/utils/envs';
import { Acl } from '~/middlewares/extract-ids/extract-ids.middleware';
import { MetaApiLimiterGuard } from '~/guards/meta-api-limiter.guard';
import { PublicApiLimiterGuard } from '~/guards/public-api-limiter.guard';
import { NcRequest } from '~/interface/config';
import { CorporateSsoService } from '~/modules/auth/corporate-sso.service';
import { EmailAuthGuard } from '~/modules/auth/email-auth.guard';

@Controller()
export class AuthController {
  constructor(
    protected readonly usersService: UsersService,
    protected readonly appHooksService: AppHooksService,
    protected readonly config: ConfigService<AppConfig>,
    protected readonly corporateSsoService: CorporateSsoService,
  ) {}

  private isEmailAuthDisabled() {
    return (
      this.config.get('auth', { infer: true }).disableEmailAuth ||
      this.corporateSsoService.shouldDisableEmailAuth()
    );
  }

  private assertEmailAuthEnabled() {
    if (this.isEmailAuthDisabled()) {
      NcError.forbidden('Email authentication is disabled');
    }
  }

  @Post([
    '/auth/user/signup',
    '/api/v1/db/auth/user/signup',
    '/api/v1/auth/user/signup',
    '/api/v2/auth/user/signup',
  ])
  @UseGuards(PublicApiLimiterGuard)
  @HttpCode(200)
  async signup(@Req() req: NcRequest, @Res() res: Response): Promise<any> {
    this.assertEmailAuthEnabled();
    const result = await this.usersService.signup({
      body: req.body,
      req,
      res,
    });
    if (result?.token) setAuthCookie(res, result.token);
    res.json(result);
  }

  @Post([
    '/auth/token/refresh',
    '/api/v1/db/auth/token/refresh',
    '/api/v1/auth/token/refresh',
    '/api/v2/auth/token/refresh',
  ])
  @UseGuards(PublicApiLimiterGuard)
  @HttpCode(200)
  async refreshToken(
    @Req() req: NcRequest,
    @Res() res: Response,
  ): Promise<any> {
    const result = await this.usersService.refreshToken({
      body: req.body,
      req,
      res,
    });
    if (result?.token) setAuthCookie(res, result.token);
    res.json(result);
  }

  @Post([
    '/auth/user/signin',
    '/api/v1/db/auth/user/signin',
    '/api/v1/auth/user/signin',
    '/api/v2/auth/user/signin',
  ])
  @UseGuards(PublicApiLimiterGuard, EmailAuthGuard)
  @HttpCode(200)
  async signin(@Req() req: NcRequest, @Res() res: Response) {
    this.assertEmailAuthEnabled();
    await this.setRefreshToken({ req, res });
    const result = await this.usersService.login(req.user, req);
    setAuthCookie(res, result.token);
    res.json(result);
  }

  @UseGuards(GlobalGuard)
  @Post(['/api/v1/auth/user/signout', '/api/v2/auth/user/signout'])
  @HttpCode(200)
  async signOut(@Req() req: NcRequest, @Res() res: Response): Promise<any> {
    if (!(req as any).isAuthenticated?.()) {
      NcError.forbidden('Not allowed');
    }
    clearAuthCookie(res);
    res.json(
      await this.usersService.signOut({
        req,
        res,
      }),
    );
  }

  @Post(`/auth/google/genTokenByCode`)
  @HttpCode(200)
  @UseGuards(PublicApiLimiterGuard, AuthGuard('google'))
  async googleSignin(@Req() req: NcRequest, @Res() res: Response) {
    await this.setRefreshToken({ req, res });
    const result = await this.usersService.login(req.user, req);
    setAuthCookie(res, result.token);
    res.json(result);
  }

  @Get('/auth/google')
  @UseGuards(PublicApiLimiterGuard, AuthGuard('google'))
  googleAuthenticate() {
    // google strategy will take care the request
  }

  @Get(['/auth/corporate', '/api/v1/auth/corporate/login'])
  @UseGuards(PublicApiLimiterGuard)
  async corporateAuthenticate(
    @Req() req: NcRequest,
    @Res() res: Response,
    @Query('next') next?: string,
    @Query('continueAfterSignIn') continueAfterSignIn?: string,
  ) {
    const { loginUrl, state } =
      await this.corporateSsoService.buildProviderLoginRedirect(
        req,
        next || continueAfterSignIn,
      );
    this.corporateSsoService.setStateCookie(req, res, state);
    return res.redirect(loginUrl);
  }

  @Get(['/auth/corporate/callback', '/api/v1/auth/corporate/callback'])
  @UseGuards(PublicApiLimiterGuard)
  async corporateCallback(
    @Req() req: NcRequest,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('sso_state') callbackState?: string,
    @Query('next') next?: string,
    @Query('error') error?: string,
    @Query('error_description') errorDescription?: string,
  ) {
    try {
      if (error) {
        NcError.unauthorized(errorDescription || error);
      }

      const user = await this.corporateSsoService.loginFromCallback({
        req,
        code,
        state,
        callbackState,
        next,
      });

      req.user = user;
      await this.setRefreshToken({ req, res });

      const result = await this.usersService.login(req.user, req);
      setAuthCookie(res, result.token);
      this.corporateSsoService.clearStateCookie(res);

      return res.redirect(
        this.corporateSsoService.resolveFrontendRedirectUrl(
          req,
          (user as any).corporateSsoNextPath,
        ),
      );
    } catch (e) {
      this.corporateSsoService.clearStateCookie(res);
      return res.redirect(
        this.corporateSsoService.resolveFrontendRedirectUrl(
          req,
          `/signin?corporateSsoError=${encodeURIComponent(
            e?.message || 'Corporate SSO failed',
          )}`,
        ),
      );
    }
  }

  @Get('/api/v1/auth/corporate/mappings')
  @UseGuards(MetaApiLimiterGuard, GlobalGuard)
  @Acl('corporateSsoMappingList', {
    scope: 'org',
    allowedRoles: [OrgUserRoles.SUPER_ADMIN],
    blockApiTokenAccess: true,
    blockOAuthTokenAccess: true,
  })
  async corporateMappingList(@Req() req: NcRequest) {
    return await this.corporateSsoService.listMappings(req.query);
  }

  @Post('/api/v1/auth/corporate/mappings')
  @UseGuards(MetaApiLimiterGuard, GlobalGuard)
  @Acl('corporateSsoMappingUpsert', {
    scope: 'org',
    allowedRoles: [OrgUserRoles.SUPER_ADMIN],
    blockApiTokenAccess: true,
    blockOAuthTokenAccess: true,
  })
  @HttpCode(200)
  async corporateMappingUpsert(@Body() body: any) {
    return await this.corporateSsoService.upsertMapping(body);
  }

  @Get([
    '/auth/user/me',
    '/api/v1/db/auth/user/me',
    '/api/v1/auth/user/me',
    '/api/v2/auth/user/me',
  ])
  @UseGuards(MetaApiLimiterGuard, GlobalGuard)
  async me(@Req() req: NcRequest) {
    // GlobalGuard silently falls back to a guest user when JWT validation
    // fails. If the caller supplied a JWT (xc-auth header or nc_token cookie)
    // and we ended up as guest, the token is invalid/expired — surface 401
    // so the client can refresh or sign out instead of consuming a guest
    // identity that flips the UI's session state mid-flight.
    if (
      (req.headers?.['xc-auth'] || req.cookies?.nc_token) &&
      (req.user as any)?.roles?.guest
    ) {
      NcError.unauthorized('Token Expired. Please login again.');
    }

    const user = {
      ...req.user,
      roles: extractRolesObj(req.user.roles),
      workspace_roles: extractRolesObj(req.user.workspace_roles),
      base_roles: extractRolesObj(req.user.base_roles),
    };

    await PresignedUrl.signMetaIconImage(user);

    return user;
  }

  @Post([
    '/user/password/change',
    '/api/v1/db/auth/password/change',
    '/api/v1/auth/password/change',
    '/api/v2/auth/password/change',
  ])
  @UseGuards(MetaApiLimiterGuard, GlobalGuard)
  @Acl('passwordChange', {
    scope: 'org',
  })
  @HttpCode(200)
  async passwordChange(@Req() req: NcRequest, @Res() res): Promise<any> {
    this.assertEmailAuthEnabled();
    if (!(req as any).isAuthenticated?.()) {
      NcError.forbidden('Not allowed');
    }

    await this.usersService.passwordChange({
      user: req['user'],
      req,
      body: req.body,
    });

    // set new refresh token
    await this.setRefreshToken({ req, res });

    const loginResult = await this.usersService.login(req.user, req);
    setAuthCookie(res, loginResult.token);

    res.json({ msg: 'Password has been updated successfully' });
  }

  @Post([
    '/auth/password/forgot',
    '/api/v1/db/auth/password/forgot',
    '/api/v1/auth/password/forgot',
    '/api/v2/auth/password/forgot',
  ])
  @UseGuards(PublicApiLimiterGuard)
  @HttpCode(200)
  async passwordForgot(@Req() req: NcRequest): Promise<any> {
    this.assertEmailAuthEnabled();
    await this.usersService.passwordForgot({
      siteUrl: (req as any).ncSiteUrl,
      body: req.body,
      req,
    });

    return { msg: 'Please check your email to reset the password' };
  }

  @Post([
    '/auth/token/validate/:tokenId',
    '/api/v1/db/auth/token/validate/:tokenId',
    '/api/v1/auth/token/validate/:tokenId',
    '/api/v2/auth/token/validate/:tokenId',
  ])
  @UseGuards(PublicApiLimiterGuard)
  @HttpCode(200)
  async tokenValidate(@Param('tokenId') tokenId: string): Promise<any> {
    this.assertEmailAuthEnabled();
    await this.usersService.tokenValidate({
      token: tokenId,
    });
    return { msg: 'Token has been validated successfully' };
  }

  @Post([
    '/auth/password/reset/:tokenId',
    '/api/v1/db/auth/password/reset/:tokenId',
    '/api/v1/auth/password/reset/:tokenId',
    '/api/v2/auth/password/reset/:tokenId',
  ])
  @UseGuards(PublicApiLimiterGuard)
  @HttpCode(200)
  async passwordReset(
    @Req() req: NcRequest,
    @Param('tokenId') tokenId: string,
    @Body() body: any,
  ): Promise<any> {
    this.assertEmailAuthEnabled();
    await this.usersService.passwordReset({
      token: tokenId,
      body: body,
      req,
    });

    return { msg: 'Password has been reset successfully' };
  }

  @Post([
    '/api/v1/db/auth/email/validate/:tokenId',
    '/api/v1/auth/email/validate/:tokenId',
    '/api/v2/auth/email/validate/:tokenId',
  ])
  @UseGuards(PublicApiLimiterGuard)
  @HttpCode(200)
  async emailVerification(
    @Req() req: NcRequest,
    @Param('tokenId') tokenId: string,
  ): Promise<any> {
    this.assertEmailAuthEnabled();
    await this.usersService.emailVerification({
      token: tokenId,
      req,
    });

    return { msg: 'Email has been verified successfully' };
  }

  @Get([
    '/api/v1/db/auth/password/reset/:tokenId',
    '/api/v2/db/auth/password/reset/:tokenId',
    '/auth/password/reset/:tokenId',
  ])
  @UseGuards(PublicApiLimiterGuard)
  async renderPasswordReset(
    @Req() req: NcRequest,
    @Res() res: Response,
    @Param('tokenId') tokenId: string,
  ): Promise<any> {
    this.assertEmailAuthEnabled();
    try {
      res.send(
        ejs.render(
          (await import('~/modules/auth/ui/auth/resetPassword')).default,
          {
            ncPublicUrl: ncSiteUrl || '',
            token: tokenId,
            // Honor the configured site URL so the in-page API calls resolve
            // correctly when NocoDB is served from a sub-path / behind a
            // reverse proxy (e.g. https://example.com/noco). Falling back to
            // `/` keeps root deployments working. Used as `<%= baseUrl %>api/..`
            // so it must carry a single trailing slash.
            baseUrl: ncSiteUrl ? `${ncSiteUrl.replace(/\/+$/, '')}/` : `/`,
          },
        ),
      );
    } catch (e) {
      return res.status(400).json({ msg: e.message });
    }
  }

  async setRefreshToken({ res, req }) {
    await this.usersService.setRefreshToken({ res, req });
  }
}

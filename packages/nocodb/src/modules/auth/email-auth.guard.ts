import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '~/interface/config';
import { NcError } from '~/helpers/catchError';
import { CorporateSsoService } from '~/modules/auth/corporate-sso.service';

@Injectable()
export class EmailAuthGuard extends AuthGuard('local') {
  constructor(
    private readonly config: ConfigService<AppConfig>,
    private readonly corporateSsoService: CorporateSsoService,
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (
      this.config.get('auth', { infer: true }).disableEmailAuth ||
      this.corporateSsoService.shouldDisableEmailAuth()
    ) {
      NcError.forbidden('Email authentication is disabled');
    }

    return super.canActivate(context);
  }
}

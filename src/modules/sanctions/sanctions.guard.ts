import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { SanctionsService } from './sanctions.service';

@Injectable()
export class SanctionsGuard implements CanActivate {
  constructor(private readonly sanctions: SanctionsService) {}
  async canActivate(context: ExecutionContext) {
    await this.sanctions.assertAccess(context.switchToHttp().getRequest().user?.id);
    return true;
  }
}


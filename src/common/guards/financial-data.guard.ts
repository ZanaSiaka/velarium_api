import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancePermissionService } from '../../modules/finance/finance-permission.service';

// Reuse existing capabilities on endpoints that return financial/account data.
@Injectable()
export class FinancialDataGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService, private readonly permissions: FinancePermissionService) {}
  async canActivate(context: ExecutionContext) {
    const id = context.switchToHttp().getRequest().user?.id;
    if (!id) throw new UnauthorizedException('Authentification requise.');
    const user = await this.prisma.user.findUnique({ where: { id }, select: { active: true, role: true } });
    if (!user?.active) throw new UnauthorizedException('Compte absent ou inactif.');
    this.permissions.require(this.permissions.canViewFinance(user.role) && this.permissions.canViewCaisses(user.role), 'Accès aux informations financières refusé.');
    context.switchToHttp().getResponse().setHeader('Cache-Control', 'private, no-store');
    return true;
  }
}

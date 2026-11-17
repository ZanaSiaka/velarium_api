import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, Role } from '../../../generated/prisma/client';
import { DossierHistoryQueryDto } from './dto/dossier-history-query.dto';
import { FinancePermissionService } from '../finance/finance-permission.service';

const DOSSIER_HISTORY_LABELS: Record<string, string> = {
  DOSSIER_CREE: 'Dossier créé',
  DOSSIER_MODIFIE: 'Dossier modifié',
  DOSSIER_ARCHIVE: 'Dossier archivé',
  DOSSIER_DESARCHIVE: 'Dossier désarchivé',
};

@Injectable()
export class ActivityLogService {
  constructor(private readonly prisma: PrismaService) {}

  log(params: {
    userId: string;
    action: string;
    entityType: string;
    entityId: string;
    dossierId?: string;
    metadata?: Record<string, unknown>;
  }, db: Pick<Prisma.TransactionClient, 'activityLog'> = this.prisma) {
    return db.activityLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        dossierId: params.dossierId,
        metadata: params.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  private async viewer(userId: string | undefined) {
    if (!userId) throw new UnauthorizedException('Authentification requise.');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, active: true, role: true },
    });
    if (!user?.active) throw new UnauthorizedException('Session expirée ou compte inactif.');
    return user;
  }

  async assertDossierHistoryAccess(userId: string | undefined) {
    const user = await this.viewer(userId);
    if (user.role !== Role.AVOCAT) {
      throw new ForbiddenException('Historique des dossiers réservé aux avocats actifs.');
    }
  }

  async findDossierHistory(dossierId: string, userId: string, query: DossierHistoryQueryDto) {
    await this.assertDossierHistoryAccess(userId);
    const { page, limit } = query;
    const rows = await this.prisma.activityLog.findMany({
      where: {
        dossierId,
        entityType: 'Dossier',
        entityId: dossierId,
        action: { in: Object.keys(DOSSIER_HISTORY_LABELS) },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit + 1,
      select: {
        id: true,
        action: true,
        createdAt: true,
        user: { select: { id: true, name: true } },
      },
    });
    return {
      items: rows.slice(0, limit).map(row => ({
        id: row.id,
        action: row.action,
        label: DOSSIER_HISTORY_LABELS[row.action],
        createdAt: row.createdAt,
        author: row.user,
      })),
      page,
      limit,
      hasMore: rows.length > limit,
    };
  }

  async findAll(userId: string, filters: { dossierId?: string; userId?: string } = {}) {
    const user = await this.viewer(userId);
    const canViewDossierHistory = user.role === Role.AVOCAT;
    if (filters.dossierId !== undefined && !canViewDossierHistory) {
      throw new ForbiddenException('Historique des dossiers réservé aux avocats actifs.');
    }
    const restrictions: Prisma.ActivityLogWhereInput[] = [
      // Sensitive specialized histories must never be exposed through the generic journal.
      { NOT: { OR: [
        { action: { contains: 'KYC', mode: 'insensitive' } },
        { action: { contains: 'SOUPCON', mode: 'insensitive' } },
        { action: { contains: 'SANCTION', mode: 'insensitive' } },
        { entityType: { contains: 'KYC', mode: 'insensitive' } },
        { entityType: { contains: 'Sanction', mode: 'insensitive' } },
        { entityType: { in: ['PersonneSuivie', 'DossierPersonne', 'SignalementSanction'], mode: 'insensitive' } },
      ] } },
    ];
    if (!new FinancePermissionService().canViewAudit(user.role)) {
      restrictions.push({ NOT: { OR: [
        { entityType: { in: ['Caisse', 'MouvementFinance', 'Facture', 'Paiement', 'Provision', 'ImputationProvision', 'FraisOuvertureDossier', 'RecuEncaissement', 'PieceJointeFinance'], mode: 'insensitive' } },
        { action: { startsWith: 'CAISSE', mode: 'insensitive' } },
        { action: { startsWith: 'MOUVEMENT_FINANCIER', mode: 'insensitive' } },
        { action: { startsWith: 'PIECE_JOINTE_FINANCE', mode: 'insensitive' } },
      ] } });
    }
    if (!canViewDossierHistory) {
      restrictions.push({ dossierId: null });
      // Also exclude legacy dossier records whose dossierId was not populated.
      restrictions.push({ NOT: { OR: [
        { entityType: { in: ['Dossier', 'Document', 'Facture', 'Paiement', 'Provision', 'ImputationProvision', 'Evenement', 'Tache'], mode: 'insensitive' } },
        { action: { startsWith: 'DOSSIER', mode: 'insensitive' } },
      ] } });
    }
    const rows = await this.prisma.activityLog.findMany({
      where: {
        dossierId: filters.dossierId,
        userId: filters.userId,
        AND: restrictions,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: {
        id: true, action: true, entityType: true, entityId: true,
        dossierId: true, createdAt: true,
        user: { select: { id: true, name: true } },
        dossier: { select: { reference: true } },
      },
    });
    // Keep the legacy response shape without returning raw metadata or full Dossier objects.
    return rows.map(row => ({ ...row, metadata: null }));
  }
}

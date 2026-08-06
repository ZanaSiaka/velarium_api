import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

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
  }) {
    return this.prisma.activityLog.create({
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

  findAll(filters: { dossierId?: string; userId?: string } = {}) {
    return this.prisma.activityLog.findMany({
      where: {
        dossierId: filters.dossierId,
        userId: filters.userId,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: true, dossier: true },
    });
  }
}

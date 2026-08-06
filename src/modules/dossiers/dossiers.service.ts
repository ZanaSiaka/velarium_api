import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { CreateDossierDto } from './dto/create-dossier.dto';
import { UpdateDossierDto } from './dto/update-dossier.dto';

@Injectable()
export class DossiersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  findAll() {
    return this.prisma.dossier.findMany({
      orderBy: { createdAt: 'desc' },
      include: { client: true, avocatResponsable: true },
    });
  }

  async findOne(id: string) {
    const dossier = await this.prisma.dossier.findUnique({
      where: { id },
      include: {
        client: true,
        avocatResponsable: true,
        collaborateurs: { include: { user: true } },
        evenements: { orderBy: { start: 'asc' } },
      },
    });

    if (!dossier) {
      throw new NotFoundException('Dossier introuvable.');
    }

    return dossier;
  }

  private async generateReference() {
    const year = new Date().getFullYear();
    const count = await this.prisma.dossier.count({
      where: { reference: { startsWith: `${year}-` } },
    });
    return `${year}-${String(count + 1).padStart(3, '0')}`;
  }

  async create(dto: CreateDossierDto, userId: string) {
    const reference = await this.generateReference();

    const dossier = await this.prisma.dossier.create({
      data: {
        reference,
        type: dto.type,
        statut: dto.statut,
        clientId: dto.clientId,
        avocatResponsableId: dto.avocatResponsableId,
        juridiction: dto.juridiction || null,
        partieAdverse: dto.partieAdverse || null,
        collaborateurs: {
          create: (dto.collaborateurIds ?? []).map((userId) => ({ userId })),
        },
      },
    });

    await this.activityLog.log({
      userId,
      action: 'DOSSIER_CREE',
      entityType: 'Dossier',
      entityId: dossier.id,
      dossierId: dossier.id,
      metadata: { reference: dossier.reference },
    });

    return dossier;
  }

  async update(id: string, dto: UpdateDossierDto, userId: string) {
    await this.findOne(id);

    const dossier = await this.prisma.$transaction(async (tx) => {
      await tx.dossierCollaborateur.deleteMany({ where: { dossierId: id } });

      return tx.dossier.update({
        where: { id },
        data: {
          type: dto.type,
          statut: dto.statut,
          clientId: dto.clientId,
          avocatResponsableId: dto.avocatResponsableId,
          juridiction: dto.juridiction || null,
          partieAdverse: dto.partieAdverse || null,
          collaborateurs: {
            create: (dto.collaborateurIds ?? []).map((userId) => ({ userId })),
          },
        },
      });
    });

    await this.activityLog.log({
      userId,
      action: 'DOSSIER_MODIFIE',
      entityType: 'Dossier',
      entityId: dossier.id,
      dossierId: dossier.id,
      metadata: { reference: dossier.reference },
    });

    return dossier;
  }
}

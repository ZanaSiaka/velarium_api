import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  findAll() {
    return this.prisma.client.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { dossiers: true } } },
    });
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        dossiers: {
          orderBy: { createdAt: 'desc' },
          include: { avocatResponsable: true },
        },
      },
    });

    if (!client) {
      throw new NotFoundException('Client introuvable.');
    }

    return client;
  }

  async create(dto: CreateClientDto, userId: string) {
    const client = await this.prisma.client.create({
      data: {
        type: dto.type,
        nom: dto.nom,
        email: dto.email || null,
        telephone: dto.telephone || null,
        adresse: dto.adresse || null,
        notes: dto.notes || null,
      },
    });

    await this.activityLog.log({
      userId,
      action: 'CLIENT_CREE',
      entityType: 'Client',
      entityId: client.id,
      metadata: { nom: client.nom },
    });

    return client;
  }

  async update(id: string, dto: UpdateClientDto) {
    await this.findOne(id);

    return this.prisma.client.update({
      where: { id },
      data: {
        type: dto.type,
        nom: dto.nom,
        email: dto.email || null,
        telephone: dto.telephone || null,
        adresse: dto.adresse || null,
        notes: dto.notes || null,
      },
    });
  }
}

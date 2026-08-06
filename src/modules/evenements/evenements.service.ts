import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateEvenementDto } from './dto/create-evenement.dto';
import { UpdateEvenementDto } from './dto/update-evenement.dto';

@Injectable()
export class EvenementsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(dossierId?: string) {
    return this.prisma.evenement.findMany({
      where: dossierId ? { dossierId } : undefined,
      orderBy: { start: 'asc' },
      include: { dossier: true },
    });
  }

  async findOne(id: string) {
    const evenement = await this.prisma.evenement.findUnique({
      where: { id },
      include: { dossier: true },
    });

    if (!evenement) {
      throw new NotFoundException('Événement introuvable.');
    }

    return evenement;
  }

  create(dto: CreateEvenementDto, createdById: string) {
    return this.prisma.evenement.create({
      data: {
        title: dto.title,
        description: dto.description || null,
        start: new Date(dto.start),
        end: dto.end ? new Date(dto.end) : null,
        color: dto.color || null,
        eventType: dto.eventType,
        location: dto.location || null,
        dossierId: dto.dossierId || null,
        createdById,
      },
    });
  }

  async update(id: string, dto: UpdateEvenementDto) {
    await this.findOne(id);

    return this.prisma.evenement.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description || null,
        start: dto.start ? new Date(dto.start) : undefined,
        end: dto.end ? new Date(dto.end) : null,
        color: dto.color || null,
        eventType: dto.eventType,
        location: dto.location || null,
        dossierId: dto.dossierId || null,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.evenement.delete({ where: { id } });
    return { success: true };
  }
}

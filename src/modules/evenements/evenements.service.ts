import { DOSSIER_REFERENCE_SELECT } from '../../common/dossier-projections';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { validateSync } from 'class-validator';

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
      include: { dossier: { select: DOSSIER_REFERENCE_SELECT } },
    });
  }

  async findOne(id: string) {
    const evenement = await this.prisma.evenement.findUnique({
      where: { id },
      include: { dossier: { select: DOSSIER_REFERENCE_SELECT } },
    });

    if (!evenement) {
      throw new NotFoundException('Événement introuvable.');
    }

    return evenement;
  }

  private validateDto(dto: CreateEvenementDto | UpdateEvenementDto, update = false) {
    const instance = update ? new UpdateEvenementDto() : new CreateEvenementDto();
    if (!dto || typeof dto !== 'object' || Array.isArray(dto) ||
        validateSync(Object.assign(instance, dto), { whitelist: true, forbidNonWhitelisted: true }).length) {
      throw new BadRequestException('Données de l’événement invalides.');
    }
    if (dto.title !== undefined && !dto.title.trim()) throw new BadRequestException('Le titre est obligatoire.');
  }

  private optionalText(value: string | null | undefined) {
    return value === undefined ? undefined : value?.trim() || null;
  }

  private eventDate(value: string): Date {
    // Legacy API dates without an offset are interpreted as UTC, independently of the server timezone.
    const naive = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value);
    const date = new Date(naive ? value.replace(' ', 'T') + 'Z' : value);
    if (!Number.isFinite(date.getTime())) throw new BadRequestException('Date d’événement invalide.');
    return date;
  }

  private chronology(start: Date, end: Date | null) {
    if (end && end.getTime() < start.getTime()) throw new BadRequestException('La fin de l’événement ne peut pas précéder son début.');
  }

  create(dto: CreateEvenementDto, createdById: string) {
    this.validateDto(dto);
    const start = this.eventDate(dto.start);
    const end = dto.end ? this.eventDate(dto.end) : null;
    this.chronology(start, end);
    return this.prisma.evenement.create({
      data: {
        title: dto.title,
        description: this.optionalText(dto.description),
        start, end,
        color: this.optionalText(dto.color),
        eventType: dto.eventType,
        location: this.optionalText(dto.location),
        dossierId: this.optionalText(dto.dossierId),
        createdById,
      },
    });
  }

  async update(id: string, dto: UpdateEvenementDto) {
    this.validateDto(dto, true);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async tx => {
          const current = await tx.evenement.findUnique({ where: { id } });
          if (!current) throw new NotFoundException('Événement introuvable.');
          const start = dto.start === undefined ? current.start : this.eventDate(dto.start);
          const end = dto.end === undefined ? current.end : dto.end === null ? null : this.eventDate(dto.end);
          this.chronology(start, end);
          return tx.evenement.update({
            where: { id },
            data: {
              title: dto.title,
              description: this.optionalText(dto.description),
              start: dto.start === undefined ? undefined : start,
              end: dto.end === undefined ? undefined : end,
              color: this.optionalText(dto.color),
              eventType: dto.eventType,
              location: this.optionalText(dto.location),
              dossierId: this.optionalText(dto.dossierId),
            },
          });
        }, { isolationLevel: 'Serializable' });
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2034') throw error;
        if (attempt === 2) throw new ConflictException('Événement modifié simultanément. Veuillez réessayer.');
      }
    }
    throw new ConflictException('Veuillez réessayer cette opération.');
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.evenement.delete({ where: { id } });
    return { success: true };
  }
}

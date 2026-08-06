import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateProvisionDto } from './dto/create-provision.dto';

function num(value: unknown): number {
  return Number(value);
}

@Injectable()
export class ProvisionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(dossierId?: string) {
    const provisions = await this.prisma.provision.findMany({
      where: dossierId ? { dossierId } : undefined,
      orderBy: { datePaiement: 'desc' },
    });
    return provisions.map((p) => ({ ...p, montant: num(p.montant) }));
  }

  async create(dto: CreateProvisionDto) {
    const provision = await this.prisma.provision.create({
      data: {
        dossierId: dto.dossierId,
        montant: dto.montant,
        datePaiement: dto.datePaiement ? new Date(dto.datePaiement) : undefined,
        note: dto.note || null,
      },
    });
    return { ...provision, montant: num(provision.montant) };
  }
}

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
  ) { }

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

  async getLivrePaiements(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        dossiers: {
          orderBy: { createdAt: 'asc' },
          include: {
            factures: {
              orderBy: { dateEmission: 'asc' },
              include: {
                paiements: {
                  orderBy: { datePaiement: 'asc' },
                },
              },
            },
            provisions: {
              orderBy: { datePaiement: 'asc' },
            },
          },
        },
      },
    });

    if (!client) {
      throw new NotFoundException('Client introuvable.');
    }

    const totalFacture = client.dossiers.reduce(
      (sum, dossier) =>
        sum +
        dossier.factures.reduce(
          (factureSum, facture) =>
            factureSum + Number(facture.montantTTC),
          0,
        ),
      0,
    );

    const totalPaiements = client.dossiers.reduce(
      (sum, dossier) =>
        sum +
        dossier.factures.reduce(
          (factureSum, facture) =>
            factureSum +
            facture.paiements.reduce(
              (paiementSum, paiement) =>
                paiementSum + Number(paiement.montant),
              0,
            ),
          0,
        ),
      0,
    );

    const totalProvisions = client.dossiers.reduce(
      (sum, dossier) =>
        sum +
        dossier.provisions.reduce(
          (provisionSum, provision) =>
            provisionSum + Number(provision.montant),
          0,
        ),
      0,
    );

    const totalEncaisse = totalPaiements + totalProvisions;

    const solde = totalFacture - totalEncaisse;

    const operations = [
      ...client.dossiers.flatMap((dossier) =>
        dossier.factures.flatMap((facture) =>
          facture.paiements.map((paiement) => ({
            id: paiement.id,
            type: 'PAIEMENT',
            date: paiement.datePaiement,
            montant: Number(paiement.montant),
            moyenPaiement: paiement.moyenPaiement,
            note: paiement.note,

            dossier: {
              id: dossier.id,
              reference: dossier.reference,
            },

            facture: {
              id: facture.id,
              numero: facture.numero,
              montantTTC: Number(facture.montantTTC),
            },
          })),
        ),
      ),

      ...client.dossiers.flatMap((dossier) =>
        dossier.provisions.map((provision) => ({
          id: provision.id,
          type: 'PROVISION',
          date: provision.datePaiement,
          montant: Number(provision.montant),
          moyenPaiement: provision.moyenPaiement,
          note: provision.note,

          dossier: {
            id: dossier.id,
            reference: dossier.reference,
          },

          facture: null,
        })),
      ),
    ].sort(
      (a, b) =>
        new Date(a.date).getTime() -
        new Date(b.date).getTime(),
    );

    return {
      client: {
        id: client.id,
        nom: client.nom,
        email: client.email,
        telephone: client.telephone,
      },

      totalFacture,
      totalPaiements,
      totalProvisions,
      totalEncaisse,
      solde,

      operations,
    };
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

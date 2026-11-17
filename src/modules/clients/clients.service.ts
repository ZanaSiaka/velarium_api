import { BILLING_CASH_INCLUDE, BILLING_INVOICE_INCLUDE, BILLING_PROVISION_INCLUDE } from '../../common/finance/billing';
import { sumMoney } from '../../common/finance/financial-read';
import { readDossierFinance } from '../dossiers/dossier-finance-read';
import { DOSSIER_PUBLIC_SELECT } from '../../common/dossier-projections';
import { ClientType } from '../../../generated/prisma/client';
import { validateSync } from 'class-validator';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

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
          select: { ...DOSSIER_PUBLIC_SELECT, avocatResponsable: { select: { id: true, name: true } } },
        },
      },
    });

    if (!client) {
      throw new NotFoundException('Client introuvable.');
    }

    return client;
  }

  async getLivrePaiements(id: string) {
    const client = await this.prisma.client.findUnique({ where: { id }, include: { dossiers: {
      orderBy: { createdAt: 'asc' }, include: {
        factures: { include: BILLING_INVOICE_INCLUDE },
        provisions: { include: BILLING_PROVISION_INCLUDE },
        fraisOuverture: { include: { mouvementFinance: { include: BILLING_CASH_INCLUDE } } },
      },
    } } });
    if (!client) throw new NotFoundException('Client introuvable.');
    const ledgers = client.dossiers.map(dossier => readDossierFinance({ ...dossier, client: { id: client.id, nom: client.nom } }));
    const total = (key: keyof (typeof ledgers)[number]['montants']) => sumMoney(ledgers.map(row => row.montants[key]));
    const montants = { totalFacture: total('totalFacture'), totalPaiements: total('totalPaiements'),
      totalProvisions: total('totalProvisionsEncaissees'), totalProvisionsDisponibles: total('totalProvisionsDisponibles'),
      totalProvisionsImputees: total('totalProvisions'),
      totalEncaisse: total('totalEncaisse'), totalEncaisseGlobal: total('totalEncaisseGlobal'),
      solde: total('resteAPayer'), tropPercu: total('tropPercu'), totalBrouillons: total('totalBrouillons') };
    const numeric = (value: string | null) => value === null ? null : Number(value);
    const operations = client.dossiers.flatMap(dossier => [
      ...dossier.factures.flatMap(facture => facture.paiements.map(payment => ({
        id: payment.id, type: 'PAIEMENT', date: payment.datePaiement, montant: payment.montant.toNumber(), montantExact: payment.montant.toFixed(2),
        moyenPaiement: payment.moyenPaiement, note: payment.note, dossier: { id: dossier.id, reference: dossier.reference },
        facture: { id: facture.id, numero: facture.numero, montantTTC: facture.montantTTC.toNumber() },
      }))),
      ...dossier.provisions.map(provision => ({
        id: provision.id, type: 'PROVISION', date: provision.datePaiement, montant: provision.montant.toNumber(), montantExact: provision.montant.toFixed(2),
        moyenPaiement: provision.moyenPaiement, note: provision.note, dossier: { id: dossier.id, reference: dossier.reference }, facture: null,
      })),
    ]).sort((a, b) => a.date.getTime() - b.date.getTime());
    return { client: { id: client.id, nom: client.nom, email: client.email, telephone: client.telephone },
      totalFacture: numeric(montants.totalFacture), totalPaiements: numeric(montants.totalPaiements),
      totalProvisions: numeric(montants.totalProvisions), totalEncaisse: numeric(montants.totalEncaisse), solde: numeric(montants.solde),
      tropPercu: numeric(montants.tropPercu), montants, operations,
      avertissements: [...new Set(ledgers.flatMap(row => row.avertissements))], perimetreFactures: 'HORS_BROUILLONS' };
  }

  async create(dto: CreateClientDto, userId: string) {
    const errors = validateSync(Object.assign(new CreateClientDto(), dto));
    if (errors.length > 0) throw new BadRequestException(errors);
    const numeroContribuable = dto.numeroContribuable?.trim() || null;
    if (numeroContribuable && dto.type !== ClientType.ENTREPRISE) {
      throw new BadRequestException('Le numéro contribuable est réservé aux entreprises.');
    }
    const client = await this.prisma.client.create({
      data: {
        type: dto.type,
        numeroContribuable,
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
    const errors = validateSync(Object.assign(new UpdateClientDto(), dto));
    if (errors.length > 0) {
      throw new BadRequestException(errors);
    }
    const current = await this.findOne(id);
    const numeroContribuable = dto.numeroContribuable === undefined
      ? undefined : dto.numeroContribuable?.trim() || null;
    if ((dto.type !== undefined || numeroContribuable !== undefined) &&
        (dto.type ?? current.type) !== ClientType.ENTREPRISE &&
        (numeroContribuable === undefined ? current.numeroContribuable : numeroContribuable)) {
      throw new BadRequestException('Le numéro contribuable est réservé aux entreprises. Effacez-le explicitement pour changer de type.');
    }

    return this.prisma.client.update({
      where: { id },
      data: {
        type: dto.type,
        numeroContribuable,
        nom: dto.nom,
        email: dto.email === undefined ? undefined : dto.email || null,
        telephone: dto.telephone === undefined ? undefined : dto.telephone || null,
        adresse: dto.adresse === undefined ? undefined : dto.adresse || null,
        notes: dto.notes === undefined ? undefined : dto.notes || null,
      },
    });
  }
}

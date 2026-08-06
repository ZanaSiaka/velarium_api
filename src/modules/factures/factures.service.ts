import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { CABINET_INFO } from '../../config/cabinet.config';
import { CreateFactureDto } from './dto/create-facture.dto';
import { CreatePaiementDto } from './dto/create-paiement.dto';

// Les champs Decimal de Prisma ne se sérialisent pas proprement en JSON par
// défaut : on les convertit explicitement en number avant de renvoyer une
// réponse HTTP.
function num(value: unknown): number {
  return Number(value);
}

function serializeFacture(facture: any) {
  return {
    ...facture,
    montantHT: num(facture.montantHT),
    montantTVA: num(facture.montantTVA),
    montantTTC: num(facture.montantTTC),
    tauxTVA: num(facture.tauxTVA),
    lignes: facture.lignes?.map((l: any) => ({
      ...l,
      quantite: num(l.quantite),
      prixUnitaire: num(l.prixUnitaire),
      montant: num(l.montant),
    })),
    paiements: facture.paiements?.map((p: any) => ({
      ...p,
      montant: num(p.montant),
    })),
  };
}

@Injectable()
export class FacturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async findAll() {
    const factures = await this.prisma.facture.findMany({
      orderBy: { createdAt: 'desc' },
      include: { client: true, dossier: true, paiements: true },
    });
    return factures.map(serializeFacture);
  }

  async findOne(id: string) {
    const facture = await this.prisma.facture.findUnique({
      where: { id },
      include: { client: true, dossier: true, lignes: true, paiements: true },
    });

    if (!facture) {
      throw new NotFoundException('Facture introuvable.');
    }

    return serializeFacture(facture);
  }

  private async generateNumero() {
    const year = new Date().getFullYear();
    const count = await this.prisma.facture.count({
      where: { numero: { startsWith: `FACT-${year}-` } },
    });
    return `FACT-${year}-${String(count + 1).padStart(3, '0')}`;
  }

  async create(dto: CreateFactureDto, userId: string) {
    const dossier = await this.prisma.dossier.findUnique({
      where: { id: dto.dossierId },
    });

    if (!dossier) {
      throw new NotFoundException('Dossier introuvable.');
    }

    const montantHT = dto.lignes.reduce(
      (sum, ligne) => sum + ligne.quantite * ligne.prixUnitaire,
      0,
    );
    const montantTVA = Math.round(montantHT * CABINET_INFO.tauxTVA) / 100;
    const montantTTC = montantHT + montantTVA;

    const numero = await this.generateNumero();

    const facture = await this.prisma.facture.create({
      data: {
        numero,
        statut: 'ENVOYEE',
        dossierId: dto.dossierId,
        clientId: dossier.clientId,
        dateEcheance: new Date(dto.dateEcheance),
        montantHT,
        montantTVA,
        montantTTC,
        tauxTVA: CABINET_INFO.tauxTVA,
        mentionRCCM: CABINET_INFO.rccm,
        mentionNCC: CABINET_INFO.ncc,
        lignes: {
          create: dto.lignes.map((ligne) => ({
            description: ligne.description,
            quantite: ligne.quantite,
            prixUnitaire: ligne.prixUnitaire,
            montant: ligne.quantite * ligne.prixUnitaire,
          })),
        },
      },
      include: { client: true, dossier: true, lignes: true, paiements: true },
    });

    await this.activityLog.log({
      userId,
      action: 'FACTURE_CREEE',
      entityType: 'Facture',
      entityId: facture.id,
      dossierId: facture.dossierId,
      metadata: { numero: facture.numero, montantTTC },
    });

    return serializeFacture(facture);
  }

  async addPaiement(id: string, dto: CreatePaiementDto, userId: string) {
    const facture = await this.prisma.facture.findUnique({
      where: { id },
      include: { paiements: true },
    });

    if (!facture) {
      throw new NotFoundException('Facture introuvable.');
    }

    await this.prisma.paiement.create({
      data: {
        factureId: id,
        montant: dto.montant,
        datePaiement: dto.datePaiement ? new Date(dto.datePaiement) : undefined,
        moyenPaiement: dto.moyenPaiement || null,
        note: dto.note || null,
      },
    });

    const totalPaye =
      facture.paiements.reduce((sum, p) => sum + Number(p.montant), 0) +
      dto.montant;
    const montantTTC = Number(facture.montantTTC);

    const statut =
      totalPaye >= montantTTC ? 'PAYEE' : totalPaye > 0 ? 'PARTIELLEMENT_PAYEE' : facture.statut;

    const updated = await this.prisma.facture.update({
      where: { id },
      data: { statut },
      include: { client: true, dossier: true, lignes: true, paiements: true },
    });

    await this.activityLog.log({
      userId,
      action: 'PAIEMENT_ENREGISTRE',
      entityType: 'Facture',
      entityId: updated.id,
      dossierId: updated.dossierId,
      metadata: { numero: updated.numero, montant: dto.montant },
    });

    return serializeFacture(updated);
  }
}

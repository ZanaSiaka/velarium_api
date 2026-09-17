import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { CABINET_INFO } from '../../config/cabinet.config';
import { CreateFactureDto } from './dto/create-facture.dto';
import { CreatePaiementDto } from './dto/create-paiement.dto';
import { FinancePermissionService } from '../finance/finance-permission.service';

/**
 * Prisma Decimal -> number
 */
function num(value: unknown): number {
  return Number(value);
}

/**
 * Sérialise une facture avant de la retourner au frontend.
 *
 * IMPORTANT :
 * Les provisions présentes ici sont uniquement les provisions
 * réellement affectées à cette facture.
 *
 * Une provision générale du dossier avec factureId = null
 * n'apparaît donc pas dans cette facture.
 */
function serializeFacture(facture: any) {
  const montantHT = num(facture.montantHT);
  const montantTVA = num(facture.montantTVA);
  const montantTTC = num(facture.montantTTC);
  const tauxTVA = num(facture.tauxTVA);

  const paiements =
    facture.paiements?.map((paiement: any) => ({
      ...paiement,
      montant: num(paiement.montant),
    })) ?? [];

  const provisions =
    facture.provisions?.map((provision: any) => ({
      ...provision,
      montant: num(provision.montant),
    })) ?? [];

  const lignes =
    facture.lignes?.map((ligne: any) => ({
      ...ligne,
      quantite: num(ligne.quantite),
      prixUnitaire: num(ligne.prixUnitaire),
      montant: num(ligne.montant),
    })) ?? [];

  /**
   * Total des paiements réels effectués sur la facture.
   */
  const totalPaiements = paiements.reduce(
    (sum: number, paiement: any) => sum + paiement.montant,
    0,
  );

  /**
   * Total des provisions affectées à cette facture.
   *
   * Une provision non affectée possède factureId = null
   * et n'est donc jamais présente dans facture.provisions.
   */
  const totalProvisions = provisions.reduce(
    (sum: number, provision: any) => sum + provision.montant,
    0,
  );

  /**
   * Total réellement réglé sur la facture :
   *
   * paiements + provisions affectées
   */
  const totalRegle = totalPaiements + totalProvisions;

  /**
   * Solde restant.
   *
   * On évite un solde négatif.
   */
  const solde = Math.max(montantTTC - totalRegle, 0);

  return {
    ...facture,

    montantHT,
    montantTVA,
    montantTTC,
    tauxTVA,

    lignes,
    paiements,
    provisions,

    totalPaiements,
    totalProvisions,
    totalRegle,
    solde,
  };
}

@Injectable()
export class FacturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly permissions: FinancePermissionService,
  ) { }

  /**
   * Liste toutes les factures.
   */
  async findAll() {
    const factures = await this.prisma.facture.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        client: true,
        dossier: true,
        lignes: true,
        paiements: true,
        provisions: true,
      },
    });

    return factures.map(serializeFacture);
  }

  /**
   * Récupère une facture avec :
   * - lignes
   * - paiements
   * - provisions affectées
   */
  async findOne(id: string) {
    const facture = await this.prisma.facture.findUnique({
      where: {
        id,
      },
      include: {
        client: true,
        dossier: true,
        lignes: true,
        paiements: true,
        provisions: true,
      },
    });

    if (!facture) {
      throw new NotFoundException('Facture introuvable.');
    }

    return serializeFacture(facture);
  }

  /**
   * Génère le numéro de facture.
   */
  private async generateNumero() {
    const year = new Date().getFullYear();

    const count = await this.prisma.facture.count({
      where: {
        numero: {
          startsWith: `FACT-${year}-`,
        },
      },
    });

    return `FACT-${year}-${String(count + 1).padStart(3, '0')}`;
  }

  /**
   * Création d'une facture.
   *
   * IMPORTANT :
   * La création d'une facture ne touche pas aux provisions.
   *
   * Les provisions peuvent avoir été créées avant la facture.
   * Elles resteront alors générales (factureId = null).
   *
   * Elles pourront ensuite être affectées à cette facture.
   */
  async create(dto: CreateFactureDto, userId: string) {
    const dossier = await this.prisma.dossier.findUnique({
      where: {
        id: dto.dossierId,
      },
    });

    if (!dossier) {
      throw new NotFoundException('Dossier introuvable.');
    }

    const montantHT = dto.lignes.reduce(
      (sum, ligne) =>
        sum + ligne.quantite * ligne.prixUnitaire,
      0,
    );

    const montantTVA =
      Math.round(montantHT * CABINET_INFO.tauxTVA) / 100;

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
            montant:
              ligne.quantite * ligne.prixUnitaire,
          })),
        },
      },

      include: {
        client: true,
        dossier: true,
        lignes: true,
        paiements: true,
        provisions: true,
      },
    });

    await this.activityLog.log({
      userId,
      action: 'FACTURE_CREEE',
      entityType: 'Facture',
      entityId: facture.id,
      dossierId: facture.dossierId,
      metadata: {
        numero: facture.numero,
        montantTTC,
      },
    });

    return serializeFacture(facture);
  }

  /**
   * Ajout d'un paiement sur une facture.
   *
   * Le montant disponible est calculé avec :
   *
   * TTC
   * - paiements déjà enregistrés
   * - provisions déjà affectées
   *
   * Une provision générale du dossier n'est PAS comptée ici
   * tant qu'elle n'est pas affectée à cette facture.
   */
  async addPaiement(
    id: string,
    dto: CreatePaiementDto,
    userId: string,
  ) {
    const facture = await this.prisma.facture.findUnique({
      where: {
        id,
      },
      include: {
        paiements: true,
        provisions: true,
      },
    });

    if (!facture) {
      throw new NotFoundException(
        'Facture introuvable.',
      );
    }

    const totalPaiementsAvant =
      facture.paiements.reduce(
        (sum, paiement) =>
          sum + Number(paiement.montant),
        0,
      );

    const totalProvisions =
      facture.provisions.reduce(
        (sum, provision) =>
          sum + Number(provision.montant),
        0,
      );

    const montantTTC = Number(
      facture.montantTTC,
    );

    /**
     * Ce qui reste réellement à régler avant
     * le nouveau paiement.
     */
    const soldeAvant =
      montantTTC -
      totalPaiementsAvant -
      totalProvisions;

    /**
     * Protection contre un paiement supérieur
     * au solde réel.
     */
    if (dto.montant > soldeAvant) {
      throw new BadRequestException(
        `Le paiement de ${dto.montant.toLocaleString(
          'fr-FR',
        )} FCFA dépasse le solde restant de ${Math.max(
          soldeAvant,
          0,
        ).toLocaleString(
          'fr-FR',
        )} FCFA.`,
      );
    }

    await this.prisma.paiement.create({
      data: {
        factureId: id,
        montant: dto.montant,

        datePaiement: dto.datePaiement
          ? new Date(dto.datePaiement)
          : undefined,

        moyenPaiement:
          dto.moyenPaiement || null,

        note: dto.note || null,
      },
    });

    /**
     * Recalcul après création du paiement.
     */
    const totalPaiements =
      totalPaiementsAvant + dto.montant;

    const totalRegle =
      totalPaiements + totalProvisions;

    /**
     * Statut de la facture.
     */
    const statut =
      totalRegle >= montantTTC
        ? 'PAYEE'
        : totalRegle > 0
          ? 'PARTIELLEMENT_PAYEE'
          : facture.statut;

    const updated =
      await this.prisma.facture.update({
        where: {
          id,
        },

        data: {
          statut,
        },

        include: {
          client: true,
          dossier: true,
          lignes: true,
          paiements: true,
          provisions: true,
        },
      });

    await this.activityLog.log({
      userId,
      action: 'PAIEMENT_ENREGISTRE',
      entityType: 'Facture',
      entityId: updated.id,
      dossierId: updated.dossierId,

      metadata: {
        numero: updated.numero,
        montant: dto.montant,
        totalPaiements,
        totalProvisions,
        totalRegle,
        solde: Math.max(
          montantTTC - totalRegle,
          0,
        ),
      },
    });

    return serializeFacture(updated);
  }
}
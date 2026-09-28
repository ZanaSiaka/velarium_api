import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  FactureStatut,
  MoyenOperationCompte,
  TypeLigneFacture,
} from '../../../generated/prisma/client';

import {
  PrismaService,
} from '../../prisma/prisma.service';

import {
  ActivityLogService,
} from '../activity-log/activity-log.service';

import {
  CABINET_INFO,
} from '../../config/cabinet.config';

import {
  CreateFactureDto,
} from './dto/create-facture.dto';

import {
  CreatePaiementDto,
} from './dto/create-paiement.dto';

// ============================================================
// HELPERS
// ============================================================

function num(
  value: unknown,
): number {
  return Number(value);
}

/**
 * Retourne les moyens de paiement autorisés
 * pour un compte.
 *
 * Les valeurs CARTE et MOBILE_MONEY sont
 * conservées uniquement pour les anciennes données.
 */
function getMoyensAutorises(
  typeCompte: string,
  moyensConfigures:
    MoyenOperationCompte[],
): MoyenOperationCompte[] {
  const moyensModernes =
    moyensConfigures.filter(
      (moyen) =>
        moyen !==
        MoyenOperationCompte.CARTE &&
        moyen !==
        MoyenOperationCompte.MOBILE_MONEY,
    );

  /**
   * Si le compte possède déjà une configuration
   * explicite moderne, elle est prioritaire.
   */
  if (
    moyensModernes.length > 0
  ) {
    return moyensModernes;
  }

  /**
   * Compatibilité temporaire avec les comptes
   * créés avant la nouvelle architecture.
   */
  switch (typeCompte) {
    case 'BANCAIRE':
      return [
        MoyenOperationCompte.VIREMENT,
        MoyenOperationCompte.CHEQUE,
      ];

    case 'MOBILE_MONEY':
      return [
        MoyenOperationCompte.ORANGE_MONEY,
        MoyenOperationCompte.WAVE,
        MoyenOperationCompte.MTN_MONEY,
        MoyenOperationCompte.MOOV_MONEY,
      ];

    case 'CARTE_BANCAIRE':
      return [
        MoyenOperationCompte.PAIEMENT_CARTE,
      ];

    case 'ESPECES':
      return [
        MoyenOperationCompte.ESPECES,
      ];

    default:
      return [];
  }
}

/**
 * Sérialisation d'une facture.
 *
 * Nouvelle architecture :
 *
 * total réglé =
 * paiements directs
 * + imputations de provisions
 * + anciennes provisions legacy
 *
 * Les anciennes provisions factureId sont encore
 * comptabilisées uniquement pendant la période
 * de transition.
 */
function serializeFacture(
  facture: any,
) {
  const montantHT =
    num(
      facture.montantHT,
    );

  const montantTVA =
    num(
      facture.montantTVA,
    );

  const montantTTC =
    num(
      facture.montantTTC,
    );

  const tauxTVA =
    num(
      facture.tauxTVA,
    );

  // ============================================================
  // LIGNES
  // ============================================================

  const lignes =
    facture.lignes?.map(
      (
        ligne: any,
      ) => ({
        ...ligne,

        quantite:
          num(
            ligne.quantite,
          ),

        prixUnitaire:
          num(
            ligne.prixUnitaire,
          ),

        montant:
          num(
            ligne.montant,
          ),
      }),
    ) ?? [];

  // ============================================================
  // PAIEMENTS DIRECTS
  // ============================================================

  const paiements =
    facture.paiements?.map(
      (
        paiement: any,
      ) => ({
        ...paiement,

        montant:
          num(
            paiement.montant,
          ),
      }),
    ) ?? [];

  // ============================================================
  // NOUVELLES IMPUTATIONS DE PROVISIONS
  // ============================================================

  const imputationsProvision =
    facture.imputationsProvision
      ?.map(
        (
          imputation: any,
        ) => ({
          ...imputation,

          montant:
            num(
              imputation.montant,
            ),

          provision:
            imputation.provision
              ? {
                ...imputation.provision,

                montant:
                  num(
                    imputation
                      .provision
                      .montant,
                  ),
              }
              : undefined,
        }),
      ) ?? [];

  // ============================================================
  // PROVISIONS LEGACY
  // ============================================================

  const provisions =
    facture.provisions?.map(
      (
        provision: any,
      ) => ({
        ...provision,

        montant:
          num(
            provision.montant,
          ),
      }),
    ) ?? [];

  // ============================================================
  // TOTAUX
  // ============================================================

  const totalPaiements =
    paiements.reduce(
      (
        total: number,
        paiement: any,
      ) =>
        total +
        paiement.montant,
      0,
    );

  const totalImputationsProvision =
    imputationsProvision.reduce(
      (
        total: number,
        imputation: any,
      ) =>
        total +
        imputation.montant,
      0,
    );

  /**
   * Ancien système :
   * Provision.factureId.
   */
  const totalProvisionsLegacy =
    provisions.reduce(
      (
        total: number,
        provision: any,
      ) =>
        total +
        provision.montant,
      0,
    );

  /**
   * Compatibilité frontend :
   *
   * totalProvisions représente maintenant
   * toutes les provisions réellement appliquées
   * à cette facture.
   */
  const totalProvisions =
    totalImputationsProvision +
    totalProvisionsLegacy;

  const totalRegle =
    totalPaiements +
    totalProvisions;

  const solde =
    Math.max(
      montantTTC -
      totalRegle,
      0,
    );

  return {
    ...facture,

    montantHT,
    montantTVA,
    montantTTC,
    tauxTVA,

    lignes,
    paiements,

    /**
     * Legacy.
     */
    provisions,

    /**
     * Nouvelle architecture.
     */
    imputationsProvision,

    totalPaiements,

    totalImputationsProvision,

    totalProvisionsLegacy,

    totalProvisions,

    totalRegle,

    solde,
  };
}

// ============================================================
// SERVICE
// ============================================================

@Injectable()
export class FacturesService {
  constructor(
    private readonly prisma:
      PrismaService,

    private readonly activityLog:
      ActivityLogService,
  ) { }

  // ============================================================
  // CALCUL STATUT FACTURE
  // ============================================================

  private resolveFactureStatut(
    totalRegle: number,
    montantTTC: number,
  ): FactureStatut {
    if (
      totalRegle >=
      montantTTC
    ) {
      return FactureStatut.PAYEE;
    }

    if (
      totalRegle > 0
    ) {
      return FactureStatut.PARTIELLEMENT_PAYEE;
    }

    return FactureStatut.ENVOYEE;
  }

  // ============================================================
  // LISTE
  // ============================================================

  async findAll() {
    const factures =
      await this.prisma
        .facture
        .findMany({
          orderBy: {
            createdAt:
              'desc',
          },

          include: {
            client:
              true,

            dossier:
              true,

            lignes:
              true,

            paiements: {
              include: {
                mouvementFinance: {
                  include: {
                    caisse:
                      true,
                  },
                },
              },
            },

            // ====================================================
            // NOUVELLE ARCHITECTURE
            // ====================================================

            imputationsProvision: {
              orderBy: {
                dateImputation:
                  'asc',
              },

              include: {
                provision: {
                  select: {
                    id:
                      true,

                    montant:
                      true,

                    datePaiement:
                      true,

                    note:
                      true,
                  },
                },

                createdBy: {
                  select: {
                    id:
                      true,

                    name:
                      true,
                  },
                },
              },
            },

            // ====================================================
            // LEGACY
            // ====================================================

            provisions:
              true,

            fraisOuvertureDossier:
              true,
          },
        });

    return factures.map(
      serializeFacture,
    );
  }

  // ============================================================
  // DETAIL
  // ============================================================

  async findOne(
    id: string,
  ) {
    const facture =
      await this.prisma
        .facture
        .findUnique({
          where: {
            id,
          },

          include: {
            client:
              true,

            dossier:
              true,

            lignes:
              true,

            paiements: {
              include: {
                mouvementFinance: {
                  include: {
                    caisse:
                      true,
                  },
                },
              },
            },

            // ====================================================
            // NOUVELLE ARCHITECTURE
            // ====================================================

            imputationsProvision: {
              orderBy: {
                dateImputation:
                  'asc',
              },

              include: {
                provision: {
                  select: {
                    id:
                      true,

                    montant:
                      true,

                    datePaiement:
                      true,

                    note:
                      true,

                    mouvementFinance: {
                      include: {
                        caisse:
                          true,

                        recuEncaissement:
                          true,
                      },
                    },
                  },
                },

                createdBy: {
                  select: {
                    id:
                      true,

                    name:
                      true,
                  },
                },
              },
            },

            // ====================================================
            // LEGACY
            // ====================================================

            provisions:
              true,

            fraisOuvertureDossier:
              true,
          },
        });

    if (!facture) {
      throw new NotFoundException(
        'Facture introuvable.',
      );
    }

    return serializeFacture(
      facture,
    );
  }

  // ============================================================
  // GENERATION NUMERO FACTURE
  // ============================================================

  private async generateNumero() {
    const year =
      new Date().getFullYear();

    const count =
      await this.prisma
        .facture
        .count({
          where: {
            numero: {
              startsWith:
                `FACT-${year}-`,
            },
          },
        });

    return `FACT-${year}-${String(
      count + 1,
    ).padStart(
      3,
      '0',
    )}`;
  }

  // ============================================================
  // CREATION FACTURE
  // ============================================================

  async create(
    dto: CreateFactureDto,
    userId: string,
  ) {
    // ============================================================
    // DATE D'ECHEANCE
    // ============================================================

    const dateEcheance =
      new Date(
        dto.dateEcheance,
      );

    if (
      Number.isNaN(
        dateEcheance.getTime(),
      )
    ) {
      throw new BadRequestException(
        'La date d’échéance est invalide.',
      );
    }

    // ============================================================
    // VALIDATION LIGNES
    // ============================================================

    if (
      !dto.lignes ||
      dto.lignes.length === 0
    ) {
      throw new BadRequestException(
        'La facture doit contenir au moins une ligne.',
      );
    }

    for (
      const ligne of dto.lignes
    ) {
      if (
        !Number.isFinite(
          ligne.quantite,
        ) ||
        ligne.quantite <= 0
      ) {
        throw new BadRequestException(
          'La quantité d’une ligne de facture doit être supérieure à zéro.',
        );
      }

      if (
        !Number.isFinite(
          ligne.prixUnitaire,
        ) ||
        ligne.prixUnitaire < 0
      ) {
        throw new BadRequestException(
          'Le prix unitaire d’une ligne de facture est invalide.',
        );
      }
    }

    // ============================================================
    // NUMERO
    // ============================================================

    const numero =
      await this.generateNumero();

    // ============================================================
    // TRANSACTION
    // ============================================================

    const facture =
      await this.prisma
        .$transaction(
          async (tx) => {
            // ====================================================
            // DOSSIER + FRAIS D'OUVERTURE
            // ====================================================

            const dossier =
              await tx.dossier
                .findUnique({
                  where: {
                    id:
                      dto.dossierId,
                  },

                  include: {
                    client:
                      true,

                    fraisOuverture:
                      true,
                  },
                });

            if (!dossier) {
              throw new NotFoundException(
                'Dossier introuvable.',
              );
            }

            // ====================================================
            // HONORAIRES
            // ====================================================

            const montantHonorairesHT =
              dto.lignes.reduce(
                (
                  total,
                  ligne,
                ) =>
                  total +
                  ligne.quantite *
                  ligne.prixUnitaire,
                0,
              );

            // ====================================================
            // FRAIS D'OUVERTURE A INCLURE
            //
            // Règle :
            // - A_PAYER => à intégrer dans la première facture.
            // - A_FACTURER => ancienne donnée, encore compatible.
            // - PAYE => jamais réintégré.
            // - FACTURE => déjà intégré dans une autre facture.
            // ====================================================

            const fraisOuverture =
              dossier.fraisOuverture;

            const inclureFraisOuverture =
              Boolean(
                fraisOuverture &&
                !fraisOuverture.factureId &&
                (
                  fraisOuverture.statut ===
                  'A_PAYER' ||
                  fraisOuverture.statut ===
                  'A_FACTURER'
                ),
              );

            const montantFraisOuverture =
              inclureFraisOuverture &&
                fraisOuverture
                ? num(
                  fraisOuverture.montant,
                )
                : 0;

            // ====================================================
            // TVA
            //
            // La TVA s'applique UNIQUEMENT aux honoraires.
            // Les frais d'ouverture sont ajoutés tels quels.
            // ====================================================

            const montantTVA =
              Math.round(
                montantHonorairesHT *
                CABINET_INFO.tauxTVA,
              ) / 100;

            /**
             * Le montant HT global contient :
             * - honoraires HT
             * - frais d'ouverture non taxés
             */
            const montantHT =
              montantHonorairesHT +
              montantFraisOuverture;

            /**
             * Total TTC final :
             * honoraires HT
             * + TVA sur honoraires
             * + frais d'ouverture
             */
            const montantTTC =
              montantHonorairesHT +
              montantTVA +
              montantFraisOuverture;

            // ====================================================
            // LIGNES
            // ====================================================

            const lignes: Array<{
              type:
              TypeLigneFacture;
              description:
              string;
              quantite:
              number;
              prixUnitaire:
              number;
              montant:
              number;
            }> =
              dto.lignes.map(
                (
                  ligne,
                ) => ({
                  type:
                    TypeLigneFacture.HONORAIRES,

                  description:
                    ligne.description,

                  quantite:
                    ligne.quantite,

                  prixUnitaire:
                    ligne.prixUnitaire,

                  montant:
                    ligne.quantite *
                    ligne.prixUnitaire,
                }),
              );

            // ====================================================
            // LIGNE FRAIS D'OUVERTURE
            // ====================================================

            if (
              inclureFraisOuverture &&
              fraisOuverture
            ) {
              lignes.push({
                type:
                  TypeLigneFacture
                    .FRAIS_OUVERTURE_DOSSIER,

                description:
                  `Frais d'ouverture du dossier ${dossier.reference}`,

                quantite:
                  1,

                prixUnitaire:
                  montantFraisOuverture,

                montant:
                  montantFraisOuverture,
              });
            }

            // ====================================================
            // CREATION FACTURE
            // ====================================================

            const createdFacture =
              await tx.facture
                .create({
                  data: {
                    numero,

                    statut:
                      FactureStatut.ENVOYEE,

                    dossierId:
                      dossier.id,

                    clientId:
                      dossier.clientId,

                    source:
                      'DOSSIER',

                    sourceLibelle:
                      `Facture du dossier ${dossier.reference}`,

                    dateEcheance,

                    montantHT,

                    tauxTVA:
                      CABINET_INFO.tauxTVA,

                    montantTVA,

                    montantTTC,

                    note:
                      dto.note
                        ?.trim() ||
                      null,

                    mentionRCCM:
                      CABINET_INFO.rccm,

                    mentionNCC:
                      CABINET_INFO.ncc,

                    lignes: {
                      create:
                        lignes,
                    },
                  },
                });

            // ====================================================
            // LIEN FRAIS D'OUVERTURE -> FACTURE
            //
            // IMPORTANT :
            // Aucun mouvement Finance n'est créé ici.
            // Aucun reçu n'est créé ici.
            // Les frais ne sont pas encore encaissés :
            // ils sont simplement désormais facturés.
            // ====================================================

            if (
              inclureFraisOuverture &&
              fraisOuverture
            ) {
              await tx
                .fraisOuvertureDossier
                .update({
                  where: {
                    id:
                      fraisOuverture.id,
                  },

                  data: {
                    statut:
                      'FACTURE',

                    factureId:
                      createdFacture.id,

                    datePaiement:
                      null,

                    mouvementFinanceId:
                      null,
                  },
                });
            }

            // ====================================================
            // RETOUR COMPLET
            // ====================================================

            return tx.facture
              .findUniqueOrThrow({
                where: {
                  id:
                    createdFacture.id,
                },

                include: {
                  client:
                    true,

                  dossier:
                    true,

                  lignes:
                    true,

                  paiements:
                    true,

                  imputationsProvision:
                    true,

                  // Legacy
                  provisions:
                    true,

                  fraisOuvertureDossier:
                    true,
                },
              });
          },

          {
            maxWait:
              10_000,

            timeout:
              20_000,
          },
        );

    // ============================================================
    // AUDIT
    // ============================================================

    const ligneFrais =
      facture.lignes.find(
        (
          ligne,
        ) =>
          ligne.type ===
          TypeLigneFacture
            .FRAIS_OUVERTURE_DOSSIER,
      );

    await this.activityLog.log({
      userId,

      action:
        'FACTURE_CREEE',

      entityType:
        'Facture',

      entityId:
        facture.id,

      dossierId:
        facture.dossierId,

      metadata: {
        numero:
          facture.numero,

        montantHT:
          Number(
            facture.montantHT,
          ),

        montantTVA:
          Number(
            facture.montantTVA,
          ),

        montantTTC:
          Number(
            facture.montantTTC,
          ),

        fraisOuvertureInclus:
          Boolean(
            ligneFrais,
          ),

        montantFraisOuverture:
          ligneFrais
            ? Number(
              ligneFrais.montant,
            )
            : 0,
      },
    });

    return serializeFacture(
      facture,
    );
  }

  // ============================================================
  // AJOUT PAIEMENT FACTURE
  // ============================================================

  async addPaiement(
    id: string,
    dto: CreatePaiementDto,
    userId: string,
  ) {
    // ============================================================
    // MONTANT
    // ============================================================

    if (
      !Number.isFinite(
        dto.montant,
      ) ||
      dto.montant <= 0
    ) {
      throw new BadRequestException(
        'Le montant du paiement doit être supérieur à zéro.',
      );
    }

    // ============================================================
    // MOYEN DE PAIEMENT
    // ============================================================

    if (
      !dto.moyenPaiement
    ) {
      throw new BadRequestException(
        'Le moyen de paiement est obligatoire.',
      );
    }

    const moyenPaiement =
      dto.moyenPaiement as
      MoyenOperationCompte;

    const valeursAutorisees =
      Object.values(
        MoyenOperationCompte,
      );

    if (
      !valeursAutorisees.includes(
        moyenPaiement,
      )
    ) {
      throw new BadRequestException(
        'Le moyen de paiement est invalide.',
      );
    }

    if (
      moyenPaiement ===
      MoyenOperationCompte.CARTE ||
      moyenPaiement ===
      MoyenOperationCompte.MOBILE_MONEY
    ) {
      throw new BadRequestException(
        'Ce moyen de paiement est une ancienne valeur et ne peut plus être utilisé pour un nouveau paiement.',
      );
    }

    // ============================================================
    // DATE
    // ============================================================

    const datePaiement =
      dto.datePaiement
        ? new Date(
          dto.datePaiement,
        )
        : new Date();

    if (
      Number.isNaN(
        datePaiement.getTime(),
      )
    ) {
      throw new BadRequestException(
        'La date du paiement est invalide.',
      );
    }

    // ============================================================
    // TRANSACTION
    // ============================================================

    const result =
      await this.prisma
        .$transaction(
          async (tx) => {
            // ====================================================
            // FACTURE
            // ====================================================

            const facture =
              await tx.facture
                .findUnique({
                  where: {
                    id,
                  },

                  include: {
                    client: {
                      select: {
                        id:
                          true,

                        nom:
                          true,
                      },
                    },

                    dossier: {
                      select: {
                        id:
                          true,

                        reference:
                          true,
                      },
                    },

                    paiements: {
                      select: {
                        montant:
                          true,
                      },
                    },

                    // ==============================================
                    // NOUVELLE ARCHITECTURE
                    // ==============================================

                    imputationsProvision: {
                      select: {
                        montant:
                          true,
                      },
                    },

                    // ==============================================
                    // LEGACY
                    // ==============================================

                    provisions: {
                      select: {
                        montant:
                          true,
                      },
                    },

                    // ==============================================
                    // FRAIS D'OUVERTURE FACTURES AVEC LA FACTURE
                    // ==============================================

                    fraisOuvertureDossier: {
                      select: {
                        id:
                          true,

                        statut:
                          true,

                        mouvementFinanceId:
                          true,
                      },
                    },
                  },
                });

            if (!facture) {
              throw new NotFoundException(
                'Facture introuvable.',
              );
            }

            // ====================================================
            // COMPTE
            // ====================================================

            const caisse =
              await tx.caisse
                .findUnique({
                  where: {
                    id:
                      dto.caisseId,
                  },

                  select: {
                    id:
                      true,

                    nom:
                      true,

                    type:
                      true,

                    devise:
                      true,

                    active:
                      true,

                    institution:
                      true,

                    moyensOperation:
                      true,
                  },
                });

            if (!caisse) {
              throw new NotFoundException(
                'Compte d’encaissement introuvable.',
              );
            }

            if (!caisse.active) {
              throw new BadRequestException(
                'Le compte d’encaissement sélectionné est désactivé.',
              );
            }

            if (
              caisse.devise !==
              'XOF'
            ) {
              throw new BadRequestException(
                'Le compte d’encaissement doit être en XOF.',
              );
            }

            // ====================================================
            // COMPATIBILITE COMPTE / MOYEN
            // ====================================================

            const moyensAutorises =
              getMoyensAutorises(
                caisse.type,
                caisse
                  .moyensOperation,
              );

            if (
              !moyensAutorises.includes(
                moyenPaiement,
              )
            ) {
              throw new BadRequestException(
                `Le moyen de paiement ${moyenPaiement} n’est pas autorisé pour le compte sélectionné.`,
              );
            }

            // ====================================================
            // TOTAUX AVANT PAIEMENT
            // ====================================================

            const totalPaiementsAvant =
              facture.paiements
                .reduce(
                  (
                    total,
                    paiement,
                  ) =>
                    total +
                    num(
                      paiement.montant,
                    ),
                  0,
                );

            const totalImputations =
              facture
                .imputationsProvision
                .reduce(
                  (
                    total,
                    imputation,
                  ) =>
                    total +
                    num(
                      imputation
                        .montant,
                    ),
                  0,
                );

            /**
             * Anciennes provisions reliées
             * directement par factureId.
             */
            const totalLegacyProvisions =
              facture.provisions
                .reduce(
                  (
                    total,
                    provision,
                  ) =>
                    total +
                    num(
                      provision.montant,
                    ),
                  0,
                );

            const totalProvisions =
              totalImputations +
              totalLegacyProvisions;

            const montantTTC =
              num(
                facture.montantTTC,
              );

            const totalRegleAvant =
              totalPaiementsAvant +
              totalProvisions;

            const soldeAvant =
              Math.max(
                montantTTC -
                totalRegleAvant,
                0,
              );

            if (
              soldeAvant <= 0
            ) {
              throw new BadRequestException(
                'Cette facture est déjà entièrement réglée.',
              );
            }

            if (
              dto.montant >
              soldeAvant
            ) {
              throw new BadRequestException(
                `Le paiement de ${dto.montant.toLocaleString(
                  'fr-FR',
                )} FCFA dépasse le solde restant de ${soldeAvant.toLocaleString(
                  'fr-FR',
                )} FCFA.`,
              );
            }

            // ====================================================
            // 1. PAIEMENT
            // ====================================================

            const paiement =
              await tx.paiement
                .create({
                  data: {
                    factureId:
                      facture.id,

                    montant:
                      dto.montant,

                    datePaiement,

                    /**
                     * Champ String legacy.
                     * On conserve la valeur enum
                     * sous forme de texte.
                     */
                    moyenPaiement,

                    note:
                      dto.note
                        ?.trim() ||
                      null,
                  },
                });

            // ====================================================
            // 2. MOUVEMENT FINANCE
            // ====================================================

            const mouvement =
              await tx
                .mouvementFinance
                .create({
                  data: {
                    type:
                      'ENTREE',

                    montant:
                      dto.montant,

                    categorie:
                      'PAIEMENT_FACTURE',

                    source:
                      'PAIEMENT_FACTURE',

                    sourceLibelle:
                      `Paiement de la facture ${facture.numero}`,

                    sourceReference:
                      facture.numero,

                    tiers:
                      facture.client.nom,

                    description:
                      dto.note
                        ?.trim() ||
                      `Paiement de la facture ${facture.numero}`,

                    reference:
                      dto.reference
                        ?.trim() ||
                      null,

                    date:
                      datePaiement,

                    caisseId:
                      caisse.id,

                    moyenPaiement,

                    userId,

                    dossierId:
                      facture.dossierId,
                  },
                });

            // ====================================================
            // 3. LIEN PAIEMENT -> MOUVEMENT
            // ====================================================

            await tx.paiement
              .update({
                where: {
                  id:
                    paiement.id,
                },

                data: {
                  mouvementFinanceId:
                    mouvement.id,
                },
              });

            // ====================================================
            // 4. RECALCUL FACTURE
            // ====================================================

            const totalPaiements =
              totalPaiementsAvant +
              dto.montant;

            const totalRegle =
              totalPaiements +
              totalProvisions;

            const solde =
              Math.max(
                montantTTC -
                totalRegle,
                0,
              );

            const statut =
              this
                .resolveFactureStatut(
                  totalRegle,
                  montantTTC,
                );

            await tx.facture
              .update({
                where: {
                  id:
                    facture.id,
                },

                data: {
                  statut,
                },
              });

            // ====================================================
            // 5. SYNCHRONISATION DES FRAIS D'OUVERTURE
            //
            // Si les frais d'ouverture ont été intégrés à cette
            // facture, ils deviennent PAYE uniquement lorsque la
            // facture est totalement réglée.
            //
            // IMPORTANT :
            // aucun mouvement Finance supplémentaire n'est créé.
            // aucun reçu supplémentaire n'est créé.
            // Le paiement de facture porte déjà l'encaissement.
            // ====================================================

            if (
              facture
                .fraisOuvertureDossier &&
              statut ===
              FactureStatut.PAYEE
            ) {
              await tx
                .fraisOuvertureDossier
                .update({
                  where: {
                    id:
                      facture
                        .fraisOuvertureDossier
                        .id,
                  },

                  data: {
                    statut:
                      'PAYE',

                    datePaiement,
                  },
                });
            }

            // ====================================================
            // 6. RETOUR COMPLET
            // ====================================================

            const updated =
              await tx.facture
                .findUnique({
                  where: {
                    id:
                      facture.id,
                  },

                  include: {
                    client:
                      true,

                    dossier:
                      true,

                    lignes:
                      true,

                    paiements: {
                      include: {
                        mouvementFinance: {
                          include: {
                            caisse:
                              true,
                          },
                        },
                      },
                    },

                    // ==============================================
                    // NOUVELLE ARCHITECTURE
                    // ==============================================

                    imputationsProvision: {
                      orderBy: {
                        dateImputation:
                          'asc',
                      },

                      include: {
                        provision: {
                          select: {
                            id:
                              true,

                            montant:
                              true,

                            datePaiement:
                              true,

                            note:
                              true,
                          },
                        },

                        createdBy: {
                          select: {
                            id:
                              true,

                            name:
                              true,
                          },
                        },
                      },
                    },

                    // ==============================================
                    // LEGACY
                    // ==============================================

                    provisions:
                      true,

                    fraisOuvertureDossier:
                      true,
                  },
                });

            if (!updated) {
              throw new NotFoundException(
                'Facture introuvable après enregistrement du paiement.',
              );
            }

            return {
              facture:
                updated,

              paiementId:
                paiement.id,

              mouvementId:
                mouvement.id,

              totalPaiements,

              totalImputations,

              totalLegacyProvisions,

              totalProvisions,

              totalRegle,

              solde,
            };
          },

          {
            maxWait:
              10_000,

            timeout:
              20_000,
          },
        );

    // ============================================================
    // AUDIT
    // ============================================================

    await this.activityLog.log({
      userId,

      action:
        'PAIEMENT_ENREGISTRE',

      entityType:
        'Facture',

      entityId:
        result.facture.id,

      dossierId:
        result.facture.dossierId,

      metadata: {
        numero:
          result.facture.numero,

        montant:
          dto.montant,

        caisseId:
          dto.caisseId,

        moyenPaiement,

        paiementId:
          result.paiementId,

        mouvementFinanceId:
          result.mouvementId,

        reference:
          dto.reference ??
          null,

        totalPaiements:
          result.totalPaiements,

        totalImputationsProvision:
          result.totalImputations,

        totalProvisionsLegacy:
          result.totalLegacyProvisions,

        totalProvisions:
          result.totalProvisions,

        totalRegle:
          result.totalRegle,

        solde:
          result.solde,
      },
    });

    return serializeFacture(
      result.facture,
    );
  }
}
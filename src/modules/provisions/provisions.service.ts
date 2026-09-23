import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  FactureStatut,
  MoyenOperationCompte,
} from '../../../generated/prisma/client';

import {
  PrismaService,
} from '../../prisma/prisma.service';

import {
  CreateProvisionDto,
} from './dto/create-provision.dto';

import {
  CreateImputationProvisionDto,
} from './dto/create-imputation-provision.dto';

function num(
  value: unknown,
): number {
  return Number(value);
}

@Injectable()
export class ProvisionsService {
  constructor(
    private readonly prisma:
      PrismaService,
  ) { }

  // ============================================================
  // STATUT D'UNE FACTURE
  // ============================================================

  private resolveFactureStatut(
    totalRegle: number,
    montantTTC: number,
  ): FactureStatut {
    if (
      totalRegle >= montantTTC
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
  // MOYENS DE PAIEMENT AUTORISES
  // ============================================================

  private getMoyensAutorises(
    typeCompte: string,
    moyensConfigures:
      MoyenOperationCompte[],
  ): MoyenOperationCompte[] {
    /**
     * CARTE et MOBILE_MONEY sont des
     * valeurs legacy.
     *
     * Elles ne doivent plus être utilisées
     * pour de nouveaux encaissements.
     */
    const moyensModernes =
      moyensConfigures.filter(
        (moyen) =>
          moyen !==
          MoyenOperationCompte.CARTE &&
          moyen !==
          MoyenOperationCompte.MOBILE_MONEY,
      );

    /**
     * Si le compte possède déjà une
     * configuration moderne explicite,
     * celle-ci est prioritaire.
     */
    if (
      moyensModernes.length > 0
    ) {
      return moyensModernes;
    }

    /**
     * Compatibilité temporaire avec
     * les comptes existants.
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

  // ============================================================
  // LISTE DES PROVISIONS
  // ============================================================

  async findAll(
    dossierId?: string,
  ) {
    const provisions =
      await this.prisma
        .provision
        .findMany({
          where:
            dossierId
              ? {
                dossierId,
              }
              : undefined,

          orderBy: {
            datePaiement:
              'desc',
          },

          include: {
            // ====================================================
            // LEGACY
            // ====================================================

            facture: {
              select: {
                id: true,
                numero: true,
                montantTTC: true,
              },
            },

            // ====================================================
            // NOUVELLES IMPUTATIONS
            // ====================================================

            imputations: {
              orderBy: {
                dateImputation:
                  'asc',
              },

              include: {
                facture: {
                  select: {
                    id: true,
                    numero: true,
                    montantTTC: true,
                    statut: true,
                  },
                },

                createdBy: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },

            // ====================================================
            // FINANCE + RECU
            // ====================================================

            mouvementFinance: {
              include: {
                caisse: {
                  select: {
                    id: true,
                    nom: true,
                    type: true,
                    institution: true,
                    identifiant: true,
                    titulaire: true,
                    devise: true,
                    active: true,
                  },
                },

                recuEncaissement:
                  true,
              },
            },
          },
        });

    return provisions.map(
      (provision) => {
        const montant =
          num(
            provision.montant,
          );

        const montantImpute =
          provision.imputations
            .reduce(
              (
                total,
                imputation,
              ) =>
                total +
                num(
                  imputation.montant,
                ),
              0,
            );

        const montantDisponible =
          Math.max(
            montant -
            montantImpute,
            0,
          );

        return {
          ...provision,

          montant,

          montantImpute,

          montantDisponible,

          // ================================================
          // LEGACY
          // ================================================

          facture:
            provision.facture
              ? {
                ...provision.facture,

                montantTTC:
                  num(
                    provision
                      .facture
                      .montantTTC,
                  ),
              }
              : null,

          // ================================================
          // IMPUTATIONS
          // ================================================

          imputations:
            provision.imputations.map(
              (
                imputation,
              ) => ({
                ...imputation,

                montant:
                  num(
                    imputation.montant,
                  ),

                facture: {
                  ...imputation.facture,

                  montantTTC:
                    num(
                      imputation
                        .facture
                        .montantTTC,
                    ),
                },
              }),
            ),

          // ================================================
          // FINANCE
          // ================================================

          mouvementFinance:
            provision
              .mouvementFinance
              ? {
                ...provision
                  .mouvementFinance,

                montant:
                  num(
                    provision
                      .mouvementFinance
                      .montant,
                  ),

                recuEncaissement:
                  provision
                    .mouvementFinance
                    .recuEncaissement
                    ? {
                      ...provision
                        .mouvementFinance
                        .recuEncaissement,

                      montant:
                        num(
                          provision
                            .mouvementFinance
                            .recuEncaissement
                            .montant,
                        ),
                    }
                    : null,
              }
              : null,
        };
      },
    );
  }

  // ============================================================
  // CREATION / ENCAISSEMENT D'UNE PROVISION
  // ============================================================

  async create(
    dto: CreateProvisionDto,
    userId: string,
  ) {
    // ============================================================
    // VALIDATION MONTANT
    // ============================================================

    if (
      !Number.isFinite(
        dto.montant,
      ) ||
      dto.montant <= 0
    ) {
      throw new BadRequestException(
        'Le montant de la provision doit être supérieur à zéro.',
      );
    }

    // ============================================================
    // VALIDATION DATE
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
        'La date de paiement de la provision est invalide.',
      );
    }

    // ============================================================
    // VALEURS LEGACY INTERDITES
    // ============================================================

    if (
      dto.moyenPaiement ===
      MoyenOperationCompte.CARTE ||
      dto.moyenPaiement ===
      MoyenOperationCompte.MOBILE_MONEY
    ) {
      throw new BadRequestException(
        'Ce moyen de paiement est une ancienne valeur et ne peut plus être utilisé pour un nouvel encaissement.',
      );
    }

    // ============================================================
    // TRANSACTION
    // ============================================================

    const provision =
      await this.prisma
        .$transaction(
          async (tx) => {
            // ====================================================
            // DOSSIER + CLIENT
            // ====================================================

            const dossier =
              await tx.dossier
                .findUnique({
                  where: {
                    id:
                      dto.dossierId,
                  },

                  include: {
                    client: {
                      select: {
                        id: true,
                        nom: true,
                      },
                    },
                  },
                });

            if (!dossier) {
              throw new NotFoundException(
                'Dossier introuvable.',
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
                    id: true,

                    nom: true,

                    type: true,

                    devise: true,

                    active: true,

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
              this
                .getMoyensAutorises(
                  caisse.type,
                  caisse
                    .moyensOperation,
                );

            if (
              !moyensAutorises
                .includes(
                  dto.moyenPaiement,
                )
            ) {
              throw new BadRequestException(
                `Le moyen de paiement ${dto.moyenPaiement} n’est pas autorisé pour le compte sélectionné.`,
              );
            }

            // ====================================================
            // NUMERO DU RECU
            // ====================================================

            const year =
              datePaiement
                .getFullYear();

            const lastReceipt =
              await tx
                .recuEncaissement
                .findFirst({
                  where: {
                    numero: {
                      startsWith:
                        `REC-${year}-`,
                    },
                  },

                  orderBy: {
                    numero:
                      'desc',
                  },

                  select: {
                    numero:
                      true,
                  },
                });

            let nextReceiptNumber =
              1;

            if (
              lastReceipt
            ) {
              const lastNumber =
                Number(
                  lastReceipt
                    .numero
                    .split('-')
                    .pop(),
                );

              if (
                Number.isFinite(
                  lastNumber,
                )
              ) {
                nextReceiptNumber =
                  lastNumber + 1;
              }
            }

            const numeroRecu =
              `REC-${year}-${String(
                nextReceiptNumber,
              ).padStart(
                4,
                '0',
              )}`;

            // ====================================================
            // MOUVEMENT FINANCE
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
                      'PROVISION',

                    source:
                      'PROVISION',

                    sourceLibelle:
                      `Provision du dossier ${dossier.reference}`,

                    sourceReference:
                      numeroRecu,

                    tiers:
                      dossier.client.nom,

                    description:
                      dto.note
                        ?.trim() ||
                      `Provision encaissée pour le dossier ${dossier.reference}`,

                    reference:
                      dto.reference
                        ?.trim() ||
                      null,

                    date:
                      datePaiement,

                    caisseId:
                      caisse.id,

                    moyenPaiement:
                      dto.moyenPaiement,

                    userId,

                    dossierId:
                      dossier.id,
                  },
                });

            // ====================================================
            // PROVISION
            // ====================================================

            const createdProvision =
              await tx
                .provision
                .create({
                  data: {
                    dossierId:
                      dossier.id,

                    montant:
                      dto.montant,

                    datePaiement,

                    /**
                     * Champ legacy.
                     *
                     * On garde encore une copie texte
                     * pour compatibilité avec l'ancien
                     * frontend.
                     *
                     * La valeur de référence est maintenant
                     * MouvementFinance.moyenPaiement.
                     */
                    moyenPaiement:
                      dto.moyenPaiement,

                    note:
                      dto.note
                        ?.trim() ||
                      null,

                    mouvementFinanceId:
                      mouvement.id,

                    /**
                     * IMPORTANT :
                     * aucune facture lors
                     * de l'encaissement.
                     */
                    factureId:
                      null,
                  },
                });

            // ====================================================
            // LIBELLE DU COMPTE POUR LE RECU
            // ====================================================

            const compteLibelle =
              caisse.institution
                ? `${caisse.nom} - ${caisse.institution}`
                : caisse.nom;

            // ====================================================
            // RECU D'ENCAISSEMENT
            // ====================================================

            await tx
              .recuEncaissement
              .create({
                data: {
                  numero:
                    numeroRecu,

                  type:
                    'PROVISION',

                  montant:
                    dto.montant,

                  dateEmission:
                    datePaiement,

                  recuDe:
                    dossier.client.nom,

                  compteLibelle,

                  moyenPaiement:
                    dto.moyenPaiement,

                  referencePaiement:
                    dto.reference
                      ?.trim() ||
                    null,

                  objet:
                    `Provision du dossier ${dossier.reference}`,

                  note:
                    dto.note
                      ?.trim() ||
                    null,

                  dossierId:
                    dossier.id,

                  mouvementFinanceId:
                    mouvement.id,

                  createdById:
                    userId,
                },
              });

            // ====================================================
            // RETOUR COMPLET
            // ====================================================

            return tx.provision
              .findUniqueOrThrow({
                where: {
                  id:
                    createdProvision.id,
                },

                include: {
                  imputations: {
                    include: {
                      facture: {
                        select: {
                          id:
                            true,

                          numero:
                            true,

                          montantTTC:
                            true,

                          statut:
                            true,
                        },
                      },
                    },
                  },

                  mouvementFinance: {
                    include: {
                      caisse: {
                        select: {
                          id:
                            true,

                          nom:
                            true,

                          type:
                            true,

                          institution:
                            true,

                          identifiant:
                            true,

                          titulaire:
                            true,

                          devise:
                            true,

                          active:
                            true,
                        },
                      },

                      recuEncaissement:
                        true,
                    },
                  },
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
    // NORMALISATION RETOUR
    // ============================================================

    const montant =
      num(
        provision.montant,
      );

    const montantImpute =
      provision.imputations
        .reduce(
          (
            total,
            imputation,
          ) =>
            total +
            num(
              imputation.montant,
            ),
          0,
        );

    return {
      ...provision,

      montant,

      montantImpute,

      montantDisponible:
        Math.max(
          montant -
          montantImpute,
          0,
        ),

      imputations:
        provision.imputations
          .map(
            (
              imputation,
            ) => ({
              ...imputation,

              montant:
                num(
                  imputation
                    .montant,
                ),

              facture: {
                ...imputation.facture,

                montantTTC:
                  num(
                    imputation
                      .facture
                      .montantTTC,
                  ),
              },
            }),
          ),

      mouvementFinance:
        provision
          .mouvementFinance
          ? {
            ...provision
              .mouvementFinance,

            montant:
              num(
                provision
                  .mouvementFinance
                  .montant,
              ),

            recuEncaissement:
              provision
                .mouvementFinance
                .recuEncaissement
                ? {
                  ...provision
                    .mouvementFinance
                    .recuEncaissement,

                  montant:
                    num(
                      provision
                        .mouvementFinance
                        .recuEncaissement
                        .montant,
                    ),
                }
                : null,
          }
          : null,
    };
  }

  // ============================================================
  // IMPUTATION D'UNE PROVISION
  // ============================================================

  async createImputation(
    provisionId: string,
    dto: CreateImputationProvisionDto,
    userId: string,
  ) {
    if (
      !Number.isFinite(
        dto.montant,
      ) ||
      dto.montant <= 0
    ) {
      throw new BadRequestException(
        'Le montant à imputer doit être supérieur à zéro.',
      );
    }

    return this.prisma
      .$transaction(
        async (tx) => {
          // ======================================================
          // PROVISION
          // ======================================================

          const provision =
            await tx.provision
              .findUnique({
                where: {
                  id:
                    provisionId,
                },

                include: {
                  imputations: {
                    select: {
                      id:
                        true,

                      factureId:
                        true,

                      montant:
                        true,
                    },
                  },
                },
              });

          if (!provision) {
            throw new NotFoundException(
              'Provision introuvable.',
            );
          }

          /**
           * Protection des anciennes données.
           *
           * Les provisions encore reliées par
           * Provision.factureId doivent d'abord
           * être migrées.
           */
          if (
            provision.factureId
          ) {
            throw new BadRequestException(
              'Cette provision utilise encore l’ancienne affectation directe à une facture. Elle doit être migrée avant d’utiliser le nouveau système d’imputation.',
            );
          }

          // ======================================================
          // MONTANT DISPONIBLE DE LA PROVISION
          // ======================================================

          const montantProvision =
            num(
              provision.montant,
            );

          const totalDejaImpute =
            provision
              .imputations
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

          const montantDisponible =
            Math.max(
              montantProvision -
              totalDejaImpute,
              0,
            );

          if (
            dto.montant >
            montantDisponible
          ) {
            throw new BadRequestException(
              `Le montant à imputer (${dto.montant.toLocaleString(
                'fr-FR',
              )} FCFA) dépasse le montant disponible de la provision (${montantDisponible.toLocaleString(
                'fr-FR',
              )} FCFA).`,
            );
          }

          // ======================================================
          // UNE SEULE IMPUTATION PAR COUPLE
          // PROVISION / FACTURE
          // ======================================================

          const existingImputation =
            provision
              .imputations
              .find(
                (
                  imputation,
                ) =>
                  imputation
                    .factureId ===
                  dto.factureId,
              );

          if (
            existingImputation
          ) {
            throw new BadRequestException(
              'Cette provision possède déjà une imputation sur cette facture.',
            );
          }

          // ======================================================
          // FACTURE
          // ======================================================

          const facture =
            await tx.facture
              .findUnique({
                where: {
                  id:
                    dto.factureId,
                },

                include: {
                  paiements: {
                    select: {
                      montant:
                        true,
                    },
                  },

                  imputationsProvision: {
                    select: {
                      montant:
                        true,
                    },
                  },

                  /**
                   * Ancien système.
                   *
                   * Tant que les données historiques
                   * ne sont pas nettoyées, elles
                   * doivent rester prises en compte.
                   */
                  provisions: {
                    select: {
                      montant:
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

          if (
            facture.dossierId !==
            provision.dossierId
          ) {
            throw new BadRequestException(
              'La facture et la provision doivent appartenir au même dossier.',
            );
          }

          // ======================================================
          // MONTANT DEJA REGLE SUR LA FACTURE
          // ======================================================

          const totalPaiements =
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
                    imputation.montant,
                  ),
                0,
              );

          const totalLegacyProvisions =
            facture.provisions
              .reduce(
                (
                  total,
                  legacyProvision,
                ) =>
                  total +
                  num(
                    legacyProvision
                      .montant,
                  ),
                0,
              );

          const montantTTC =
            num(
              facture.montantTTC,
            );

          const totalDejaRegle =
            totalPaiements +
            totalImputations +
            totalLegacyProvisions;

          const soldeFacture =
            Math.max(
              montantTTC -
              totalDejaRegle,
              0,
            );

          if (
            dto.montant >
            soldeFacture
          ) {
            throw new BadRequestException(
              `Le montant à imputer (${dto.montant.toLocaleString(
                'fr-FR',
              )} FCFA) dépasse le solde restant de la facture (${soldeFacture.toLocaleString(
                'fr-FR',
              )} FCFA).`,
            );
          }

          // ======================================================
          // CREATION IMPUTATION
          //
          // AUCUN MOUVEMENT FINANCE
          // AUCUN RECU
          // ======================================================

          const imputation =
            await tx
              .imputationProvision
              .create({
                data: {
                  provisionId:
                    provision.id,

                  factureId:
                    facture.id,

                  montant:
                    dto.montant,

                  createdById:
                    userId,
                },

                include: {
                  facture: {
                    select: {
                      id:
                        true,

                      numero:
                        true,

                      montantTTC:
                        true,

                      statut:
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
              });

          // ======================================================
          // MISE A JOUR STATUT FACTURE
          // ======================================================

          const nouveauTotalRegle =
            totalDejaRegle +
            dto.montant;

          const nouveauStatut =
            this
              .resolveFactureStatut(
                nouveauTotalRegle,
                montantTTC,
              );

          await tx.facture
            .update({
              where: {
                id:
                  facture.id,
              },

              data: {
                statut:
                  nouveauStatut,
              },
            });

          return {
            ...imputation,

            montant:
              num(
                imputation.montant,
              ),

            facture: {
              ...imputation.facture,

              montantTTC:
                num(
                  imputation
                    .facture
                    .montantTTC,
                ),

              statut:
                nouveauStatut,
            },

            provision: {
              id:
                provision.id,

              montant:
                montantProvision,

              montantImpute:
                totalDejaImpute +
                dto.montant,

              montantDisponible:
                montantDisponible -
                dto.montant,
            },
          };
        },

        {
          maxWait:
            10_000,

          timeout:
            20_000,
        },
      );
  }

  // ============================================================
  // RETRAIT D'UNE IMPUTATION
  // ============================================================

  async removeImputation(
    provisionId: string,
    imputationId: string,
  ) {
    return this.prisma
      .$transaction(
        async (tx) => {
          // ======================================================
          // IMPUTATION
          // ======================================================

          const imputation =
            await tx
              .imputationProvision
              .findFirst({
                where: {
                  id:
                    imputationId,

                  provisionId,
                },
              });

          if (!imputation) {
            throw new NotFoundException(
              'Imputation introuvable.',
            );
          }

          const factureId =
            imputation.factureId;

          // ======================================================
          // SUPPRESSION DE L'IMPUTATION
          //
          // IMPORTANT :
          // aucun mouvement Finance n'est supprimé.
          // aucun reçu n'est supprimé.
          // ======================================================

          await tx
            .imputationProvision
            .delete({
              where: {
                id:
                  imputation.id,
              },
            });

          // ======================================================
          // RECALCUL FACTURE
          // ======================================================

          const facture =
            await tx.facture
              .findUnique({
                where: {
                  id:
                    factureId,
                },

                include: {
                  paiements: {
                    select: {
                      montant:
                        true,
                    },
                  },

                  imputationsProvision: {
                    select: {
                      montant:
                        true,
                    },
                  },

                  provisions: {
                    select: {
                      montant:
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

          const totalPaiements =
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
                  currentImputation,
                ) =>
                  total +
                  num(
                    currentImputation
                      .montant,
                  ),
                0,
              );

          const totalLegacyProvisions =
            facture.provisions
              .reduce(
                (
                  total,
                  legacyProvision,
                ) =>
                  total +
                  num(
                    legacyProvision
                      .montant,
                  ),
                0,
              );

          const totalRegle =
            totalPaiements +
            totalImputations +
            totalLegacyProvisions;

          const montantTTC =
            num(
              facture.montantTTC,
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

          // ======================================================
          // PROVISION APRES RETRAIT
          // ======================================================

          const provision =
            await tx.provision
              .findUniqueOrThrow({
                where: {
                  id:
                    provisionId,
                },

                include: {
                  imputations: {
                    include: {
                      facture: {
                        select: {
                          id:
                            true,

                          numero:
                            true,

                          montantTTC:
                            true,

                          statut:
                            true,
                        },
                      },
                    },
                  },

                  mouvementFinance: {
                    include: {
                      caisse:
                        true,

                      recuEncaissement:
                        true,
                    },
                  },
                },
              });

          const montantProvision =
            num(
              provision.montant,
            );

          const montantImpute =
            provision
              .imputations
              .reduce(
                (
                  total,
                  currentImputation,
                ) =>
                  total +
                  num(
                    currentImputation
                      .montant,
                  ),
                0,
              );

          return {
            ...provision,

            montant:
              montantProvision,

            montantImpute,

            montantDisponible:
              Math.max(
                montantProvision -
                montantImpute,
                0,
              ),

            factureMiseAJour: {
              id:
                facture.id,

              numero:
                facture.numero,

              statut,

              montantTTC,
            },
          };
        },

        {
          maxWait:
            10_000,

          timeout:
            20_000,
        },
      );
  }
}
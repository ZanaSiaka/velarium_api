import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  MoyenOperationCompte,
} from '../../../generated/prisma/client';

import {
  PrismaService,
} from '../../prisma/prisma.service';

import {
  ActivityLogService,
} from '../activity-log/activity-log.service';

import {
  CreateDossierDto,
} from './dto/create-dossier.dto';

import {
  UpdateDossierDto,
} from './dto/update-dossier.dto';

@Injectable()
export class DossiersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) { }

  // ============================================================
  // LISTE DES DOSSIERS
  // ============================================================

  async findAll() {
    const dossiers =
      await this.prisma.dossier.findMany({
        where: {
          archive: false,
        },

        orderBy: {
          createdAt: 'desc',
        },

        include: {
          client: true,

          avocatResponsable: true,

          fraisOuverture: {
            select: {
              id: true,
              montant: true,
              statut: true,
              datePaiement: true,

              // Legacy
              factureId: true,

              mouvementFinanceId: true,

              mouvementFinance: {
                select: {
                  id: true,
                  moyenPaiement: true,
                  reference: true,

                  caisse: {
                    select: {
                      id: true,
                      nom: true,
                      type: true,
                    },
                  },

                  recuEncaissement: {
                    select: {
                      id: true,
                      numero: true,
                      dateEmission: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

    return dossiers.map((dossier) => ({
      ...dossier,

      fraisOuverture:
        dossier.fraisOuverture
          ? {
            ...dossier.fraisOuverture,

            montant:
              Number(
                dossier
                  .fraisOuverture
                  .montant,
              ),

            statutAffichage:
              dossier
                .fraisOuverture
                .statut === 'PAYE'
                ? 'PAYE'
                : 'IMPAYE',
          }
          : null,
    }));
  }

  // ============================================================
  // LISTE DES DOSSIERS ARCHIVES
  // ============================================================

  async findArchived() {
    const dossiers =
      await this.prisma.dossier.findMany({
        where: {
          archive: true,
        },

        orderBy: {
          archivedAt: 'desc',
        },

        include: {
          client: true,

          avocatResponsable: true,

          fraisOuverture: {
            select: {
              id: true,
              montant: true,
              statut: true,
              datePaiement: true,

              // Legacy
              factureId: true,

              mouvementFinanceId: true,

              mouvementFinance: {
                select: {
                  id: true,

                  moyenPaiement: true,

                  reference: true,

                  caisse: {
                    select: {
                      id: true,
                      nom: true,
                      type: true,
                    },
                  },

                  recuEncaissement: {
                    select: {
                      id: true,
                      numero: true,
                      dateEmission: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

    return dossiers.map((dossier) => ({
      ...dossier,

      fraisOuverture:
        dossier.fraisOuverture
          ? {
            ...dossier.fraisOuverture,

            montant:
              Number(
                dossier
                  .fraisOuverture
                  .montant,
              ),

            statutAffichage:
              dossier
                .fraisOuverture
                .statut === 'PAYE'
                ? 'PAYE'
                : 'IMPAYE',
          }
          : null,
    }));
  }

  // ============================================================
  // LIVRE DES PAIEMENTS
  // ============================================================

  async getLivrePaiements(
    id: string,
  ) {
    const dossier =
      await this.prisma.dossier.findUnique({
        where: {
          id,
        },

        include: {
          client: true,

          // ==========================================================
          // FRAIS D'OUVERTURE
          // ==========================================================

          fraisOuverture: {
            include: {
              mouvementFinance: {
                include: {
                  caisse: true,

                  recuEncaissement:
                    true,
                },
              },
            },
          },

          // ==========================================================
          // FACTURES
          // ==========================================================

          factures: {
            orderBy: {
              dateEmission:
                'asc',
            },

            include: {
              paiements: {
                orderBy: {
                  datePaiement:
                    'asc',
                },
              },

              // Nouvelle architecture :
              // imputations réellement appliquées
              // aux factures.
              imputationsProvision: {
                select: {
                  id: true,

                  provisionId:
                    true,

                  factureId:
                    true,

                  montant:
                    true,

                  dateImputation:
                    true,
                },
              },

              // Anciennes provisions directement
              // attachées à factureId.
              provisions: {
                select: {
                  id: true,

                  montant:
                    true,

                  factureId:
                    true,
                },
              },
            },
          },

          // ==========================================================
          // PROVISIONS DU DOSSIER
          // ==========================================================

          provisions: {
            orderBy: {
              datePaiement:
                'asc',
            },

            include: {
              imputations: {
                orderBy: {
                  dateImputation:
                    'asc',
                },

                select: {
                  id: true,

                  factureId:
                    true,

                  montant:
                    true,

                  dateImputation:
                    true,
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
          },
        },
      });

    if (!dossier) {
      throw new NotFoundException(
        'Dossier introuvable.',
      );
    }

    // ============================================================
    // TOTAL DES FACTURES
    // ============================================================

    const totalFacture =
      dossier.factures.reduce(
        (
          total,
          facture,
        ) =>
          total +
          Number(
            facture.montantTTC,
          ),
        0,
      );

    // ============================================================
    // PAIEMENTS REELS DE FACTURES
    // ============================================================

    const totalPaiements =
      dossier.factures.reduce(
        (
          total,
          facture,
        ) =>
          total +
          facture.paiements.reduce(
            (
              paiementTotal,
              paiement,
            ) =>
              paiementTotal +
              Number(
                paiement.montant,
              ),
            0,
          ),
        0,
      );

    // ============================================================
    // PROVISIONS ENCAISSEES
    //
    // Argent réellement reçu par le cabinet.
    // Une provision reste encaissée même si elle n'est
    // pas encore totalement imputée.
    // ============================================================

    const totalProvisionsEncaissees =
      dossier.provisions.reduce(
        (
          total,
          provision,
        ) =>
          total +
          Number(
            provision.montant,
          ),
        0,
      );

    // ============================================================
    // PROVISIONS IMPUTEES
    //
    // Seules ces sommes diminuent le solde des factures.
    // ============================================================

    const totalProvisionsImputees =
      dossier.factures.reduce(
        (
          total,
          facture,
        ) =>
          total +
          facture
            .imputationsProvision
            .reduce(
              (
                imputationTotal,
                imputation,
              ) =>
                imputationTotal +
                Number(
                  imputation.montant,
                ),
              0,
            ),
        0,
      );

    // ============================================================
    // ANCIENNES PROVISIONS
    //
    // Compatibilité temporaire avec les anciennes données
    // où Provision.factureId était utilisé directement.
    // ============================================================

    const totalProvisionsLegacy =
      dossier.factures.reduce(
        (
          total,
          facture,
        ) =>
          total +
          facture.provisions.reduce(
            (
              provisionTotal,
              provision,
            ) =>
              provisionTotal +
              Number(
                provision.montant,
              ),
            0,
          ),
        0,
      );

    // ============================================================
    // TOTAL PROVISIONS AFFECTEES AUX FACTURES
    // ============================================================

    const totalProvisions =
      totalProvisionsImputees +
      totalProvisionsLegacy;

    // ============================================================
    // PROVISIONS ENCORE DISPONIBLES
    // ============================================================

    const totalProvisionsDisponibles =
      Math.max(
        totalProvisionsEncaissees -
        totalProvisions,
        0,
      );

    // ============================================================
    // FRAIS D'OUVERTURE DEJA ENCAISSES
    //
    // Ils restent indépendants des provisions.
    // ============================================================

    const totalFraisOuvertureEncaisse =
      dossier.fraisOuverture?.statut ===
        'PAYE'
        ? Number(
          dossier
            .fraisOuverture
            .montant,
        )
        : 0;

    // ============================================================
    // TOTAL REGLE SUR LES FACTURES
    //
    // IMPORTANT :
    //
    // On ne prend PAS toutes les provisions encaissées.
    // On prend uniquement :
    //
    // paiements
    // + provisions imputées
    // + provisions legacy déjà affectées
    // ============================================================

    const totalRegleFactures =
      totalPaiements +
      totalProvisions;

    // ============================================================
    // TOTAL ENCAISSE HORS FRAIS D'OUVERTURE
    //
    // Ici on parle réellement de trésorerie reçue.
    // ============================================================

    const totalEncaisse =
      totalPaiements +
      totalProvisionsEncaissees;

    // ============================================================
    // TOTAL ENCAISSE GLOBAL DU DOSSIER
    // ============================================================

    const totalEncaisseGlobal =
      totalEncaisse +
      totalFraisOuvertureEncaisse;

    // ============================================================
    // RESTE A PAYER SUR LES FACTURES
    // ============================================================

    const resteAPayer =
      Math.max(
        totalFacture -
        totalRegleFactures,
        0,
      );

    // ============================================================
    // TROP-PERCU SUR LES FACTURES
    //
    // Une provision non imputée n'est PAS un trop-perçu
    // de facture.
    // ============================================================

    const tropPercu =
      Math.max(
        totalRegleFactures -
        totalFacture,
        0,
      );

    // ============================================================
    // HISTORIQUE DES OPERATIONS
    // ============================================================

    const operations = [
      // ----------------------------------------------------------
      // PAIEMENTS
      // ----------------------------------------------------------

      ...dossier.factures.flatMap(
        (
          facture,
        ) =>
          facture.paiements.map(
            (
              paiement,
            ) => ({
              id:
                paiement.id,

              type:
                'PAIEMENT' as const,

              date:
                paiement
                  .datePaiement,

              montant:
                Number(
                  paiement.montant,
                ),

              moyenPaiement:
                paiement
                  .moyenPaiement,

              note:
                paiement.note,

              facture: {
                id:
                  facture.id,

                numero:
                  facture.numero,

                montantTTC:
                  Number(
                    facture
                      .montantTTC,
                  ),
              },

              recu:
                null,
            }),
          ),
      ),

      // ----------------------------------------------------------
      // PROVISIONS
      // ----------------------------------------------------------

      ...dossier.provisions.map(
        (
          provision,
        ) => {
          const montant =
            Number(
              provision.montant,
            );

          const montantImpute =
            provision.imputations.reduce(
              (
                total,
                imputation,
              ) =>
                total +
                Number(
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
            id:
              provision.id,

            type:
              'PROVISION' as const,

            date:
              provision
                .datePaiement,

            montant,

            moyenPaiement:
              provision
                .mouvementFinance
                ?.moyenPaiement ??
              provision
                .moyenPaiement ??
              null,

            note:
              provision.note,

            facture:
              null,

            recu:
              provision
                .mouvementFinance
                ?.recuEncaissement ??
              null,

            montantImpute,

            montantDisponible,
          };
        },
      ),

      // ----------------------------------------------------------
      // FRAIS D'OUVERTURE
      // ----------------------------------------------------------

      ...(dossier.fraisOuverture &&
        dossier.fraisOuverture.statut ===
        'PAYE'
        ? [
          {
            id:
              dossier
                .fraisOuverture
                .id,

            type:
              'FRAIS_OUVERTURE' as const,

            date:
              dossier
                .fraisOuverture
                .datePaiement ??
              dossier
                .fraisOuverture
                .createdAt,

            montant:
              Number(
                dossier
                  .fraisOuverture
                  .montant,
              ),

            moyenPaiement:
              dossier
                .fraisOuverture
                .mouvementFinance
                ?.moyenPaiement ??
              null,

            note:
              dossier
                .fraisOuverture
                .mouvementFinance
                ?.description ??
              null,

            facture:
              null,

            recu:
              dossier
                .fraisOuverture
                .mouvementFinance
                ?.recuEncaissement ??
              null,

            montantImpute:
              undefined,

            montantDisponible:
              undefined,
          },
        ]
        : []),
    ].sort(
      (
        a,
        b,
      ) =>
        new Date(
          a.date,
        ).getTime() -
        new Date(
          b.date,
        ).getTime(),
    );

    // ============================================================
    // RETOUR
    // ============================================================

    return {
      dossier: {
        id:
          dossier.id,

        reference:
          dossier.reference,

        client:
          dossier.client,
      },

      totalFacture,

      totalPaiements,

      /**
       * Pour compatibilité frontend :
       * totalProvisions représente maintenant
       * ce qui est réellement imputé aux factures.
       */
      totalProvisions,

      totalProvisionsEncaissees,

      totalProvisionsImputees,

      totalProvisionsLegacy,

      totalProvisionsDisponibles,

      totalFraisOuvertureEncaisse,

      /**
       * Paiements + toutes les provisions encaissées.
       */
      totalEncaisse,

      /**
       * Paiements + provisions encaissées
       * + frais d'ouverture payés.
       */
      totalEncaisseGlobal,

      /**
       * Somme réellement affectée aux factures.
       */
      totalRegleFactures,

      resteAPayer,

      tropPercu,

      operations,
    };
  }

  // ============================================================
  // DETAIL D'UN DOSSIER
  // ============================================================

  async findOne(
    id: string,
  ) {
    const dossier =
      await this.prisma.dossier.findUnique({
        where: {
          id,
        },

        include: {
          client: true,

          avocatResponsable: true,

          collaborateurs: {
            include: {
              user: true,
            },
          },

          evenements: {
            orderBy: {
              start: 'asc',
            },
          },

          fraisOuverture: {
            include: {
              // Relation conservée uniquement pour
              // les anciennes données.
              facture: true,

              mouvementFinance: {
                include: {
                  caisse: true,

                  recuEncaissement: true,
                },
              },
            },
          },

          recusEncaissement: {
            orderBy: {
              dateEmission: 'desc',
            },
          },

          factures: {
            orderBy: {
              dateEmission: 'asc',
            },

            include: {
              lignes: true,

              paiements: {
                orderBy: {
                  datePaiement: 'asc',
                },
              },
            },
          },

          provisions: {
            orderBy: {
              datePaiement: 'asc',
            },
          },
        },
      });

    if (!dossier) {
      throw new NotFoundException(
        'Dossier introuvable.',
      );
    }

    return dossier;
  }

  // ============================================================
  // GENERATION REFERENCE DOSSIER
  // ============================================================

  private async generateReference() {
    const year =
      new Date().getFullYear();

    const count =
      await this.prisma.dossier.count({
        where: {
          reference: {
            startsWith:
              `${year}-`,
          },
        },
      });

    return `${year}-${String(
      count + 1,
    ).padStart(
      3,
      '0',
    )}`;
  }

  // ============================================================
  // CREATION
  // ============================================================

  async create(
    dto: CreateDossierDto,
    userId: string,
  ) {

    console.log(
      '========== CREATE DOSSIER ==========',
    );

    console.log(
      'MONTANT RECU PAR NEST =',
      dto.montantFraisOuverture,
    );

    console.log(
      'TYPE MONTANT =',
      typeof dto.montantFraisOuverture,
    );

    console.log(
      'FRAIS REGLES =',
      dto.fraisOuvertureRegles,
    );

    console.log(
      '=====================================',
    );
    // ============================================================
    // VALIDATION MONTANT
    // ============================================================

    if (
      !Number.isFinite(
        dto.montantFraisOuverture,
      ) ||
      dto.montantFraisOuverture <=
      0
    ) {
      throw new BadRequestException(
        'Le montant des frais d’ouverture doit être supérieur à zéro.',
      );
    }

    // ============================================================
    // DATE DU PAIEMENT
    // ============================================================

    let datePaiement:
      Date | null =
      null;

    if (
      dto.fraisOuvertureRegles
    ) {
      datePaiement =
        dto.datePaiementFraisOuverture
          ? new Date(
            dto
              .datePaiementFraisOuverture,
          )
          : new Date();

      if (
        Number.isNaN(
          datePaiement.getTime(),
        )
      ) {
        throw new BadRequestException(
          'La date de paiement des frais d’ouverture est invalide.',
        );
      }
    }

    // ============================================================
    // REFERENCE DOSSIER
    // ============================================================

    const reference =
      await this.generateReference();

    // ============================================================
    // TRANSACTION
    // ============================================================

    const dossier =
      await this.prisma.$transaction(
        async (tx) => {
          // ======================================================
          // CLIENT
          // ======================================================

          const client =
            await tx.client.findUnique({
              where: {
                id:
                  dto.clientId,
              },
            });

          if (!client) {
            throw new NotFoundException(
              'Client introuvable.',
            );
          }

          // ======================================================
          // AVOCAT RESPONSABLE
          // ======================================================

          const avocatResponsable =
            await tx.user.findUnique({
              where: {
                id:
                  dto
                    .avocatResponsableId,
              },
            });

          if (
            !avocatResponsable
          ) {
            throw new NotFoundException(
              'Avocat responsable introuvable.',
            );
          }

          // ======================================================
          // COMPTE + MOYEN DE PAIEMENT
          // ======================================================

          let caisse:
            | {
              id: string;
              nom: string;
              type: string;
              active: boolean;
              devise: string;
              institution:
              | string
              | null;
              moyensOperation:
              MoyenOperationCompte[];
            }
            | null =
            null;

          let moyenPaiement:
            | MoyenOperationCompte
            | null =
            null;

          if (
            dto.fraisOuvertureRegles
          ) {
            if (
              !dto.caisseIdFraisOuverture
            ) {
              throw new BadRequestException(
                'Le compte d’encaissement est obligatoire lorsque les frais d’ouverture sont réglés.',
              );
            }

            if (
              !dto.moyenPaiementFraisOuverture
            ) {
              throw new BadRequestException(
                'Le moyen de paiement est obligatoire lorsque les frais d’ouverture sont réglés.',
              );
            }

            moyenPaiement =
              dto
                .moyenPaiementFraisOuverture;

            // Les anciennes valeurs sont conservées
            // uniquement pour la migration.
            // Elles ne sont plus acceptées pour
            // de nouveaux encaissements.
            if (
              moyenPaiement ===
              MoyenOperationCompte.CARTE ||
              moyenPaiement ===
              MoyenOperationCompte.MOBILE_MONEY
            ) {
              throw new BadRequestException(
                'Ce moyen de paiement est une ancienne valeur et ne peut plus être utilisé pour un nouvel encaissement.',
              );
            }

            caisse =
              await tx.caisse.findUnique({
                where: {
                  id:
                    dto
                      .caisseIdFraisOuverture,
                },

                select: {
                  id: true,

                  nom: true,

                  type: true,

                  active: true,

                  devise: true,

                  institution: true,

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
            // MOYENS MODERNES CONFIGURES SUR LE COMPTE
            // ====================================================

            const moyensModernes =
              caisse.moyensOperation.filter(
                (
                  moyen,
                ) =>
                  moyen !==
                  MoyenOperationCompte.CARTE &&
                  moyen !==
                  MoyenOperationCompte.MOBILE_MONEY,
              );

            let moyensAutorises =
              moyensModernes;

            // ====================================================
            // COMPATIBILITE PAR DEFAUT
            //
            // Utile pendant la transition des anciens comptes.
            // ====================================================

            if (
              moyensAutorises.length ===
              0
            ) {
              switch (
              caisse.type
              ) {
                case 'BANCAIRE':
                  moyensAutorises =
                    [
                      MoyenOperationCompte.VIREMENT,
                      MoyenOperationCompte.CHEQUE,
                    ];
                  break;

                case 'MOBILE_MONEY':
                  moyensAutorises =
                    [
                      MoyenOperationCompte.ORANGE_MONEY,
                      MoyenOperationCompte.WAVE,
                      MoyenOperationCompte.MTN_MONEY,
                      MoyenOperationCompte.MOOV_MONEY,
                    ];
                  break;

                case 'CARTE_BANCAIRE':
                  moyensAutorises =
                    [
                      MoyenOperationCompte.PAIEMENT_CARTE,
                    ];
                  break;

                case 'ESPECES':
                  moyensAutorises =
                    [
                      MoyenOperationCompte.ESPECES,
                    ];
                  break;

                default:
                  moyensAutorises =
                    [];
              }
            }

            if (
              !moyensAutorises.includes(
                moyenPaiement,
              )
            ) {
              throw new BadRequestException(
                `Le moyen de paiement ${moyenPaiement} n’est pas autorisé pour le compte sélectionné.`,
              );
            }
          }

          // ======================================================
          // CREATION DOSSIER
          // ======================================================

          const createdDossier =
            await tx.dossier.create({
              data: {
                reference,

                natureAffaire:
                  dto.natureAffaire,

                typeDossier:
                  dto.typeDossier,

                statut:
                  dto.statut,

                clientId:
                  dto.clientId,

                avocatResponsableId:
                  dto
                    .avocatResponsableId,

                avocatClientNom:
                  dto.avocatClientNom
                    ?.trim() ||
                  null,

                avocatClientEmail:
                  dto.avocatClientEmail
                    ?.trim() ||
                  null,

                avocatClientTelephone:
                  dto.avocatClientTelephone
                    ?.trim() ||
                  null,

                juridiction:
                  dto.juridiction
                    ?.trim() ||
                  null,

                partieAdverse:
                  dto.partieAdverse
                    ?.trim() ||
                  null,

                kycSoupcon:
                  dto.kycSoupcon,

                declarationSoupcon:
                  dto.kycSoupcon
                    ? dto
                      .declarationSoupcon
                      ?.trim() ||
                    null
                    : null,

                collaborateurs: {
                  create: (
                    dto.collaborateurIds ??
                    []
                  ).map(
                    (
                      collaborateurId,
                    ) => ({
                      userId:
                        collaborateurId,
                    }),
                  ),
                },
              },
            });

          // ======================================================
          // FRAIS NON REGLES
          // ======================================================

          if (
            !dto.fraisOuvertureRegles
          ) {
            await tx
              .fraisOuvertureDossier
              .create({
                data: {
                  dossierId:
                    createdDossier.id,

                  montant:
                    dto
                      .montantFraisOuverture,

                  statut:
                    'A_PAYER',

                  datePaiement:
                    null,

                  mouvementFinanceId:
                    null,

                  // Legacy
                  factureId:
                    null,
                },
              });

            return tx.dossier
              .findUniqueOrThrow({
                where: {
                  id:
                    createdDossier.id,
                },

                include: {
                  client: true,

                  avocatResponsable:
                    true,

                  collaborateurs: {
                    include: {
                      user: true,
                    },
                  },

                  fraisOuverture: {
                    include: {
                      mouvementFinance: {
                        include: {
                          caisse:
                            true,

                          recuEncaissement:
                            true,
                        },
                      },

                      // Legacy
                      facture:
                        true,
                    },
                  },
                },
              });
          }

          // ======================================================
          // FRAIS DEJA REGLES
          // ======================================================

          const montant =
            dto.montantFraisOuverture;

          // ======================================================
          // NUMERO DU RECU
          // ======================================================

          const receiptYear =
            datePaiement!.getFullYear();

          const receiptCount =
            await tx
              .recuEncaissement
              .count({
                where: {
                  numero: {
                    startsWith:
                      `REC-${receiptYear}-`,
                  },
                },
              });

          const numeroRecu =
            `REC-${receiptYear}-${String(
              receiptCount + 1,
            ).padStart(
              4,
              '0',
            )}`;

          // ======================================================
          // MOUVEMENT FINANCE
          // ======================================================

          const mouvement =
            await tx
              .mouvementFinance
              .create({
                data: {
                  type:
                    'ENTREE',

                  montant,

                  categorie:
                    'FRAIS_OUVERTURE_DOSSIER',

                  source:
                    'FRAIS_OUVERTURE_DOSSIER',

                  sourceLibelle:
                    `Frais d'ouverture du dossier ${reference}`,

                  // Le reçu devient la référence
                  // métier interne du mouvement.
                  sourceReference:
                    numeroRecu,

                  tiers:
                    client.nom,

                  description:
                    `Encaissement des frais d'ouverture du dossier ${reference}`,

                  reference:
                    dto
                      .referencePaiementFraisOuverture
                      ?.trim() ||
                    null,

                  date:
                    datePaiement!,

                  caisseId:
                    caisse!.id,

                  moyenPaiement:
                    moyenPaiement!,

                  userId,

                  dossierId:
                    createdDossier.id,
                },
              });

          // ======================================================
          // FRAIS D'OUVERTURE
          // ======================================================

          await tx
            .fraisOuvertureDossier
            .create({
              data: {
                dossierId:
                  createdDossier.id,

                montant,

                statut:
                  'PAYE',

                datePaiement:
                  datePaiement!,

                mouvementFinanceId:
                  mouvement.id,

                // Legacy :
                // plus aucune facture créée.
                factureId:
                  null,
              },
            });

          // ======================================================
          // LIBELLE DU COMPTE
          // ======================================================

          const compteLibelle =
            caisse!.institution
              ? `${caisse!.nom} - ${caisse!.institution}`
              : caisse!.nom;

          // ======================================================
          // RECU
          // ======================================================

          await tx
            .recuEncaissement
            .create({
              data: {
                numero:
                  numeroRecu,

                type:
                  'FRAIS_OUVERTURE_DOSSIER',

                montant,

                dateEmission:
                  datePaiement!,

                recuDe:
                  client.nom,

                compteLibelle,

                moyenPaiement:
                  moyenPaiement!,

                referencePaiement:
                  dto
                    .referencePaiementFraisOuverture
                    ?.trim() ||
                  null,

                objet:
                  `Frais d'ouverture du dossier ${reference}`,

                note:
                  null,

                dossierId:
                  createdDossier.id,

                mouvementFinanceId:
                  mouvement.id,

                createdById:
                  userId,
              },
            });

          // ======================================================
          // RETOUR
          // ======================================================

          return tx.dossier
            .findUniqueOrThrow({
              where: {
                id:
                  createdDossier.id,
              },

              include: {
                client:
                  true,

                avocatResponsable:
                  true,

                collaborateurs: {
                  include: {
                    user:
                      true,
                  },
                },

                fraisOuverture: {
                  include: {
                    mouvementFinance: {
                      include: {
                        caisse:
                          true,

                        recuEncaissement:
                          true,
                      },
                    },

                    // Legacy uniquement.
                    facture:
                      true,
                  },
                },

                recusEncaissement:
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
    // JOURNAL D'ACTIVITE
    // ============================================================

    await this.activityLog.log({
      userId,

      action:
        'DOSSIER_CREE',

      entityType:
        'Dossier',

      entityId:
        dossier.id,

      dossierId:
        dossier.id,

      metadata: {
        reference:
          dossier.reference,

        montantFraisOuverture:
          dto
            .montantFraisOuverture,

        fraisOuvertureRegles:
          dto
            .fraisOuvertureRegles,

        caisseIdFraisOuverture:
          dto.fraisOuvertureRegles
            ? dto
              .caisseIdFraisOuverture
            : null,

        moyenPaiementFraisOuverture:
          dto.fraisOuvertureRegles
            ? dto
              .moyenPaiementFraisOuverture
            : null,
      },
    });

    return dossier;
  }

  // ============================================================
  // MODIFICATION
  // ============================================================

  async update(
    id: string,
    dto: UpdateDossierDto,
    userId: string,
  ) {
    await this.findOne(
      id,
    );

    const dossier =
      await this.prisma.$transaction(
        async (tx) => {
          await tx
            .dossierCollaborateur
            .deleteMany({
              where: {
                dossierId:
                  id,
              },
            });

          return tx.dossier
            .update({
              where: {
                id,
              },

              data: {
                natureAffaire:
                  dto.natureAffaire,

                typeDossier:
                  dto.typeDossier,

                statut:
                  dto.statut,

                dateCloture:
                  dto.statut ===
                    'CLOTURE'
                    ? new Date()
                    : dto.statut
                      ? null
                      : undefined,

                clientId:
                  dto.clientId,

                avocatResponsableId:
                  dto
                    .avocatResponsableId,

                avocatClientNom:
                  dto.avocatClientNom ||
                  null,

                avocatClientEmail:
                  dto.avocatClientEmail ||
                  null,

                avocatClientTelephone:
                  dto.avocatClientTelephone ||
                  null,

                juridiction:
                  dto.juridiction ||
                  null,

                partieAdverse:
                  dto.partieAdverse ||
                  null,

                kycSoupcon:
                  dto.kycSoupcon ??
                  false,

                declarationSoupcon:
                  dto.kycSoupcon
                    ? dto
                      .declarationSoupcon ||
                    null
                    : null,

                collaborateurs: {
                  create: (
                    dto.collaborateurIds ??
                    []
                  ).map(
                    (
                      collaboratorId,
                    ) => ({
                      userId:
                        collaboratorId,
                    }),
                  ),
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

    await this.activityLog.log({
      userId,

      action:
        'DOSSIER_MODIFIE',

      entityType:
        'Dossier',

      entityId:
        dossier.id,

      dossierId:
        dossier.id,

      metadata: {
        reference:
          dossier.reference,
      },
    });

    return dossier;
  }

  // ============================================================
  // LISTE DES FRAIS D'OUVERTURE
  // ============================================================

  async findFraisOuverture() {
    const frais =
      await this.prisma
        .fraisOuvertureDossier
        .findMany({
          orderBy: {
            createdAt:
              'desc',
          },

          include: {
            dossier: {
              include: {
                client:
                  true,

                avocatResponsable: {
                  select: {
                    id:
                      true,

                    name:
                      true,

                    email:
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

            // ====================================================
            // LEGACY
            // ====================================================

            facture: {
              select: {
                id:
                  true,

                numero:
                  true,

                statut:
                  true,

                montantTTC:
                  true,

                dateEmission:
                  true,
              },
            },
          },
        });

    const items =
      frais.map(
        (item) => ({
          id:
            item.id,

          montant:
            Number(
              item.montant,
            ),

          statut:
            item.statut,

          statutAffichage:
            item.statut ===
              'PAYE'
              ? 'PAYE'
              : 'IMPAYE',

          datePaiement:
            item.datePaiement,

          createdAt:
            item.createdAt,

          dossier: {
            id:
              item
                .dossier.id,

            reference:
              item
                .dossier
                .reference,

            natureAffaire:
              item
                .dossier
                .natureAffaire,

            statut:
              item
                .dossier
                .statut,

            client: {
              id:
                item
                  .dossier
                  .client.id,

              nom:
                item
                  .dossier
                  .client.nom,

              type:
                item
                  .dossier
                  .client.type,
            },

            avocatResponsable:
              item
                .dossier
                .avocatResponsable,
          },

          encaissement:
            item
              .mouvementFinance
              ? {
                id:
                  item
                    .mouvementFinance
                    .id,

                moyenPaiement:
                  item
                    .mouvementFinance
                    .moyenPaiement,

                reference:
                  item
                    .mouvementFinance
                    .reference,

                compte: {
                  id:
                    item
                      .mouvementFinance
                      .caisse.id,

                  nom:
                    item
                      .mouvementFinance
                      .caisse.nom,

                  type:
                    item
                      .mouvementFinance
                      .caisse.type,
                },

                recu:
                  item
                    .mouvementFinance
                    .recuEncaissement,
              }
              : null,

          // Anciennes données seulement
          facture:
            item.facture
              ? {
                id:
                  item
                    .facture.id,

                numero:
                  item
                    .facture.numero,

                statut:
                  item
                    .facture.statut,

                montantTTC:
                  Number(
                    item
                      .facture
                      .montantTTC,
                  ),

                dateEmission:
                  item
                    .facture
                    .dateEmission,
              }
              : null,
        }),
      );

    // ============================================================
    // RESUME
    // ============================================================

    const montantTotal =
      items.reduce(
        (
          total,
          item,
        ) =>
          total +
          item.montant,
        0,
      );

    const montantEncaisse =
      items
        .filter(
          (item) =>
            item.statut ===
            'PAYE',
        )
        .reduce(
          (
            total,
            item,
          ) =>
            total +
            item.montant,
          0,
        );

    const montantImpayes =
      items
        .filter(
          (item) =>
            item.statut !==
            'PAYE',
        )
        .reduce(
          (
            total,
            item,
          ) =>
            total +
            item.montant,
          0,
        );

    const nombrePayes =
      items.filter(
        (item) =>
          item.statut ===
          'PAYE',
      ).length;

    const nombreImpayes =
      items.filter(
        (item) =>
          item.statut !==
          'PAYE',
      ).length;

    return {
      resume: {
        montantTotal,

        montantEncaisse,

        montantImpayes,

        nombreTotal:
          items.length,

        nombrePayes,

        nombreImpayes,
      },

      items,
    };
  }

  // ============================================================
  // ARCHIVAGE
  // ============================================================

  async archive(
    id: string,
    userId: string,
  ) {
    const dossier =
      await this.findOne(
        id,
      );

    if (
      dossier.statut !==
      'CLOTURE'
    ) {
      throw new BadRequestException(
        'Seul un dossier clôturé peut être archivé.',
      );
    }

    if (
      dossier.archive
    ) {
      return dossier;
    }

    const archivedDossier =
      await this.prisma
        .dossier.update({
          where: {
            id,
          },

          data: {
            archive:
              true,

            archivedAt:
              new Date(),
          },
        });

    await this.activityLog.log({
      userId,

      action:
        'DOSSIER_ARCHIVE',

      entityType:
        'Dossier',

      entityId:
        archivedDossier.id,

      dossierId:
        archivedDossier.id,

      metadata: {
        reference:
          archivedDossier.reference,
      },
    });

    return archivedDossier;
  }

  // ============================================================
  // DESARCHIVAGE
  // ============================================================

  async unarchive(
    id: string,
    userId: string,
  ) {
    const dossier =
      await this.findOne(
        id,
      );

    if (
      !dossier.archive
    ) {
      return dossier;
    }

    const unarchivedDossier =
      await this.prisma
        .dossier.update({
          where: {
            id,
          },

          data: {
            archive:
              false,

            archivedAt:
              null,
          },
        });

    await this.activityLog.log({
      userId,

      action:
        'DOSSIER_DESARCHIVE',

      entityType:
        'Dossier',

      entityId:
        unarchivedDossier.id,

      dossierId:
        unarchivedDossier.id,

      metadata: {
        reference:
          unarchivedDossier.reference,
      },
    });

    return unarchivedDossier;
  }
}
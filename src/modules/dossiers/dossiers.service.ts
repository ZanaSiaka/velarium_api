import { isTreasuryConflict, lockTreasuryAccounts } from '../../common/finance/treasury';
import { allocateBillingNumber, BILLING_CASH_INCLUDE } from '../../common/finance/billing';
import { DOSSIER_PUBLIC_SELECT, DOSSIER_REFERENCE_SELECT } from '../../common/dossier-projections';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import {
  MoyenOperationCompte,
  Role,
  Prisma,
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

import { validateSync } from 'class-validator';
import { hasKycDeclaration } from './dto/kyc-declaration.validator';

import { FinancePermissionService } from '../finance/finance-permission.service';

import { readDossierFinance } from './dossier-finance-read';

@Injectable()
export class DossiersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly financePermissions: FinancePermissionService,
  ) { }

  // ============================================================
  // LISTE DES DOSSIERS
  // ============================================================

  private async viewer(userId?: string) {
    if (!userId) throw new UnauthorizedException('Authentification requise.');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, active: true } });
    if (!user?.active) throw new UnauthorizedException('Compte absent ou inactif.');
    return user;
  }

  private async listDossiers(archive: boolean, userId?: string) {
    const user = await this.viewer(userId);
    const canFinance = this.financePermissions.canViewFinance(user.role);
    const rows = await this.prisma.dossier.findMany({
      where: { archive }, orderBy: archive ? { archivedAt: 'desc' } : { createdAt: 'desc' },
      select: {
        ...DOSSIER_PUBLIC_SELECT,
        client: { select: { id: true, nom: true, type: true } },
        avocatResponsable: { select: { id: true, name: true } },
        ...(canFinance ? { fraisOuverture: { select: { id: true, montant: true, statut: true, datePaiement: true, factureId: true } } } : {}),
      },
    });
    // No KYC in list responses, including for lawyers.
    return rows.map(row => ({ ...row, ...(canFinance ? { fraisOuverture: row.fraisOuverture ? {
      ...row.fraisOuverture, montant: Number(row.fraisOuverture.montant), statutAffichage: row.fraisOuverture.statut === 'PAYE' ? 'PAYE' : 'IMPAYE',
    } : null } : {}) }));
  }

  findAll(userId?: string) { return this.listDossiers(false, userId); }
  findArchived(userId?: string) { return this.listDossiers(true, userId); }

  // ============================================================
  // LIVRE DES PAIEMENTS
  // ============================================================

  async getLivrePaiements(
    id: string,
    role?: Role,
  ) {
    this.financePermissions.require(!!role && this.financePermissions.canViewFinance(role), 'Accès financier non autorisé.');
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
                include: BILLING_CASH_INCLUDE,
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
              lignes: true,
              paiements: {
                include: { mouvementFinance: { include: BILLING_CASH_INCLUDE } },
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
                include: BILLING_CASH_INCLUDE,
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

    const consolidation = readDossierFinance(dossier);
    const operations = [
      ...consolidation.factures.flatMap(facture => facture.paiements.map(payment => ({
        ...payment, type: 'PAIEMENT' as const,
      }))),
      ...consolidation.provisions.map(provision => ({
        ...provision, type: 'PROVISION' as const, montant: provision.montantInitial, facture: null,
      })),
      ...(dossier.fraisOuverture?.statut === 'PAYE' ? [{
        id: dossier.fraisOuverture.id, type: 'FRAIS_OUVERTURE' as const,
        date: dossier.fraisOuverture.datePaiement ?? dossier.fraisOuverture.createdAt,
        montant: consolidation.fraisOuverture?.montant ?? null,
        devise: consolidation.fraisOuverture?.devise ?? null,
        moyenPaiement: dossier.fraisOuverture.mouvementFinance?.moyenPaiement ?? null,
        note: dossier.fraisOuverture.mouvementFinance?.description ?? null,
        facture: null, recu: consolidation.fraisOuverture?.recu ?? null,
      }] : []),
    ].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
    // Keep the historical numeric envelope for existing consumers. The versioned
    // consolidation contains exact decimals and is the source used by the dossier UI.
    const legacyNumber = (amount: string | null) => amount === null ? null : Number(amount);
    const legacyMontants = {
      totalFacture: legacyNumber(consolidation.montants.totalFacture),
      totalPaiements: legacyNumber(consolidation.montants.totalPaiements),
      totalProvisions: legacyNumber(consolidation.montants.totalProvisions),
      totalProvisionsEncaissees: legacyNumber(consolidation.montants.totalProvisionsEncaissees),
      totalProvisionsImputees: legacyNumber(consolidation.montants.totalProvisionsImputees),
      totalProvisionsLegacy: legacyNumber(consolidation.montants.totalProvisionsLegacy),
      totalProvisionsDisponibles: legacyNumber(consolidation.montants.totalProvisionsDisponibles),
      totalRegleFactures: legacyNumber(consolidation.montants.totalRegleFactures),
      totalFraisOuvertureEncaisse: legacyNumber(consolidation.montants.totalFraisOuvertureEncaisse),
      totalEncaisse: legacyNumber(consolidation.montants.totalEncaisse),
      totalEncaisseGlobal: legacyNumber(consolidation.montants.totalEncaisseGlobal),
      resteAPayer: legacyNumber(consolidation.montants.resteAPayer),
      tropPercu: legacyNumber(consolidation.montants.tropPercu),
    };
    return {
      dossier: { id: dossier.id, reference: dossier.reference, client: dossier.client },
      ...legacyMontants, consolidation,
      operations: operations.map(operation => ({ ...operation, montant: legacyNumber(operation.montant) })),
    };
  }

  // ============================================================
  // DETAIL D'UN DOSSIER
  // ============================================================

  async findOne(id: string, userId?: string) {
    // Internal D1 existence checks receive a safe projection, never privileged KYC.
    const canKyc = userId ? (await this.viewer(userId)).role === Role.AVOCAT : false;
    const dossier = await this.prisma.dossier.findUnique({
      where: { id },
      select: {
        ...DOSSIER_PUBLIC_SELECT,
        ...(canKyc ? { kycSoupcon: true, declarationSoupcon: true } : {}),
        client: { select: { id: true, nom: true, type: true, email: true, telephone: true, adresse: true, numeroContribuable: true } },
        avocatResponsable: { select: { id: true, name: true } },
        collaborateurs: { select: { id: true, userId: true, user: { select: { id: true, name: true } } } },
      },
    });
    if (!dossier) throw new NotFoundException('Dossier introuvable.');
    return dossier;
  }

  // ============================================================
  // GENERATION REFERENCE DOSSIER
  // ============================================================

  private async generateReference(tx: Prisma.TransactionClient) {
    const prefix = `${new Date().getFullYear()}-`;
    let sequence = await tx.dossier.count({ where: { reference: { startsWith: prefix } } }) + 1;
    // Keep count-based numbering; skip an occupied historical candidate after gaps.
    while (true) {
      const reference = prefix + String(sequence).padStart(3, '0');
      if (!await tx.dossier.findUnique({ where: { reference }, select: { id: true } })) return reference;
      sequence++;
    }
  }

  private async generateReceiptNumber(tx: Prisma.TransactionClient, year: number) {
    return allocateBillingNumber(tx, 'REC', year);
  }

  private isNumberingConflict(error: unknown): boolean {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') return false;
    const meta = 'meta' in error && error.meta && typeof error.meta === 'object'
      ? error.meta as { modelName?: unknown; target?: unknown } : {};
    if (typeof meta.modelName === 'string' && !['Dossier', 'RecuEncaissement'].includes(meta.modelName)) return false;
    const targets = Array.isArray(meta.target) ? meta.target : typeof meta.target === 'string' ? [meta.target] : [];
    return targets.some(target => typeof target === 'string' && /(^reference$|^numero$|Dossier_reference_key|RecuEncaissement_numero_key)/.test(target))
      || (targets.length === 0 && ['Dossier', 'RecuEncaissement'].includes(String(meta.modelName)));
  }

  private async dossierTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, retryNumbering = false): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(work, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 20_000 });
      } catch (error) {
        const serializationConflict = isTreasuryConflict(error);
        if (!serializationConflict && !(retryNumbering && this.isNumberingConflict(error))) throw error;
        if (attempt === 2) throw new ConflictException('Le dossier a été modifié ou créé simultanément. Veuillez réessayer.');
      }
    }
    throw new ConflictException('Veuillez réessayer cette opération.');
  }

  // ============================================================
  // CREATION
  // ============================================================

  async create(
    dto: CreateDossierDto,
    userId: string,
  ) {

    if (dto.fraisOuvertureRegles !== true) {
      throw new BadRequestException(
        'Les frais d’ouverture doivent être réglés et encaissés lors de la création du dossier.',
      );
    }

    if (dto.kycSoupcon === true && !hasKycDeclaration(dto.declarationSoupcon)) {
      throw new BadRequestException('La déclaration du soupçon est obligatoire lorsque le soupçon est actif.');
    }

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
    // TRANSACTION
    // ============================================================

    const dossier =
      await this.dossierTransaction(
        async (tx) => {
          // Apply the same account and movement permissions as the Finance module.
          const encaisseur = await tx.user.findUnique({ where: { id: userId } });
          if (!encaisseur?.active) {
            throw new ForbiddenException('Utilisateur d’encaissement absent ou inactif.');
          }
          this.financePermissions.require(
            this.financePermissions.canViewCaisses(encaisseur.role) &&
            this.financePermissions.canCreateMouvement(encaisseur.role),
            'Vous n’avez pas les permissions nécessaires pour encaisser les frais d’ouverture.',
          );

          if (encaisseur.role !== Role.AVOCAT && (dto.kycSoupcon === true || dto.declarationSoupcon !== undefined)) {
            throw new ForbiddenException('Informations KYC réservées aux avocats actifs.');
          }

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

          if (!avocatResponsable.active) {
            throw new BadRequestException('Avocat responsable inactif.');
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

            await lockTreasuryAccounts(tx, [dto.caisseIdFraisOuverture]);
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

          const collaborateurIds = await this.validateCollaborateurs(
            tx, dto.collaborateurIds === undefined ? [] : dto.collaborateurIds,
          );

          const reference = await this.generateReference(tx);

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

                dateCloture: dto.statut === 'CLOTURE' ? new Date() : null,

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
                  dto.kycSoupcon ?? false,

                declarationSoupcon:
                  dto.kycSoupcon
                    ? dto
                      .declarationSoupcon
                      ?.trim() ||
                    null
                    : null,

                collaborateurs: {
                  create: (
                    collaborateurIds
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

                  avocatResponsable: { select: { id: true, name: true } },

                  collaborateurs: {
                    include: {
                      user: { select: { id: true, name: true } },
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

          const numeroRecu = await this.generateReceiptNumber(tx, receiptYear);

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

          await this.activityLog.log({ userId, action: 'FRAIS_OUVERTURE_ENCAISSES', entityType: 'MouvementFinance',
            entityId: mouvement.id, dossierId: createdDossier.id,
            metadata: { montantExact: montant.toFixed(2), devise: caisse!.devise, caisseId: caisse!.id,
              dateMetier: datePaiement!.toISOString(), moyenPaiement: moyenPaiement!, numeroRecu },
          }, tx);
          return tx.dossier
            .findUniqueOrThrow({
              where: {
                id:
                  createdDossier.id,
              },

              include: {
                client:
                  true,

                avocatResponsable: { select: { id: true, name: true } },

                collaborateurs: {
                  include: {
                    user: { select: { id: true, name: true } },
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

        true,
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

    return this.findOne(dossier.id, userId);
  }

  // ============================================================
  // MODIFICATION
  // ============================================================

  private async validateCollaborateurs(
    tx: Prisma.TransactionClient,
    ids: string[],
  ): Promise<string[]> {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new BadRequestException('Identifiants des collaborateurs invalides.');
    }
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length > 0) {
      const users = await tx.user.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true },
      });
      if (users.length !== uniqueIds.length) {
        throw new NotFoundException('Un ou plusieurs collaborateurs sont introuvables.');
      }
    }
    return uniqueIds;
  }

  async update(
    id: string,
    dto: UpdateDossierDto,
    userId: string,
  ) {
    if (!dto || typeof dto !== 'object' || Array.isArray(dto) ||
        validateSync(Object.assign(new UpdateDossierDto(), dto), { whitelist: true, forbidNonWhitelisted: true }).length) {
      throw new BadRequestException('Données de modification du dossier invalides.');
    }
    for (const field of ['natureAffaire', 'typeDossier', 'clientId', 'avocatResponsableId'] as const) {
      if (dto[field] !== undefined && !dto[field]?.trim()) throw new BadRequestException('Un champ obligatoire ne peut pas être effacé.');
    }
    await this.findOne(id);

    const dossier =
      await this.dossierTransaction(
        async (tx) => {
          if (dto.kycSoupcon !== undefined || dto.declarationSoupcon !== undefined) {
            const actor = await tx.user.findUnique({ where: { id: userId }, select: { active: true, role: true } });
            if (!actor?.active || actor.role !== Role.AVOCAT) throw new ForbiddenException('Informations KYC réservées aux avocats actifs.');
          }
          const current = await tx.dossier.findUniqueOrThrow({
            where: { id },
            select: { statut: true, dateCloture: true, archive: true, kycSoupcon: true, declarationSoupcon: true },
          });
          if (current.archive && dto.statut !== undefined && dto.statut !== 'CLOTURE') {
            throw new BadRequestException('Désarchivez le dossier avant de changer son statut.');
          }
          if (dto.kycSoupcon !== undefined || dto.declarationSoupcon !== undefined) {
            const finalSuspicion = dto.kycSoupcon ?? current.kycSoupcon;
            const finalDeclaration = dto.declarationSoupcon === undefined ? current.declarationSoupcon : dto.declarationSoupcon;
            if (finalSuspicion && !hasKycDeclaration(finalDeclaration)) {
              throw new BadRequestException('La déclaration du soupçon doit rester non vide tant que le soupçon est actif.');
            }
          }
          if (dto.clientId !== undefined && !await tx.client.findUnique({ where: { id: dto.clientId }, select: { id: true } })) {
            throw new NotFoundException('Client introuvable.');
          }

          if (dto.avocatResponsableId !== undefined) {
            if (!dto.avocatResponsableId) {
              throw new BadRequestException('Identifiant de l’avocat responsable invalide.');
            }
            const avocat = await tx.user.findUnique({
              where: { id: dto.avocatResponsableId },
            });
            if (!avocat) {
              throw new NotFoundException('Avocat responsable introuvable.');
            }
            if (!avocat.active) {
              throw new BadRequestException('Avocat responsable inactif.');
            }
          }
          const collaborateurIds = dto.collaborateurIds === undefined
            ? undefined
            : await this.validateCollaborateurs(tx, dto.collaborateurIds);
          if (collaborateurIds !== undefined) {
            await tx
              .dossierCollaborateur
              .deleteMany({
                where: {
                  dossierId:
                    id,
                },
              });
          }

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

                // Existing reopening rule: clear the closure date only on a real transition.
                dateCloture: dto.statut === undefined || dto.statut === current.statut
                  ? undefined : dto.statut === 'CLOTURE' ? new Date() : null,

                clientId:
                  dto.clientId,

                avocatResponsableId:
                  dto
                    .avocatResponsableId,

                avocatClientNom: dto.avocatClientNom === undefined ? undefined : dto.avocatClientNom?.trim() || null,

                avocatClientEmail: dto.avocatClientEmail === undefined ? undefined : dto.avocatClientEmail?.trim() || null,

                avocatClientTelephone:
                  dto.avocatClientTelephone === undefined
                    ? undefined
                    : dto.avocatClientTelephone?.trim() || null,

                juridiction:
                  dto.juridiction === undefined
                    ? undefined
                    : dto.juridiction?.trim() || null,

                partieAdverse:
                  dto.partieAdverse === undefined
                    ? undefined
                    : dto.partieAdverse?.trim() || null,

                kycSoupcon: dto.kycSoupcon,

                declarationSoupcon:
                  dto.declarationSoupcon === undefined
                    ? undefined
                    : dto.declarationSoupcon?.trim() || null,

                collaborateurs: collaborateurIds === undefined
                  ? undefined
                  : {
                    create: collaborateurIds.map((userId) => ({ userId })),
                  },
              },
            });
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

    return this.findOne(dossier.id, userId);
  }

  // ============================================================
  // LISTE DES FRAIS D'OUVERTURE
  // ============================================================

  async findFraisOuverture(role?: Role) {
    this.financePermissions.require(!!role && this.financePermissions.canViewFinance(role) && this.financePermissions.canViewCaisses(role), 'Accès financier refusé.');
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
              select: {
                ...DOSSIER_REFERENCE_SELECT,
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

  async archive(id: string, userId: string) {
    await this.findOne(id);
    const result = await this.dossierTransaction(async tx => {
      const current = await tx.dossier.findUniqueOrThrow({ where: { id } });
      if (current.statut !== 'CLOTURE') throw new BadRequestException('Seul un dossier clôturé peut être archivé.');
      if (current.archive) return { dossier: current, changed: false };
      return { dossier: await tx.dossier.update({ where: { id }, data: { archive: true, archivedAt: new Date() } }), changed: true };
    });
    if (result.changed) await this.activityLog.log({
      userId, action: 'DOSSIER_ARCHIVE', entityType: 'Dossier', entityId: id, dossierId: id,
      metadata: { reference: result.dossier.reference },
    });
    return this.findOne(result.dossier.id, userId);
  }

  async unarchive(id: string, userId: string) {
    await this.findOne(id);
    const result = await this.dossierTransaction(async tx => {
      const current = await tx.dossier.findUniqueOrThrow({ where: { id } });
      if (!current.archive) return { dossier: current, changed: false };
      return { dossier: await tx.dossier.update({ where: { id }, data: { archive: false, archivedAt: null } }), changed: true };
    });
    if (result.changed) await this.activityLog.log({
      userId, action: 'DOSSIER_DESARCHIVE', entityType: 'Dossier', entityId: id, dossierId: id,
      metadata: { reference: result.dossier.reference },
    });
    return this.findOne(result.dossier.id, userId);
  }
}

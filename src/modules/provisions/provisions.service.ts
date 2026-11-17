import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { MoyenOperationCompte, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProvisionDto } from './dto/create-provision.dto';
import { CreateImputationProvisionDto } from './dto/create-imputation-provision.dto';
import { lockTreasuryAccounts, treasuryTransaction } from '../../common/finance/treasury';
import { readProvisionBalance } from '../../common/finance/financial-read';
import { allocateBillingNumber, BILLING_INVOICE_INCLUDE, BILLING_PROVISION_INCLUDE, billingAmount, lockBillingRows, readInvoiceBalance, recognizedCash, resolveInvoiceStatus, serializeBillingProvision } from '../../common/finance/billing';

@Injectable()
export class ProvisionsService {
  constructor(private readonly prisma: PrismaService) {}
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


  async findAll(dossierId?: string) {
    const rows = await this.prisma.provision.findMany({ where: dossierId ? { dossierId } : undefined, orderBy: { datePaiement: 'desc' }, include: BILLING_PROVISION_INCLUDE });
    return rows.map(serializeBillingProvision);
  }

  async create(
    dto: CreateProvisionDto,
    userId: string,
  ) {
    const money = billingAmount(dto.montant);
    // ============================================================
    // VALIDATION MONTANT
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
      await treasuryTransaction(this.prisma,
          async (tx) => {
            await lockTreasuryAccounts(tx, [dto.caisseId]);
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

            const numeroRecu = await allocateBillingNumber(tx, 'REC', datePaiement.getUTCFullYear());

            const mouvement =
              await tx
                .mouvementFinance
                .create({
                  data: {
                    type:
                      'ENTREE',

                    montant:
                      money,

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
                      money,

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
                    money,

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

            await tx.activityLog.create({ data: {
              userId, action: 'PROVISION_ENCAISSEE', entityType: 'Provision', entityId: createdProvision.id, dossierId: dossier.id,
              metadata: { mouvementFinanceId: mouvement.id, montantExact: money.toFixed(2), devise: caisse.devise,
                caisseId: caisse.id, moyenPaiement: dto.moyenPaiement, dateMetier: datePaiement.toISOString(), numeroRecu },
            } });
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

          true,
        );

    // ============================================================
    // NORMALISATION RETOUR
    // ============================================================

    return serializeBillingProvision(provision);
  }


  async createImputation(provisionId: string, dto: CreateImputationProvisionDto, userId: string) {
    const amount = billingAmount(dto.montant);
    return treasuryTransaction(this.prisma, async tx => {
      // No cash entry: invoice first, then provision; never acquire a cash-account lock afterwards.
      await lockBillingRows(tx, 'facture', [dto.factureId]);
      await lockBillingRows(tx, 'provision', [provisionId]);
      const [provision, invoice] = await Promise.all([
        tx.provision.findUnique({ where: { id: provisionId }, include: BILLING_PROVISION_INCLUDE }),
        tx.facture.findUnique({ where: { id: dto.factureId }, include: BILLING_INVOICE_INCLUDE }),
      ]);
      if (!provision || !invoice) throw new NotFoundException('Provision ou facture introuvable.');
      if (invoice.dossierId !== provision.dossierId || invoice.clientId !== provision.dossier.clientId) throw new BadRequestException('La provision et la facture doivent appartenir au même dossier et au même client.');
      const available = readProvisionBalance(provision);
      if (available.montantDisponible === null || recognizedCash(provision.montant, provision.mouvementFinance, provision.dossierId, 'PROVISION') === null) throw new BadRequestException('Cette provision nécessite une vérification de son affectation historique ou de son encaissement avant imputation.');
      if (provision.imputations.some(row => row.factureId === invoice.id)) throw new BadRequestException('Cette provision possède déjà une imputation sur cette facture.');
      const balance = readInvoiceBalance(invoice);
      if (!balance.reglementAutorise || balance.solde === null) throw new BadRequestException('La facture est un brouillon, déjà réglée ou présente une lecture historique ambiguë.');
      if (amount.greaterThan(available.montantDisponible) || amount.greaterThan(balance.solde)) throw new BadRequestException('Le montant dépasse la provision disponible ou le reste à payer de la facture.');
      const imputation = await tx.imputationProvision.create({ data: { provisionId, factureId: invoice.id, montant: amount, createdById: userId },
        include: { createdBy: { select: { id: true, name: true } } } });
      const settled = new Prisma.Decimal(balance.totalRegle!).plus(amount);
      const status = resolveInvoiceStatus(settled.toFixed(2), invoice.montantTTC.toFixed(2), invoice.dateEcheance);
      await tx.facture.update({ where: { id: invoice.id }, data: { statut: status } });
      if (invoice.fraisOuvertureDossier && status === 'PAYEE' && !invoice.fraisOuvertureDossier.mouvementFinanceId) {
        await tx.fraisOuvertureDossier.update({ where: { id: invoice.fraisOuvertureDossier.id }, data: { statut: 'PAYE', datePaiement: imputation.dateImputation } });
      }
      await tx.activityLog.create({ data: { userId, action: 'PROVISION_IMPUTEE', entityType: 'ImputationProvision',
        entityId: imputation.id, dossierId: provision.dossierId,
        metadata: { provisionId, factureId: invoice.id, montantExact: amount.toFixed(2),
          dateMetier: imputation.dateImputation.toISOString(), statutFactureAvant: invoice.statut, statutFactureApres: status,
          mouvementFinanceId: provision.mouvementFinanceId, nouvelEncaissement: false },
      } });
      return { ...imputation, montant: amount.toNumber(), montantExact: amount.toFixed(2),
        facture: { id: invoice.id, numero: invoice.numero, montantTTC: invoice.montantTTC.toNumber(), statut: status },
        provision: { id: provision.id, montant: provision.montant.toNumber(), montantImpute: new Prisma.Decimal(available.montantImpute!).plus(amount).toNumber(),
          montantDisponible: new Prisma.Decimal(available.montantDisponible).minus(amount).toNumber() } };
    });
  }

  async removeImputation(provisionId: string, imputationId: string, userId?: string) {
    if (!userId) throw new UnauthorizedException('Auteur de la suppression requis.');
    return treasuryTransaction(this.prisma, async tx => {
      const target = await tx.imputationProvision.findFirst({ where: { id: imputationId, provisionId } });
      if (!target) throw new NotFoundException('Imputation introuvable.');
      await lockBillingRows(tx, 'facture', [target.factureId]);
      await lockBillingRows(tx, 'provision', [provisionId]);
      const current = await tx.imputationProvision.findFirst({ where: { id: imputationId, provisionId, factureId: target.factureId } });
      if (!current) throw new NotFoundException('Imputation introuvable.');
      await tx.imputationProvision.delete({ where: { id: imputationId } });
      const invoice = await tx.facture.findUniqueOrThrow({ where: { id: target.factureId }, include: BILLING_INVOICE_INCLUDE });
      const balance = readInvoiceBalance(invoice);
      // Preserve the existing deletion operation, but never invent a status for an ambiguous history.
      if (balance.statutCalcule) await tx.facture.update({ where: { id: invoice.id }, data: { statut: balance.statutCalcule } });
      // Do not infer a reversal of historical opening-fee payment from a missing cash link.
      const provision = await tx.provision.findUniqueOrThrow({ where: { id: provisionId }, include: BILLING_PROVISION_INCLUDE });
      await tx.activityLog.create({ data: { userId, action: 'IMPUTATION_PROVISION_RETIREE', entityType: 'ImputationProvision',
        entityId: current.id, dossierId: provision.dossierId,
        metadata: { provisionId, factureId: current.factureId, montantExact: current.montant.toFixed(2),
          auteurInitialId: current.createdById, dateImputationInitiale: current.dateImputation.toISOString(),
          statutFactureAvant: invoice.statut, statutFactureApres: balance.statutCalcule ?? invoice.statut, mouvementFinanceId: provision.mouvementFinanceId,
          nouvelEncaissement: false, effetTresorerie: false },
      } });
      return { ...serializeBillingProvision(provision), factureMiseAJour: { id: invoice.id, numero: invoice.numero, montantTTC: invoice.montantTTC.toNumber(), statut: balance.statutCalcule ?? invoice.statut }, avertissements: balance.avertissements };
    });
  }
}

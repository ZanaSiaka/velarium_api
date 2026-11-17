import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FactureStatut, MoyenOperationCompte, Prisma, TypeLigneFacture } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { CABINET_INFO } from '../../config/cabinet.config';
import { CreateFactureDto } from './dto/create-facture.dto';
import { CreatePaiementDto } from './dto/create-paiement.dto';
import { lockTreasuryAccounts, treasuryTransaction } from '../../common/finance/treasury';
import { allocateBillingNumber, BILLING_INVOICE_INCLUDE, billingAmount, lockBillingRows, readInvoiceBalance, resolveInvoiceStatus, serializeBillingInvoice } from '../../common/finance/billing';

function allowedMethods(type: string, configured: MoyenOperationCompte[]) {
  const modern = configured.filter(method => method !== 'CARTE' && method !== 'MOBILE_MONEY');
  if (modern.length) return modern;
  switch (type) {
    case 'BANCAIRE': return [MoyenOperationCompte.VIREMENT, MoyenOperationCompte.CHEQUE];
    case 'EPARGNE': return [MoyenOperationCompte.VIREMENT];
    case 'MOBILE_MONEY': return [MoyenOperationCompte.ORANGE_MONEY, MoyenOperationCompte.WAVE, MoyenOperationCompte.MTN_MONEY, MoyenOperationCompte.MOOV_MONEY];
    case 'CARTE_BANCAIRE': return [MoyenOperationCompte.PAIEMENT_CARTE];
    case 'ESPECES': return [MoyenOperationCompte.ESPECES];
    default: return [];
  }
}

@Injectable()
export class FacturesService {
  constructor(private readonly prisma: PrismaService, private readonly activityLog: ActivityLogService) {}

  async findAll(dossierId?: string) {
    const rows = await this.prisma.facture.findMany({ where: dossierId === undefined ? undefined : { dossierId }, orderBy: { createdAt: 'desc' }, include: BILLING_INVOICE_INCLUDE });
    return rows.map(serializeBillingInvoice);
  }

  async findOne(id: string) {
    const row = await this.prisma.facture.findUnique({ where: { id }, include: BILLING_INVOICE_INCLUDE });
    if (!row) throw new NotFoundException('Facture introuvable.');
    return serializeBillingInvoice(row);
  }

  private async calculate(tx: Prisma.TransactionClient, dto: CreateFactureDto) {
    const due = new Date(dto.dateEcheance);
    if (!Number.isFinite(due.getTime()) || !dto.lignes?.length) throw new BadRequestException('Échéance et lignes de facture valides requises.');
    const dossier = await tx.dossier.findUnique({ where: { id: dto.dossierId }, include: { fraisOuverture: true } });
    if (!dossier) throw new NotFoundException('Dossier introuvable.');
    const fee = dossier.fraisOuverture;
    const includeFee = !!fee && !fee.factureId && (fee.statut === 'A_PAYER' || fee.statut === 'A_FACTURER');
    if (fee && ((includeFee && fee.mouvementFinanceId) || (fee.statut === 'FACTURE' && !fee.factureId))) {
      throw new BadRequestException('Les frais d’ouverture présentent un rattachement ou un encaissement historique ambigu. Vérifiez-les avant facturation.');
    }
    const lines = dto.lignes.map(line => {
      const quantity = billingAmount(line.quantite);
      if (quantity.greaterThan('99999999.99') || !line.description?.trim()) throw new BadRequestException('Quantité ou description de ligne invalide.');
      const price = billingAmount(line.prixUnitaire, true);
      // Match the existing two-decimal storage of each line; sum those persisted amounts.
      const amount = quantity.times(price).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      if (amount.greaterThan('999999999999.99')) throw new BadRequestException('Montant de ligne hors capacité.');
      return { type: TypeLigneFacture.HONORAIRES as TypeLigneFacture, description: line.description.trim(), quantite: quantity, prixUnitaire: price, montant: amount };
    });
    const honoraires = lines.reduce((total, row) => total.plus(row.montant), new Prisma.Decimal(0));
    const feeAmount = includeFee && fee ? fee.montant : new Prisma.Decimal(0);
    if (!feeAmount.isFinite() || feeAmount.isNegative()) throw new BadRequestException('Montant des frais historiques invalide.');
    if (includeFee) lines.push({ type: TypeLigneFacture.FRAIS_OUVERTURE_DOSSIER, description: "Frais d'ouverture du dossier " + dossier.reference, quantite: new Prisma.Decimal(1), prixUnitaire: feeAmount, montant: feeAmount });
    // Existing positive-amount TVA rule: cent precision, half up; fees remain untaxed.
    const tax = honoraires.times(CABINET_INFO.tauxTVA).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const ht = honoraires.plus(feeAmount), ttc = ht.plus(tax);
    if ([ht, tax, ttc].some(amount => amount.greaterThan('999999999999.99'))) throw new BadRequestException('Total de facture hors capacité.');
    return { dossier, fee, includeFee, due, lines, ht, tax, ttc };
  }

  async preview(dto: CreateFactureDto) {
    return this.prisma.$transaction(async tx => {
      const result = await this.calculate(tx, dto);
      return { montantHT: result.ht.toFixed(2), montantTVA: result.tax.toFixed(2), montantTTC: result.ttc.toFixed(2), tauxTVA: String(CABINET_INFO.tauxTVA),
        fraisOuverture: result.includeFee ? result.fee!.montant.toFixed(2) : '0.00',
        lignes: result.lines.map(row => ({ type: row.type, description: row.description, quantite: row.quantite.toFixed(2), prixUnitaire: row.prixUnitaire.toFixed(2), montant: row.montant.toFixed(2) })) };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async create(dto: CreateFactureDto, userId: string) {
    return treasuryTransaction(this.prisma, async tx => {
      const numero = await allocateBillingNumber(tx, 'FACT', new Date().getUTCFullYear());
      await lockBillingRows(tx, 'dossier', [dto.dossierId]);
      const result = await this.calculate(tx, dto);
      const created = await tx.facture.create({ data: {
        numero, statut: result.ttc.greaterThan(0) ? resolveInvoiceStatus('0.00', result.ttc.toFixed(2), result.due) : FactureStatut.ENVOYEE,
        dossierId: result.dossier.id, clientId: result.dossier.clientId, source: 'DOSSIER', sourceLibelle: 'Facture du dossier ' + result.dossier.reference,
        dateEcheance: result.due, montantHT: result.ht, montantTVA: result.tax, montantTTC: result.ttc, tauxTVA: CABINET_INFO.tauxTVA,
        note: dto.note?.trim() || null, mentionRCCM: CABINET_INFO.rccm, mentionNCC: CABINET_INFO.ncc,
        lignes: { create: result.lines },
      } });
      if (result.includeFee && result.fee) await tx.fraisOuvertureDossier.update({ where: { id: result.fee.id }, data: { statut: 'FACTURE', factureId: created.id } });
      await this.activityLog.log({ userId, action: 'FACTURE_CREEE', entityType: 'Facture', entityId: created.id, dossierId: created.dossierId,
        metadata: { numero, montantHTExact: result.ht.toFixed(2), montantTVAExact: result.tax.toFixed(2), montantTTCExact: result.ttc.toFixed(2), devise: 'XOF',
          montantHT: result.ht.toNumber(), montantTVA: result.tax.toNumber(), montantTTC: result.ttc.toNumber(),
          fraisOuvertureInclus: result.includeFee, montantFraisOuverture: result.includeFee ? result.fee!.montant.toNumber() : 0 } }, tx);
      return serializeBillingInvoice(await tx.facture.findUniqueOrThrow({ where: { id: created.id }, include: BILLING_INVOICE_INCLUDE }));
    }, true);
  }

  async addPaiement(id: string, dto: CreatePaiementDto, userId: string) {
    const amount = billingAmount(dto.montant);
    const date = dto.datePaiement ? new Date(dto.datePaiement) : new Date();
    if (!Number.isFinite(date.getTime()) || !dto.moyenPaiement || dto.moyenPaiement === 'CARTE' || dto.moyenPaiement === 'MOBILE_MONEY') throw new BadRequestException('Date ou moyen de paiement invalide.');
    return treasuryTransaction(this.prisma, async tx => {
      // Global order: accounts, invoices, provisions. Payments never lock a provision after reading another invoice.
      await lockTreasuryAccounts(tx, [dto.caisseId]);
      await lockBillingRows(tx, 'facture', [id]);
      const invoice = await tx.facture.findUnique({ where: { id }, include: BILLING_INVOICE_INCLUDE });
      if (!invoice) throw new NotFoundException('Facture introuvable.');
      const balance = readInvoiceBalance(invoice);
      if (!balance.reglementAutorise || balance.solde === null) throw new BadRequestException('Cette facture ne peut pas recevoir de règlement : brouillon, solde nul ou lecture historique à vérifier.');
      if (amount.greaterThan(balance.solde)) throw new BadRequestException('Le paiement dépasse le reste à payer de la facture.');
      const account = await tx.caisse.findUnique({ where: { id: dto.caisseId } });
      if (!account) throw new NotFoundException('Compte d’encaissement introuvable.');
      if (!account.active || account.devise !== 'XOF') throw new BadRequestException('Le compte doit être actif et en XOF.');
      const method = dto.moyenPaiement as MoyenOperationCompte;
      if (!allowedMethods(account.type, account.moyensOperation).some(value => value === method)) throw new BadRequestException('Le moyen de paiement n’est pas autorisé pour ce compte.');
      const movement = await tx.mouvementFinance.create({ data: {
        type: 'ENTREE', montant: amount, categorie: 'PAIEMENT_FACTURE', source: 'PAIEMENT_FACTURE',
        sourceLibelle: 'Paiement de la facture ' + invoice.numero, sourceReference: invoice.numero, tiers: invoice.client.nom,
        description: dto.note?.trim() || 'Paiement de la facture ' + invoice.numero, reference: dto.reference?.trim() || null,
        date, caisseId: account.id, moyenPaiement: method, userId, dossierId: invoice.dossierId,
      } });
      const payment = await tx.paiement.create({ data: { factureId: id, montant: amount, datePaiement: date, moyenPaiement: method, note: dto.note?.trim() || null, mouvementFinanceId: movement.id } });
      const settled = new Prisma.Decimal(balance.totalRegle!).plus(amount);
      const status = resolveInvoiceStatus(settled.toFixed(2), invoice.montantTTC.toFixed(2), invoice.dateEcheance);
      await tx.facture.update({ where: { id }, data: { statut: status } });
      if (invoice.fraisOuvertureDossier && status === 'PAYEE') await tx.fraisOuvertureDossier.update({ where: { id: invoice.fraisOuvertureDossier.id }, data: { statut: 'PAYE', datePaiement: date } });
      await this.activityLog.log({ userId, action: 'PAIEMENT_ENREGISTRE', entityType: 'Facture', entityId: id, dossierId: invoice.dossierId,
        metadata: { numero: invoice.numero, montant: amount.toNumber(), montantExact: amount.toFixed(2), devise: account.devise, dateMetier: date.toISOString(), caisseId: account.id, moyenPaiement: method,
          paiementId: payment.id, mouvementFinanceId: movement.id, reference: dto.reference ?? null,
          totalPaiements: new Prisma.Decimal(balance.totalPaiements!).plus(amount).toNumber(),
          totalImputationsProvision: Number(balance.totalImputationsProvision), totalProvisionsLegacy: Number(balance.totalProvisionsLegacy),
          totalProvisions: Number(balance.totalProvisions), totalRegle: settled.toNumber(), solde: invoice.montantTTC.minus(settled).toNumber() } }, tx);
      return serializeBillingInvoice(await tx.facture.findUniqueOrThrow({ where: { id }, include: BILLING_INVOICE_INCLUDE }));
    });
  }
}

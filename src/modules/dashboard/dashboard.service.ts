import { BILLING_INVOICE_INCLUDE, readInvoiceBalance } from '../../common/finance/billing';
import { sumMoney } from '../../common/finance/financial-read';
import { readTreasuryAccounts } from '../../common/finance/treasury';
import { BadRequestException, Injectable } from '@nestjs/common';
import { FactureStatut, Prisma, Role, TypeMouvementFinance } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancePermissionService } from '../finance/finance-permission.service';

// An empty, successfully loaded set sums to zero. Missing/invalid amounts do not.
const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
};
const sum = (values: readonly (number | null)[]): number | null =>
  values.some(value => value === null) ? null : num(values.reduce<number>((total, value) => total + value!, 0));
const remaining = (amount: number | null, paid: number | null) =>
  amount === null || paid === null ? null : Math.max(amount - paid, 0);

function day(value: string, end: boolean) {
  const date = new Date(value + (end ? 'T23:59:59.999Z' : 'T00:00:00.000Z'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('Dates invalides. Format attendu : AAAA-MM-JJ.');
  }
  return date;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: FinancePermissionService,
  ) {}

  async getSummary(role: Role, startDateParam?: string, endDateParam?: string) {
    const now = new Date();
    const startDate = startDateParam !== undefined ? day(startDateParam, false)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const endDate = endDateParam !== undefined ? day(endDateParam, true) : now;
    if (startDate > endDate) throw new BadRequestException('La date de début doit être antérieure à la date de fin.');

    const canViewFinance = this.permissions.canViewFinance(role);
    const canViewCaisses = canViewFinance && this.permissions.canViewCaisses(role);
    const canViewMouvements = canViewFinance && this.permissions.canViewMouvements(role);
    const capabilities = { canViewFinance, canViewCaisses, canViewMouvements };
    const [clientsTotal, clientsActifs, dossiersActifs, echeancesSemaine] = await Promise.all([
      this.prisma.client.count({ where: { createdAt: { gte: startDate, lte: endDate } } }),
      this.prisma.client.count({ where: { createdAt: { gte: startDate, lte: endDate }, dossiers: { some: { statut: 'EN_COURS' } } } }),
      this.prisma.dossier.count({ where: { statut: 'EN_COURS' } }),
      this.prisma.evenement.count({ where: { start: { gte: now, lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) } } }),
    ]);
    const operational = {
      dossiersActifs, echeancesSemaine,
      clients: { total: clientsTotal, actifs: clientsActifs, inactifs: clientsTotal - clientsActifs },
      periode: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
      permissions: capabilities,
    };
    // No financial query or secondary projection for users without Finance capabilities.
    if (!canViewFinance) return operational;

    const [entrees, sorties, paiementsLegacy, provisionsLegacy, caisses, factures, paiements] = await Promise.all([
      canViewMouvements ? this.prisma.mouvementFinance.findMany({
        where: { type: TypeMouvementFinance.ENTREE, date: { gte: startDate, lte: endDate } },
        select: { montant: true, date: true, caisse: { select: { devise: true } } },
      }) : [],
      canViewMouvements ? this.prisma.mouvementFinance.findMany({
        where: { type: TypeMouvementFinance.SORTIE, date: { gte: startDate, lte: endDate } },
        select: { montant: true, date: true, caisse: { select: { devise: true } } },
      }) : [],
      canViewMouvements ? this.prisma.paiement.findMany({
        where: { mouvementFinanceId: null, datePaiement: { gte: startDate, lte: endDate } },
        select: { montant: true, datePaiement: true },
      }) : [],
      canViewMouvements ? this.prisma.provision.findMany({
        where: { mouvementFinanceId: null, datePaiement: { gte: startDate, lte: endDate } },
        select: { montant: true, datePaiement: true },
      }) : [],
      canViewCaisses ? this.prisma.$transaction(tx => readTreasuryAccounts(tx), { isolationLevel: 'RepeatableRead' }) : [],
      this.prisma.facture.findMany({ where: { statut: { not: FactureStatut.BROUILLON } }, include: BILLING_INVOICE_INCLUDE }),
      canViewMouvements ? this.prisma.paiement.findMany({
        where: { datePaiement: { gte: startDate, lte: endDate } },
        orderBy: { datePaiement: 'desc' }, take: 7,
        select: { id: true, montant: true, datePaiement: true,
          facture: { select: { numero: true, client: { select: { nom: true } } } } },
      }) : [],
    ]);

    // Preserve the existing historical inclusion rules; reconciliation belongs to F3.
    const cashIn = [
      ...entrees.map(row => ({ date: row.date, montant: row.montant })),
      ...paiementsLegacy.map(row => ({ date: row.datePaiement, montant: row.montant })),
      ...provisionsLegacy.map(row => ({ date: row.datePaiement, montant: row.montant })),
    ];
    const cashOut = sorties.map(row => ({ date: row.date, montant: row.montant }));
    const accountCurrencies = new Set(caisses.map(row => row.devise));
    const deviseSolde = !caisses.length ? 'XOF' : accountCurrencies.size === 1 && /^[A-Z]{3}$/.test(caisses[0].devise) ? caisses[0].devise : null;
    const balances: Awaited<ReturnType<typeof readTreasuryAccounts>> = caisses;
    const soldeGlobal = deviseSolde ? balances.reduce<Prisma.Decimal>((total, row) => total.plus(row.solde), new Prisma.Decimal(0)) : null;
    const outstanding = sumMoney(factures.map(row => readInvoiceBalance(row).solde));
    const impayes = outstanding === null ? null : Number(outstanding);

    // Cards and chart use the same rows and inclusive UTC bounds, including multi-year periods.
    const series = (rows: typeof cashIn, available: boolean) => {
      const buckets = new Map<string, { month: string; total: Prisma.Decimal }>();
      const cursor = new Date(startDate);
      cursor.setUTCDate(1);
      while (cursor <= endDate) {
        const key = cursor.toISOString().slice(0, 7);
        buckets.set(key, { month: cursor.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' }), total: new Prisma.Decimal(0) });
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
      if (!available) return [...buckets.values()].map(row => ({ ...row, total: null }));
      for (const row of rows) {
        const bucket = buckets.get(row.date.toISOString().slice(0, 7));
        if (bucket) bucket.total = bucket.total.plus(row.montant);
      }
      return [...buckets.values()].map(row => ({ ...row, total: row.total.toNumber() }));
    };
    const warnings: string[] = [];
    const flowCurrencies = new Set([...entrees, ...sorties].map(row => row.caisse.devise));
    const deviseFlux = paiementsLegacy.length || provisionsLegacy.length ? null : flowCurrencies.size === 0 ? 'XOF' : flowCurrencies.size === 1 && /^[A-Z]{3}$/.test([...flowCurrencies][0]) ? [...flowCurrencies][0] : null;
    if ((canViewCaisses && !deviseSolde) || (canViewMouvements && !deviseFlux)) warnings.push('Total indisponible : les devises sont différentes ou non confirmées. Les montants ne sont pas convertis ni additionnés.');
    const currencies = new Set([
      ...caisses.map(row => row.devise),
      ...entrees.map(row => row.caisse.devise),
      ...sorties.map(row => row.caisse.devise),
    ]);
    if ([...currencies].some(currency => currency !== 'XOF')) {
      warnings.push('Les agrégats historiques peuvent mélanger des devises ou libellés monétaires différents, notamment FCFA et XOF. Aucune conversion appliquée ; clarification prévue en F2.');
    }
    if (paiementsLegacy.length || provisionsLegacy.length) {
      warnings.push('Les encaissements incluent des paiements ou provisions historiques sans mouvement lié : leur devise et leur rapprochement restent à vérifier en F3.');
    }
    return {
      ...operational,
      impayes,
      ...(canViewCaisses ? { soldeGlobal: soldeGlobal?.toNumber() ?? null, deviseSolde } : {}),
      ...(canViewMouvements ? {
        totalEntrees: deviseFlux ? cashIn.reduce((total, row) => total.plus(row.montant), new Prisma.Decimal(0)).toNumber() : null,
        totalSorties: deviseFlux ? cashOut.reduce((total, row) => total.plus(row.montant), new Prisma.Decimal(0)).toNumber() : null,
        deviseFlux,
        entreesParMois: series(cashIn, !!deviseFlux), sortiesParMois: series(cashOut, !!deviseFlux),
        derniersPaiements: paiements.map(row => ({
          id: row.id, montant: num(row.montant), datePaiement: row.datePaiement,
          numero: row.facture.numero, client: row.facture.client.nom,
        })),
      } : {}),
      avertissementsFinanciers: warnings,
    };
  }
}

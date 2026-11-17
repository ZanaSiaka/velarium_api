import { BadRequestException } from '@nestjs/common';
import { FactureStatut, Prisma } from '../../../generated/prisma/client';
import { DOSSIER_REFERENCE_SELECT } from '../dossier-projections';
import { exactMoney, MoneyValue, readProvisionBalance, remainingMoney, sumMoney } from './financial-read';

export const BILLING_CASH_INCLUDE = {
  caisse: { select: { id: true, nom: true, type: true, devise: true } },
  paiement: { select: { id: true } }, provision: { select: { id: true } },
  fraisOuvertureDossier: { select: { id: true } }, recuEncaissement: true,
} satisfies Prisma.MouvementFinanceInclude;
export const BILLING_PROVISION_INCLUDE = {
  dossier: { select: { ...DOSSIER_REFERENCE_SELECT, clientId: true } },
  facture: { select: { id: true, numero: true, montantTTC: true } },
  mouvementFinance: { include: BILLING_CASH_INCLUDE },
  imputations: { orderBy: { dateImputation: 'asc' }, include: { facture: { select: { id: true, numero: true, montantTTC: true, statut: true } }, createdBy: { select: { id: true, name: true } } } },
} satisfies Prisma.ProvisionInclude;
export const BILLING_INVOICE_INCLUDE = {
  client: true, dossier: { select: DOSSIER_REFERENCE_SELECT }, lignes: true,
  paiements: { include: { mouvementFinance: { include: BILLING_CASH_INCLUDE } } },
  provisions: { include: BILLING_PROVISION_INCLUDE },
  imputationsProvision: { orderBy: { dateImputation: 'asc' }, include: { provision: { include: BILLING_PROVISION_INCLUDE }, createdBy: { select: { id: true, name: true } } } },
  fraisOuvertureDossier: true,
} satisfies Prisma.FactureInclude;

export type BillingCash = {
  id: string; montant: MoneyValue; type: string; source: string; dossierId: string | null;
  caisse: { devise: string }; paiement?: { id: string } | null; provision?: { id: string } | null;
  fraisOuvertureDossier?: { id: string } | null;
  recuEncaissement?: { montant: MoneyValue } | null;
};
export type BillingProvision = {
  id: string; dossierId: string; montant: MoneyValue; factureId: string | null;
  mouvementFinance: BillingCash | null;
  facture?: { montantTTC: MoneyValue } | null;
  imputations: readonly { factureId: string; montant: MoneyValue; facture?: { montantTTC: MoneyValue } }[];
};
export type InvoiceBalanceInput = {
  id: string; dossierId: string; statut: string; montantTTC: MoneyValue; dateEcheance: Date;
  montantHT?: MoneyValue; montantTVA?: MoneyValue; tauxTVA?: MoneyValue;
  lignes?: readonly { montant: MoneyValue; quantite: MoneyValue; prixUnitaire: MoneyValue; type?: string }[];
  paiements: readonly { montant: MoneyValue; mouvementFinance: BillingCash | null }[];
  provisions: readonly { id?: string }[];
  imputationsProvision: readonly { montant: MoneyValue; provision: BillingProvision | null }[];
};

export function billingAmount(value: number, allowZero = false) {
  if (!Number.isFinite(value)) throw new BadRequestException('Montant invalide.');
  const amount = new Prisma.Decimal(value.toString());
  if (amount.decimalPlaces() > 2 || amount.greaterThan('999999999999.99') || (allowZero ? amount.isNegative() : !amount.greaterThan(0))) {
    throw new BadRequestException('Le montant doit respecter deux décimales et la capacité monétaire de la facture.');
  }
  return amount;
}

export function recognizedCash(amount: MoneyValue, cash: BillingCash | null, dossierId: string, source: string): string | null {
  const value = exactMoney(amount);
  if (!value || new Prisma.Decimal(value).isNegative() || !cash || cash.type !== 'ENTREE' || cash.source !== source || cash.dossierId !== dossierId || cash.caisse.devise !== 'XOF') return null;
  if ([cash.paiement, cash.provision, cash.fraisOuvertureDossier].filter(Boolean).length > 1) return null;
  const cashAmount = exactMoney(cash.montant);
  return cashAmount !== null && new Prisma.Decimal(cashAmount).equals(value) ? value : null;
}

export function resolveInvoiceStatus(paid: string, ttc: string, due: Date, now = new Date()): FactureStatut {
  if (new Prisma.Decimal(paid).greaterThanOrEqualTo(ttc)) return FactureStatut.PAYEE;
  // The due day is inclusive, using the project's UTC date convention.
  if (due.toISOString().slice(0, 10) < now.toISOString().slice(0, 10)) return FactureStatut.EN_RETARD;
  return new Prisma.Decimal(paid).greaterThan(0) ? FactureStatut.PARTIELLEMENT_PAYEE : FactureStatut.ENVOYEE;
}

export function readInvoiceBalance(invoice: InvoiceBalanceInput) {
  const warnings = new Set<string>();
  const ttc = exactMoney(invoice.montantTTC);
  let integrity = ttc !== null && !new Prisma.Decimal(ttc).isNegative();
  if (invoice.lignes && invoice.montantHT !== undefined && invoice.montantTVA !== undefined) {
    const ht = exactMoney(invoice.montantHT), tax = exactMoney(invoice.montantTVA);
    const lines = sumMoney(invoice.lignes.map(row => exactMoney(row.montant)));
    if (ht === null || tax === null || lines !== ht || sumMoney([ht, tax]) !== ttc) integrity = false;
    if (invoice.lignes.some(row => exactMoney(row.montant) !== new Prisma.Decimal(row.quantite).times(row.prixUnitaire).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2))) integrity = false;
    if (invoice.tauxTVA !== undefined && invoice.lignes.every(row => row.type !== undefined)) {
      const base = sumMoney(invoice.lignes.filter(row => row.type === 'HONORAIRES').map(row => exactMoney(row.montant)));
      if (base !== null && tax !== null && new Prisma.Decimal(base).times(invoice.tauxTVA).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2) !== tax) {
        warnings.add('La TVA stockée ne se reconstitue pas depuis le typage historique des lignes ; montants conservés, qualification fiscale à vérifier.');
      }
    }
  }
  if (!integrity) warnings.add('Les montants stockés et les lignes nécessitent une vérification ; aucune réécriture historique effectuée.');
  const totalPaiements = sumMoney(invoice.paiements.map(row => recognizedCash(row.montant, row.mouvementFinance, invoice.dossierId, 'PAIEMENT_FACTURE')));
  if (totalPaiements === null) warnings.add('Paiement historique sans encaissement ou devise confirmé, ou mouvement incohérent.');
  const applied = invoice.imputationsProvision.map(row => {
    const provision = row.provision;
    if (!provision) return null;
    const balance = readProvisionBalance(provision);
    const value = exactMoney(row.montant);
    if (provision.dossierId !== invoice.dossierId || balance.montantImpute === null || recognizedCash(provision.montant, provision.mouvementFinance, provision.dossierId, 'PROVISION') === null || value === null || new Prisma.Decimal(value).isNegative()) return null;
    return value;
  });
  const totalImputationsProvision = sumMoney(applied);
  // factureId contains no allocation amount; it cannot prove an integral allocation.
  const totalProvisionsLegacy = invoice.provisions.length ? null : '0.00';
  if (invoice.provisions.length) warnings.add('Affectation historique de provision non réconciliée : montant reconnu indisponible.');
  if (totalImputationsProvision === null) warnings.add('Une imputation ou sa provision présente une ambiguïté.');
  const ids = [...invoice.paiements.map(row => row.mouvementFinance?.id), ...invoice.imputationsProvision.map(row => row.provision?.mouvementFinance?.id)].filter((id): id is string => !!id);
  // A provision may have only one allocation to this invoice (Prisma uniqueness).
  const duplicate = new Set(ids).size !== ids.length;
  if (duplicate) warnings.add('Un mouvement est utilisé plusieurs fois dans les règlements de cette facture.');
  const totalProvisions = sumMoney([totalImputationsProvision, totalProvisionsLegacy]);
  const totalRegle = integrity && !duplicate ? sumMoney([totalPaiements, totalProvisions]) : null;
  const solde = remainingMoney(ttc, totalRegle);
  const tropPercu = remainingMoney(totalRegle, ttc);
  if (tropPercu !== null && new Prisma.Decimal(tropPercu).greaterThan(0)) warnings.add('Excédent historique identifié, sans compensation ni crédit client automatique.');
  const eligible = invoice.statut !== 'BROUILLON';
  if (!eligible) warnings.add('Brouillon : exclu des créances exigibles et des nouveaux règlements.');
  if (ttc === '0.00') warnings.add('Facture à TTC nul : qualification métier à confirmer, aucun règlement positif autorisé.');
  const statutCalcule = totalRegle !== null && ttc !== null && ttc !== '0.00' && eligible ? resolveInvoiceStatus(totalRegle, ttc, invoice.dateEcheance) : null;
  if (statutCalcule && statutCalcule !== invoice.statut) warnings.add('Le statut stocké diffère de la lecture financière actuelle ; il est conservé tant qu’aucune nouvelle opération ne le met à jour.');
  return { montantTTC: ttc, totalPaiements, totalImputationsProvision, totalProvisionsLegacy, totalProvisions,
    totalRegle, solde, tropPercu, eligible, statutCalcule, totalPaiementsEnregistres: sumMoney(invoice.paiements.map(row => exactMoney(row.montant))),
    reglementAutorise: eligible && integrity && solde !== null && new Prisma.Decimal(solde).greaterThan(0) && tropPercu === '0.00', avertissements: [...warnings] };
}

export async function lockBillingRows(tx: Prisma.TransactionClient, kind: 'facture' | 'provision' | 'dossier', ids: readonly string[]) {
  const table = kind === 'facture' ? Prisma.sql`"Facture"` : kind === 'provision' ? Prisma.sql`"Provision"` : Prisma.sql`"Dossier"`;
  const ordered = [...new Set(ids)].sort();
  if (ordered.length) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM ${table} WHERE "id" IN (${Prisma.join(ordered)}) ORDER BY "id" FOR UPDATE`);
}

export async function allocateBillingNumber(tx: Prisma.TransactionClient, prefix: 'FACT' | 'REC', year: number) {
  await tx.$queryRaw(Prisma.sql`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${prefix === 'FACT' ? 726510 : 726511}::int, ${year}::int)`);
  const start = prefix + '-' + year + '-';
  const rows = prefix === 'FACT' ? await tx.facture.findMany({ where: { numero: { startsWith: start } }, select: { numero: true } })
    : await tx.recuEncaissement.findMany({ where: { numero: { startsWith: start } }, select: { numero: true } });
  let next = 1n;
  for (const row of rows) {
    const suffix = row.numero.slice(start.length);
    if (/^\d+$/.test(suffix) && BigInt(suffix) >= next) next = BigInt(suffix) + 1n;
  }
  return start + next.toString().padStart(prefix === 'FACT' ? 3 : 4, '0');
}

export function serializeBillingProvision<T extends BillingProvision>(row: T) {
  const balance = readProvisionBalance(row);
  const encaissementConfirme = recognizedCash(row.montant, row.mouvementFinance, row.dossierId, 'PROVISION') !== null;
  return { ...row, montant: Number(row.montant), montantExact: exactMoney(row.montant), lectureFinanciere: balance,
    encaissementConfirme, avertissements: [balance.avertissement, encaissementConfirme ? null : 'Encaissement historique non confirmé par un mouvement cohérent en XOF.'].filter((value): value is string => value !== null),
    facture: row.facture ? { ...row.facture, montantTTC: Number(row.facture.montantTTC) } : null,
    imputations: row.imputations.map(item => ({ ...item, montant: Number(item.montant), montantExact: exactMoney(item.montant),
      ...(item.facture ? { facture: { ...item.facture, montantTTC: Number(item.facture.montantTTC) } } : {}) })),
    mouvementFinance: row.mouvementFinance ? { ...row.mouvementFinance, montant: Number(row.mouvementFinance.montant),
      recuEncaissement: row.mouvementFinance.recuEncaissement ? { ...row.mouvementFinance.recuEncaissement, montant: Number(row.mouvementFinance.recuEncaissement.montant) } : null } : null,
    montantImpute: balance.montantImpute === null ? null : Number(balance.montantImpute),
    montantDisponible: balance.montantDisponible === null ? null : Number(balance.montantDisponible) };
}

export type BillingInvoiceRecord = Prisma.FactureGetPayload<{ include: typeof BILLING_INVOICE_INCLUDE }>;
export function serializeBillingInvoice(row: BillingInvoiceRecord) {
  const montants = readInvoiceBalance(row);
  const numeric = (value: string | null) => value === null ? null : Number(value);
  return { ...row, montantHT: row.montantHT.toNumber(), montantTVA: row.montantTVA.toNumber(), montantTTC: row.montantTTC.toNumber(), tauxTVA: row.tauxTVA.toNumber(),
    montantHTExact: row.montantHT.toFixed(2), montantTVAExact: row.montantTVA.toFixed(2), montantTTCExact: row.montantTTC.toFixed(2),
    lignes: row.lignes.map(line => ({ ...line, quantite: line.quantite.toNumber(), prixUnitaire: line.prixUnitaire.toNumber(), montant: line.montant.toNumber(), montantExact: line.montant.toFixed(2) })),
    paiements: row.paiements.map(payment => ({ ...payment, montant: payment.montant.toNumber(), montantExact: payment.montant.toFixed(2) })),
    provisions: row.provisions.map(serializeBillingProvision),
    imputationsProvision: row.imputationsProvision.map(item => ({ ...item, montant: item.montant.toNumber(), montantExact: item.montant.toFixed(2), provision: serializeBillingProvision(item.provision) })),
    totalPaiements: numeric(montants.totalPaiements), totalImputationsProvision: numeric(montants.totalImputationsProvision), totalProvisionsLegacy: numeric(montants.totalProvisionsLegacy),
    totalProvisions: numeric(montants.totalProvisions), totalRegle: numeric(montants.totalRegle), solde: numeric(montants.solde), tropPercu: numeric(montants.tropPercu),
    montants, avertissements: montants.avertissements, reglementAutorise: montants.reglementAutorise };
}

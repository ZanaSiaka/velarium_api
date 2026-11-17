import { BillingCash, readInvoiceBalance, recognizedCash } from '../../common/finance/billing';
import { MoneyValue, exactMoney, readProvisionBalance, remainingMoney, sumMoney } from '../../common/finance/financial-read';

type Receipt = { id: string; numero: string; dateEmission: Date; montant: MoneyValue; type: string; dossierId: string };
type Movement = BillingCash & { id: string; moyenPaiement?: string | null; caisse: { devise: string }; recuEncaissement: Receipt | null };
type Provision = {
  id: string; dossierId: string; montant: MoneyValue; factureId: string | null; datePaiement: Date;
  moyenPaiement: string | null; note: string | null; mouvementFinanceId: string | null;
  mouvementFinance: Movement | null; imputations: { factureId: string; montant: MoneyValue }[];
};
type Payment = {
  id: string; montant: MoneyValue; datePaiement: Date; moyenPaiement: string | null;
  note: string | null; mouvementFinanceId: string | null; mouvementFinance: Movement | null;
};
type Invoice = {
  id: string; numero: string; statut: string; montantTTC: MoneyValue; dateEmission: Date; dateEcheance: Date;
  montantHT?: MoneyValue; montantTVA?: MoneyValue;
  lignes?: { montant: MoneyValue; quantite: MoneyValue; prixUnitaire: MoneyValue }[];
  paiements: Payment[]; provisions: { id: string }[];
  imputationsProvision: { provisionId: string; montant: MoneyValue }[];
};
type Fee = {
  id: string; montant: MoneyValue; statut: string; datePaiement: Date | null; createdAt: Date;
  factureId: string | null; mouvementFinanceId: string | null; mouvementFinance: Movement | null;
};
export type DossierFinanceInput = {
  id: string; reference: string; client: { id: string; nom: string };
  factures: Invoice[]; provisions: Provision[]; fraisOuverture: Fee | null;
};

export function readDossierFinance(dossier: DossierFinanceInput) {
  // Facturation/paiements actuels are explicitly XOF in the existing services.
  // Historical cash entries without an account currency remain unknown.
  const devise = 'XOF';
  const warnings = new Set<string>();
  const currency = (movement: Movement | null) => movement?.caisse.devise?.trim() || null;
  const receipt = (movement: Movement | null) => {
    const row = movement?.recuEncaissement;
    if (!row) return null;
    if (row.dossierId !== dossier.id) { warnings.add('Un reçu lié à un autre dossier n’est pas affiché.'); return null; }
    return { id: row.id, numero: row.numero, dateEmission: row.dateEmission, montant: exactMoney(row.montant), type: row.type };
  };
  const provisionMap = new Map(dossier.provisions.map(row => [row.id, row]));
  const invoiceIds = new Set(dossier.factures.map(row => row.id));
  const balances = new Map(dossier.provisions.map(row => [row.id, readProvisionBalance(row)]));
  const currenciesKnown = dossier.provisions.every(row => currency(row.mouvementFinance) === devise);
  if (!currenciesKnown) warnings.add('Certaines provisions ont une devise absente ou différente de XOF : les agrégats concernés sont indisponibles.');
  for (const row of dossier.provisions) {
    const balance = balances.get(row.id)!;
    if (balance.avertissement) warnings.add(`Provision historique : ${balance.avertissement}`);
    if ((row.factureId && !invoiceIds.has(row.factureId)) || row.imputations.some(item => !invoiceIds.has(item.factureId))) {
      balance.montantImpute = null; balance.montantDisponible = null;
      balance.mode = 'AMBIGUE';
      balance.avertissement = 'Une affectation vise une facture hors du dossier : vérification nécessaire.';
      warnings.add(`Provision : ${balance.avertissement}`);
    }
  }

  const seenCash = new Set<string>();
  let duplicatedCash = false;
  const registerCash = (movementId: string | null) => {
    if (!movementId) return;
    if (seenCash.has(movementId)) duplicatedCash = true;
    seenCash.add(movementId);
  };
  dossier.factures.forEach(row => row.paiements.forEach(payment => registerCash(payment.mouvementFinanceId)));
  dossier.provisions.forEach(row => registerCash(row.mouvementFinanceId));
  if (dossier.fraisOuverture?.statut === 'PAYE') registerCash(dossier.fraisOuverture.mouvementFinanceId);
  if (duplicatedCash) warnings.add('Un même mouvement est référencé par plusieurs écritures métier : les agrégats potentiellement doublonnés sont indisponibles.');

  const factures = dossier.factures.map(invoice => {
    const paiements = invoice.paiements.map(payment => ({
      id: payment.id, date: payment.datePaiement, montant: exactMoney(payment.montant),
      devise: currency(payment.mouvementFinance), moyenPaiement: payment.mouvementFinance?.moyenPaiement ?? payment.moyenPaiement,
      note: payment.note, facture: { id: invoice.id, numero: invoice.numero },
      recu: receipt(payment.mouvementFinance),
      encaissementConfirme: recognizedCash(payment.montant, payment.mouvementFinance, dossier.id, 'PAIEMENT_FACTURE') !== null,
    }));
    const balance = readInvoiceBalance({
      ...invoice, dossierId: dossier.id,
      imputationsProvision: invoice.imputationsProvision.map(item => ({ ...item, provision: provisionMap.get(item.provisionId) ?? null })),
    });
    balance.avertissements.forEach(message => warnings.add("Facture " + invoice.numero + " : " + message));
    return { id: invoice.id, numero: invoice.numero, statut: invoice.statut, statutCalcule: balance.statutCalcule,
      dateEmission: invoice.dateEmission, dateEcheance: invoice.dateEcheance, eligible: balance.eligible,
      devise, montantTTC: balance.montantTTC, montantRegle: balance.totalRegle, resteAPayer: balance.solde,
      tropPercu: balance.tropPercu, reglementAutorise: balance.reglementAutorise,
      avertissements: balance.avertissements, totalPaiementsReconnu: balance.totalPaiements, paiements };
  });
  const provisions = dossier.provisions.map(row => ({
    id: row.id, date: row.datePaiement, devise: currency(row.mouvementFinance),
    factureId: row.factureId, note: row.note, ...balances.get(row.id)!,
    moyenPaiement: row.mouvementFinance?.moyenPaiement ?? row.moyenPaiement,
    recu: receipt(row.mouvementFinance),
    encaissementConfirme: recognizedCash(row.montant, row.mouvementFinance, dossier.id, 'PROVISION') !== null,
    imputations: row.imputations.map(item => ({ factureId: item.factureId, montant: exactMoney(item.montant) })),
  }));
  const totalPaiements = sumMoney(factures.map(row => row.totalPaiementsReconnu));
  const totalProvisionsEncaissees = sumMoney(dossier.provisions.map(row => recognizedCash(row.montant, row.mouvementFinance, dossier.id, 'PROVISION')));
  const totalProvisions = currenciesKnown ? sumMoney(provisions.map(row => row.montantImpute)) : null;
  const totalProvisionsDisponibles = currenciesKnown ? sumMoney(provisions.map(row => row.montantDisponible)) : null;
  const totalProvisionsImputees = currenciesKnown ? sumMoney(dossier.provisions.flatMap(row => row.imputations.map(item => exactMoney(item.montant)))) : null;
  const totalProvisionsLegacy = currenciesKnown ? sumMoney(provisions.filter(row => row.factureId !== null).map(row => row.montantImpute)) : null;
  const fee = dossier.fraisOuverture;
  const linkedInvoice = fee?.factureId ? factures.find(row => row.id === fee.factureId) : undefined;
  const settledThroughInvoice = !!linkedInvoice && linkedInvoice.resteAPayer === '0.00' && linkedInvoice.montantRegle !== null;
  const totalFraisOuvertureEncaisse = !fee ? null : fee.statut !== 'PAYE' ? '0.00'
    : fee.mouvementFinance ? recognizedCash(fee.montant, fee.mouvementFinance, dossier.id, 'FRAIS_OUVERTURE_DOSSIER')
    : settledThroughInvoice ? exactMoney(fee.montant) : null;
  if (!fee) warnings.add('Frais d’ouverture non enregistrés : montant encaissé indisponible.');
  else if (fee.statut === 'PAYE' && totalFraisOuvertureEncaisse === null) warnings.add('Frais d’ouverture historiques : encaissement ou devise non confirmé.');
  const openingAmbiguity = !!fee?.factureId && (!!fee.mouvementFinance || !linkedInvoice);
  if (openingAmbiguity) warnings.add('Frais d’ouverture liés à une ancienne facture réglée ou non réconciliée : encaissement global indisponible.');
  if (factures.some(row => !row.eligible)) warnings.add('Les brouillons sont présentés séparément et exclus des créances exigibles.');
  const eligibleInvoices = factures.filter(row => row.eligible);
  const totalBrouillons = sumMoney(factures.filter(row => !row.eligible).map(row => row.montantTTC));
  const totalFacture = sumMoney(eligibleInvoices.map(row => row.montantTTC));
  const totalRegleFactures = duplicatedCash ? null : sumMoney(eligibleInvoices.map(row => row.montantRegle));
  const totalEncaisse = duplicatedCash ? null : sumMoney([totalPaiements, totalProvisionsEncaissees]);
  // A fee billed through an invoice is already included in payments/provisions cash flows.
  const totalEncaisseGlobal = duplicatedCash || openingAmbiguity ? null : fee?.factureId ? totalEncaisse : sumMoney([totalEncaisse, totalFraisOuvertureEncaisse]);
  const montants = { totalFacture, totalBrouillons, totalPaiements, totalProvisions, totalProvisionsEncaissees,
    totalProvisionsImputees, totalProvisionsLegacy, totalProvisionsDisponibles, totalRegleFactures,
    totalFraisOuvertureEncaisse, totalEncaisse, totalEncaisseGlobal,
    resteAPayer: duplicatedCash ? null : sumMoney(eligibleInvoices.map(row => row.resteAPayer)), tropPercu: duplicatedCash ? null : sumMoney(eligibleInvoices.map(row => row.tropPercu)) };
  return { version: 2, devise, perimetreFactures: 'HORS_BROUILLONS', montants,
    factures, provisions, fraisOuverture: fee ? {
      montant: exactMoney(fee.montant), statut: fee.statut, devise: currency(fee.mouvementFinance),
      facture: linkedInvoice ? { id: linkedInvoice.id, numero: linkedInvoice.numero } : null,
      facturation: openingAmbiguity ? 'A_VERIFIER' : fee.factureId ? 'FACTURE' : 'NON_FACTURE',
      encaissement: openingAmbiguity || totalFraisOuvertureEncaisse === null ? 'A_VERIFIER'
        : fee.statut !== 'PAYE' ? 'NON_CONFIRME' : fee.factureId ? 'VIA_FACTURE' : 'DIRECT',
      datePaiement: fee.datePaiement, moyenPaiement: fee.mouvementFinance?.moyenPaiement ?? null,
      recu: receipt(fee.mouvementFinance),
    } : null,
    avertissements: [...warnings] };
}

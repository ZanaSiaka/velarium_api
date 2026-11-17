/** Audit ponctuel, READ ONLY imposé par PostgreSQL. Aucun appel métier d'écriture. */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../generated/prisma/client';
import { BILLING_CASH_INCLUDE, BILLING_PROVISION_INCLUDE, readInvoiceBalance, recognizedCash } from '../src/common/finance/billing';
import { readProvisionBalance } from '../src/common/finance/financial-read';

type Finding = { code: string; qualification: string; entityType: string; id: string; relatedIds?: string[]; commentaire: string };
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('CONFIGURATION_ABSENTE');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const mode = await tx.$queryRaw<{ transaction_read_only: string }[]>`SHOW transaction_read_only`;
      if (mode[0]?.transaction_read_only !== 'on') throw new Error('LECTURE_SEULE_NON_CONFIRMEE');
      const [invoices, provisions, fees, accounts, movements] = await Promise.all([
        tx.facture.findMany({ select: { id: true, dossierId: true, statut: true, montantHT: true, montantTVA: true,
          tauxTVA: true, montantTTC: true, dateEcheance: true, lignes: true,
          paiements: { include: { mouvementFinance: { include: BILLING_CASH_INCLUDE } } },
          provisions: { select: { id: true } },
          imputationsProvision: { include: { provision: { include: BILLING_PROVISION_INCLUDE } } } } }),
        tx.provision.findMany({ include: BILLING_PROVISION_INCLUDE }),
        tx.fraisOuvertureDossier.findMany({ include: { mouvementFinance: { include: BILLING_CASH_INCLUDE } } }),
        tx.caisse.findMany({ select: { id: true, devise: true, active: true } }),
        tx.mouvementFinance.findMany({ include: BILLING_CASH_INCLUDE }),
      ]);
      const findings: Finding[] = [];
      const add = (code: string, qualification: string, entityType: string, id: string, commentaire: string, relatedIds?: string[]) =>
        findings.push({ code, qualification, entityType, id, commentaire, ...(relatedIds ? { relatedIds } : {}) });
      for (const invoice of invoices) {
        const balance = readInvoiceBalance(invoice);
        for (const payment of invoice.paiements) {
          if (!payment.mouvementFinanceId) add('PAIEMENT_SANS_MOUVEMENT', 'DONNEE_INCOMPLETE', 'Paiement', payment.id,
            'Absence du lien confirmée ; réalité de l’encaissement non déduite.', [invoice.id]);
          else if (recognizedCash(payment.montant, payment.mouvementFinance, invoice.dossierId, 'PAIEMENT_FACTURE') === null)
            add('PAIEMENT_NON_RECONCILIE', 'AMBIGUE', 'Paiement', payment.id, 'Lien, montant, source ou devise à vérifier.', [invoice.id, payment.mouvementFinanceId]);
        }
        if (balance.tropPercu !== null && new Prisma.Decimal(balance.tropPercu).greaterThan(0))
          add('EXCEDENT_RECONNU', 'ANOMALIE_CONFIRMEE', 'Facture', invoice.id, 'Excédent selon les lectures F3 ; aucune compensation automatique.');
        const arithmetic = invoice.paiements.reduce((sum, row) => sum.plus(row.montant), new Prisma.Decimal(0))
          .plus(invoice.imputationsProvision.reduce((sum, row) => sum.plus(row.montant), new Prisma.Decimal(0)));
        if (balance.totalRegle === null && arithmetic.greaterThan(invoice.montantTTC))
          add('DEPASSEMENT_ARITHMETIQUE_NON_RECONCILIE', 'AMBIGUE', 'Facture', invoice.id, 'Somme enregistrée supérieure au TTC, encaissement ou affectation non démontré.');
        if (balance.avertissements.some(message => message.includes('TVA stockée')))
          add('TVA_NON_RECONSTITUABLE', 'DECISION_CABINET', 'Facture', invoice.id, 'Typage historique insuffisant ; aucune erreur fiscale présumée.');
        if (balance.avertissements.some(message => message.includes('montants stockés et les lignes')))
          add('MONTANTS_LIGNES_A_VERIFIER', 'ANOMALIE_CONFIRMEE', 'Facture', invoice.id, 'Divergence des montants stockés et des lignes ; aucune réécriture.');
        if (balance.statutCalcule && balance.statutCalcule !== invoice.statut)
          add('STATUT_STOCKE_DIVERGENT', 'A_QUALIFIER', 'Facture', invoice.id, 'Peut résulter du passage du temps ; pas nécessairement une anomalie de trésorerie.');
      }
      for (const provision of provisions) {
        if (!provision.mouvementFinanceId) add('PROVISION_SANS_MOUVEMENT', 'DONNEE_INCOMPLETE', 'Provision', provision.id, 'Absence du lien confirmée ; encaissement réel non déduit.');
        else if (recognizedCash(provision.montant, provision.mouvementFinance, provision.dossierId, 'PROVISION') === null)
          add('PROVISION_NON_RECONCILIEE', 'AMBIGUE', 'Provision', provision.id, 'Mouvement ou devise à vérifier.', [provision.mouvementFinanceId]);
        if (provision.factureId) add('PROVISION_HISTORIQUE', 'AMBIGUE', 'Provision', provision.id, 'Le lien factureId ne démontre pas le montant affecté.', [provision.factureId]);
        if (readProvisionBalance(provision).mode === 'AMBIGUE') add('IMPUTATIONS_AMBIGUES', 'AMBIGUE', 'Provision', provision.id, 'Montants ou rattachements nécessitant justificatifs.');
        for (const row of provision.imputations) {
          const invoice = invoices.find(item => item.id === row.factureId);
          if (!invoice || invoice.dossierId !== provision.dossierId)
            add('IMPUTATION_HORS_DOSSIER', 'ANOMALIE_CONFIRMEE', 'ImputationProvision', row.id, 'Affectation hors du dossier de la provision.', [provision.id, row.factureId]);
        }
      }
      for (const fee of fees) if (fee.statut === 'PAYE' && !fee.mouvementFinanceId) {
        const invoice = invoices.find(row => row.id === fee.factureId);
        const balance = invoice ? readInvoiceBalance(invoice) : null;
        const viaInvoice = balance?.solde === '0.00' && balance.totalRegle !== null;
        add('FRAIS_PAYE_SANS_MOUVEMENT_DIRECT', viaInvoice ? 'HISTORIQUEMENT_VALIDE_VIA_FACTURE' : 'AMBIGUE', 'FraisOuvertureDossier', fee.id,
          viaInvoice ? 'Règlement via facture reconnu ; ne pas créer une seconde entrée.' : 'Statut PAYE sans preuve directe réconciliée ; ne pas conclure à une absence de paiement.', fee.factureId ? [fee.factureId] : undefined);
      }
      for (const account of accounts) if (account.devise === 'FCFA')
        add('COMPTE_FCFA', 'DECISION_CABINET', 'Caisse', account.id, 'Devise historique conservée, aucune normalisation.');
      const groups = new Map<string, string[]>();
      for (const row of movements) {
        if ([row.paiement, row.provision, row.fraisOuvertureDossier].filter(Boolean).length > 1)
          add('MOUVEMENT_PARTAGE', 'ANOMALIE_CONFIRMEE', 'MouvementFinance', row.id, 'Plusieurs origines métier utilisent le même mouvement.');
        // Similarity is a warning only, never proof, even with a matching reference.
        const key = JSON.stringify([row.type, row.montant.toFixed(2), row.date.toISOString().slice(0, 10), row.caisseId,
          row.caisseDestinationId, row.dossierId, row.categorie, row.source, row.reference, row.sourceReference]);
        groups.set(key, [...(groups.get(key) ?? []), row.id]);
      }
      for (const ids of groups.values()) if (ids.length > 1)
        add('DOUBLON_POTENTIEL', 'AMBIGUE', 'MouvementFinance', ids[0], 'Similarité de saisie ; vérifier références et justificatifs. Aucun doublon humain confirmé automatiquement.', ids.slice(1));
      return { generatedAt: new Date().toISOString(), readOnly: true, pseudonymise: true,
        avertissement: 'Confidentiel : identifiants techniques conservés, sans noms, coordonnées, références métier ou clés de stockage. Pas un plan d’exécution.',
        counts: { factures: invoices.length, provisions: provisions.length, paiements: invoices.reduce((n, row) => n + row.paiements.length, 0), frais: fees.length, comptes: accounts.length, mouvements: movements.length }, findings };
    }, { isolationLevel: 'RepeatableRead', maxWait: 10_000, timeout: 30_000 });
    mkdirSync('.temp', { recursive: true });
    const output = '.temp/finance-f5-anomalies-' + Date.now() + '.json';
    writeFileSync(output, JSON.stringify(result, null, 2), { encoding: 'utf8', flag: 'wx' });
    const counts: Record<string, number> = {};
    for (const row of result.findings) counts[row.code] = (counts[row.code] ?? 0) + 1;
    console.log(JSON.stringify({ readOnly: true, output, volumes: result.counts, anomalies: counts }));
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error('Audit F5 interrompu ; aucune écriture métier demandée. Vérifier configuration et accès sans publier les secrets.'); process.exitCode = 1; });

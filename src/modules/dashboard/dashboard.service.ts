import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

const MOIS_LABELS = [
  'Jan',
  'Fév',
  'Mar',
  'Avr',
  'Mai',
  'Juin',
  'Juil',
  'Août',
  'Sep',
  'Oct',
  'Nov',
  'Déc',
];

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [dossiersActifs, echeancesSemaine, paiementsDuMois, facturesImpayees, paiements6Mois, derniersPaiements] =
      await Promise.all([
        this.prisma.dossier.count({ where: { statut: 'EN_COURS' } }),
        this.prisma.evenement.count({
          where: { start: { gte: now, lte: in7Days } },
        }),
        this.prisma.paiement.findMany({
          where: { datePaiement: { gte: startOfMonth } },
          select: { montant: true },
        }),
        this.prisma.facture.findMany({
          where: { statut: { in: ['ENVOYEE', 'PARTIELLEMENT_PAYEE', 'EN_RETARD'] } },
          include: { paiements: true },
        }),
        this.prisma.paiement.findMany({
          where: { datePaiement: { gte: sixMonthsAgo } },
          select: { montant: true, datePaiement: true },
        }),
        this.prisma.paiement.findMany({
          orderBy: { datePaiement: 'desc' },
          take: 7,
          include: { facture: { include: { client: true } } },
        }),
      ]);

    const honorairesEncaissesMois = paiementsDuMois.reduce(
      (sum, p) => sum + Number(p.montant),
      0,
    );

    const impayes = facturesImpayees.reduce((sum, f) => {
      const paye = f.paiements.reduce((s, p) => s + Number(p.montant), 0);
      return sum + (Number(f.montantTTC) - paye);
    }, 0);

    const honorairesParMoisMap = new Map<string, number>();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      honorairesParMoisMap.set(MOIS_LABELS[d.getMonth()], 0);
    }
    for (const p of paiements6Mois) {
      const label = MOIS_LABELS[new Date(p.datePaiement).getMonth()];
      if (honorairesParMoisMap.has(label)) {
        honorairesParMoisMap.set(label, honorairesParMoisMap.get(label)! + Number(p.montant));
      }
    }

    return {
      dossiersActifs,
      echeancesSemaine,
      honorairesEncaissesMois,
      impayes,
      honorairesParMois: Array.from(honorairesParMoisMap.entries()).map(([month, total]) => ({
        month,
        total,
      })),
      derniersPaiements: derniersPaiements.map((p) => ({
        id: p.id,
        montant: Number(p.montant),
        datePaiement: p.datePaiement,
        numero: p.facture.numero,
        client: p.facture.client.nom,
      })),
    };
  }
}

import {
  BadRequestException,
  Injectable,
} from '@nestjs/common'

import { PrismaService } from '../../prisma/prisma.service'

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
]

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
  ) { }

  async getSummary(
    startDateParam?: string,
    endDateParam?: string,
  ) {
    const now = new Date()

    // ============================================================
    // PÉRIODE DU DASHBOARD
    // ============================================================

    const startDate = startDateParam
      ? new Date(`${startDateParam}T00:00:00.000`)
      : new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
      )

    const endDate = endDateParam
      ? new Date(`${endDateParam}T23:59:59.999`)
      : now

    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime())
    ) {
      throw new BadRequestException(
        'Dates invalides.',
      )
    }

    if (startDate > endDate) {
      throw new BadRequestException(
        'La date de début doit être antérieure à la date de fin.',
      )
    }

    // ============================================================
    // AUTRES DATES DU DASHBOARD
    // ============================================================

    const in7Days = new Date(
      now.getTime() +
      7 * 24 * 60 * 60 * 1000,
    )

    const startOfMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
    )

    const sixMonthsAgo = new Date(
      now.getFullYear(),
      now.getMonth() - 5,
      1,
    )

    // ============================================================
    // REQUÊTES
    // ============================================================

    const [
      clientsTotal,
      clientsActifs,
      dossiersActifs,
      echeancesSemaine,
      paiementsDuMois,
      facturesImpayees,
      paiements6Mois,
      derniersPaiements,
    ] = await Promise.all([

      // ==========================================================
      // NOMBRE DE CLIENTS
      //
      // Clients créés pendant la période sélectionnée.
      // ==========================================================

      this.prisma.client.count({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      }),

      // ==========================================================
      // CLIENTS ACTIFS
      //
      // Parmi les clients créés pendant la période,
      // on compte ceux qui ont au moins un dossier EN_COURS.
      // ==========================================================

      this.prisma.client.count({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },

          dossiers: {
            some: {
              statut: 'EN_COURS',
            },
          },
        },
      }),

      // ==========================================================
      // DOSSIERS ACTIFS
      //
      // KPI existant du dashboard.
      // ==========================================================

      this.prisma.dossier.count({
        where: {
          statut: 'EN_COURS',
        },
      }),

      // ==========================================================
      // ÉCHÉANCES DES 7 PROCHAINS JOURS
      // ==========================================================

      this.prisma.evenement.count({
        where: {
          start: {
            gte: now,
            lte: in7Days,
          },
        },
      }),

      // ==========================================================
      // PAIEMENTS DU MOIS
      // ==========================================================

      this.prisma.paiement.findMany({
        where: {
          datePaiement: {
            gte: startOfMonth,
          },
        },
        select: {
          montant: true,
        },
      }),

      // ==========================================================
      // FACTURES IMPAYÉES
      // ==========================================================

      this.prisma.facture.findMany({
        where: {
          statut: {
            in: [
              'ENVOYEE',
              'PARTIELLEMENT_PAYEE',
              'EN_RETARD',
            ],
          },
        },
        include: {
          paiements: true,
        },
      }),

      // ==========================================================
      // PAIEMENTS DES 6 DERNIERS MOIS
      // ==========================================================

      this.prisma.paiement.findMany({
        where: {
          datePaiement: {
            gte: sixMonthsAgo,
          },
        },
        select: {
          montant: true,
          datePaiement: true,
        },
      }),

      // ==========================================================
      // DERNIERS PAIEMENTS
      // ==========================================================

      this.prisma.paiement.findMany({
        orderBy: {
          datePaiement: 'desc',
        },
        take: 7,
        include: {
          facture: {
            include: {
              client: true,
            },
          },
        },
      }),
    ])

    // ============================================================
    // CLIENTS NON ACTIFS
    // ============================================================

    const clientsInactifs =
      clientsTotal - clientsActifs

    // ============================================================
    // HONORAIRES ENCAISSÉS DU MOIS
    // ============================================================

    const honorairesEncaissesMois =
      paiementsDuMois.reduce(
        (sum, p) =>
          sum + Number(p.montant),
        0,
      )

    // ============================================================
    // IMPAYÉS
    // ============================================================

    const impayes =
      facturesImpayees.reduce(
        (sum, facture) => {
          const paye =
            facture.paiements.reduce(
              (total, paiement) =>
                total + Number(paiement.montant),
              0,
            )

          return (
            sum +
            (
              Number(facture.montantTTC) -
              paye
            )
          )
        },
        0,
      )

    // ============================================================
    // HONORAIRES PAR MOIS
    // ============================================================

    const honorairesParMoisMap =
      new Map<string, number>()

    for (let i = 5; i >= 0; i--) {
      const date = new Date(
        now.getFullYear(),
        now.getMonth() - i,
        1,
      )

      honorairesParMoisMap.set(
        MOIS_LABELS[date.getMonth()],
        0,
      )
    }

    for (const paiement of paiements6Mois) {
      const label =
        MOIS_LABELS[
        new Date(
          paiement.datePaiement,
        ).getMonth()
        ]

      if (
        honorairesParMoisMap.has(label)
      ) {
        honorairesParMoisMap.set(
          label,
          honorairesParMoisMap.get(label)! +
          Number(paiement.montant),
        )
      }
    }

    // ============================================================
    // RÉPONSE DU DASHBOARD
    // ============================================================

    return {
      // ----------------------------------------------------------
      // KPI EXISTANTS
      // ----------------------------------------------------------

      dossiersActifs,

      echeancesSemaine,

      honorairesEncaissesMois,

      impayes,

      // ----------------------------------------------------------
      // KPI CLIENTS
      // ----------------------------------------------------------

      clients: {
        total: clientsTotal,

        actifs: clientsActifs,

        inactifs: clientsInactifs,
      },

      // ----------------------------------------------------------
      // PÉRIODE UTILISÉE
      // ----------------------------------------------------------

      periode: {
        startDate:
          startDate.toISOString(),

        endDate:
          endDate.toISOString(),
      },

      // ----------------------------------------------------------
      // HONORAIRES PAR MOIS
      // ----------------------------------------------------------

      honorairesParMois:
        Array.from(
          honorairesParMoisMap.entries(),
        ).map(
          ([month, total]) => ({
            month,
            total,
          }),
        ),

      // ----------------------------------------------------------
      // DERNIERS PAIEMENTS
      // ----------------------------------------------------------

      derniersPaiements:
        derniersPaiements.map(
          (paiement) => ({
            id: paiement.id,

            montant:
              Number(paiement.montant),

            datePaiement:
              paiement.datePaiement,

            numero:
              paiement.facture.numero,

            client:
              paiement.facture.client.nom,
          }),
        ),
    }
  }
}
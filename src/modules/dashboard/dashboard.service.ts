import {
  BadRequestException,
  Injectable,
} from '@nestjs/common'

import {
  FactureStatut,
  TypeMouvementFinance,
} from '../../../generated/prisma/client'

import {
  PrismaService,
} from '../../prisma/prisma.service'

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

const num = (
  value: unknown,
): number =>
  Number(
    value ??
    0,
  )

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma:
      PrismaService,
  ) { }

  async getSummary(
    startDateParam?: string,
    endDateParam?: string,
  ) {
    const now =
      new Date()

    const startDate =
      startDateParam
        ? new Date(
          `${startDateParam}T00:00:00.000Z`,
        )
        : new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            1,
          ),
        )

    const endDate =
      endDateParam
        ? new Date(
          `${endDateParam}T23:59:59.999Z`,
        )
        : now

    if (
      Number.isNaN(
        startDate.getTime(),
      ) ||
      Number.isNaN(
        endDate.getTime(),
      )
    ) {
      throw new BadRequestException(
        'Dates invalides.',
      )
    }

    if (
      startDate >
      endDate
    ) {
      throw new BadRequestException(
        'La date de début doit être antérieure à la date de fin.',
      )
    }

    const in7Days =
      new Date(
        now.getTime() +
        7 *
        24 *
        60 *
        60 *
        1000,
      )

    const sixMonthsAgo =
      new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth() -
          5,
          1,
        ),
      )

    const [
      clientsTotal,
      clientsActifs,
      dossiersActifs,
      echeancesSemaine,

      mouvementsEntreePeriode,
      mouvementsSortiePeriode,

      paiementsLegacyPeriode,
      provisionsLegacyPeriode,

      caisses,
      facturesImpayees,

      mouvementsEntree6Mois,
      mouvementsSortie6Mois,

      paiementsLegacy6Mois,
      provisionsLegacy6Mois,

      derniersPaiements,
    ] =
      await Promise.all([
        this.prisma.client.count({
          where: {
            createdAt: {
              gte:
                startDate,
              lte:
                endDate,
            },
          },
        }),

        this.prisma.client.count({
          where: {
            createdAt: {
              gte:
                startDate,
              lte:
                endDate,
            },
            dossiers: {
              some: {
                statut:
                  'EN_COURS',
              },
            },
          },
        }),

        this.prisma.dossier.count({
          where: {
            statut:
              'EN_COURS',
          },
        }),

        this.prisma.evenement.count({
          where: {
            start: {
              gte:
                now,
              lte:
                in7Days,
            },
          },
        }),

        this.prisma.mouvementFinance.findMany({
          where: {
            type:
              TypeMouvementFinance.ENTREE,
            date: {
              gte:
                startDate,
              lte:
                endDate,
            },
          },
          select: {
            montant:
              true,
          },
        }),

        this.prisma.mouvementFinance.findMany({
          where: {
            type: TypeMouvementFinance.SORTIE,
            date: {
              gte: sixMonthsAgo,
              lte: now,
            },
          },
          select: {
            montant: true,
            date: true,
          },
        }),
        // this.prisma.mouvementFinance.findMany({
        //   where: {
        //     type:
        //       TypeMouvementFinance.SORTIE,
        //     date: {
        //       gte:
        //         startDate,
        //       lte:
        //         endDate,
        //     },
        //   },
        //   select: {
        //     montant:
        //       true,
        //   },
        // }),

        this.prisma.paiement.findMany({
          where: {
            mouvementFinanceId:
              null,
            datePaiement: {
              gte:
                startDate,
              lte:
                endDate,
            },
          },
          select: {
            montant:
              true,
            datePaiement:
              true,
          },
        }),

        this.prisma.provision.findMany({
          where: {
            mouvementFinanceId:
              null,
            datePaiement: {
              gte:
                startDate,
              lte:
                endDate,
            },
          },
          select: {
            montant:
              true,
            datePaiement:
              true,
          },
        }),

        this.prisma.caisse.findMany({
          orderBy: {
            createdAt:
              'asc',
          },
          include: {
            mouvements:
              true,
            transfertsEntrants:
              true,
          },
        }),

        this.prisma.facture.findMany({
          where: {
            statut: {
              in: [
                FactureStatut.ENVOYEE,
                FactureStatut.PARTIELLEMENT_PAYEE,
                FactureStatut.EN_RETARD,
              ],
            },
          },
          select: {
            montantTTC:
              true,
            paiements: {
              select: {
                montant:
                  true,
              },
            },
            imputationsProvision: {
              select: {
                montant:
                  true,
              },
            },
            provisions: {
              select: {
                montant:
                  true,
              },
            },
          },
        }),

        this.prisma.mouvementFinance.findMany({
          where: {
            type:
              TypeMouvementFinance.ENTREE,
            date: {
              gte:
                sixMonthsAgo,
              lte:
                now,
            },
          },
          select: {
            montant:
              true,
            date:
              true,
          },
        }),

        this.prisma.mouvementFinance.findMany({
          where: {
            type:
              TypeMouvementFinance.SORTIE,
            date: {
              gte:
                sixMonthsAgo,
              lte:
                now,
            },
          },
          select: {
            montant:
              true,
            date:
              true,
          },
        }),

        this.prisma.paiement.findMany({
          where: {
            mouvementFinanceId:
              null,
            datePaiement: {
              gte:
                sixMonthsAgo,
              lte:
                now,
            },
          },
          select: {
            montant:
              true,
            datePaiement:
              true,
          },
        }),

        this.prisma.provision.findMany({
          where: {
            mouvementFinanceId:
              null,
            datePaiement: {
              gte:
                sixMonthsAgo,
              lte:
                now,
            },
          },
          select: {
            montant:
              true,
            datePaiement:
              true,
          },
        }),

        this.prisma.paiement.findMany({
          orderBy: {
            datePaiement:
              'desc',
          },
          take:
            7,
          include: {
            facture: {
              include: {
                client:
                  true,
              },
            },
          },
        }),
      ])

    const clientsInactifs =
      clientsTotal -
      clientsActifs

    const totalEntreesModernes =
      mouvementsEntreePeriode.reduce(
        (
          total,
          mouvement,
        ) =>
          total +
          num(
            mouvement.montant,
          ),
        0,
      )

    const totalPaiementsLegacy =
      paiementsLegacyPeriode.reduce(
        (
          total,
          paiement,
        ) =>
          total +
          num(
            paiement.montant,
          ),
        0,
      )

    const totalProvisionsLegacy =
      provisionsLegacyPeriode.reduce(
        (
          total,
          provision,
        ) =>
          total +
          num(
            provision.montant,
          ),
        0,
      )

    const totalEntrees =
      totalEntreesModernes +
      totalPaiementsLegacy +
      totalProvisionsLegacy

    const totalSorties =
      mouvementsSortiePeriode.reduce(
        (
          total,
          mouvement,
        ) =>
          total +
          num(
            mouvement.montant,
          ),
        0,
      )

    const detailComptes =
      caisses.map(
        (
          caisse,
        ) => {
          const soldeInitial =
            num(
              caisse.soldeInitial,
            )

          let entrees =
            0

          let sorties =
            0

          for (
            const mouvement
            of caisse.mouvements
          ) {
            const montant =
              num(
                mouvement.montant,
              )

            if (
              mouvement.type ===
              TypeMouvementFinance.ENTREE
            ) {
              entrees +=
                montant
            }

            if (
              mouvement.type ===
              TypeMouvementFinance.SORTIE
            ) {
              sorties +=
                montant
            }

            if (
              mouvement.type ===
              TypeMouvementFinance.TRANSFERT
            ) {
              sorties +=
                montant
            }
          }

          for (
            const transfert
            of caisse.transfertsEntrants
          ) {
            if (
              transfert.type ===
              TypeMouvementFinance.TRANSFERT
            ) {
              entrees +=
                num(
                  transfert.montant,
                )
            }
          }

          return {
            id:
              caisse.id,
            solde:
              soldeInitial +
              entrees -
              sorties,
          }
        },
      )

    const soldeGlobal =
      detailComptes.reduce(
        (
          total,
          compte,
        ) =>
          total +
          compte.solde,
        0,
      )

    const impayes =
      facturesImpayees.reduce(
        (
          totalGlobal,
          facture,
        ) => {
          const totalPaiements =
            facture.paiements.reduce(
              (
                total,
                paiement,
              ) =>
                total +
                num(
                  paiement.montant,
                ),
              0,
            )

          const totalImputations =
            facture
              .imputationsProvision
              .reduce(
                (
                  total,
                  imputation,
                ) =>
                  total +
                  num(
                    imputation.montant,
                  ),
                0,
              )

          const totalLegacyFacture =
            facture.provisions.reduce(
              (
                total,
                provision,
              ) =>
                total +
                num(
                  provision.montant,
                ),
              0,
            )

          const totalRegle =
            totalPaiements +
            totalImputations +
            totalLegacyFacture

          const solde =
            Math.max(
              num(
                facture.montantTTC,
              ) -
              totalRegle,
              0,
            )

          return (
            totalGlobal +
            solde
          )
        },
        0,
      )

    const entreesParMoisMap =
      new Map<
        string,
        number
      >()

    const sortiesParMoisMap =
      new Map<
        string,
        number
      >()

    for (
      let i = 5;
      i >= 0;
      i--
    ) {
      const date =
        new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth() -
            i,
            1,
          ),
        )

      const label =
        MOIS_LABELS[
        date.getUTCMonth()
        ]

      entreesParMoisMap.set(
        label,
        0,
      )

      sortiesParMoisMap.set(
        label,
        0,
      )
    }

    const addToMap = (
      map:
        Map<
          string,
          number
        >,

      date:
        Date,

      montant:
        number,
    ) => {
      const label =
        MOIS_LABELS[
        date.getUTCMonth()
        ]

      if (
        !map.has(
          label,
        )
      ) {
        return
      }

      map.set(
        label,
        (
          map.get(
            label,
          ) ??
          0
        ) +
        montant,
      )
    }

    for (
      const mouvement
      of mouvementsEntree6Mois
    ) {
      addToMap(
        entreesParMoisMap,
        new Date(
          mouvement.date,
        ),
        num(
          mouvement.montant,
        ),
      )
    }

    for (
      const paiement
      of paiementsLegacy6Mois
    ) {
      addToMap(
        entreesParMoisMap,
        new Date(
          paiement.datePaiement,
        ),
        num(
          paiement.montant,
        ),
      )
    }

    for (
      const provision
      of provisionsLegacy6Mois
    ) {
      addToMap(
        entreesParMoisMap,
        new Date(
          provision.datePaiement,
        ),
        num(
          provision.montant,
        ),
      )
    }

    // for (
    //   const mouvement
    //   of mouvementsSortie6Mois
    // ) {
    //   addToMap(
    //     sortiesParMoisMap,
    //     new Date(
    //       mouvement.date,
    //     ),
    //     num(
    //       mouvement.montant,
    //     ),
    //   )
    // }

    for (
      const mouvement
      of mouvementsSortie6Mois
    ) {
      const date =
        new Date(
          mouvement.date,
        )

      const label =
        MOIS_LABELS[
        date.getUTCMonth()
        ]

      sortiesParMoisMap.set(
        label,
        (
          sortiesParMoisMap.get(
            label,
          ) ?? 0
        ) +
        Number(
          mouvement.montant,
        ),
      )
    }

    const entreesParMois =
      Array.from(
        entreesParMoisMap.entries(),
      ).map(
        (
          [
            month,
            total,
          ],
        ) => ({
          month,
          total,
        }),
      )

    // const sortiesParMois =
    //   Array.from(
    //     sortiesParMoisMap.entries(),
    //   ).map(
    //     (
    //       [
    //         month,
    //         total,
    //       ],
    //     ) => ({
    //       month,
    //       total,
    //     }),
    //   )

    const sortiesParMois =
      Array.from(
        sortiesParMoisMap.entries(),
      ).map(
        ([month, total]) => ({
          month,
          total,
        }),
      )

    console.log(
      "COURBES DASHBOARD",
      {
        entreesParMois,
        sortiesParMois,
      },
    )

    return {
      dossiersActifs,
      echeancesSemaine,
      totalEntrees,
      totalSorties,
      soldeGlobal,
      impayes,

      clients: {
        total:
          clientsTotal,
        actifs:
          clientsActifs,
        inactifs:
          clientsInactifs,
      },

      periode: {
        startDate:
          startDate.toISOString(),
        endDate:
          endDate.toISOString(),
      },

      entreesParMois,
      sortiesParMois,

      derniersPaiements:
        derniersPaiements.map(
          (
            paiement,
          ) => ({
            id:
              paiement.id,
            montant:
              num(
                paiement.montant,
              ),
            datePaiement:
              paiement.datePaiement,
            numero:
              paiement
                .facture
                .numero,
            client:
              paiement
                .facture
                .client
                .nom,
          }),
        ),
    }
  }
}

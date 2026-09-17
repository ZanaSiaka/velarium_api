import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'

import { PrismaService } from '../../prisma/prisma.service'
import { ActivityLogService } from '../activity-log/activity-log.service'
import { CreateDossierDto } from './dto/create-dossier.dto'
import { UpdateDossierDto } from './dto/update-dossier.dto'

@Injectable()
export class DossiersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) { }

  // ============================================================
  // LISTE DES DOSSIERS
  // ============================================================

  // findAll() {
  //   return this.prisma.dossier.findMany({
  //     orderBy: {
  //       createdAt: 'desc',
  //     },

  //     include: {
  //       client: true,
  //       avocatResponsable: true,
  //     },
  //   })
  // }

  findAll() {
    return this.prisma.dossier.findMany({
      where: {
        archive: false,
      },

      orderBy: {
        createdAt: 'desc',
      },

      include: {
        client: true,
        avocatResponsable: true,
      },
    })
  }

  // ============================================================
  // LISTE DES DOSSIERS ARCHIVÉS
  // ============================================================

  findArchived() {
    return this.prisma.dossier.findMany({
      where: {
        archive: true,
      },

      orderBy: {
        archivedAt: 'desc',
      },

      include: {
        client: true,
        avocatResponsable: true,
      },
    })
  }

  // ============================================================
  // DETAIL D'UN DOSSIER
  // ============================================================



  async getLivrePaiements(id: string) {
    const dossier = await this.prisma.dossier.findUnique({
      where: { id },
      include: {
        client: true,
        factures: {
          orderBy: { dateEmission: 'asc' },
          include: {
            paiements: {
              orderBy: { datePaiement: 'asc' },
            },
          },
        },
        provisions: {
          orderBy: { datePaiement: 'asc' },
        },
      },
    })

    if (!dossier) {
      throw new NotFoundException('Dossier introuvable.')
    }

    // ============================================================
    // TOTAL DES FACTURES
    // ============================================================

    const totalFacture = dossier.factures.reduce(
      (sum, facture) =>
        sum + Number(facture.montantTTC),
      0,
    )

    // ============================================================
    // TOTAL DES PAIEMENTS
    // ============================================================

    const totalPaiements = dossier.factures.reduce(
      (sum, facture) =>
        sum +
        facture.paiements.reduce(
          (paiementSum, paiement) =>
            paiementSum + Number(paiement.montant),
          0,
        ),
      0,
    )

    // ============================================================
    // TOTAL DES PROVISIONS
    // ============================================================

    const totalProvisions = dossier.provisions.reduce(
      (sum, provision) =>
        sum + Number(provision.montant),
      0,
    )

    // ============================================================
    // TOTAL ENCAISSÉ
    // ============================================================

    const totalEncaisse =
      totalPaiements + totalProvisions

    // ============================================================
    // SITUATION FINANCIÈRE
    //
    // Option 2 :
    // - un dépassement devient un trop-perçu
    // - le reste à payer ne peut jamais être négatif
    // ============================================================

    const resteAPayer = Math.max(
      totalFacture - totalEncaisse,
      0,
    )

    const tropPercu = Math.max(
      totalEncaisse - totalFacture,
      0,
    )

    // ============================================================
    // HISTORIQUE DES OPÉRATIONS
    // ============================================================

    const operations = [
      ...dossier.factures.flatMap((facture) =>
        facture.paiements.map((paiement) => ({
          id: paiement.id,
          type: 'PAIEMENT' as const,
          date: paiement.datePaiement,
          montant: Number(paiement.montant),
          moyenPaiement: paiement.moyenPaiement,
          note: paiement.note,
          facture: {
            id: facture.id,
            numero: facture.numero,
            montantTTC: Number(facture.montantTTC),
          },
        })),
      ),

      ...dossier.provisions.map((provision) => ({
        id: provision.id,
        type: 'PROVISION' as const,
        date: provision.datePaiement,
        montant: Number(provision.montant),
        moyenPaiement: provision.moyenPaiement,
        note: provision.note,
        facture: null,
      })),
    ].sort(
      (a, b) =>
        new Date(a.date).getTime() -
        new Date(b.date).getTime(),
    )

    // ============================================================
    // RÉPONSE
    // ============================================================

    return {
      dossier: {
        id: dossier.id,
        reference: dossier.reference,
        client: dossier.client,
      },

      totalFacture,
      totalPaiements,
      totalProvisions,
      totalEncaisse,

      resteAPayer,
      tropPercu,

      operations,
    }
  }
  async findOne(id: string) {
    const dossier = await this.prisma.dossier.findUnique({
      where: {
        id,
      },

      include: {
        client: true,

        avocatResponsable: true,

        collaborateurs: {
          include: {
            user: true,
          },
        },

        evenements: {
          orderBy: {
            start: 'asc',
          },
        },

        factures: {
          orderBy: {
            dateEmission: 'asc',
          },

          include: {
            lignes: true,

            paiements: {
              orderBy: {
                datePaiement: 'asc',
              },
            },
          },
        },

        provisions: {
          orderBy: {
            datePaiement: 'asc',
          },
        },
      },
    })

    if (!dossier) {
      throw new NotFoundException(
        'Dossier introuvable.',
      )
    }

    return dossier
  }
  // ============================================================
  // GENERATION DE LA REFERENCE
  // ============================================================

  private async generateReference() {
    const year = new Date().getFullYear()

    const count =
      await this.prisma.dossier.count({
        where: {
          reference: {
            startsWith: `${year}-`,
          },
        },
      })

    return `${year}-${String(
      count + 1,
    ).padStart(3, '0')}`
  }

  // ============================================================
  // CREATION
  // ============================================================

  async create(
    dto: CreateDossierDto,
    userId: string,
  ) {
    const reference =
      await this.generateReference()

    const dossier =
      await this.prisma.dossier.create({
        data: {
          reference,

          // Informations du dossier
          natureAffaire:
            dto.natureAffaire,

          typeDossier:
            dto.typeDossier,

          statut:
            dto.statut,

          // Client
          clientId:
            dto.clientId,

          // Avocat responsable
          avocatResponsableId:
            dto.avocatResponsableId,

          // Avocat du client
          avocatClientNom:
            dto.avocatClientNom || null,

          avocatClientEmail:
            dto.avocatClientEmail || null,

          avocatClientTelephone:
            dto.avocatClientTelephone || null,

          // Informations juridiques
          juridiction:
            dto.juridiction || null,

          partieAdverse:
            dto.partieAdverse || null,

          // KYC
          kycSoupcon:
            dto.kycSoupcon,

          declarationSoupcon:
            dto.kycSoupcon
              ? dto.declarationSoupcon || null
              : null,

          // Collaborateurs
          collaborateurs: {
            create: (
              dto.collaborateurIds ?? []
            ).map((userId) => ({
              userId,
            })),
          },
        },
      })

    // ==========================================================
    // JOURNAL D'ACTIVITE
    // ==========================================================

    await this.activityLog.log({
      userId,

      action: 'DOSSIER_CREE',

      entityType: 'Dossier',

      entityId: dossier.id,

      dossierId: dossier.id,

      metadata: {
        reference:
          dossier.reference,
      },
    })

    return dossier
  }

  // ============================================================
  // MODIFICATION
  // ============================================================

  async update(
    id: string,
    dto: UpdateDossierDto,
    userId: string,
  ) {
    await this.findOne(id)

    const dossier =
      await this.prisma.$transaction(
        async (tx) => {
          // On reconstruit la liste des collaborateurs
          // avec les valeurs reçues.
          await tx.dossierCollaborateur.deleteMany(
            {
              where: {
                dossierId: id,
              },
            },
          )

          return tx.dossier.update({
            where: {
              id,
            },

            data: {
              // Informations du dossier
              natureAffaire:
                dto.natureAffaire,

              typeDossier:
                dto.typeDossier,
              statut: dto.statut,
              dateCloture:
                dto.statut === 'CLOTURE'
                  ? new Date()
                  : dto.statut
                    ? null
                    : undefined,
              // Client
              clientId:
                dto.clientId,

              // Avocat responsable
              avocatResponsableId:
                dto.avocatResponsableId,

              // Avocat du client
              avocatClientNom:
                dto.avocatClientNom || null,

              avocatClientEmail:
                dto.avocatClientEmail || null,

              avocatClientTelephone:
                dto.avocatClientTelephone || null,

              // Informations juridiques
              juridiction:
                dto.juridiction || null,

              partieAdverse:
                dto.partieAdverse || null,

              // KYC
              kycSoupcon:
                dto.kycSoupcon ?? false,

              declarationSoupcon:
                dto.kycSoupcon
                  ? dto.declarationSoupcon ||
                  null
                  : null,

              // Collaborateurs
              collaborateurs: {
                create: (
                  dto.collaborateurIds ?? []
                ).map((userId) => ({
                  userId,
                })),
              },
            },
          })
        },
      )

    // ==========================================================
    // JOURNAL D'ACTIVITE
    // ==========================================================

    await this.activityLog.log({
      userId,

      action: 'DOSSIER_MODIFIE',

      entityType: 'Dossier',

      entityId: dossier.id,

      dossierId: dossier.id,

      metadata: {
        reference:
          dossier.reference,
      },
    })


    return dossier
  }
  // ============================================================
  // ARCHIVAGE
  // ============================================================

  // ============================================================
  // ARCHIVAGE
  // ============================================================

  async archive(
    id: string,
    userId: string,
  ) {
    const dossier = await this.findOne(id)

    // Un dossier doit obligatoirement être clôturé
    // avant de pouvoir être archivé.
    if (dossier.statut !== 'CLOTURE') {
      throw new BadRequestException(
        'Seul un dossier clôturé peut être archivé.',
      )
    }

    // Déjà archivé
    if (dossier.archive) {
      return dossier
    }

    const archivedDossier =
      await this.prisma.dossier.update({
        where: {
          id,
        },

        data: {
          archive: true,
          archivedAt: new Date(),
        },
      })

    await this.activityLog.log({
      userId,

      action: 'DOSSIER_ARCHIVE',

      entityType: 'Dossier',

      entityId: archivedDossier.id,

      dossierId: archivedDossier.id,

      metadata: {
        reference: archivedDossier.reference,
      },
    })

    return archivedDossier
  }
  // ============================================================
  // DÉSARCHIVAGE
  // ============================================================

  async unarchive(
    id: string,
    userId: string,
  ) {
    const dossier = await this.findOne(id)

    if (!dossier.archive) {
      return dossier
    }

    const unarchivedDossier =
      await this.prisma.dossier.update({
        where: {
          id,
        },

        data: {
          archive: false,
          archivedAt: null,
        },
      })

    await this.activityLog.log({
      userId,

      action: 'DOSSIER_DESARCHIVE',

      entityType: 'Dossier',

      entityId: unarchivedDossier.id,

      dossierId: unarchivedDossier.id,

      metadata: {
        reference: unarchivedDossier.reference,
      },
    })

    return unarchivedDossier
  }

}

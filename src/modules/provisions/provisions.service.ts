import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateProvisionDto } from './dto/create-provision.dto';

function num(value: unknown): number {
  return Number(value);
}

@Injectable()
export class ProvisionsService {
  constructor(
    private readonly prisma: PrismaService,
  ) { }

  /**
   * Liste les provisions.
   *
   * Si dossierId est fourni :
   * retourne uniquement les provisions de ce dossier.
   *
   * Une provision peut être :
   * - générale : factureId = null
   * - affectée : factureId = l'id d'une facture
   */
  async findAll(dossierId?: string) {
    const provisions =
      await this.prisma.provision.findMany({
        where: dossierId
          ? { dossierId }
          : undefined,

        orderBy: {
          datePaiement: 'desc',
        },

        include: {
          facture: {
            select: {
              id: true,
              numero: true,
              montantTTC: true,
            },
          },
        },
      });

    return provisions.map((provision) => ({
      ...provision,

      montant: num(provision.montant),

      facture: provision.facture
        ? {
          ...provision.facture,
          montantTTC: num(
            provision.facture.montantTTC,
          ),
        }
        : null,
    }));
  }

  /**
   * Création d'une provision.
   *
   * Une provision peut être créée AVANT la facture.
   *
   * Dans ce cas :
   * factureId = null
   *
   * Elle reste donc une provision générale du dossier.
   *
   * Elle pourra ensuite être affectée à une facture
   * avec assignToFacture().
   */
  async create(dto: CreateProvisionDto) {
    /**
     * Vérification du dossier.
     */
    const dossier =
      await this.prisma.dossier.findUnique({
        where: {
          id: dto.dossierId,
        },
      });

    if (!dossier) {
      throw new NotFoundException(
        'Dossier introuvable.',
      );
    }

    /**
     * Une valeur vide ou "AUCUNE" signifie :
     * provision générale du dossier.
     *
     * Cela protège également le backend si le frontend
     * envoie "AUCUNE".
     */
    const factureId =
      dto.factureId &&
        dto.factureId !== 'AUCUNE'
        ? dto.factureId
        : null;

    /**
     * Si une facture est sélectionnée dès la création
     * de la provision, on vérifie qu'elle appartient
     * bien au même dossier et que son solde permet
     * d'accueillir la provision.
     */
    if (factureId) {
      const facture =
        await this.prisma.facture.findUnique({
          where: {
            id: factureId,
          },

          include: {
            paiements: true,
            provisions: true,
          },
        });

      if (!facture) {
        throw new NotFoundException(
          'Facture introuvable.',
        );
      }

      /**
       * La facture et la provision doivent appartenir
       * au même dossier.
       */
      if (
        facture.dossierId !==
        dto.dossierId
      ) {
        throw new BadRequestException(
          'La facture et la provision doivent appartenir au même dossier.',
        );
      }

      const totalPaiements =
        facture.paiements.reduce(
          (sum, paiement) =>
            sum + Number(paiement.montant),
          0,
        );

      const totalProvisions =
        facture.provisions.reduce(
          (sum, provision) =>
            sum + Number(provision.montant),
          0,
        );

      const montantTTC =
        Number(facture.montantTTC);

      const soldeDisponible =
        montantTTC -
        totalPaiements -
        totalProvisions;

      if (
        dto.montant >
        Math.max(0, soldeDisponible)
      ) {
        throw new BadRequestException(
          `La provision de ${dto.montant.toLocaleString(
            'fr-FR',
          )} FCFA dépasse le solde disponible de la facture (${Math.max(
            0,
            soldeDisponible,
          ).toLocaleString(
            'fr-FR',
          )} FCFA).`,
        );
      }
    }

    /**
     * Création de la provision.
     */
    const provision =
      await this.prisma.provision.create({
        data: {
          dossierId: dto.dossierId,

          factureId,

          montant: dto.montant,

          datePaiement:
            dto.datePaiement
              ? new Date(
                dto.datePaiement,
              )
              : undefined,

          moyenPaiement:
            dto.moyenPaiement || null,

          note: dto.note || null,
        },

        include: {
          facture: {
            select: {
              id: true,
              numero: true,
              montantTTC: true,
            },
          },
        },
      });

    /**
     * Si la provision a été directement affectée
     * à une facture, on recalcule son statut.
     */
    if (factureId) {
      await this.recalculateFactureStatus(
        factureId,
      );
    }

    return {
      ...provision,

      montant: num(
        provision.montant,
      ),

      facture: provision.facture
        ? {
          ...provision.facture,

          montantTTC: num(
            provision.facture.montantTTC,
          ),
        }
        : null,
    };
  }

  /**
   * Affecte une provision générale à une facture.
   *
   * Exemple :
   *
   * Dossier
   * └── Provision générale : 100 000 FCFA
   *
   * Facture créée ensuite :
   * └── 500 000 FCFA
   *
   * Après affectation :
   *
   * Facture : 500 000
   * Provision : 100 000
   * Solde : 400 000
   */
  async assignToFacture(
    provisionId: string,
    factureId: string,
  ) {
    /**
     * Récupération de la provision.
     */
    const provision =
      await this.prisma.provision.findUnique({
        where: {
          id: provisionId,
        },
      });

    if (!provision) {
      throw new NotFoundException(
        'Provision introuvable.',
      );
    }

    /**
     * Une provision déjà affectée ne peut pas
     * être affectée une deuxième fois.
     */
    if (provision.factureId) {
      throw new BadRequestException(
        'Cette provision est déjà affectée à une facture.',
      );
    }

    /**
     * Récupération de la facture.
     */
    const facture =
      await this.prisma.facture.findUnique({
        where: {
          id: factureId,
        },

        include: {
          paiements: true,
          provisions: true,
        },
      });

    if (!facture) {
      throw new NotFoundException(
        'Facture introuvable.',
      );
    }

    /**
     * La provision ne peut être affectée
     * qu'à une facture du même dossier.
     */
    if (
      facture.dossierId !==
      provision.dossierId
    ) {
      throw new BadRequestException(
        'La facture et la provision doivent appartenir au même dossier.',
      );
    }

    /**
     * Total des paiements déjà enregistrés.
     */
    const totalPaiements =
      facture.paiements.reduce(
        (sum, paiement) =>
          sum + Number(paiement.montant),
        0,
      );

    /**
     * Total des provisions déjà affectées
     * à cette facture.
     *
     * La provision actuelle n'est pas encore
     * dans cette liste puisqu'elle est générale.
     */
    const totalProvisions =
      facture.provisions.reduce(
        (sum, existingProvision) =>
          sum +
          Number(
            existingProvision.montant,
          ),
        0,
      );

    const montantTTC =
      Number(facture.montantTTC);

    /**
     * Solde avant l'affectation.
     */
    const soldeDisponible =
      montantTTC -
      totalPaiements -
      totalProvisions;

    /**
     * Vérification du montant de la provision.
     */
    if (
      Number(provision.montant) >
      Math.max(0, soldeDisponible)
    ) {
      throw new BadRequestException(
        `La provision de ${Number(
          provision.montant,
        ).toLocaleString(
          'fr-FR',
        )} FCFA dépasse le solde disponible de la facture (${Math.max(
          0,
          soldeDisponible,
        ).toLocaleString(
          'fr-FR',
        )} FCFA).`,
      );
    }

    /**
     * Affectation réelle.
     */
    const updated =
      await this.prisma.provision.update({
        where: {
          id: provisionId,
        },

        data: {
          factureId,
        },

        include: {
          facture: {
            select: {
              id: true,
              numero: true,
              montantTTC: true,
            },
          },
        },
      });

    /**
     * IMPORTANT :
     * Maintenant que la provision possède
     * factureId, elle entre dans le calcul
     * de la facture.
     *
     * On recalcule donc immédiatement
     * le statut de la facture.
     */
    await this.recalculateFactureStatus(
      factureId,
    );

    return {
      ...updated,

      montant: num(
        updated.montant,
      ),

      facture: updated.facture
        ? {
          ...updated.facture,

          montantTTC: num(
            updated.facture.montantTTC,
          ),
        }
        : null,
    };
  }

  /**
   * Retire une provision d'une facture.
   *
   * Elle redevient une provision générale du dossier.
   *
   * factureId = null
   */
  async unassignFromFacture(
    provisionId: string,
  ) {
    const provision =
      await this.prisma.provision.findUnique({
        where: {
          id: provisionId,
        },
      });

    if (!provision) {
      throw new NotFoundException(
        'Provision introuvable.',
      );
    }

    if (!provision.factureId) {
      throw new BadRequestException(
        'Cette provision n’est affectée à aucune facture.',
      );
    }

    /**
     * On mémorise la facture actuelle
     * avant de supprimer la relation.
     */
    const factureId =
      provision.factureId;

    /**
     * Suppression de l'affectation.
     *
     * La provision reste dans le dossier,
     * mais redevient générale.
     */
    const updated =
      await this.prisma.provision.update({
        where: {
          id: provisionId,
        },

        data: {
          factureId: null,
        },
      });

    /**
     * La facture vient de perdre une provision.
     *
     * Il faut donc recalculer son statut.
     */
    await this.recalculateFactureStatus(
      factureId,
    );

    return {
      ...updated,

      montant: num(
        updated.montant,
      ),
    };
  }

  /**
   * Recalcule le statut d'une facture
   * à partir de ses paiements ET de ses provisions
   * affectées.
   *
   * Règle :
   *
   * total réglé = paiements + provisions
   *
   * total réglé >= TTC
   *      => PAYEE
   *
   * total réglé > 0
   *      => PARTIELLEMENT_PAYEE
   *
   * total réglé = 0
   *      => ENVOYEE
   */
  private async recalculateFactureStatus(
    factureId: string,
  ) {
    const facture =
      await this.prisma.facture.findUnique({
        where: {
          id: factureId,
        },

        include: {
          paiements: true,
          provisions: true,
        },
      });

    if (!facture) {
      throw new NotFoundException(
        'Facture introuvable.',
      );
    }

    const totalPaiements =
      facture.paiements.reduce(
        (sum, paiement) =>
          sum + Number(paiement.montant),
        0,
      );

    const totalProvisions =
      facture.provisions.reduce(
        (sum, provision) =>
          sum + Number(provision.montant),
        0,
      );

    const montantTTC =
      Number(facture.montantTTC);

    const totalRegle =
      totalPaiements +
      totalProvisions;

    let statut:
      | 'ENVOYEE'
      | 'PARTIELLEMENT_PAYEE'
      | 'PAYEE';

    if (totalRegle >= montantTTC) {
      statut = 'PAYEE';
    } else if (totalRegle > 0) {
      statut = 'PARTIELLEMENT_PAYEE';
    } else {
      statut = 'ENVOYEE';
    }

    return this.prisma.facture.update({
      where: {
        id: factureId,
      },

      data: {
        statut,
      },
    });
  }
}
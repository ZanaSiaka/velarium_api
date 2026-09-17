import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { FinancePermissionService } from './finance-permission.service';

import { CreateCaisseDto } from './dto/create-caisse.dto';
import { UpdateCaisseDto } from './dto/update-caisse.dto';
import { CreateMouvementDto } from './dto/create-mouvement.dto';

import { Role } from '../../../generated/prisma/client';

@Injectable()
export class FinanceService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly activityLog: ActivityLogService,
        private readonly permissions: FinancePermissionService,
    ) { }

    // ============================================================
    // CAISSES
    // ============================================================

    async findCaisses(
        role: Role,
    ) {
        this.permissions.require(
            this.permissions.canViewCaisses(role),
            'Vous n’avez pas les permissions nécessaires pour consulter les caisses.',
        );

        const caisses =
            await this.prisma.caisse.findMany({
                orderBy: {
                    createdAt: 'asc',
                },

                include: {
                    mouvements: true,
                    transfertsEntrants: true,
                },
            });

        return caisses.map(
            (caisse) => {
                const soldeInitial =
                    Number(
                        caisse.soldeInitial,
                    );

                let totalEntrees = 0;
                let totalSorties = 0;

                // ------------------------------------------------
                // MOUVEMENTS DE LA CAISSE
                // ------------------------------------------------

                for (
                    const mouvement
                    of caisse.mouvements
                ) {
                    const montant =
                        Number(
                            mouvement.montant,
                        );

                    if (
                        mouvement.type ===
                        'ENTREE'
                    ) {
                        totalEntrees +=
                            montant;
                    }

                    if (
                        mouvement.type ===
                        'SORTIE'
                    ) {
                        totalSorties +=
                            montant;
                    }

                    if (
                        mouvement.type ===
                        'TRANSFERT'
                    ) {
                        totalSorties +=
                            montant;
                    }
                }

                // ------------------------------------------------
                // TRANSFERTS ENTRANTS
                // ------------------------------------------------

                for (
                    const mouvement
                    of caisse.transfertsEntrants
                ) {
                    if (
                        mouvement.type ===
                        'TRANSFERT'
                    ) {
                        totalEntrees +=
                            Number(
                                mouvement.montant,
                            );
                    }
                }

                const solde =
                    soldeInitial +
                    totalEntrees -
                    totalSorties;

                const hasHistory =
                    caisse.mouvements.length >
                    0 ||
                    caisse.transfertsEntrants.length >
                    0;

                return {
                    id:
                        caisse.id,

                    nom:
                        caisse.nom,

                    type:
                        caisse.type,

                    devise:
                        caisse.devise,

                    soldeInitial,

                    totalEntrees,

                    totalSorties,

                    solde,

                    active:
                        caisse.active,

                    /**
                     * Information utile pour le frontend :
                     * dès qu'un mouvement existe,
                     * le solde initial devient immuable.
                     */
                    hasHistory,

                    createdAt:
                        caisse.createdAt,

                    updatedAt:
                        caisse.updatedAt,
                };
            },
        );
    }

    // ============================================================
    // CAISSE DETAIL
    // ============================================================

    async findCaisse(
        id: string,
        role: Role,
    ) {
        this.permissions.require(
            this.permissions.canViewCaisses(role),
            'Vous n’avez pas les permissions nécessaires pour consulter les caisses.',
        );

        const caisse =
            await this.prisma.caisse.findUnique({
                where: {
                    id,
                },
            });

        if (!caisse) {
            throw new NotFoundException(
                'Caisse introuvable.',
            );
        }

        const mouvements =
            await this.prisma.mouvementFinance.findMany({
                where: {
                    OR: [
                        {
                            caisseId:
                                id,
                        },

                        {
                            caisseDestinationId:
                                id,
                        },
                    ],
                },

                orderBy: {
                    date:
                        'desc',
                },

                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },

                    dossier: {
                        select: {
                            id: true,
                            reference: true,
                        },
                    },

                    caisse: {
                        select: {
                            id: true,
                            nom: true,
                            type: true,
                        },
                    },

                    caisseDestination: {
                        select: {
                            id: true,
                            nom: true,
                            type: true,
                        },
                    },
                },
            });

        const soldeInitial =
            Number(
                caisse.soldeInitial,
            );

        let totalEntrees = 0;
        let totalSorties = 0;

        for (
            const mouvement
            of mouvements
        ) {
            const montant =
                Number(
                    mouvement.montant,
                );

            // ------------------------------------------------
            // ENTREE
            // ------------------------------------------------

            if (
                mouvement.type ===
                'ENTREE' &&
                mouvement.caisseId ===
                id
            ) {
                totalEntrees +=
                    montant;
            }

            // ------------------------------------------------
            // SORTIE
            // ------------------------------------------------

            if (
                mouvement.type ===
                'SORTIE' &&
                mouvement.caisseId ===
                id
            ) {
                totalSorties +=
                    montant;
            }

            // ------------------------------------------------
            // TRANSFERT SORTANT
            // ------------------------------------------------

            if (
                mouvement.type ===
                'TRANSFERT' &&
                mouvement.caisseId ===
                id
            ) {
                totalSorties +=
                    montant;
            }

            // ------------------------------------------------
            // TRANSFERT ENTRANT
            // ------------------------------------------------

            if (
                mouvement.type ===
                'TRANSFERT' &&
                mouvement.caisseDestinationId ===
                id
            ) {
                totalEntrees +=
                    montant;
            }
        }

        return {
            id:
                caisse.id,

            nom:
                caisse.nom,

            type:
                caisse.type,

            devise:
                caisse.devise,

            soldeInitial,

            totalEntrees,

            totalSorties,

            solde:
                soldeInitial +
                totalEntrees -
                totalSorties,

            active:
                caisse.active,

            /**
             * Le détail permet lui aussi au frontend
             * de savoir si le solde initial est verrouillé.
             */
            hasHistory:
                mouvements.length >
                0,

            createdAt:
                caisse.createdAt,

            updatedAt:
                caisse.updatedAt,

            mouvements:
                mouvements.map(
                    (mouvement) => ({
                        ...mouvement,

                        montant:
                            Number(
                                mouvement.montant,
                            ),
                    }),
                ),
        };
    }

    // ============================================================
    // CREATION CAISSE
    // ============================================================

    async createCaisse(
        dto: CreateCaisseDto,
        userId: string,
        role: Role,
    ) {
        this.permissions.require(
            this.permissions.canCreateCaisse(role),
            'Seul le comptable peut créer une caisse.',
        );

        if (
            !dto.nom?.trim()
        ) {
            throw new BadRequestException(
                'Le nom de la caisse est obligatoire.',
            );
        }

        if (
            !dto.type
        ) {
            throw new BadRequestException(
                'Le type de caisse est obligatoire.',
            );
        }

        if (
            dto.soldeInitial !==
            undefined &&
            (
                !Number.isFinite(
                    dto.soldeInitial,
                ) ||
                dto.soldeInitial <
                0
            )
        ) {
            throw new BadRequestException(
                'Le solde initial ne peut pas être négatif.',
            );
        }

        const caisse =
            await this.prisma.caisse.create({
                data: {
                    nom:
                        dto.nom.trim(),

                    type:
                        dto.type,

                    devise:
                        dto.devise
                            ?.trim()
                            .toUpperCase() ||
                        'XOF',

                    soldeInitial:
                        dto.soldeInitial ??
                        0,

                    active:
                        dto.active ??
                        true,
                },
            });

        await this.activityLog.log({
            userId,

            action:
                'CAISSE_CREEE',

            entityType:
                'Caisse',

            entityId:
                caisse.id,

            metadata: {
                nom:
                    caisse.nom,

                type:
                    caisse.type,

                soldeInitial:
                    Number(
                        caisse.soldeInitial,
                    ),
            },
        });

        return {
            ...caisse,

            soldeInitial:
                Number(
                    caisse.soldeInitial,
                ),

            hasHistory:
                false,
        };
    }

    // ============================================================
    // MODIFICATION CAISSE
    // ============================================================

    async updateCaisse(
        id: string,
        dto: UpdateCaisseDto,
        userId: string,
        role: Role,
    ) {
        this.permissions.require(
            this.permissions.canUpdateCaisse(role),
            'Seul le comptable peut modifier une caisse.',
        );

        const caisse =
            await this.prisma.caisse.findUnique({
                where: {
                    id,
                },
            });

        if (!caisse) {
            throw new NotFoundException(
                'Caisse introuvable.',
            );
        }

        // ============================================================
        // VALIDATION DU NOM
        // ============================================================

        if (
            dto.nom !==
            undefined &&
            !dto.nom.trim()
        ) {
            throw new BadRequestException(
                'Le nom de la caisse ne peut pas être vide.',
            );
        }

        // ============================================================
        // VALIDATION SOLDE INITIAL
        // ============================================================

        if (
            dto.soldeInitial !==
            undefined
        ) {
            if (
                !Number.isFinite(
                    dto.soldeInitial,
                ) ||
                dto.soldeInitial <
                0
            ) {
                throw new BadRequestException(
                    'Le solde initial ne peut pas être négatif.',
                );
            }

            const ancienSoldeInitial =
                Number(
                    caisse.soldeInitial,
                );

            const nouveauSoldeInitial =
                Number(
                    dto.soldeInitial,
                );

            const soldeInitialModifie =
                Math.abs(
                    ancienSoldeInitial -
                    nouveauSoldeInitial,
                ) >
                0.000001;

            /**
             * On ne fait la requête de comptage que
             * si la valeur change réellement.
             *
             * Cela permet de tolérer un ancien client
             * qui renverrait accidentellement la même valeur.
             */
            if (
                soldeInitialModifie
            ) {
                const nombreMouvements =
                    await this.prisma.mouvementFinance.count({
                        where: {
                            OR: [
                                {
                                    caisseId:
                                        id,
                                },

                                {
                                    caisseDestinationId:
                                        id,
                                },
                            ],
                        },
                    });

                if (
                    nombreMouvements >
                    0
                ) {
                    throw new BadRequestException(
                        'Le solde initial de cette caisse ne peut plus être modifié car elle possède déjà un historique financier. Toute correction doit être enregistrée comme un mouvement financier afin de préserver la traçabilité.',
                    );
                }
            }
        }

        // ============================================================
        // DESACTIVATION DE LA CAISSE
        // ============================================================
        //
        // Une caisse contenant encore de l'argent ne peut pas
        // être désactivée.
        //
        // Le contrôle porte sur le SOLDE APRES MODIFICATION.
        // Cela évite qu'une requête puisse simultanément changer
        // le solde initial et désactiver une caisse avec un solde.
        // ============================================================

        if (
            dto.active ===
            false &&
            caisse.active ===
            true
        ) {
            const caisseDetail =
                await this.findCaisse(
                    id,
                    role,
                );

            const soldeActuel =
                Number(
                    caisseDetail.solde,
                );

            const soldeInitialActuel =
                Number(
                    caisse.soldeInitial,
                );

            const soldeInitialApresModification =
                dto.soldeInitial !==
                    undefined
                    ? Number(
                        dto.soldeInitial,
                    )
                    : soldeInitialActuel;

            const soldeProjete =
                soldeActuel -
                soldeInitialActuel +
                soldeInitialApresModification;

            if (
                Math.abs(
                    soldeProjete,
                ) >
                0.000001
            ) {
                throw new BadRequestException(
                    `Impossible de désactiver la caisse "${caisse.nom}". Son solde après modification serait de ${soldeProjete.toLocaleString(
                        'fr-FR',
                    )} FCFA. Veuillez transférer ou sortir le solde restant avant de la désactiver.`,
                );
            }
        }

        // ============================================================
        // MODIFICATION
        // ============================================================

        const updated =
            await this.prisma.caisse.update({
                where: {
                    id,
                },

                data: {
                    ...(dto.nom !==
                        undefined && {
                        nom:
                            dto.nom.trim(),
                    }),

                    ...(dto.type !==
                        undefined && {
                        type:
                            dto.type,
                    }),

                    ...(dto.devise !==
                        undefined && {
                        devise:
                            dto.devise
                                .trim()
                                .toUpperCase(),
                    }),

                    ...(dto.soldeInitial !==
                        undefined && {
                        soldeInitial:
                            dto.soldeInitial,
                    }),

                    ...(dto.active !==
                        undefined && {
                        active:
                            dto.active,
                    }),
                },
            });

        // ============================================================
        // HISTORIQUE APRES MODIFICATION
        // ============================================================

        const nombreMouvements =
            await this.prisma.mouvementFinance.count({
                where: {
                    OR: [
                        {
                            caisseId:
                                id,
                        },

                        {
                            caisseDestinationId:
                                id,
                        },
                    ],
                },
            });

        // ============================================================
        // JOURNALISATION
        // ============================================================

        await this.activityLog.log({
            userId,

            action:
                'CAISSE_MODIFIEE',

            entityType:
                'Caisse',

            entityId:
                updated.id,

            metadata: {
                nom:
                    updated.nom,

                active:
                    updated.active,

                type:
                    updated.type,

                devise:
                    updated.devise,

                soldeInitial:
                    Number(
                        updated.soldeInitial,
                    ),
            },
        });

        return {
            ...updated,

            soldeInitial:
                Number(
                    updated.soldeInitial,
                ),

            hasHistory:
                nombreMouvements >
                0,
        };
    }

    // ============================================================
    // SUPPRESSION CAISSE
    // ============================================================

    async deleteCaisse(
        id: string,
        userId: string,
        role: Role,
    ) {
        this.permissions.require(
            this.permissions.canDeleteCaisse(role),
            'Seul le comptable peut supprimer une caisse.',
        );

        const caisse =
            await this.prisma.caisse.findUnique({
                where: {
                    id,
                },

                include: {
                    mouvements: {
                        select: {
                            id: true,
                        },
                    },

                    transfertsEntrants: {
                        select: {
                            id: true,
                        },
                    },
                },
            });

        if (!caisse) {
            throw new NotFoundException(
                'Caisse introuvable.',
            );
        }

        // ============================================================
        // VERIFICATION DU SOLDE
        // ============================================================

        const caisseDetail =
            await this.findCaisse(
                id,
                role,
            );

        const soldeActuel =
            Number(
                caisseDetail.solde,
            );

        if (
            Math.abs(
                soldeActuel,
            ) >
            0.000001
        ) {
            throw new BadRequestException(
                `Impossible de supprimer la caisse "${caisse.nom}". Son solde actuel est de ${soldeActuel.toLocaleString(
                    'fr-FR',
                )} FCFA. Le solde doit être ramené à zéro avant toute suppression.`,
            );
        }

        // ============================================================
        // VERIFICATION DE L'HISTORIQUE
        // ============================================================

        if (
            caisse.mouvements.length >
            0 ||
            caisse.transfertsEntrants.length >
            0
        ) {
            throw new BadRequestException(
                'Cette caisse possède déjà un historique financier. Elle ne peut pas être supprimée. Désactivez-la plutôt afin de conserver la traçabilité.',
            );
        }

        // ============================================================
        // SUPPRESSION
        // ============================================================

        await this.prisma.caisse.delete({
            where: {
                id,
            },
        });

        // ============================================================
        // JOURNALISATION
        // ============================================================

        await this.activityLog.log({
            userId,

            action:
                'CAISSE_SUPPRIMEE',

            entityType:
                'Caisse',

            entityId:
                id,

            metadata: {
                nom:
                    caisse.nom,

                type:
                    caisse.type,

                soldeInitial:
                    Number(
                        caisse.soldeInitial,
                    ),
            },
        });

        return {
            success:
                true,
        };
    }

    // ============================================================
    // MOUVEMENTS
    // ============================================================

    async findMouvements(
        role: Role,
        options?: {
            caisseId?: string;
            dossierId?: string;

            type?:
            | 'ENTREE'
            | 'SORTIE'
            | 'TRANSFERT';

            dateDebut?: string;
            dateFin?: string;
        },
    ) {
        this.permissions.require(
            this.permissions.canViewMouvements(role),
            'Vous n’avez pas les permissions nécessaires pour consulter les mouvements financiers.',
        );

        const where: any = {};

        // ------------------------------------------------------------
        // CAISSE
        // ------------------------------------------------------------

        if (
            options?.caisseId
        ) {
            where.OR = [
                {
                    caisseId:
                        options.caisseId,
                },

                {
                    caisseDestinationId:
                        options.caisseId,
                },
            ];
        }

        // ------------------------------------------------------------
        // DOSSIER
        // ------------------------------------------------------------

        if (
            options?.dossierId
        ) {
            where.dossierId =
                options.dossierId;
        }

        // ------------------------------------------------------------
        // TYPE
        // ------------------------------------------------------------

        if (
            options?.type
        ) {
            where.type =
                options.type;
        }

        // ------------------------------------------------------------
        // DATES
        // ------------------------------------------------------------

        if (
            options?.dateDebut ||
            options?.dateFin
        ) {
            where.date = {};

            if (
                options.dateDebut
            ) {
                const dateDebut =
                    new Date(
                        options.dateDebut,
                    );

                if (
                    Number.isNaN(
                        dateDebut.getTime(),
                    )
                ) {
                    throw new BadRequestException(
                        'La date de début est invalide.',
                    );
                }

                where.date.gte =
                    dateDebut;
            }

            if (
                options.dateFin
            ) {
                const dateFin =
                    new Date(
                        options.dateFin,
                    );

                if (
                    Number.isNaN(
                        dateFin.getTime(),
                    )
                ) {
                    throw new BadRequestException(
                        'La date de fin est invalide.',
                    );
                }

                dateFin.setHours(
                    23,
                    59,
                    59,
                    999,
                );

                where.date.lte =
                    dateFin;
            }
        }

        const mouvements =
            await this.prisma.mouvementFinance.findMany({
                where,

                orderBy: {
                    date:
                        'desc',
                },

                include: {
                    caisse: {
                        select: {
                            id: true,
                            nom: true,
                            type: true,
                        },
                    },

                    caisseDestination: {
                        select: {
                            id: true,
                            nom: true,
                            type: true,
                        },
                    },

                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },

                    dossier: {
                        select: {
                            id: true,
                            reference: true,
                        },
                    },
                },
            });

        return mouvements.map(
            (mouvement) => ({
                ...mouvement,

                montant:
                    Number(
                        mouvement.montant,
                    ),
            }),
        );
    }

    // ============================================================
    // CREATION MOUVEMENT
    // ============================================================

    async createMouvement(
        dto: CreateMouvementDto,
        userId: string,
        role: Role,
    ) {
        this.permissions.require(
            this.permissions.canCreateMouvement(role),
            'Seul le comptable peut enregistrer un mouvement financier.',
        );

        // ------------------------------------------------------------
        // MONTANT
        // ------------------------------------------------------------

        if (
            !Number.isFinite(
                dto.montant,
            ) ||
            dto.montant <=
            0
        ) {
            throw new BadRequestException(
                'Le montant doit être supérieur à zéro.',
            );
        }

        // ------------------------------------------------------------
        // CAISSE SOURCE
        // ------------------------------------------------------------

        const caisse =
            await this.prisma.caisse.findUnique({
                where: {
                    id:
                        dto.caisseId,
                },
            });

        if (!caisse) {
            throw new NotFoundException(
                'Caisse introuvable.',
            );
        }

        if (
            !caisse.active
        ) {
            throw new BadRequestException(
                'Cette caisse est désactivée.',
            );
        }

        // ------------------------------------------------------------
        // DOSSIER
        // ------------------------------------------------------------

        if (
            dto.dossierId
        ) {
            const dossier =
                await this.prisma.dossier.findUnique({
                    where: {
                        id:
                            dto.dossierId,
                    },
                });

            if (!dossier) {
                throw new NotFoundException(
                    'Dossier introuvable.',
                );
            }
        }

        // ------------------------------------------------------------
        // SOLDE ACTUEL
        // ------------------------------------------------------------

        const source =
            await this.findCaisse(
                dto.caisseId,
                role,
            );

        // ------------------------------------------------------------
        // SORTIE
        // ------------------------------------------------------------

        if (
            dto.type ===
            'SORTIE'
        ) {
            if (
                dto.montant >
                source.solde
            ) {
                throw new BadRequestException(
                    `Solde insuffisant dans la caisse "${caisse.nom}". Solde disponible : ${source.solde.toLocaleString(
                        'fr-FR',
                    )} FCFA.`,
                );
            }
        }

        // ------------------------------------------------------------
        // TRANSFERT
        // ------------------------------------------------------------

        if (
            dto.type ===
            'TRANSFERT'
        ) {
            if (
                !dto.caisseDestinationId
            ) {
                throw new BadRequestException(
                    'Une caisse destination est obligatoire pour un transfert.',
                );
            }

            if (
                dto.caisseDestinationId ===
                dto.caisseId
            ) {
                throw new BadRequestException(
                    'La caisse source et la caisse destination doivent être différentes.',
                );
            }

            const destination =
                await this.prisma.caisse.findUnique({
                    where: {
                        id:
                            dto.caisseDestinationId,
                    },
                });

            if (!destination) {
                throw new NotFoundException(
                    'Caisse destination introuvable.',
                );
            }

            if (
                !destination.active
            ) {
                throw new BadRequestException(
                    'La caisse destination est désactivée.',
                );
            }

            if (
                dto.montant >
                source.solde
            ) {
                throw new BadRequestException(
                    `Solde insuffisant dans la caisse "${caisse.nom}". Solde disponible : ${source.solde.toLocaleString(
                        'fr-FR',
                    )} FCFA.`,
                );
            }
        }

        // ------------------------------------------------------------
        // DATE
        // ------------------------------------------------------------

        const date =
            dto.date
                ? new Date(
                    dto.date,
                )
                : new Date();

        if (
            Number.isNaN(
                date.getTime(),
            )
        ) {
            throw new BadRequestException(
                'La date du mouvement est invalide.',
            );
        }

        // ------------------------------------------------------------
        // CREATION
        // ------------------------------------------------------------

        const mouvement =
            await this.prisma.mouvementFinance.create({
                data: {
                    type:
                        dto.type,

                    montant:
                        dto.montant,

                    categorie:
                        dto.categorie,

                    description:
                        dto.description ??
                        null,

                    date,

                    reference:
                        dto.reference ??
                        null,

                    pieceJointe:
                        dto.pieceJointe ??
                        null,

                    caisseId:
                        dto.caisseId,

                    caisseDestinationId:
                        dto.type ===
                            'TRANSFERT'
                            ? dto.caisseDestinationId
                            : null,

                    userId,

                    dossierId:
                        dto.dossierId ??
                        null,
                },

                include: {
                    caisse: {
                        select: {
                            id: true,
                            nom: true,
                            type: true,
                        },
                    },

                    caisseDestination: {
                        select: {
                            id: true,
                            nom: true,
                            type: true,
                        },
                    },

                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },

                    dossier: {
                        select: {
                            id: true,
                            reference: true,
                        },
                    },
                },
            });

        // ------------------------------------------------------------
        // JOURNALISATION
        // ------------------------------------------------------------

        await this.activityLog.log({
            userId,

            action:
                'MOUVEMENT_FINANCIER_CREE',

            entityType:
                'MouvementFinance',

            entityId:
                mouvement.id,

            dossierId:
                mouvement.dossierId ??
                undefined,

            metadata: {
                type:
                    mouvement.type,

                montant:
                    Number(
                        mouvement.montant,
                    ),

                categorie:
                    mouvement.categorie,

                caisseId:
                    mouvement.caisseId,

                caisseDestinationId:
                    mouvement.caisseDestinationId,
            },
        });

        return {
            ...mouvement,

            montant:
                Number(
                    mouvement.montant,
                ),
        };
    }

    // ============================================================
    // DASHBOARD FINANCIER
    // ============================================================

    async getDashboard(
        role: Role,
    ) {
        this.permissions.require(
            this.permissions.canViewFinance(role),
            'Vous n’avez pas les permissions nécessaires pour consulter le dashboard financier.',
        );

        const caisses =
            await this.findCaisses(
                role,
            );

        const mouvements =
            await this.prisma.mouvementFinance.findMany({
                orderBy: {
                    date:
                        'desc',
                },

                include: {
                    caisse: {
                        select: {
                            id: true,
                            nom: true,
                            type: true,
                        },
                    },

                    caisseDestination: {
                        select: {
                            id: true,
                            nom: true,
                            type: true,
                        },
                    },

                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },

                    dossier: {
                        select: {
                            id: true,
                            reference: true,
                        },
                    },
                },
            });

        let totalEntrees = 0;
        let totalSorties = 0;

        for (
            const mouvement
            of mouvements
        ) {
            const montant =
                Number(
                    mouvement.montant,
                );

            if (
                mouvement.type ===
                'ENTREE'
            ) {
                totalEntrees +=
                    montant;
            }

            if (
                mouvement.type ===
                'SORTIE'
            ) {
                totalSorties +=
                    montant;
            }

            /*
             * Les transferts ne changent pas
             * le patrimoine financier global.
             */
        }

        const soldeGlobal =
            caisses.reduce(
                (
                    total,
                    caisse,
                ) =>
                    total +
                    caisse.solde,
                0,
            );

        const permissions =
            this.permissions.getFinancePermissions(
                role,
            );

        return {
            soldeGlobal,

            totalEntrees,

            totalSorties,

            nombreCaisses:
                caisses.length,

            caisses,

            derniersMouvements:
                mouvements
                    .slice(
                        0,
                        10,
                    )
                    .map(
                        (
                            mouvement,
                        ) => ({
                            ...mouvement,

                            montant:
                                Number(
                                    mouvement.montant,
                                ),
                        }),
                    ),

            permissions,
        };
    }
}
import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';

import {
    PrismaService,
} from '../../prisma/prisma.service';

import {
    ActivityLogService,
} from '../activity-log/activity-log.service';

import {
    FinancePermissionService,
} from './finance-permission.service';

import {
    CreateCaisseDto,
} from './dto/create-caisse.dto';

import {
    UpdateCaisseDto,
} from './dto/update-caisse.dto';

import {
    CreateMouvementDto,
} from './dto/create-mouvement.dto';
import {
    MoyenOperationCompte,
    Role,
    SourceMouvementFinance,
    TypeCaisse,
} from '../../../generated/prisma/client';
@Injectable()
export class FinanceService {

    constructor(
        private readonly prisma:
            PrismaService,

        private readonly activityLog:
            ActivityLogService,

        private readonly permissions:
            FinancePermissionService,
    ) { }

    // ============================================================
    // HELPERS
    // ============================================================

    private normalizeOptionalText(
        value?: string,
    ): string | null {
        if (
            value === undefined ||
            value === null
        ) {
            return null;
        }

        const normalized =
            value.trim();

        return normalized.length >
            0
            ? normalized
            : null;
    }

    private getDefaultMoyensOperation(
        type: TypeCaisse,
    ): MoyenOperationCompte[] {

        switch (type) {

            case TypeCaisse.BANCAIRE:
                return [
                    MoyenOperationCompte.VIREMENT,
                    MoyenOperationCompte.CHEQUE,
                ];

            case TypeCaisse.EPARGNE:
                return [
                    MoyenOperationCompte.VIREMENT,
                ];

            case TypeCaisse.CARTE_BANCAIRE:
                return [
                    MoyenOperationCompte.CARTE,
                ];

            case TypeCaisse.MOBILE_MONEY:
                return [
                    MoyenOperationCompte.MOBILE_MONEY,
                ];

            case TypeCaisse.ESPECES:
                return [
                    MoyenOperationCompte.ESPECES,
                ];

            default:
                return [];
        }
    }

    // ============================================================
    // COMPTES
    //
    // Le modèle Prisma s'appelle encore "Caisse"
    // pendant la phase de transition.
    // ============================================================

    async findCaisses(
        role: Role,
    ) {
        this.permissions.require(
            this.permissions.canViewCaisses(
                role,
            ),
            'Vous n’avez pas les permissions nécessaires pour consulter les comptes financiers.',
        );

        const caisses =
            await this.prisma.caisse.findMany({
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
            });

        return caisses.map(
            (
                caisse,
            ) => {

                const soldeInitial =
                    Number(
                        caisse.soldeInitial,
                    );

                let totalEntrees =
                    0;

                let totalSorties =
                    0;

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
                    caisse
                        .mouvements
                        .length >
                    0 ||
                    caisse
                        .transfertsEntrants
                        .length >
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

                    institution:
                        caisse.institution,

                    identifiant:
                        caisse.identifiant,

                    titulaire:
                        caisse.titulaire,

                    moyensOperation:
                        caisse.moyensOperation,

                    soldeInitial,

                    totalEntrees,

                    totalSorties,

                    solde,

                    active:
                        caisse.active,

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
    // DETAIL COMPTE
    // ============================================================

    async findCaisse(
        id: string,
        role: Role,
    ) {
        this.permissions.require(
            this.permissions.canViewCaisses(
                role,
            ),
            'Vous n’avez pas les permissions nécessaires pour consulter ce compte.',
        );

        const caisse =
            await this.prisma.caisse.findUnique({
                where: {
                    id,
                },
            });

        if (!caisse) {
            throw new NotFoundException(
                'Compte introuvable.',
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
                            id:
                                true,

                            name:
                                true,

                            email:
                                true,
                        },
                    },

                    dossier: {
                        select: {
                            id:
                                true,

                            reference:
                                true,
                        },
                    },

                    caisse: {
                        select: {
                            id:
                                true,

                            nom:
                                true,

                            type:
                                true,
                        },
                    },

                    caisseDestination: {
                        select: {
                            id:
                                true,

                            nom:
                                true,

                            type:
                                true,
                        },
                    },
                },
            });

        const soldeInitial =
            Number(
                caisse.soldeInitial,
            );

        let totalEntrees =
            0;

        let totalSorties =
            0;

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
                'ENTREE' &&
                mouvement.caisseId ===
                id
            ) {
                totalEntrees +=
                    montant;
            }

            if (
                mouvement.type ===
                'SORTIE' &&
                mouvement.caisseId ===
                id
            ) {
                totalSorties +=
                    montant;
            }

            if (
                mouvement.type ===
                'TRANSFERT' &&
                mouvement.caisseId ===
                id
            ) {
                totalSorties +=
                    montant;
            }

            if (
                mouvement.type ===
                'TRANSFERT' &&
                mouvement
                    .caisseDestinationId ===
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

            institution:
                caisse.institution,

            identifiant:
                caisse.identifiant,

            titulaire:
                caisse.titulaire,

            moyensOperation:
                caisse.moyensOperation,

            soldeInitial,

            totalEntrees,

            totalSorties,

            solde:
                soldeInitial +
                totalEntrees -
                totalSorties,

            active:
                caisse.active,

            hasHistory:
                mouvements.length >
                0,

            createdAt:
                caisse.createdAt,

            updatedAt:
                caisse.updatedAt,

            mouvements:
                mouvements.map(
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
        };
    }

    // ============================================================
    // CREATION COMPTE
    // ============================================================

    async createCaisse(
        dto: CreateCaisseDto,
        userId: string,
        role: Role,
    ) {
        this.permissions.require(
            this.permissions.canCreateCaisse(
                role,
            ),
            'Vous n’avez pas les permissions nécessaires pour créer un compte financier.',
        );

        if (
            !dto.nom?.trim()
        ) {
            throw new BadRequestException(
                'Le nom du compte est obligatoire.',
            );
        }

        if (
            !dto.type
        ) {
            throw new BadRequestException(
                'Le type de compte est obligatoire.',
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

        const moyensOperation =
            dto.moyensOperation ??
            this.getDefaultMoyensOperation(
                dto.type,
            );

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

                    institution:
                        this.normalizeOptionalText(
                            dto.institution,
                        ),

                    identifiant:
                        this.normalizeOptionalText(
                            dto.identifiant,
                        ),

                    titulaire:
                        this.normalizeOptionalText(
                            dto.titulaire,
                        ),

                    moyensOperation,

                    active:
                        dto.active ??
                        true,
                },
            });

        await this.activityLog.log({
            userId,

            /*
             * On conserve les anciens identifiants
             * d'audit pour éviter de casser
             * l'historique existant.
             */
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

                institution:
                    caisse.institution,

                identifiant:
                    caisse.identifiant,

                titulaire:
                    caisse.titulaire,

                moyensOperation:
                    caisse.moyensOperation,

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
    // MODIFICATION COMPTE
    // ============================================================

    async updateCaisse(
        id: string,
        dto: UpdateCaisseDto,
        userId: string,
        role: Role,
    ) {
        this.permissions.require(
            this.permissions.canUpdateCaisse(
                role,
            ),
            'Vous n’avez pas les permissions nécessaires pour modifier ce compte.',
        );

        const caisse =
            await this.prisma.caisse.findUnique({
                where: {
                    id,
                },
            });

        if (!caisse) {
            throw new NotFoundException(
                'Compte introuvable.',
            );
        }

        if (
            dto.nom !==
            undefined &&
            !dto.nom.trim()
        ) {
            throw new BadRequestException(
                'Le nom du compte ne peut pas être vide.',
            );
        }

        // ========================================================
        // SOLDE INITIAL
        // ========================================================

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
                        'Le solde initial de ce compte ne peut plus être modifié car il possède déjà un historique financier. Toute correction doit être enregistrée comme un mouvement financier.',
                    );
                }
            }
        }

        // ========================================================
        // DESACTIVATION
        // ========================================================

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
                    `Impossible de désactiver le compte "${caisse.nom}". Son solde après modification serait de ${soldeProjete.toLocaleString(
                        'fr-FR',
                    )} FCFA. Veuillez transférer ou sortir le solde restant avant de le désactiver.`,
                );
            }
        }

        // ========================================================
        // MOYENS D'OPERATION
        // ========================================================

        let moyensOperation:
            MoyenOperationCompte[] |
            undefined;

        if (
            dto.moyensOperation !==
            undefined
        ) {
            moyensOperation =
                dto.moyensOperation;
        } else if (
            dto.type !==
            undefined &&
            dto.type !==
            caisse.type
        ) {
            /*
             * Si le type change et que le client
             * n'envoie aucun moyen, on applique
             * les valeurs par défaut du nouveau type.
             */
            moyensOperation =
                this.getDefaultMoyensOperation(
                    dto.type,
                );
        }

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

                    ...(dto.institution !==
                        undefined && {
                        institution:
                            this.normalizeOptionalText(
                                dto.institution,
                            ),
                    }),

                    ...(dto.identifiant !==
                        undefined && {
                        identifiant:
                            this.normalizeOptionalText(
                                dto.identifiant,
                            ),
                    }),

                    ...(dto.titulaire !==
                        undefined && {
                        titulaire:
                            this.normalizeOptionalText(
                                dto.titulaire,
                            ),
                    }),

                    ...(moyensOperation !==
                        undefined && {
                        moyensOperation,
                    }),

                    ...(dto.active !==
                        undefined && {
                        active:
                            dto.active,
                    }),
                },
            });

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

                institution:
                    updated.institution,

                identifiant:
                    updated.identifiant,

                titulaire:
                    updated.titulaire,

                moyensOperation:
                    updated.moyensOperation,

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
    // SUPPRESSION COMPTE
    // ============================================================

    async deleteCaisse(
        id: string,
        userId: string,
        role: Role,
    ) {
        this.permissions.require(
            this.permissions.canDeleteCaisse(
                role,
            ),
            'Vous n’avez pas les permissions nécessaires pour supprimer ce compte.',
        );

        const caisse =
            await this.prisma.caisse.findUnique({
                where: {
                    id,
                },

                include: {
                    mouvements: {
                        select: {
                            id:
                                true,
                        },
                    },

                    transfertsEntrants: {
                        select: {
                            id:
                                true,
                        },
                    },
                },
            });

        if (!caisse) {
            throw new NotFoundException(
                'Compte introuvable.',
            );
        }

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
                `Impossible de supprimer le compte "${caisse.nom}". Son solde actuel est de ${soldeActuel.toLocaleString(
                    'fr-FR',
                )} FCFA. Le solde doit être ramené à zéro avant toute suppression.`,
            );
        }

        if (
            caisse.mouvements.length >
            0 ||
            caisse.transfertsEntrants
                .length >
            0
        ) {
            throw new BadRequestException(
                'Ce compte possède déjà un historique financier. Il ne peut pas être supprimé. Désactivez-le plutôt afin de conserver la traçabilité.',
            );
        }

        await this.prisma.caisse.delete({
            where: {
                id,
            },
        });

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
            this.permissions.canViewMouvements(
                role,
            ),
            'Vous n’avez pas les permissions nécessaires pour consulter les mouvements financiers.',
        );

        const where:
            any = {};

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

        if (
            options?.dossierId
        ) {
            where.dossierId =
                options.dossierId;
        }

        if (
            options?.type
        ) {
            where.type =
                options.type;
        }

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
                            id:
                                true,

                            nom:
                                true,

                            type:
                                true,
                        },
                    },

                    caisseDestination: {
                        select: {
                            id:
                                true,

                            nom:
                                true,

                            type:
                                true,
                        },
                    },

                    user: {
                        select: {
                            id:
                                true,

                            name:
                                true,

                            email:
                                true,
                        },
                    },

                    dossier: {
                        select: {
                            id:
                                true,

                            reference:
                                true,
                        },
                    },
                },
            });

        return mouvements.map(
            (
                mouvement,
            ) => ({
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
            this.permissions.canCreateMouvement(
                role,
            ),
            'Vous n’avez pas les permissions nécessaires pour enregistrer un mouvement financier.',
        );

        // ============================================================
        // MONTANT
        // ============================================================

        if (
            !Number.isFinite(
                dto.montant,
            ) ||
            dto.montant <= 0
        ) {
            throw new BadRequestException(
                'Le montant doit être supérieur à zéro.',
            );
        }

        // ============================================================
        // SOURCE
        // ============================================================

        let sourceMouvement:
            SourceMouvementFinance;

        /**
         * Un transfert a toujours TRANSFERT
         * comme source.
         *
         * L'utilisateur n'a donc pas besoin
         * de sélectionner sa source.
         */
        if (
            dto.type ===
            'TRANSFERT'
        ) {
            sourceMouvement =
                SourceMouvementFinance.TRANSFERT;
        } else {
            /**
             * Pour toute ENTREE ou SORTIE manuelle,
             * la source est obligatoire.
             */
            if (!dto.source) {
                throw new BadRequestException(
                    'La source du mouvement est obligatoire.',
                );
            }

            /**
             * Certaines sources ne doivent jamais
             * être créées manuellement depuis Finance.
             *
             * Elles sont générées par leurs modules
             * métier afin d'éviter les doubles entrées.
             */
            const sourcesAutomatiques:
                SourceMouvementFinance[] = [
                    SourceMouvementFinance.PAIEMENT_FACTURE,
                    SourceMouvementFinance.PROVISION,
                    SourceMouvementFinance.FRAIS_OUVERTURE_DOSSIER,
                    SourceMouvementFinance.TRANSFERT,
                ];

            if (
                sourcesAutomatiques.includes(
                    dto.source,
                )
            ) {
                throw new BadRequestException(
                    'Cette source est générée automatiquement par Velarium et ne peut pas être utilisée pour un mouvement manuel.',
                );
            }

            sourceMouvement =
                dto.source;
        }

        const sourceLibelle =
            this.normalizeOptionalText(
                dto.sourceLibelle,
            );

        /**
         * AUTRE signifie que l'utilisateur doit
         * obligatoirement préciser la vraie source.
         */
        if (
            sourceMouvement ===
            SourceMouvementFinance.AUTRE &&
            !sourceLibelle
        ) {
            throw new BadRequestException(
                'Veuillez préciser la source du mouvement.',
            );
        }

        const sourceReference =
            this.normalizeOptionalText(
                dto.sourceReference,
            );

        const tiers =
            this.normalizeOptionalText(
                dto.tiers,
            );

        // ============================================================
        // COMPTE SOURCE
        // ============================================================

        const caisse =
            await this.prisma.caisse.findUnique({
                where: {
                    id:
                        dto.caisseId,
                },
            });

        if (!caisse) {
            throw new NotFoundException(
                'Compte source introuvable.',
            );
        }

        if (!caisse.active) {
            throw new BadRequestException(
                'Ce compte est désactivé.',
            );
        }

        // ============================================================
        // DOSSIER
        // ============================================================

        if (dto.dossierId) {
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

        // ============================================================
        // SOLDE DU COMPTE
        // ============================================================

        const compteSource =
            await this.findCaisse(
                dto.caisseId,
                role,
            );

        /**
         * Une sortie ne peut pas dépasser
         * le solde disponible.
         */
        if (
            dto.type ===
            'SORTIE'
        ) {
            if (
                dto.montant >
                compteSource.solde
            ) {
                throw new BadRequestException(
                    `Solde insuffisant dans le compte "${caisse.nom}". Solde disponible : ${compteSource.solde.toLocaleString(
                        'fr-FR',
                    )} FCFA.`,
                );
            }
        }

        // ============================================================
        // TRANSFERT
        // ============================================================

        if (
            dto.type ===
            'TRANSFERT'
        ) {
            if (
                !dto.caisseDestinationId
            ) {
                throw new BadRequestException(
                    'Un compte destination est obligatoire pour un transfert.',
                );
            }

            if (
                dto.caisseDestinationId ===
                dto.caisseId
            ) {
                throw new BadRequestException(
                    'Le compte source et le compte destination doivent être différents.',
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
                    'Compte destination introuvable.',
                );
            }

            if (
                !destination.active
            ) {
                throw new BadRequestException(
                    'Le compte destination est désactivé.',
                );
            }

            if (
                dto.montant >
                compteSource.solde
            ) {
                throw new BadRequestException(
                    `Solde insuffisant dans le compte "${caisse.nom}". Solde disponible : ${compteSource.solde.toLocaleString(
                        'fr-FR',
                    )} FCFA.`,
                );
            }
        }

        // ============================================================
        // DATE
        // ============================================================

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

        // ============================================================
        // CREATION
        // ============================================================

        const mouvement =
            await this.prisma.mouvementFinance.create({
                data: {
                    type:
                        dto.type,

                    montant:
                        dto.montant,

                    categorie:
                        dto.categorie,

                    source:
                        sourceMouvement,

                    sourceLibelle,

                    sourceReference,

                    tiers,

                    description:
                        this.normalizeOptionalText(
                            dto.description,
                        ),

                    date,

                    reference:
                        this.normalizeOptionalText(
                            dto.reference,
                        ),

                    pieceJointe:
                        this.normalizeOptionalText(
                            dto.pieceJointe,
                        ),

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
                            id:
                                true,

                            nom:
                                true,

                            type:
                                true,
                        },
                    },

                    caisseDestination: {
                        select: {
                            id:
                                true,

                            nom:
                                true,

                            type:
                                true,
                        },
                    },

                    user: {
                        select: {
                            id:
                                true,

                            name:
                                true,

                            email:
                                true,
                        },
                    },

                    dossier: {
                        select: {
                            id:
                                true,

                            reference:
                                true,
                        },
                    },
                },
            });

        // ============================================================
        // AUDIT
        // ============================================================

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

                source:
                    mouvement.source,

                sourceLibelle:
                    mouvement.sourceLibelle,

                sourceReference:
                    mouvement.sourceReference,

                tiers:
                    mouvement.tiers,

                caisseId:
                    mouvement.caisseId,

                caisseDestinationId:
                    mouvement
                        .caisseDestinationId,
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
    // DASHBOARD
    // ============================================================

    async getDashboard(
        role: Role,
    ) {
        this.permissions.require(
            this.permissions.canViewFinance(
                role,
            ),
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
                            id:
                                true,

                            nom:
                                true,

                            type:
                                true,
                        },
                    },

                    caisseDestination: {
                        select: {
                            id:
                                true,

                            nom:
                                true,

                            type:
                                true,
                        },
                    },

                    user: {
                        select: {
                            id:
                                true,

                            name:
                                true,

                            email:
                                true,
                        },
                    },

                    dossier: {
                        select: {
                            id:
                                true,

                            reference:
                                true,
                        },
                    },
                },
            });

        let totalEntrees =
            0;

        let totalSorties =
            0;

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
             * Les transferts sont volontairement
             * exclus des totaux globaux.
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

            /*
             * On conserve temporairement le nom
             * pour compatibilité frontend.
             */
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
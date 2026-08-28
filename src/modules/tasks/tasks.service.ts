import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';

@Injectable()
export class TasksService {
    constructor(
        private readonly prisma: PrismaService,
    ) { }

    /**
     * Créer une tâche
     *
     * AVOCAT :
     * peut assigner la tâche à n'importe quel utilisateur.
     *
     * Autres rôles :
     * doivent obligatoirement s'assigner
     * la tâche à eux-mêmes.
     */
    async create(
        dto: CreateTaskDto,
        createurId: string,
        role: string,
    ) {
        // Vérifier que le créateur existe
        const createur = await this.prisma.user.findUnique({
            where: {
                id: createurId,
            },
        });

        if (!createur) {
            throw new BadRequestException(
                'Utilisateur connecté introuvable.',
            );
        }

        /**
         * Seul l'AVOCAT peut assigner
         * une tâche à un autre utilisateur.
         */
        if (
            role !== 'AVOCAT' &&
            dto.assigneAId !== createurId
        ) {
            throw new ForbiddenException(
                'Vous ne pouvez pas assigner une tâche à un autre utilisateur.',
            );
        }

        // Vérifier que l'utilisateur assigné existe
        const assigneA = await this.prisma.user.findUnique({
            where: {
                id: dto.assigneAId,
            },
        });

        if (!assigneA) {
            throw new NotFoundException(
                'L’utilisateur assigné n’existe pas.',
            );
        }

        // Vérifier que le dossier existe s'il est fourni
        if (dto.dossierId) {
            const dossier =
                await this.prisma.dossier.findUnique({
                    where: {
                        id: dto.dossierId,
                    },
                });

            if (!dossier) {
                throw new NotFoundException(
                    'Le dossier indiqué n’existe pas.',
                );
            }
        }

        return this.prisma.tache.create({
            data: {
                titre: dto.titre,

                description: dto.description,

                priorite: dto.priorite,

                ...(dto.statut !== undefined && {
                    statut: dto.statut as any,
                }),

                dateEcheance: dto.dateEcheance
                    ? new Date(dto.dateEcheance)
                    : undefined,

                createurId,

                assigneAId: dto.assigneAId,

                dossierId:
                    dto.dossierId ?? undefined,
            },

            include: {
                createur: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },

                assigneA: {
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
    }

    /**
     * Récupérer les tâches
     *
     * AVOCAT :
     * retourne toutes les tâches.
     *
     * Autres rôles :
     * retourne uniquement les tâches
     * qui leur sont assignées.
     */
    async findAll(
        userId: string,
        role: string,
    ) {
        return this.prisma.tache.findMany({
            where:
                role === 'AVOCAT'
                    ? undefined
                    : {
                        assigneAId: userId,
                    },

            orderBy: [
                {
                    dateEcheance: 'asc',
                },
                {
                    createdAt: 'desc',
                },
            ],

            include: {
                createur: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },

                assigneA: {
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
    }

    /**
     * Récupérer une tâche
     *
     * AVOCAT :
     * peut consulter n'importe quelle tâche.
     *
     * Autres rôles :
     * peuvent uniquement consulter
     * une tâche qui leur est assignée.
     */
    async findOne(
        id: string,
        userId: string,
        role: string,
    ) {
        const task =
            await this.prisma.tache.findUnique({
                where: {
                    id,
                },

                include: {
                    createur: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },

                    assigneA: {
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

        if (!task) {
            throw new NotFoundException(
                'Tâche introuvable.',
            );
        }

        // Un non-AVOCAT ne peut consulter
        // que sa propre tâche.
        if (
            role !== 'AVOCAT' &&
            task.assigneAId !== userId
        ) {
            throw new ForbiddenException(
                'Vous n’avez pas accès à cette tâche.',
            );
        }

        return task;
    }

    /**
     * Modifier une tâche
     *
     * AVOCAT :
     * peut modifier toutes les tâches.
     *
     * Autres rôles :
     * peuvent uniquement modifier
     * leurs propres tâches.
     */
    async update(
        id: string,
        dto: Partial<CreateTaskDto>,
        userId: string,
        role: string,
    ) {
        const existingTask =
            await this.prisma.tache.findUnique({
                where: {
                    id,
                },
            });

        if (!existingTask) {
            throw new NotFoundException(
                'Tâche introuvable.',
            );
        }

        // Vérifier les droits d'accès
        if (
            role !== 'AVOCAT' &&
            existingTask.assigneAId !== userId
        ) {
            throw new ForbiddenException(
                'Vous n’avez pas accès à cette tâche.',
            );
        }

        /**
         * Seul l'AVOCAT peut changer
         * l'utilisateur assigné.
         */
        if (
            dto.assigneAId !== undefined &&
            role !== 'AVOCAT' &&
            dto.assigneAId !== existingTask.assigneAId
        ) {
            throw new ForbiddenException(
                'Vous ne pouvez pas réassigner cette tâche.',
            );
        }

        // Vérifier le nouvel utilisateur assigné
        if (dto.assigneAId) {
            const assigneA =
                await this.prisma.user.findUnique({
                    where: {
                        id: dto.assigneAId,
                    },
                });

            if (!assigneA) {
                throw new NotFoundException(
                    'L’utilisateur assigné n’existe pas.',
                );
            }
        }

        // Vérifier le nouveau dossier
        if (dto.dossierId) {
            const dossier =
                await this.prisma.dossier.findUnique({
                    where: {
                        id: dto.dossierId,
                    },
                });

            if (!dossier) {
                throw new NotFoundException(
                    'Le dossier indiqué n’existe pas.',
                );
            }
        }

        return this.prisma.tache.update({
            where: {
                id,
            },

            data: {
                ...(dto.titre !== undefined && {
                    titre: dto.titre,
                }),

                ...(dto.description !== undefined && {
                    description: dto.description,
                }),

                ...(dto.priorite !== undefined && {
                    priorite: dto.priorite,
                }),

                ...(dto.statut !== undefined && {
                    statut: dto.statut as any,
                }),

                ...(dto.assigneAId !== undefined && {
                    assigneAId: dto.assigneAId,
                }),

                ...(dto.dossierId !== undefined && {
                    dossierId:
                        dto.dossierId || null,
                }),

                ...(dto.dateEcheance !== undefined && {
                    dateEcheance:
                        dto.dateEcheance
                            ? new Date(dto.dateEcheance)
                            : null,
                }),
            },

            include: {
                createur: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },

                assigneA: {
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
    }

    /**
     * Changer le statut d'une tâche
     *
     * AVOCAT :
     * peut changer le statut de n'importe quelle tâche.
     *
     * Autres rôles :
     * uniquement leurs propres tâches.
     */
    async updateStatus(
        id: string,
        statut: string,
        userId: string,
        role: string,
    ) {
        const task =
            await this.prisma.tache.findUnique({
                where: {
                    id,
                },
            });

        if (!task) {
            throw new NotFoundException(
                'Tâche introuvable.',
            );
        }

        // Vérifier les droits
        if (
            role !== 'AVOCAT' &&
            task.assigneAId !== userId
        ) {
            throw new ForbiddenException(
                'Vous n’avez pas accès à cette tâche.',
            );
        }

        const statutsAutorises = [
            'A_FAIRE',
            'EN_COURS',
            'TERMINEE',
            'ANNULEE',
        ];

        if (!statutsAutorises.includes(statut)) {
            throw new BadRequestException(
                'Statut de tâche invalide.',
            );
        }

        return this.prisma.tache.update({
            where: {
                id,
            },

            data: {
                statut: statut as any,
            },

            include: {
                createur: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },

                assigneA: {
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
    }

    /**
     * Supprimer une tâche
     *
     * Seul l'AVOCAT peut supprimer une tâche.
     */
    async remove(
        id: string,
        userId: string,
        role: string,
    ) {
        const task =
            await this.prisma.tache.findUnique({
                where: {
                    id,
                },
            });

        if (!task) {
            throw new NotFoundException(
                'Tâche introuvable.',
            );
        }

        /**
         * Pour l'instant, suppression réservée
         * à l'AVOCAT.
         */
        if (role !== 'AVOCAT') {
            throw new ForbiddenException(
                'Vous n’êtes pas autorisé à supprimer une tâche.',
            );
        }

        await this.prisma.tache.delete({
            where: {
                id,
            },
        });

        return {
            message:
                'Tâche supprimée avec succès.',
        };
    }
}
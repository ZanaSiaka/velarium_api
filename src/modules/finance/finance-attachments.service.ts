import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';

import {
    randomUUID,
} from 'crypto';

import {
    Role,
} from '../../../generated/prisma/client';

import {
    PrismaService,
} from '../../prisma/prisma.service';

import {
    S3Service,
} from '../../common/s3/s3.service';

import {
    ActivityLogService,
} from '../activity-log/activity-log.service';

import {
    FinancePermissionService,
} from './finance-permission.service';

import {
    PresignFinanceAttachmentDto,
} from './dto/presign-finance-attachment.dto';

import {
    CreateFinanceAttachmentDto,
} from './dto/create-finance-attachment.dto';

@Injectable()
export class FinanceAttachmentsService {
    private readonly maxFileSize =
        10 * 1024 * 1024;

    private readonly allowedContentTypes =
        new Set([
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/webp',
        ]);

    constructor(
        private readonly prisma:
            PrismaService,

        private readonly s3:
            S3Service,

        private readonly activityLog:
            ActivityLogService,

        private readonly permissions:
            FinancePermissionService,
    ) { }

    // ============================================================
    // HELPERS
    // ============================================================

    private async requireMouvement(
        mouvementId: string,
    ) {
        const mouvement =
            await this.prisma.mouvementFinance.findUnique({
                where: {
                    id:
                        mouvementId,
                },

                select: {
                    id:
                        true,

                    dossierId:
                        true,
                },
            });

        if (!mouvement) {
            throw new NotFoundException(
                'Mouvement financier introuvable.',
            );
        }

        return mouvement;
    }

    private sanitizeFilename(
        filename: string,
    ) {
        const cleaned =
            filename
                .trim()
                .replace(
                    /[^a-zA-Z0-9._-]/g,
                    '_',
                )
                .replace(
                    /_+/g,
                    '_',
                );

        if (!cleaned) {
            return 'document';
        }

        return cleaned.slice(
            0,
            150,
        );
    }

    private validateFile(
        contentType: string,
        taille?: number,
    ) {
        if (
            !this.allowedContentTypes.has(
                contentType,
            )
        ) {
            throw new BadRequestException(
                'Type de fichier non autorisé. Formats acceptés : PDF, JPEG, PNG et WebP.',
            );
        }

        if (
            taille !== undefined &&
            taille > this.maxFileSize
        ) {
            throw new BadRequestException(
                'Le fichier ne peut pas dépasser 10 Mo.',
            );
        }
    }

    // ============================================================
    // PRESIGN UPLOAD
    // ============================================================

    async presignUpload(
        mouvementId: string,
        dto:
            PresignFinanceAttachmentDto,
        role:
            Role,
    ) {
        this.permissions.require(
            this.permissions.canManagePieceJointes(
                role,
            ),
            'Seul le comptable peut ajouter des justificatifs financiers.',
        );

        await this.requireMouvement(
            mouvementId,
        );

        this.validateFile(
            dto.contentType,
            dto.taille,
        );

        const filename =
            this.sanitizeFilename(
                dto.filename,
            );

        const storageKey =
            `finance/mouvements/${mouvementId}/${randomUUID()}-${filename}`;

        const uploadUrl =
            await this.s3.getUploadUrl(
                storageKey,
                dto.contentType,
            );

        return {
            uploadUrl,
            storageKey,
        };
    }

    // ============================================================
    // LISTE
    // ============================================================

    async findAll(
        mouvementId: string,
        role:
            Role,
    ) {
        this.permissions.require(
            this.permissions.canViewPieceJointes(
                role,
            ),
            'Vous n’avez pas les permissions nécessaires pour consulter les justificatifs financiers.',
        );

        await this.requireMouvement(
            mouvementId,
        );

        return this.prisma.pieceJointeFinance.findMany({
            where: {
                mouvementId,
            },

            orderBy: {
                createdAt:
                    'desc',
            },

            include: {
                uploadedBy: {
                    select: {
                        id:
                            true,

                        name:
                            true,

                        email:
                            true,
                    },
                },
            },
        });
    }

    // ============================================================
    // CREATION APRES UPLOAD
    // ============================================================

    async create(
        mouvementId: string,
        dto:
            CreateFinanceAttachmentDto,
        uploadedById:
            string,
        role:
            Role,
    ) {
        this.permissions.require(
            this.permissions.canManagePieceJointes(
                role,
            ),
            'Seul le comptable peut ajouter des justificatifs financiers.',
        );

        const mouvement =
            await this.requireMouvement(
                mouvementId,
            );

        if (
            dto.type
        ) {
            this.validateFile(
                dto.type,
                dto.taille,
            );
        }

        if (
            dto.taille !== undefined &&
            dto.taille >
            this.maxFileSize
        ) {
            throw new BadRequestException(
                'Le fichier ne peut pas dépasser 10 Mo.',
            );
        }

        const expectedPrefix =
            `finance/mouvements/${mouvementId}/`;

        if (
            !dto.storageKey.startsWith(
                expectedPrefix,
            )
        ) {
            throw new BadRequestException(
                'Clé de stockage invalide pour ce mouvement financier.',
            );
        }

        const existing =
            await this.prisma.pieceJointeFinance.findUnique({
                where: {
                    storageKey:
                        dto.storageKey,
                },
            });

        if (
            existing
        ) {
            throw new BadRequestException(
                'Ce justificatif a déjà été enregistré.',
            );
        }

        const piece =
            await this.prisma.pieceJointeFinance.create({
                data: {
                    nom:
                        dto.nom.trim(),

                    storageKey:
                        dto.storageKey,

                    taille:
                        dto.taille ??
                        null,

                    type:
                        dto.type ??
                        null,

                    mouvementId,

                    uploadedById,
                },

                include: {
                    uploadedBy: {
                        select: {
                            id:
                                true,

                            name:
                                true,

                            email:
                                true,
                        },
                    },
                },
            });

        await this.activityLog.log({
            userId:
                uploadedById,

            action:
                'PIECE_JOINTE_FINANCE_DEPOSEE',

            entityType:
                'PieceJointeFinance',

            entityId:
                piece.id,

            dossierId:
                mouvement.dossierId ??
                undefined,

            metadata: {
                mouvementId,

                nom:
                    piece.nom,

                storageKey:
                    piece.storageKey,

                type:
                    piece.type,

                taille:
                    piece.taille,
            },
        });

        return piece;
    }

    // ============================================================
    // FIND ONE
    // ============================================================

    private async findOne(
        id: string,
        role:
            Role,
    ) {
        this.permissions.require(
            this.permissions.canViewPieceJointes(
                role,
            ),
            'Vous n’avez pas les permissions nécessaires pour consulter les justificatifs financiers.',
        );

        const piece =
            await this.prisma.pieceJointeFinance.findUnique({
                where: {
                    id,
                },

                include: {
                    mouvement: {
                        select: {
                            id:
                                true,

                            dossierId:
                                true,
                        },
                    },

                    uploadedBy: {
                        select: {
                            id:
                                true,

                            name:
                                true,

                            email:
                                true,
                        },
                    },
                },
            });

        if (
            !piece
        ) {
            throw new NotFoundException(
                'Justificatif financier introuvable.',
            );
        }

        return piece;
    }

    // ============================================================
    // VIEW
    // ============================================================

    async getViewUrl(
        id: string,
        userId:
            string,
        role:
            Role,
    ) {
        const piece =
            await this.findOne(
                id,
                role,
            );

        const url =
            await this.s3.getViewUrl(
                piece.storageKey,
            );

        await this.activityLog.log({
            userId,

            action:
                'PIECE_JOINTE_FINANCE_CONSULTEE',

            entityType:
                'PieceJointeFinance',

            entityId:
                piece.id,

            dossierId:
                piece.mouvement.dossierId ??
                undefined,

            metadata: {
                mouvementId:
                    piece.mouvement.id,

                nom:
                    piece.nom,
            },
        });

        return {
            url,
        };
    }

    // ============================================================
    // DOWNLOAD
    // ============================================================

    async getDownloadUrl(
        id: string,
        userId:
            string,
        role:
            Role,
    ) {
        const piece =
            await this.findOne(
                id,
                role,
            );

        const url =
            await this.s3.getDownloadUrl(
                piece.storageKey,
            );

        await this.activityLog.log({
            userId,

            action:
                'PIECE_JOINTE_FINANCE_TELECHARGEE',

            entityType:
                'PieceJointeFinance',

            entityId:
                piece.id,

            dossierId:
                piece.mouvement.dossierId ??
                undefined,

            metadata: {
                mouvementId:
                    piece.mouvement.id,

                nom:
                    piece.nom,
            },
        });

        return {
            url,
        };
    }

    // ============================================================
    // DELETE
    // ============================================================

    async remove(
        id: string,
        userId:
            string,
        role:
            Role,
    ) {
        this.permissions.require(
            this.permissions.canManagePieceJointes(
                role,
            ),
            'Seul le comptable peut supprimer un justificatif financier.',
        );

        const piece =
            await this.prisma.pieceJointeFinance.findUnique({
                where: {
                    id,
                },

                include: {
                    mouvement: {
                        select: {
                            id:
                                true,

                            dossierId:
                                true,
                        },
                    },
                },
            });

        if (
            !piece
        ) {
            throw new NotFoundException(
                'Justificatif financier introuvable.',
            );
        }

        await this.s3.deleteObject(
            piece.storageKey,
        );

        await this.prisma.pieceJointeFinance.delete({
            where: {
                id,
            },
        });

        await this.activityLog.log({
            userId,

            action:
                'PIECE_JOINTE_FINANCE_SUPPRIMEE',

            entityType:
                'PieceJointeFinance',

            entityId:
                piece.id,

            dossierId:
                piece.mouvement.dossierId ??
                undefined,

            metadata: {
                mouvementId:
                    piece.mouvement.id,

                nom:
                    piece.nom,

                storageKey:
                    piece.storageKey,
            },
        });

        return {
            success:
                true,
        };
    }
}
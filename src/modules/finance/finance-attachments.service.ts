import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
    ServiceUnavailableException,
    UnauthorizedException,
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
import { signFinanceUpload, verifyFinanceUpload, validateFinanceStorageKey } from './finance-upload';

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
            (!Number.isSafeInteger(taille) || taille <= 0 || taille > this.maxFileSize)
        ) {
            throw new BadRequestException(
                'Le fichier ne peut pas dépasser 10 Mo.',
            );
        }
    }

    private async uploadActor(userId?: string) {
        if (!userId) throw new UnauthorizedException('Authentification requise.');
        const actor = await this.prisma.user.findUnique({ where: { id: userId }, select: { active: true, role: true } });
        if (!actor?.active) throw new UnauthorizedException('Compte absent ou inactif.');
        this.permissions.require(this.permissions.canManagePieceJointes(actor.role), 'Ajout de justificatifs non autorisé.');
        return userId;
    }

    private async objectInfo(key: string) {
        try { return await this.s3.getDocumentObjectInfo(key); }
        catch (error) {
            const status = error && typeof error === 'object' && '$metadata' in error
                ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode : undefined;
            if (status === 404) throw new NotFoundException('Fichier absent du stockage privé.');
            throw new ServiceUnavailableException('Stockage financier momentanément indisponible.');
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
        userId?: string,
    ) {
        this.permissions.require(
            this.permissions.canManagePieceJointes(
                role,
            ),
            'Seul le comptable peut ajouter des justificatifs financiers.',
        );

        const actorId = await this.uploadActor(userId);
        await this.requireMouvement(
            mouvementId,
        );

        this.validateFile(
            dto.contentType,
            dto.taille,
        );
        if (!dto.taille) throw new BadRequestException('Taille du justificatif requise.');

        const filename =
            this.sanitizeFilename(
                dto.filename,
            );

        const storageKey =
            `finance/mouvements/${mouvementId}/${randomUUID()}-${filename}`;
        validateFinanceStorageKey(storageKey, mouvementId);
        const uploadToken = signFinanceUpload({ userId: actorId, mouvementId, storageKey, nom: dto.filename.trim(),
            type: dto.contentType, taille: dto.taille, expires: Date.now() + 300_000 });

        const uploadUrl =
            await this.s3.getDocumentUploadUrl(
                storageKey,
                dto.contentType,
                dto.taille,
            );

        return {
            uploadUrl,
            storageKey,
            uploadToken,
            headers: { 'Content-Type': dto.contentType, 'If-None-Match': '*' },
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
        await this.uploadActor(uploadedById);
        validateFinanceStorageKey(dto.storageKey, mouvementId);
        verifyFinanceUpload(dto.uploadToken, { userId: uploadedById, mouvementId, storageKey: dto.storageKey,
            nom: dto.nom.trim(), type: dto.type ?? '', taille: dto.taille ?? 0 });
        const object = await this.objectInfo(dto.storageKey);
        this.validateFile(object.type ?? '', object.taille);
        if (object.taille !== dto.taille || object.type !== dto.type) {
            throw new BadRequestException('Les métadonnées ne correspondent pas au fichier réellement stocké.');
        }

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
            throw new ConflictException(
                'Ce justificatif a déjà été enregistré.',
            );
        }

        return this.prisma.$transaction(async tx => {
        const piece =
            await tx.pieceJointeFinance.create({
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
        }, tx);

        return piece;
        }).catch(error => {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
                throw new ConflictException('Ce justificatif a déjà été enregistré par une autre demande.');
            }
            throw error;
        });
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

        validateFinanceStorageKey(piece.storageKey, piece.mouvement.id);
        const object = await this.objectInfo(piece.storageKey);
        this.validateFile(object.type ?? '', object.taille);
        const url = await this.s3.getDocumentReadUrl(piece.storageKey, object.type!, piece.nom, true);

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

        validateFinanceStorageKey(piece.storageKey, piece.mouvement.id);
        const object = await this.objectInfo(piece.storageKey);
        const url = await this.s3.getDocumentReadUrl(piece.storageKey, object.type || 'application/octet-stream', piece.nom, false);

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

        validateFinanceStorageKey(piece.storageKey, piece.mouvement.id);
        // R2 and PostgreSQL cannot commit atomically. Persist the intent first so
        // a crash or storage failure never erases all evidence of the attempt.
        await this.activityLog.log({ userId, action: 'PIECE_JOINTE_FINANCE_SUPPRESSION_DEMANDEE',
            entityType: 'PieceJointeFinance', entityId: piece.id, dossierId: piece.mouvement.dossierId ?? undefined,
            metadata: { mouvementId: piece.mouvement.id, storageKey: piece.storageKey, nom: piece.nom,
                uploadedById: piece.uploadedById, type: piece.type, taille: piece.taille },
        });
        await this.s3.deleteFinanceObject(
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

import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';

import { randomUUID } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../../common/s3/s3.service';

import { PresignUserPieceDto } from './dto/presign-user-piece.dto';
import { CreateUserPieceDto } from './dto/create-user-piece.dto';

@Injectable()
export class UserPiecesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly s3: S3Service,
    ) { }

    /**
     * Vérifie que l'utilisateur existe.
     */
    private async ensureUserExists(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
            },
        });

        if (!user) {
            throw new NotFoundException(
                'Utilisateur introuvable.',
            );
        }

        return user;
    }

    /**
     * Génère une URL pré-signée pour envoyer
     * directement le fichier vers Cloudflare R2.
     */
    async presignUpload(
        userId: string,
        dto: PresignUserPieceDto,
    ) {
        await this.ensureUserExists(userId);

        const storageKey =
            `users/${userId}/pieces/` +
            `${randomUUID()}-${dto.filename}`;

        const uploadUrl = await this.s3.getUploadUrl(
            storageKey,
            dto.contentType,
        );

        return {
            uploadUrl,
            storageKey,
        };
    }

    /**
     * Enregistre la pièce dans PostgreSQL
     * après que le fichier ait été envoyé dans R2.
     */
    async create(
        userId: string,
        dto: CreateUserPieceDto,
    ) {
        await this.ensureUserExists(userId);

        if (dto.contratId) {
            const contrat =
                await this.prisma.contratUtilisateur.findFirst({
                    where: {
                        id: dto.contratId,
                        userId,
                    },
                });

            if (!contrat) {
                throw new BadRequestException(
                    'Le contrat indiqué n’appartient pas à cet utilisateur.',
                );
            }
        }

        const piece =
            await this.prisma.pieceUtilisateur.create({
                data: {
                    userId,
                    contratId: dto.contratId ?? null,
                    type: dto.type,
                    nom: dto.nom,
                    url: dto.url,
                    dateExpiration: dto.dateExpiration
                        ? new Date(dto.dateExpiration)
                        : null,
                },
            });

        return piece;
    }

    /**
     * Liste les pièces administratives d'un utilisateur.
     */
    async findAll(userId: string) {
        await this.ensureUserExists(userId);

        return this.prisma.pieceUtilisateur.findMany({
            where: {
                userId,
            },
            orderBy: {
                createdAt: 'desc',
            },
            include: {
                contrat: true,
            },
        });
    }

    /**
     * Récupère une pièce appartenant à l'utilisateur.
     */
    private async findOne(
        userId: string,
        pieceId: string,
    ) {
        const piece =
            await this.prisma.pieceUtilisateur.findFirst({
                where: {
                    id: pieceId,
                    userId,
                },
                include: {
                    contrat: true,
                },
            });

        if (!piece) {
            throw new NotFoundException(
                'Pièce administrative introuvable.',
            );
        }

        return piece;
    }

    /**
     * Génère une URL temporaire de téléchargement.
     */
    async getDownloadUrl(
        userId: string,
        pieceId: string,
    ) {
        const piece = await this.findOne(
            userId,
            pieceId,
        );

        const url = await this.s3.getDownloadUrl(
            piece.url,
        );

        return {
            url,
        };
    }

    /**
     * Supprime le fichier de R2 puis
     * son enregistrement dans PostgreSQL.
     */
    async remove(
        userId: string,
        pieceId: string,
    ) {
        const piece = await this.findOne(
            userId,
            pieceId,
        );

        await this.s3.deleteObject(piece.url);

        await this.prisma.pieceUtilisateur.delete({
            where: {
                id: piece.id,
            },
        });

        return {
            success: true,
        };
    }
}
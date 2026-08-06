import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../../common/s3/s3.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { CreateDocumentDto } from './dto/create-document.dto';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly activityLog: ActivityLogService,
  ) {}

  async presignUpload(dto: PresignUploadDto) {
    const storageKey = `dossiers/${dto.dossierId}/${randomUUID()}-${dto.filename}`;
    const uploadUrl = await this.s3.getUploadUrl(storageKey, dto.contentType);
    return { uploadUrl, storageKey };
  }

  findAll(dossierId?: string) {
    return this.prisma.document.findMany({
      where: dossierId ? { dossierId } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { dossier: true, uploadedBy: true },
    });
  }

  async findOne(id: string) {
    const document = await this.prisma.document.findUnique({
      where: { id },
    });

    if (!document) {
      throw new NotFoundException('Document introuvable.');
    }

    return document;
  }

  async create(dto: CreateDocumentDto, uploadedById: string) {
    const document = await this.prisma.document.create({
      data: {
        nom: dto.nom,
        dossierId: dto.dossierId,
        storageKey: dto.storageKey,
        taille: dto.taille ?? null,
        type: dto.type ?? null,
        visibilite: dto.visibilite,
        uploadedById,
      },
    });

    await this.activityLog.log({
      userId: uploadedById,
      action: 'DOCUMENT_DEPOSE',
      entityType: 'Document',
      entityId: document.id,
      dossierId: document.dossierId,
      metadata: { nom: document.nom },
    });

    return document;
  }

  async getDownloadUrl(id: string, userId: string) {
    const document = await this.findOne(id);

    await this.prisma.documentConsultation.create({
      data: { documentId: document.id, userId },
    });

    const url = await this.s3.getDownloadUrl(document.storageKey);
    return { url };
  }

  async remove(id: string) {
    const document = await this.findOne(id);
    await this.s3.deleteObject(document.storageKey);
    await this.prisma.document.delete({ where: { id } });
    return { success: true };
  }
}

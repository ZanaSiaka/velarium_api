import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { Role, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../../common/s3/s3.service';
import { DOSSIER_REFERENCE_SELECT } from '../../common/dossier-projections';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { CreateDocumentDto } from './dto/create-document.dto';

const DOCUMENT_SELECT = {
  id: true, nom: true, dossierId: true, storageKey: true, taille: true, type: true, visibilite: true,
  uploadedById: true, createdAt: true,
  dossier: { select: DOSSIER_REFERENCE_SELECT },
  uploadedBy: { select: { id: true, name: true } },
} satisfies Prisma.DocumentSelect;
type UploadClaim = { userId: string; dossierId: string; key: string; nom: string; type: string; taille: number; expires: number };

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService, private readonly s3: S3Service, private readonly activityLog: ActivityLogService) {}

  private async actor(userId?: string) {
    if (!userId) throw new UnauthorizedException('Authentification requise.');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, active: true } });
    if (!user?.active) throw new UnauthorizedException('Compte absent ou inactif.');
    // Validated policy: global internal dossier access, without an assignment restriction.
    return user;
  }

  private async dossier(id: string) {
    if (!await this.prisma.dossier.findUnique({ where: { id }, select: { id: true } })) throw new NotFoundException('Dossier introuvable.');
  }

  private validKey(key: string, dossierId: string) {
    const prefix = 'dossiers/' + dossierId + '/';
    if (!key.startsWith(prefix) || !key.slice(prefix.length) || /[\\\u0000-\u001f\u007f]/.test(key) ||
        key.split('/').some(part => part === '.' || part === '..') || key.slice(prefix.length).includes('/')) {
      throw new ForbiddenException('Clé de stockage hors du dossier autorisé.');
    }
  }

  private filename(name: string) {
    if (!name?.trim() || /[/\\\u0000-\u001f\u007f]/.test(name) || name === '.' || name === '..') throw new BadRequestException('Nom de fichier invalide.');
    return name.trim();
  }

  private size(size: number) {
    if (!Number.isSafeInteger(size) || size <= 0) throw new BadRequestException('Taille de fichier invalide.');
    const configured = process.env.DOCUMENT_MAX_FILE_BYTES;
    if (configured) {
      const maximum = Number(configured);
      if (!Number.isSafeInteger(maximum) || maximum <= 0) throw new ServiceUnavailableException('Configuration documentaire indisponible.');
      if (size > maximum) throw new BadRequestException('Le fichier dépasse la limite documentaire configurée.');
    }
  }

  private secret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new ServiceUnavailableException('Confirmation d’upload indisponible.');
    return secret;
  }
  private mac(payload: string) { return createHmac('sha256', this.secret()).update('document-upload-v1.' + payload).digest(); }
  private sign(claim: UploadClaim) {
    const payload = Buffer.from(JSON.stringify(claim)).toString('base64url');
    return payload + '.' + this.mac(payload).toString('base64url');
  }
  private claim(token: string): UploadClaim {
    try {
      const [payload, signature, extra] = token.split('.');
      if (!payload || !signature || extra !== undefined) throw new Error();
      const received = Buffer.from(signature, 'base64url'), expected = this.mac(payload);
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error();
      const claim = JSON.parse(Buffer.from(payload, 'base64url').toString()) as UploadClaim;
      if (!Number.isFinite(claim.expires) || claim.expires < Date.now()) throw new Error();
      return claim;
    } catch { throw new BadRequestException('Confirmation d’upload invalide ou expirée.'); }
  }

  private async object(key: string) {
    try { return await this.s3.getDocumentObjectInfo(key); }
    catch (error) {
      const status = error && typeof error === 'object' && '$metadata' in error
        ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode : undefined;
      if (status === 404) throw new NotFoundException('Fichier non présent dans le stockage.');
      throw new ServiceUnavailableException('Stockage documentaire momentanément indisponible.');
    }
  }

  async presignUpload(dto: PresignUploadDto, userId?: string) {
    const user = await this.actor(userId); await this.dossier(dto.dossierId);
    const nom = this.filename(dto.filename), type = dto.contentType?.trim().toLowerCase();
    this.size(dto.taille);
    if (!type || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(type)) throw new BadRequestException('Type MIME invalide.');
    const storageKey = 'dossiers/' + dto.dossierId + '/' + randomUUID();
    this.validKey(storageKey, dto.dossierId);
    const uploadToken = this.sign({ userId: user.id, dossierId: dto.dossierId, key: storageKey, nom, type, taille: dto.taille, expires: Date.now() + 300_000 });
    return { uploadUrl: await this.s3.getDocumentUploadUrl(storageKey, type, dto.taille), storageKey, uploadToken,
      headers: { 'Content-Type': type, 'If-None-Match': '*' } };
  }

  async findAll(dossierId: string | undefined, userId?: string) {
    const user = await this.actor(userId); if (dossierId) await this.dossier(dossierId);
    const documents = await this.prisma.document.findMany({
      where: { ...(dossierId ? { dossierId } : {}), NOT: { storageKey: { startsWith: 'sanctions-private/' } } },
      orderBy: { createdAt: 'desc' }, select: DOCUMENT_SELECT,
    });
    return documents.map(document => {
      let canRead = true;
      // Keep legacy metadata visible; never sign an out-of-scope key automatically.
      try { this.validKey(document.storageKey, document.dossierId); } catch { canRead = false; }
      const { storageKey, ...safe } = document;
      return { ...safe, canRead, canDelete: canRead && (user.role === Role.AVOCAT || document.uploadedById === user.id) };
    });
  }

  private async accessible(id: string, userId?: string) {
    const user = await this.actor(userId);
    const document = await this.prisma.document.findUnique({ where: { id } });
    if (!document) throw new NotFoundException('Document introuvable.');
    await this.dossier(document.dossierId);
    this.validKey(document.storageKey, document.dossierId);
    return { document, user };
  }

  async create(dto: CreateDocumentDto, userId?: string) {
    const user = await this.actor(userId); await this.dossier(dto.dossierId);
    const claim = this.claim(dto.uploadToken);
    this.validKey(dto.storageKey, dto.dossierId);
    if (claim.userId !== user.id || claim.dossierId !== dto.dossierId || claim.key !== dto.storageKey ||
        this.filename(dto.nom) !== claim.nom || (dto.taille !== undefined && dto.taille !== claim.taille) ||
        (dto.type !== undefined && dto.type.trim().toLowerCase() !== claim.type)) {
      throw new ForbiddenException('Confirmation ne correspondant pas à cet upload.');
    }
    const object = await this.object(dto.storageKey);
    this.size(claim.taille);
    if (object.taille !== claim.taille || object.type !== claim.type) throw new BadRequestException('Les métadonnées ne correspondent pas au fichier stocké.');
    let document;
    try {
      document = await this.prisma.$transaction(async tx => {
        if (await tx.document.findFirst({ where: { storageKey: dto.storageKey }, select: { id: true } })) throw new ConflictException('Cet upload est déjà enregistré.');
        return tx.document.create({ data: { nom: claim.nom, dossierId: claim.dossierId, storageKey: claim.key,
          taille: object.taille, type: object.type, visibilite: dto.visibilite, uploadedById: user.id }, select: DOCUMENT_SELECT });
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') throw new ConflictException('Confirmation simultanée. Rechargez la liste des documents.');
      throw error;
    }
    await this.activityLog.log({ userId: user.id, action: 'DOCUMENT_DEPOSE', entityType: 'Document', entityId: document.id, dossierId: document.dossierId });
    const { storageKey, ...safe } = document;
    return { ...safe, canRead: true, canDelete: true };
  }

  private async readUrl(id: string, userId: string, preview: boolean) {
    const { document } = await this.accessible(id, userId);
    const object = await this.object(document.storageKey);
    const url = await this.s3.getDocumentReadUrl(document.storageKey, object.type || 'application/octet-stream', this.filename(document.nom), preview);
    await this.prisma.documentConsultation.create({ data: { documentId: id, userId } });
    return { url };
  }
  getDownloadUrl(id: string, userId: string) { return this.readUrl(id, userId, false); }
  getViewUrl(id: string, userId: string) { return this.readUrl(id, userId, true); }

  async remove(id: string, userId?: string) {
    const { document, user } = await this.accessible(id, userId);
    if (document.uploadedById !== user.id && user.role !== Role.AVOCAT) throw new ForbiddenException('Suppression réservée à l’auteur du dépôt ou à un avocat actif.');
    try { await this.s3.deleteObject(document.storageKey); }
    catch { throw new ServiceUnavailableException('Suppression du fichier momentanément indisponible.'); }
    await this.prisma.document.delete({ where: { id } });
    return { success: true };
  }

  async findFolders(userId?: string) {
    await this.actor(userId);
    const dossiers = await this.prisma.dossier.findMany({
      where: { documents: { some: { NOT: { storageKey: { startsWith: 'sanctions-private/' } } } } },
      select: { ...DOSSIER_REFERENCE_SELECT, _count: { select: { documents: { where: { NOT: { storageKey: { startsWith: 'sanctions-private/' } } } } } } },
    });
    return dossiers.map(dossier => ({ id: dossier.id, reference: dossier.reference, natureAffaire: dossier.natureAffaire,
      typeDossier: dossier.typeDossier, documentCount: dossier._count.documents }));
  }
}

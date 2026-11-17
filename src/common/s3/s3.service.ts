import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Client S3-compatible générique : fonctionne avec AWS S3 (laisser
// S3_ENDPOINT vide) ou tout fournisseur compatible (Cloudflare R2, MinIO...)
// en renseignant S3_ENDPOINT.
@Injectable()
export class S3Service {
  private assertGenericKey(key: string) {
    if (key.startsWith('sanctions-private/')) throw new ForbiddenException('Pièce accessible uniquement par son module dédié.');
  }
  private assertLegacyKey(key: string) {
    this.assertGenericKey(key);
    if (key.startsWith('finance/')) throw new ForbiddenException('Justificatif accessible uniquement par le module Finance.');
  }
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET as string;

    const endpoint = process.env.S3_ENDPOINT || undefined;

    this.client = new S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint,
      forcePathStyle: !!endpoint,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY as string,
      },
      // Le SDK v3 ajoute par défaut un checksum CRC32 (paramètre
      // ?checksum-crc32=... dans l'URL pré-signée) que Cloudflare R2 (et la
      // plupart des fournisseurs S3-compatibles hors AWS) ne gère pas
      // correctement — la requête PUT échoue alors en CORS depuis le
      // navigateur. On désactive ce comportement, inutile pour notre usage.
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }

  getUploadUrl(key: string, contentType: string) {
    this.assertLegacyKey(key);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.client, command, { expiresIn: 300 });
  }

  getDownloadUrl(key: string) {
    this.assertLegacyKey(key);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: 300 });
  }

  getViewUrl(key: string) {
    this.assertLegacyKey(key);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: 'inline',
    });

    return getSignedUrl(this.client, command, {
      expiresIn: 300,
    });
  }

  getDocumentUploadUrl(key: string, contentType: string, size: number) {
    this.assertGenericKey(key);
    return getSignedUrl(this.client, new PutObjectCommand({
      Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: size, IfNoneMatch: '*',
    }), { expiresIn: 300, signableHeaders: new Set(['content-type', 'content-length', 'if-none-match']) });
  }

  async getDocumentObjectInfo(key: string) {
    this.assertGenericKey(key);
    const object = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return { taille: object.ContentLength, type: object.ContentType?.split(';')[0].trim().toLowerCase() };
  }

  getDocumentReadUrl(key: string, mime: string, filename: string, preview: boolean) {
    this.assertGenericKey(key);
    // Active content (HTML/SVG/etc.) is downloaded, never rendered inline.
    const inline = preview && ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime);
    const disposition = (inline ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(filename).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16));
    return getSignedUrl(this.client, new GetObjectCommand({
      Bucket: this.bucket, Key: key,
      ResponseContentType: inline ? mime : 'application/octet-stream',
      ResponseContentDisposition: disposition,
      ResponseCacheControl: 'private, no-store',
    }), { expiresIn: 300 });
  }

  async deleteObject(key: string) {
    this.assertLegacyKey(key);
    await this.deleteStoredObject(key);
  }

  async deleteFinanceObject(key: string) {
    if (!key.startsWith('finance/mouvements/')) throw new ForbiddenException('Clé financière invalide.');
    await this.deleteStoredObject(key);
  }

  private async deleteStoredObject(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

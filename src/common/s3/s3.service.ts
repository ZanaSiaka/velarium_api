import { Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Client S3-compatible générique : fonctionne avec AWS S3 (laisser
// S3_ENDPOINT vide) ou tout fournisseur compatible (Cloudflare R2, MinIO...)
// en renseignant S3_ENDPOINT.
@Injectable()
export class S3Service {
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
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.client, command, { expiresIn: 300 });
  }

  getDownloadUrl(key: string) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: 300 });
  }

  getViewUrl(key: string) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: 'inline',
    });

    return getSignedUrl(this.client, command, {
      expiresIn: 300,
    });
  }

  async deleteObject(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

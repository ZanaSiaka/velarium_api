import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

export const SANCTION_MAX_FILE = 5 * 1024 * 1024;
export const SANCTION_PREFIX = 'sanctions-private/v1/';
export type SanctionFile = { buffer: Buffer; size: number; mimetype: string };

// Separate object namespace: no generic Document record, no signed bearer URL.
@Injectable()
export class SanctionsStorageService {
  // Deliberate opt-in: do not silently reuse a possibly public generic bucket.
  private readonly bucket = process.env.SANCTIONS_S3_BUCKET;
  private readonly client = new S3Client({
    region: process.env.S3_REGION || 'auto', endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID as string, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY as string },
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
  private key(key: string) {
    if (!this.bucket) throw new ServiceUnavailableException('Stockage privé des justificatifs non configuré.');
    if (!/^sanctions-private\/v1\/[a-f0-9-]{36}$/.test(key)) throw new ServiceUnavailableException('Justificatif indisponible.');
    return key;
  }
  async put(key: string, file: SanctionFile) {
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.key(key), Body: file.buffer, ContentType: file.mimetype }));
    } catch { throw new ServiceUnavailableException('Stockage du justificatif indisponible.'); }
  }
  async read(key: string): Promise<Buffer> {
    try {
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
      if (!object.Body || (object.ContentLength ?? SANCTION_MAX_FILE + 1) > SANCTION_MAX_FILE) throw new Error();
      // Bounded stream even if ContentLength is misleading; no unbounded transformToByteArray.
      const chunks: Buffer[] = []; let size = 0;
      const stream = object.Body as AsyncIterable<Uint8Array> & { destroy?: () => void };
      for await (const bytes of stream) {
        size += bytes.length;
        if (size > SANCTION_MAX_FILE) { stream.destroy?.(); throw new Error(); }
        chunks.push(Buffer.from(bytes));
      }
      return Buffer.concat(chunks);
    } catch { throw new ServiceUnavailableException('Justificatif indisponible.'); }
  }
  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
  }
}


import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { DocumentsService } from '../documents/documents.service';
import { S3Service } from '../../common/s3/s3.service';
import { SanctionsStorageService, SANCTION_MAX_FILE } from './sanctions-storage.service';
import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));
describe('P3.1 isolation from generic document routes and S3', () => {
  const previousBucket = process.env.SANCTIONS_S3_BUCKET;
  beforeAll(() => { process.env.SANCTIONS_S3_BUCKET = 'private-test-bucket'; });
  afterAll(() => { if (previousBucket === undefined) delete process.env.SANCTIONS_S3_BUCKET; else process.env.SANCTIONS_S3_BUCKET = previousBucket; });
  const key = 'sanctions-private/v1/00000000-0000-0000-0000-000000000000';
  it.each(['getUploadUrl','getDownloadUrl','getViewUrl','deleteObject'])('generic S3 %s cannot use the reserved namespace', async method => {
    const s3 = Object.create(S3Service.prototype);
    await expect(Promise.resolve().then(() => s3[method](key,'application/pdf'))).rejects.toThrow(ForbiddenException);
  });
  it('blocks a forged generic Document record before its creation', async () => {
    const db: any = { document: { create: jest.fn() } };
    const docs = new DocumentsService(db, {} as never, {} as never);
    await expect(docs.create({ storageKey:key } as never,'user')).rejects.toThrow(ForbiddenException);
    expect(db.document.create).not.toHaveBeenCalled();
  });
  it.each(['getDownloadUrl','getViewUrl','remove'])('a grafted generic document cannot be used through %s', async method => {
    const db: any = { document: { findUnique: jest.fn(async () => ({ id:'doc',storageKey:key })) }, documentConsultation:{create:jest.fn()} };
    const s3: any = { getDownloadUrl:jest.fn(),getViewUrl:jest.fn(),deleteObject:jest.fn() };
    const docs = new DocumentsService(db,s3,{} as never);
    await expect(docs[method]('doc','user')).rejects.toThrow(ForbiddenException);
    expect(db.documentConsultation.create).not.toHaveBeenCalled(); expect(s3.deleteObject).not.toHaveBeenCalled();
  });
  it('excludes reserved metadata from generic document lists', () => {
    const db: any = { document: { findMany: jest.fn() } };
    new DocumentsService(db,{} as never,{} as never).findAll();
    expect(db.document.findMany.mock.calls[0][0].where.NOT.storageKey.startsWith).toBe('sanctions-private/');
  });
  it('private storage refuses keys outside its namespace before any network IO', async () => {
    const storage = new SanctionsStorageService();
    await expect(storage.read('dossiers/public')).rejects.toThrow(ServiceUnavailableException);
    await expect(storage.put('dossiers/public',{buffer:Buffer.from('test'),size:4,mimetype:'application/pdf'})).rejects.toThrow(ServiceUnavailableException);
  });
  it('bounds actual streamed S3 bytes and destroys an oversized stream', async () => {
    const storage = new SanctionsStorageService(); const destroy = jest.fn();
    const body = { async *[Symbol.asyncIterator]() { yield Buffer.alloc(SANCTION_MAX_FILE); yield Buffer.alloc(1); }, destroy };
    const client = (storage as unknown as {client:{send:jest.Mock}}).client;
    jest.spyOn(client,'send').mockResolvedValue({ Body:body, ContentLength:1 } as never);
    await expect(storage.read(key)).rejects.toThrow(ServiceUnavailableException);
    expect(destroy).toHaveBeenCalled();
  });
  it('fails closed when the private bucket was not explicitly configured', async () => {
    delete process.env.SANCTIONS_S3_BUCKET;
    const storage = new SanctionsStorageService();
    process.env.SANCTIONS_S3_BUCKET = 'private-test-bucket';
    await expect(storage.read(key)).rejects.toThrow(ServiceUnavailableException);
  });
  it('migration remains additive, gives a same-signal proof FK and immutable private history', () => {
    const sql=readFileSync(join(__dirname,'../../../prisma/migrations/20261028000000_add_sanctions/migration.sql'),'utf8');
    expect(sql).toContain('FOREIGN KEY ("justificatifId", "id") REFERENCES "SanctionPiece"("id", "signalementId")');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "SanctionHistorique"');
    expect(sql).toContain('BEFORE TRUNCATE ON "SanctionHistorique"');
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)|DELETE\s+FROM|UPDATE\s+"(?:Client|Dossier|User)"/i);
    expect(sql).toContain('BEGIN;'); expect(sql).toContain('COMMIT;');
  });
});


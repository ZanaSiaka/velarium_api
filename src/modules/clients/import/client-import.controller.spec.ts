import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { ClientImportController } from './client-import.controller';
import { ClientImportService } from './client-import.service';
import { upload } from './client-import.fixtures';
import { IMPORT_LIMITS } from './client-workbook';

jest.mock('../../../prisma/prisma.service', () => ({ PrismaService: class {} }));

describe('client import HTTP contracts and role guard', () => {
  let app: INestApplication;
  const preview = jest.fn(), confirm = jest.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ClientImportController],
      providers: [
        { provide: ClientImportService, useValue: { preview, confirm } },
        { provide: APP_GUARD, useValue: { canActivate(context) {
          const req = context.switchToHttp().getRequest();
          if (!req.headers['x-test-role']) throw new UnauthorizedException();
          req.user = { id: 'owner', role: req.headers['x-test-role'] }; return true;
        } } },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  beforeEach(() => { preview.mockReset().mockResolvedValue({ totals: { valid: 1 } }); confirm.mockReset().mockResolvedValue({ totals: { created: 1 } }); });
  afterAll(async () => { await app.close(); });
  it.each(['preview', 'confirm'])('rejects unauthenticated %s', async (phase) => {
    await request(app.getHttpServer()).post('/api/clients/import/' + phase).expect(401);
    expect(preview).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
  });
  it.each(['preview', 'confirm'])('rejects non-lawyers on %s before parsing an upload', async (phase) => {
    await request(app.getHttpServer()).post('/api/clients/import/' + phase).set('x-test-role', 'COMPTABLE').expect(403);
    expect(preview).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
  });
  it('accepts a multipart preview for a lawyer', async () => {
    await request(app.getHttpServer()).post('/api/clients/import/preview').set('x-test-role', 'AVOCAT').attach('file', upload([['PARTICULIER', 'Alice']]).buffer, 'clients.xlsx').expect(201);
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ originalname: 'clients.xlsx' }), 'owner');
  });
  it('rejects oversized uploads at the interceptor', async () => {
    await request(app.getHttpServer()).post('/api/clients/import/preview').set('x-test-role', 'AVOCAT').attach('file', Buffer.alloc(IMPORT_LIMITS.bytes + 1), 'clients.xlsx').expect(413);
    expect(preview).not.toHaveBeenCalled();
  });
  it('validates explicit confirmation and rejects client-supplied row overrides', async () => {
    await request(app.getHttpServer()).post('/api/clients/import/confirm').set('x-test-role', 'AVOCAT').field('token', 'x'.repeat(30)).field('confirmed', 'false').expect(400);
    await request(app.getHttpServer()).post('/api/clients/import/confirm').set('x-test-role', 'AVOCAT').field('token', 'x'.repeat(30)).field('confirmed', 'true').field('rows', '[]').expect(400);
    expect(confirm).not.toHaveBeenCalled();
  });
  it('accepts only token, explicit confirmation and original workbook', async () => {
    await request(app.getHttpServer()).post('/api/clients/import/confirm').set('x-test-role', 'AVOCAT').field('token', 'x'.repeat(30)).field('confirmed', 'true').attach('file', upload([['PARTICULIER', 'Alice']]).buffer, 'clients.xlsx').expect(201);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ originalname: 'clients.xlsx' }), 'owner', 'x'.repeat(30), 'true');
  });
});

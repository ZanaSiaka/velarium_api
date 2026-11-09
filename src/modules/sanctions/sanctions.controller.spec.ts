import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { SanctionsStorageService } from './sanctions-storage.service';
import { PersonnesSuiviesController, SanctionsController } from './sanctions.controller';
import { SanctionsService } from './sanctions.service';
import { SanctionsGuard } from './sanctions.guard';
import { sanctionsFixture } from './sanctions.fixtures';

jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));
const routes: [string,string][] = [
  ['get','/personnes-suivies'], ['post','/personnes-suivies'], ['get','/personnes-suivies/person'],
  ['patch','/personnes-suivies/person'],
  ['get','/personnes-suivies/person/sanctions'], ['post','/personnes-suivies/person/sanctions'],
  ['get','/personnes-suivies/person/dossiers'], ['post','/personnes-suivies/person/dossiers'],
  ['get','/personnes-suivies/person/historique'],
  ['get','/sanctions/signal'], ['patch','/sanctions/signal'], ['post','/sanctions/signal/transitions'],
  ['get','/sanctions/signal/historique'], ['get','/sanctions/signal/pieces'], ['post','/sanctions/signal/pieces'],
  ['get','/sanctions/signal/pieces/piece/contenu'],
];
describe('P3.1 all HTTP routes require an active lawyer (mock database)', () => {
  let app: INestApplication, f: ReturnType<typeof sanctionsFixture>, service: SanctionsService;
  beforeAll(async () => {
    f = sanctionsFixture();
    const module = await Test.createTestingModule({
      controllers: [PersonnesSuiviesController, SanctionsController],
      providers: [SanctionsService, SanctionsGuard,
        { provide: PrismaService, useValue: f.db }, { provide: SanctionsStorageService, useValue: f.storage },
        { provide: APP_GUARD, useValue: { canActivate(context) {
          const req = context.switchToHttp().getRequest();
          if (!req.headers['x-test-session']) throw new UnauthorizedException();
          // JWT is simulated; role/active authorization is checked against the mocked DB.
          req.user = { id: 'avocat', role: 'AVOCAT' }; return true;
        } } }, { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    service = module.get(SanctionsService);
    app = module.createNestApplication(); app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  beforeEach(() => { f.user.role = 'AVOCAT'; f.user.active = true; jest.clearAllMocks(); });
  afterAll(async () => { await app.close(); });
  const call = (method: string, path: string) => (request(app.getHttpServer()) as any)[method]('/api' + path);
  it.each(routes)('%s %s denies an absent session', async (method, path) => {
    await call(method, path).expect(401);
    expect(f.db.personneSuivie.findUnique).not.toHaveBeenCalled(); expect(f.storage.read).not.toHaveBeenCalled();
  });
  it.each(routes)('%s %s rejects a non-lawyer even with a stale lawyer JWT claim', async (method, path) => {
    f.user.role = 'COMPTABLE';
    await call(method, path).set('x-test-session','1').expect(403);
    expect(f.db.personneSuivie.findUnique).not.toHaveBeenCalled(); expect(f.db.signalementSanction.findUnique).not.toHaveBeenCalled();
  });
  it.each(routes)('%s %s denies an inactive lawyer', async (method, path) => {
    f.user.active = false;
    await call(method, path).set('x-test-session','1').expect(403);
    expect(f.storage.read).not.toHaveBeenCalled(); expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects an unexpected property without persisting', async () => {
    await call('post','/personnes-suivies').set('x-test-session','1').send({ nature:'PHYSIQUE', nom:'Nom', passwordHash:'never accepted' }).expect(400);
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  it('resolves creation, listing, filtering and detail with no secret user projection', async () => {
    const res = await call('post','/personnes-suivies').set('x-test-session','1').send({ nature:'PHYSIQUE', nom:'Personne test' }).expect(201);
    const list = await call('get','/personnes-suivies?recherche=Personne&limit=5').set('x-test-session','1').expect(200);
    expect(list.body.items).toHaveLength(1); expect(list.headers['cache-control']).toBe('private, no-store');
    const detail = await call('get','/personnes-suivies/' + res.body.id).set('x-test-session','1').expect(200);
    expect(detail.body).not.toHaveProperty('createdBy'); expect(detail.body).not.toHaveProperty('passwordHash');
  });
  it('rejects direct confirmation through creation and PATCH', async () => {
    const p = await service.createPersonne('avocat',{ nature:'PHYSIQUE', nom:'Nom' });
    await call('post','/personnes-suivies/' + p.id + '/sanctions').set('x-test-session','1').send({ type:'Type', source:'Source', description:'Faits', qualification:'CONFIRMEE' }).expect(400);
    await call('patch','/sanctions/any').set('x-test-session','1').send({ version:1, motif:'Correction motivée', qualification:'CONFIRMEE' }).expect(400);
  });
  it('validates multipart proof metadata and types without calling storage', async () => {
    const p = await service.createPersonne('avocat',{ nature:'PHYSIQUE', nom:'Nom' });
    const s = await service.createSignalement('avocat',p.id,{ type:'Type', source:'Source', description:'Faits' });
    await call('post','/sanctions/' + s.id + '/pieces').set('x-test-session','1')
      .field('version','1').field('motif','Dépôt motivé').field('referenceSource','Document 01')
      .attach('file', Buffer.from('<html>bad</html>'), {filename:'fake.pdf', contentType:'text/html'}).expect(400);
    expect(f.storage.put).not.toHaveBeenCalled();
  });
  it('streams private proof bytes with no-store, attachment and nosniff, without exposing a signed URL', async () => {
    const p = await service.createPersonne('avocat',{ nature:'PHYSIQUE', nom:'Nom' });
    const s = await service.createSignalement('avocat',p.id,{ type:'Type', source:'Source', description:'Faits' });
    const file = Buffer.from('%PDF-1.7\nprivate test');
    const uploaded = await call('post','/sanctions/' + s.id + '/pieces').set('x-test-session','1')
      .field('version','1').field('motif','Dépôt motivé').field('referenceSource','Document 01')
      .attach('file',file,{ filename:'decision.pdf', contentType:'application/pdf' }).expect(201);
    expect(uploaded.body.piece).not.toHaveProperty('storageKey');
    const res = await call('get','/sanctions/' + s.id + '/pieces/' + uploaded.body.piece.id + '/contenu').set('x-test-session','1').expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store'); expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.body).toEqual(file);
  });
});


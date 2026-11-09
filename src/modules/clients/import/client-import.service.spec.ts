import { BadRequestException, ConflictException, ForbiddenException, GoneException, ServiceUnavailableException } from '@nestjs/common';
import { ClientImportService } from './client-import.service';
import { upload } from './client-import.fixtures';
import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('../../../prisma/prisma.service', () => ({ PrismaService: class {} }));

describe('client import preview and atomic confirmation', () => {
  let service: ClientImportService, db: any, state: any;
  let role: string, active: boolean;
  const previousSecret = process.env.JWT_SECRET;
  beforeAll(() => { process.env.JWT_SECRET = 'test-only-import-signature-secret'; });
  afterAll(() => { if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });
  beforeEach(() => {
    role = 'AVOCAT'; active = true;
    state = { clients: [], batches: [], identities: [], logs: [] };
    db = {
      user: { findUnique: jest.fn(async () => ({ role, active })) },
      $queryRaw: jest.fn(async (query) => Array.isArray(query) ? [] : state.clients),
      client: { createManyAndReturn: jest.fn(async ({ data }) => {
        const clients = data.map((row, n) => ({ ...row, id: 'client-' + (state.clients.length + n) }));
        state.clients.push(...clients); return clients;
      }) },
      clientImport: {
        findUnique: jest.fn(async ({ where }) => state.batches.find((entry) => where.id ? entry.id === where.id : entry.fileHash === where.fileHash) ?? null),
        create: jest.fn(async ({ data }) => { state.batches.push(data); return data; }),
      },
      clientImportIdentity: {
        findMany: jest.fn(async ({ where }) => state.identities.filter((entry) => where.key.in.includes(entry.key))),
        createMany: jest.fn(async ({ data }) => { state.identities.push(...data); }),
      },
      activityLog: { createMany: jest.fn(async ({ data }) => { state.logs.push(...data); }) },
    };
    db.$transaction = jest.fn(async (fn) => {
      const before = structuredClone(state);
      try { return await fn(db); } catch (error) { state = before; throw error; }
    });
    service = new ClientImportService(db);
  });
  const file = () => upload([['PARTICULIER', 'Alice', ' Alice@EXAMPLE.COM ', '00123'], [' entreprise ', 'Cabinet', '', '', '', ' CI-123 ']]);

  it('previews all seven columns of an openpyxl workbook without any writes', async () => {
    const buffer = readFileSync(join(__dirname, '__fixtures__', 'openpyxl.xlsx'));
    const result = await service.preview({ originalname: 'clients.xlsx', buffer, size: buffer.length }, 'owner');
    expect(result.totals).toMatchObject({ total: 1, valid: 1, invalid: 0, duplicate: 0 });
    expect(result.rows[0].data).toEqual({ type: 'ENTREPRISE', nom: 'Cabinet Test', email: 'contact@example.test', telephone: '00123456', adresse: 'Conakry', numeroContribuable: '001122', notes: 'Note de test' });
    expect(state).toEqual({ clients: [], batches: [], identities: [], logs: [] });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('previews without any writes and normalizes particular/enterprise data', async () => {
    const preview = await service.preview(file(), 'owner');
    expect(preview.totals.valid).toBe(2);
    expect(preview.rows[0].data).toMatchObject({ type: 'PARTICULIER', nom: 'Alice', email: 'alice@example.com', telephone: '00123' });
    expect(preview.rows[1].data).toMatchObject({ type: 'ENTREPRISE', numeroContribuable: 'CI-123' });
    expect(state).toEqual({ clients: [], batches: [], identities: [], logs: [] });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(db.clientImportIdentity.findMany).toHaveBeenCalledTimes(1);
  });
  it('classifies incomplete rows and enterprise-only tax rules', async () => {
    const preview = await service.preview(upload([['PARTICULIER', ''], ['UNKNOWN', 'Nom'], ['PARTICULIER', 'Nom', 'bad-email'], ['PARTICULIER', 'Nom', '', '', '', '123']]), 'owner');
    expect(preview.totals.invalid).toBe(4);
  });
  it('marks formula rows invalid in the report', async () => {
    const preview = await service.preview(upload([['PARTICULIER', { formula: '1+1' }]]), 'owner');
    expect(preview.totals.invalid).toBe(1);
  });
  it('detects duplicate chains in the file by name/type or email', async () => {
    const preview = await service.preview(upload([['PARTICULIER', 'Alice', 'a@example.com'], ['PARTICULIER', ' ALICE ', 'b@example.com'], ['ENTREPRISE', 'Other', ' B@example.com ']]), 'owner');
    expect(preview.totals).toMatchObject({ valid: 1, duplicate: 2 });
  });
  it.each([
    { type: 'PARTICULIER', nom: 'ALICE', email: null, numeroContribuable: null },
    { type: 'ENTREPRISE', nom: 'Other', email: 'alice@example.com', numeroContribuable: null },
    { type: 'ENTREPRISE', nom: 'Other', email: null, numeroContribuable: 'ci-123' },
  ])('detects a matching existing client without updating it: %p', async (existing) => {
    state.clients.push(existing);
    const preview = await service.preview(file(), 'owner');
    expect(preview.totals.duplicate).toBe(1);
    expect(db.client.createManyAndReturn).not.toHaveBeenCalled();
    expect(state.clients).toEqual([existing]);
  });
  it.each(['JURISTE', 'COMPTABLE', 'SECRETARIAT', 'AVOCAT_STAGIAIRE', 'COLLABORATEUR_ASSOCIE', 'ARCHIVISTE'])('rejects both service routes for %s', async (otherRole) => {
    role = otherRole;
    await expect(service.preview(file(), 'owner')).rejects.toThrow(ForbiddenException);
    await expect(service.confirm(file(), 'owner', 'bad-token', 'true')).rejects.toThrow(ForbiddenException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects inactive users on both routes', async () => {
    active = false;
    await expect(service.preview(file(), 'owner')).rejects.toThrow(ForbiddenException);
    await expect(service.confirm(file(), 'owner', 'bad-token', 'true')).rejects.toThrow(ForbiddenException);
  });
  it('requires explicit confirmation before writing', async () => {
    const preview = await service.preview(file(), 'owner');
    await expect(service.confirm(file(), 'owner', preview.token, 'false')).rejects.toThrow(BadRequestException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects token tampering, other owners, and file replacement', async () => {
    const original = file(), preview = await service.preview(original, 'owner');
    await expect(service.confirm(original, 'owner', preview.token + 'x', 'true')).rejects.toThrow(BadRequestException);
    await expect(service.confirm(original, 'other-owner', preview.token, 'true')).rejects.toThrow(BadRequestException);
    await expect(service.confirm(upload([['PARTICULIER', 'Changed']]), 'owner', preview.token, 'true')).rejects.toThrow(BadRequestException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects multibyte signature tampering with HTTP 400', async () => {
    const original = file(), preview = await service.preview(original, 'owner');
    const body = preview.token.split('.')[0];
    await expect(service.confirm(original, 'owner', body + '.' + '\u00e9'.repeat(43), 'true')).rejects.toThrow(BadRequestException);
  });
  it('rejects expired confirmations without writes', async () => {
    const preview = await service.preview(file(), 'owner');
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60 * 1000);
    try { await expect(service.confirm(file(), 'owner', preview.token, 'true')).rejects.toThrow(GoneException); }
    finally { now.mockRestore(); }
    expect(state.clients).toHaveLength(0);
  });
  it('rechecks permissions if the role changed after preview', async () => {
    const preview = await service.preview(file(), 'owner'); role = 'JURISTE';
    await expect(service.confirm(file(), 'owner', preview.token, 'true')).rejects.toThrow(ForbiddenException);
  });
  it('creates clients, identity claims, audit and report in one transaction', async () => {
    const original = file(), preview = await service.preview(original, 'owner');
    const result = await service.confirm(original, 'owner', preview.token, 'true');
    expect(result.totals.created).toBe(2);
    expect(state.clients).toHaveLength(2);
    expect(state.identities.length).toBeGreaterThan(2);
    expect(state.logs).toHaveLength(2);
    expect(state.batches).toHaveLength(1);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: 'Serializable' }));
  });
  it('does not recreate clients on retry of the same confirmation', async () => {
    const original = file(), preview = await service.preview(original, 'owner');
    const first = await service.confirm(original, 'owner', preview.token, 'true');
    const retry = await service.confirm(original, 'owner', preview.token, 'true');
    expect(retry).toEqual(first);
    expect(db.client.createManyAndReturn).toHaveBeenCalledTimes(1);
  });
  it('refuses preview or a different confirmation of an already imported file', async () => {
    const original = file(), first = await service.preview(original, 'owner'), second = await service.preview(original, 'owner');
    await service.confirm(original, 'owner', first.token, 'true');
    await expect(service.preview(original, 'owner')).rejects.toThrow(ConflictException);
    await expect(service.confirm(original, 'owner', second.token, 'true')).rejects.toThrow(ConflictException);
  });
  it('revalidates against clients created since preview', async () => {
    const original = file(), preview = await service.preview(original, 'owner');
    state.clients.push({ type: 'PARTICULIER', nom: 'Alice', email: null });
    const result = await service.confirm(original, 'owner', preview.token, 'true');
    expect(result.totals).toMatchObject({ created: 1, duplicate: 1 });
  });
  it('never imports a row that was not eligible at preview', async () => {
    const original = file(); state.clients.push({ type: 'PARTICULIER', nom: 'Alice', email: null });
    const preview = await service.preview(original, 'owner'); state.clients = [];
    const result = await service.confirm(original, 'owner', preview.token, 'true');
    expect(result.totals).toMatchObject({ created: 1, skipped: 1 });
  });
  it('imports valid rows only and reports invalid rows without partial failure', async () => {
    const original = upload([['PARTICULIER', 'Alice'], ['PARTICULIER', ''], ['PARTICULIER', ' Alice ']]);
    const preview = await service.preview(original, 'owner');
    const result = await service.confirm(original, 'owner', preview.token, 'true');
    expect(result.totals).toMatchObject({ created: 1, invalid: 1, duplicate: 1 });
  });
  it('rolls back all clients when a later financial-independent import write fails', async () => {
    const original = file(), preview = await service.preview(original, 'owner');
    db.clientImportIdentity.createMany.mockRejectedValueOnce(new Error('database failure'));
    await expect(service.confirm(original, 'owner', preview.token, 'true')).rejects.toThrow(ServiceUnavailableException);
    expect(state).toEqual({ clients: [], batches: [], identities: [], logs: [] });
    expect((await service.confirm(original, 'owner', preview.token, 'true')).totals.created).toBe(2);
  });
  it('fails closed without signature configuration', async () => {
    const secret = process.env.JWT_SECRET; delete process.env.JWT_SECRET;
    try { await expect(service.preview(file(), 'owner')).rejects.toThrow(ServiceUnavailableException); }
    finally { process.env.JWT_SECRET = secret; }
    expect(state.clients).toHaveLength(0);
  });
});

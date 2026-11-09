import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import type { Prisma } from '../../../generated/prisma/client';

jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../../../generated/prisma/client', () => jest.requireActual('../../../generated/prisma/enums'));

describe('Client optional enterprise tax number contract', () => {
  let service: ClientsService;
  let current: any;
  let create: jest.Mock;
  let update: jest.Mock;
  beforeEach(() => {
    current = { id: 'client', type: 'ENTREPRISE', nom: 'Cabinet', numeroContribuable: 'OLD' };
    create = jest.fn(async ({ data }) => ({ id: 'new', ...data }));
    update = jest.fn(async ({ data }) => ({ ...current, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) }));
    service = new ClientsService({ client: { create, update } } as any, { log: jest.fn() } as any);
    jest.spyOn(service, 'findOne').mockImplementation(async () => current);
  });
  it('persists a trimmed optional number using the Prisma contract', async () => {
    const data = { nom: 'Entreprise', type: 'ENTREPRISE', numeroContribuable: ' CI-123 ' } satisfies Prisma.ClientCreateInput;
    expect(await service.create(data, 'user')).toMatchObject({ numeroContribuable: 'CI-123' });
  });
  it.each(['PARTICULIER', 'ENTREPRISE'] as const)('allows creation without a number for %s', async (type) => {
    expect(await service.create({ type, nom: 'Nom' }, 'user')).toMatchObject({ numeroContribuable: null });
  });
  it('rejects a tax number on a private individual', async () => {
    await expect(service.create({ nom: 'Nom', type: 'PARTICULIER', numeroContribuable: '123' }, 'user')).rejects.toThrow(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });
  it('preserves omitted numbers on PATCH', async () => {
    expect(await service.update('client', { notes: 'Note' })).toMatchObject({ numeroContribuable: 'OLD' });
    expect(update.mock.calls[0][0].data.numeroContribuable).toBeUndefined();
  });
  it.each([null, '', '   '])('explicitly clears a supplied empty number %p', async (value) => {
    expect(await service.update('client', { numeroContribuable: value })).toMatchObject({ numeroContribuable: null });
  });
  it('updates the number independently of other fields', async () => {
    expect(await service.update('client', { numeroContribuable: ' NEW ' })).toMatchObject({ numeroContribuable: 'NEW' });
  });
  it('requires explicit clearing when changing enterprise to private individual', async () => {
    await expect(service.update('client', { type: 'PARTICULIER' })).rejects.toThrow(BadRequestException);
    expect(update).not.toHaveBeenCalled();
    expect(await service.update('client', { type: 'PARTICULIER', numeroContribuable: null })).toMatchObject({ type: 'PARTICULIER', numeroContribuable: null });
  });
  it('checks the persisted client type when the type is omitted', async () => {
    current.type = 'PARTICULIER';
    current.numeroContribuable = null;
    await expect(service.update('client', { numeroContribuable: '123' })).rejects.toThrow(BadRequestException);
  });
  it('allows assigning the enterprise type and number together', async () => {
    current.type = 'PARTICULIER';
    current.numeroContribuable = null;
    expect(await service.update('client', { type: 'ENTREPRISE', numeroContribuable: 'NEW' })).toMatchObject({ type: 'ENTREPRISE', numeroContribuable: 'NEW' });
  });
  it('retains the number in HTTP DTO validation and rejects invalid types', async () => {
    const dto = plainToInstance(CreateClientDto, { type: 'ENTREPRISE', nom: 'Nom', numeroContribuable: '123' });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(dto.numeroContribuable).toBe('123');
    expect(await validate(plainToInstance(UpdateClientDto, { numeroContribuable: 123 }))).not.toHaveLength(0);
  });
});

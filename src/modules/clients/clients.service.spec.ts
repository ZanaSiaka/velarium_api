import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ClientsService } from './clients.service';
import { UpdateClientDto } from './dto/update-client.dto';

jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../../../generated/prisma/client', () => jest.requireActual('../../../generated/prisma/enums'));

describe('ClientsService partial updates', () => {
  let service: ClientsService;
  let stored: Record<string, unknown>;
  let update: jest.Mock;

  beforeEach(() => {
    stored = { id: 'client', type: 'PARTICULIER', nom: 'Nom', email: 'email@example.com', telephone: '123', adresse: 'Adresse', notes: 'Notes' };
    update = jest.fn(async ({ data }) => {
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) stored[key] = value;
      }
      return { ...stored };
    });
    service = new ClientsService({ client: { update } } as any, { log: jest.fn() } as any);
    jest.spyOn(service, 'findOne').mockResolvedValue(stored as any);
  });

  it('preserves omitted contact details and notes', async () => {
    const before = { ...stored };
    await service.update('client', { nom: 'Nouveau nom' });
    expect(stored).toEqual({ ...before, nom: 'Nouveau nom' });
  });

  it.each(['email', 'telephone', 'adresse', 'notes'])('accepts explicit null for %s and preserves other values', async (field) => {
    const before = { ...stored };
    await service.update('client', { [field]: null });
    expect(stored).toEqual({ ...before, [field]: null });
  });

  it('keeps explicit empty strings compatible with clearing nullable fields', async () => {
    await service.update('client', { email: null, telephone: '', adresse: '', notes: '' });
    expect(stored).toMatchObject({ email: null, telephone: null, adresse: null, notes: null });
  });

  it.each([{ nom: null }, { type: null }, { nom: 123 }, { nom: '   ' }, { telephone: 123 }, { notes: [] }, { email: 'invalid' }])('rejects invalid values before writing: %p', async (dto) => {
    await expect(service.update('client', dto as any)).rejects.toThrow(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('aligns DTO validation: omitted fields and nullable text accepted; required null rejected', async () => {
    expect(await validate(plainToInstance(UpdateClientDto, {}))).toEqual([]);
    expect(await validate(plainToInstance(UpdateClientDto, { notes: null, email: null }))).toEqual([]);
    expect((await validate(plainToInstance(UpdateClientDto, { nom: null, type: null }))).map((e) => e.property)).toEqual(expect.arrayContaining(['nom', 'type']));
  });
});

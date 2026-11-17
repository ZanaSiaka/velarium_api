import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DossiersService } from './dossiers.service';
import { FinancePermissionService } from '../finance/finance-permission.service';
import { UpdateDossierDto } from './dto/update-dossier.dto';

// No database connection: exercise the service against transaction delegates.
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../../../generated/prisma/client', () => jest.requireActual('../../../generated/prisma/enums'));

describe('DossiersService partial updates', () => {
  let service: DossiersService;
  let tx: any;
  let prisma: any;
  let log: any;
  let stored: any;
  beforeEach(() => {
    stored = {
      id: 'dossier', reference: '2026-001', kycSoupcon: true,
      declarationSoupcon: 'Declaration existante', juridiction: 'Tribunal',
      partieAdverse: 'Adverse', avocatClientNom: 'Nom',
      avocatClientEmail: 'email@example.com', avocatClientTelephone: '123',
      collaborateurs: ['ancien'],
    };
    tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'avocat', active: true, role: 'AVOCAT' }),
        findMany: jest.fn().mockImplementation(async ({ where }) => where.id.in.map((id) => ({ id }))),
      },
      dossierCollaborateur: { deleteMany: jest.fn().mockImplementation(async () => { stored.collaborateurs = []; }) },
      dossier: { findUniqueOrThrow: jest.fn().mockImplementation(async () => ({ statut: stored.statut, dateCloture: stored.dateCloture, archive: stored.archive, kycSoupcon: stored.kycSoupcon, declarationSoupcon: stored.declarationSoupcon })), update: jest.fn().mockImplementation(async ({ data }) => {
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined && key !== 'collaborateurs') stored[key] = value;
        }
        if (data.collaborateurs) stored.collaborateurs = data.collaborateurs.create.map((v) => v.userId);
        return { ...stored };
      }) },
    };
    prisma = { $transaction: jest.fn().mockImplementation(async (callback) => {
      const snapshot = structuredClone(stored);
      try { return await callback(tx); }
      catch (error) { stored = snapshot; throw error; }
    }) };
    log = { log: jest.fn().mockResolvedValue(undefined) };
    service = new DossiersService(prisma, log, new FinancePermissionService());
    jest.spyOn(service, 'findOne').mockResolvedValue(stored);
  });

  it('preserves omitted collaborators, KYC and optional fields', async () => {
    const before = structuredClone(stored);
    await service.update('dossier', { natureAffaire: 'Modification' }, 'user');
    expect(stored).toEqual({ ...before, natureAffaire: 'Modification' });
    expect(tx.dossierCollaborateur.deleteMany).not.toHaveBeenCalled();
  });
  it('clears collaborators when an empty array is supplied', async () => {
    await service.update('dossier', { collaborateurIds: [] }, 'user');
    expect(stored.collaborateurs).toEqual([]);
    expect(tx.dossierCollaborateur.deleteMany).toHaveBeenCalledWith({ where: { dossierId: 'dossier' } });
    expect(tx.user.findMany).not.toHaveBeenCalled();
  });
  it('validates and replaces collaborators without duplicates in a transaction', async () => {
    await service.update('dossier', { collaborateurIds: ['a', 'a', 'b'] }, 'user');
    expect(stored.collaborateurs).toEqual(['a', 'b']);
    expect(tx.user.findMany).toHaveBeenCalledWith({ where: { id: { in: ['a', 'b'] } }, select: { id: true } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.user.findMany.mock.invocationCallOrder[0]).toBeLessThan(tx.dossierCollaborateur.deleteMany.mock.invocationCallOrder[0]);
  });
  it('rejects an unknown collaborator before deleting associations', async () => {
    tx.user.findMany.mockResolvedValue([]);
    await expect(service.update('dossier', { collaborateurIds: ['missing'] }, 'user')).rejects.toThrow(NotFoundException);
    expect(tx.dossierCollaborateur.deleteMany).not.toHaveBeenCalled();
    expect(log.log).not.toHaveBeenCalled();
  });
  it.each([null, [''], [123], 'invalid'])('rejects invalid collaborator input %p', async (ids) => {
    await expect(service.update('dossier', { collaborateurIds: ids } as any, 'user')).rejects.toThrow(BadRequestException);
    expect(tx.dossierCollaborateur.deleteMany).not.toHaveBeenCalled();
  });
  it('rolls back replacement when the dossier update fails', async () => {
    tx.dossier.update.mockRejectedValue(new Error('write failed'));
    await expect(service.update('dossier', { collaborateurIds: ['a'] }, 'user')).rejects.toThrow('write failed');
    expect(stored.collaborateurs).toEqual(['ancien']);
    expect(log.log).not.toHaveBeenCalled();
  });
  it('updates the declaration without requiring kycSoupcon', async () => {
    await service.update('dossier', { declarationSoupcon: ' Nouvelle ' }, 'user');
    expect(stored.declarationSoupcon).toBe('Nouvelle');
    expect(stored.kycSoupcon).toBe(true);
  });
  it('accepts explicit false and preserves an omitted declaration', async () => {
    await service.update('dossier', { kycSoupcon: false }, 'user');
    expect(stored.kycSoupcon).toBe(false);
    expect(stored.declarationSoupcon).toBe('Declaration existante');
  });
  it('allows explicitly clearing nullable fields', async () => {
    await service.update('dossier', { kycSoupcon: false, juridiction: '', declarationSoupcon: '' }, 'user');
    expect(stored.juridiction).toBeNull();
    expect(stored.declarationSoupcon).toBeNull();
  });
  it.each([null, { active: false }])('rejects a missing or inactive responsible lawyer %p', async (avocat) => {
    tx.user.findUnique.mockResolvedValue(avocat);
    await expect(service.update('dossier', { avocatResponsableId: 'avocat', collaborateurIds: [] }, 'user')).rejects.toThrow(avocat ? BadRequestException : NotFoundException);
    expect(tx.dossier.update).not.toHaveBeenCalled();
    expect(tx.dossierCollaborateur.deleteMany).not.toHaveBeenCalled();
  });
  it('accepts an active responsible lawyer', async () => {
    await service.update('dossier', { avocatResponsableId: 'avocat' }, 'user');
    expect(stored.avocatResponsableId).toBe('avocat');
  });
  it('rejects an inactive responsible lawyer on creation before financial writes', async () => {
    prisma.dossier = { count: jest.fn().mockResolvedValue(0) };
    tx.client = { findUnique: jest.fn().mockResolvedValue({ id: 'client' }) };
    tx.user.findUnique.mockResolvedValueOnce({ active: true, role: 'AVOCAT' }).mockResolvedValueOnce({ active: false });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(service.create({ montantFraisOuverture: 100, fraisOuvertureRegles: true, clientId: 'client', avocatResponsableId: 'avocat' } as any, 'user')).rejects.toThrow(BadRequestException);
    } finally { consoleSpy.mockRestore(); }
  });
  it('allows updating a historical unpaid dossier without changing its fees', async () => {
    stored.fraisOuverture = { statut: 'A_PAYER', montant: 100, mouvementFinanceId: null };
    await service.update('dossier', { natureAffaire: 'Modification' }, 'user');
    expect(stored.fraisOuverture).toEqual({ statut: 'A_PAYER', montant: 100, mouvementFinanceId: null });
    expect(stored.kycSoupcon).toBe(true);
    expect(stored.collaborateurs).toEqual(['ancien']);
  });
  it.each(['avocatClientNom', 'avocatClientEmail', 'avocatClientTelephone', 'juridiction', 'partieAdverse', 'declarationSoupcon'])('clears explicit null only for the supplied nullable field %s', async (field) => {
    const before = structuredClone(stored);
    await service.update('dossier', { [field]: null, ...(field === 'declarationSoupcon' ? { kycSoupcon: false } : {}) }, 'user');
    expect(stored).toEqual({ ...before, [field]: null, ...(field === 'declarationSoupcon' ? { kycSoupcon: false } : {}) });
  });
  it.each(['kycSoupcon', 'clientId', 'avocatResponsableId', 'statut', 'natureAffaire', 'typeDossier', 'collaborateurIds'])('rejects explicit null for %s before writing', async (field) => {
    await expect(service.update('dossier', { [field]: null } as any, 'user')).rejects.toThrow(BadRequestException);
    expect(tx.dossier.update).not.toHaveBeenCalled();
    expect(tx.dossierCollaborateur.deleteMany).not.toHaveBeenCalled();
  });
  it('DTO rejects null for required fields but accepts nullable legal fields', async () => {
    expect(await validate(plainToInstance(UpdateDossierDto, { avocatClientNom: null, declarationSoupcon: null }))).toEqual([]);
    expect((await validate(plainToInstance(UpdateDossierDto, { kycSoupcon: null, collaborateurIds: null }))).map((e) => e.property)).toEqual(expect.arrayContaining(['kycSoupcon', 'collaborateurIds']));
  });
  it('reuses the existing declaration when activating suspicion without resending it', async () => {
    stored.kycSoupcon = false;
    await service.update('dossier', { kycSoupcon: true }, 'user');
    expect(stored.kycSoupcon).toBe(true);
    expect(stored.declarationSoupcon).toBe('Declaration existante');
  });
  it.each([null, '', '   '])('rejects clearing the effective declaration while suspicion remains active: %p', async (value) => {
    await expect(service.update('dossier', { declarationSoupcon: value, collaborateurIds: [] }, 'user')).rejects.toThrow(BadRequestException);
    expect(tx.dossier.update).not.toHaveBeenCalled();
    expect(tx.dossierCollaborateur.deleteMany).not.toHaveBeenCalled();
    expect(log.log).not.toHaveBeenCalled();
  });
  it('allows unrelated edits on a legacy dossier with an incomplete declaration', async () => {
    stored.declarationSoupcon = null;
    await service.update('dossier', { natureAffaire: 'Legacy' }, 'user');
    expect(stored.kycSoupcon).toBe(true);
    expect(stored.declarationSoupcon).toBeNull();
    expect(tx.dossier.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'dossier' } }));
  });
  it('rejects activating suspicion without an existing or supplied declaration', async () => {
    stored.kycSoupcon = false;
    stored.declarationSoupcon = null;
    await expect(service.update('dossier', { kycSoupcon: true }, 'user')).rejects.toThrow(BadRequestException);
    expect(tx.dossier.update).not.toHaveBeenCalled();
  });
  it('the update DTO accepts omitted KYC and collaborators without injecting defaults', async () => {
    const dto = plainToInstance(UpdateDossierDto, { natureAffaire: 'Modification' });
    expect(await validate(dto)).toEqual([]);
    expect(dto.kycSoupcon).toBeUndefined();
    expect(dto.collaborateurIds).toBeUndefined();
  });
});

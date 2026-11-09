import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DossiersService } from './dossiers.service';
import { CreateDossierDto } from './dto/create-dossier.dto';
import { FinancePermissionService } from '../finance/finance-permission.service';
import { MoyenOperationCompte, Role } from '../../../generated/prisma/enums';

jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../../../generated/prisma/client', () => jest.requireActual('../../../generated/prisma/enums'));

describe('DossiersService mandatory opening payment', () => {
  let service: DossiersService;
  let prisma: any;
  let tx: any;
  let log: any;
  let dto: CreateDossierDto;
  let writes: Array<{ table: string; data: any }>;
  let committed: typeof writes;
  const legacy = { id: 'legacy', reference: '2025-001', fraisOuverture: { montant: 100, statut: 'A_PAYER', mouvementFinance: null } };

  beforeEach(() => {
    writes = [];
    committed = [];
    const create = (table: string) => jest.fn(async ({ data }) => {
      writes.push({ table, data });
      return { id: table, ...data };
    });
    tx = {
      user: { findUnique: jest.fn(async ({ where }) => ({ id: where.id, active: true, role: Role.AVOCAT })) },
      client: { findUnique: jest.fn().mockResolvedValue({ id: 'client', nom: 'Client' }) },
      caisse: { findUnique: jest.fn().mockResolvedValue({ id: 'caisse', nom: 'Caisse', type: 'ESPECES', active: true, devise: 'XOF', institution: null, moyensOperation: [MoyenOperationCompte.ESPECES] }) },
      dossier: {
        create: create('dossier'),
        findUniqueOrThrow: jest.fn(async () => ({
          id: 'dossier', reference: '2026-001',
          fraisOuverture: writes.find((w) => w.table === 'frais')?.data,
          recusEncaissement: writes.filter((w) => w.table === 'recu').map((w) => w.data),
        })),
      },
      mouvementFinance: { create: create('mouvement') },
      fraisOuvertureDossier: { create: create('frais') },
      recuEncaissement: { count: jest.fn().mockResolvedValue(0), create: create('recu') },
    };
    prisma = {
      dossier: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([structuredClone(legacy)]), findUnique: jest.fn().mockResolvedValue({ ...structuredClone(legacy), factures: [], provisions: [] }) },
      // Model the transaction boundary; this verifies the service contract, not PostgreSQL rollback.
      $transaction: jest.fn(async (callback) => {
        try {
          const result = await callback(tx);
          committed = [...writes];
          return result;
        } catch (error) { writes = []; throw error; }
      }),
    };
    log = { log: jest.fn().mockResolvedValue(undefined) };
    service = new DossiersService(prisma, log, new FinancePermissionService());
    dto = {
      natureAffaire: 'Affaire', typeDossier: 'Civil', statut: 'EN_COURS',
      clientId: 'client', avocatResponsableId: 'avocat', kycSoupcon: false,
      montantFraisOuverture: 1000, fraisOuvertureRegles: true,
      caisseIdFraisOuverture: 'caisse', moyenPaiementFraisOuverture: MoyenOperationCompte.ESPECES,
    };
  });

  it.each([false, undefined, null, 'true', 1])('rejects an unconfirmed payment flag %p with HTTP 400', async (value) => {
    dto.fraisOuvertureRegles = value as any;
    await expect(service.create(dto, 'encaisseur')).rejects.toMatchObject({ status: 400, message: expect.stringContaining('doivent être réglés') });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(committed).toEqual([]);
  });
  it.each([0, -1, NaN, Infinity])('rejects invalid amount %p before writes', async (amount) => {
    dto.montantFraisOuverture = amount;
    await expect(service.create(dto, 'encaisseur')).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each(['caisseIdFraisOuverture', 'moyenPaiementFraisOuverture'])('requires %s', async (field) => {
    delete dto[field];
    await expect(service.create(dto, 'encaisseur')).rejects.toThrow(BadRequestException);
    expect(tx.dossier.create).not.toHaveBeenCalled();
  });
  it.each([null, { active: false }])('rejects a nonexistent or inactive caisse %p', async (caisse) => {
    tx.caisse.findUnique.mockResolvedValue(caisse);
    await expect(service.create(dto, 'encaisseur')).rejects.toThrow(caisse ? BadRequestException : NotFoundException);
    expect(tx.dossier.create).not.toHaveBeenCalled();
    expect(tx.mouvementFinance.create).not.toHaveBeenCalled();
  });
  it.each([MoyenOperationCompte.VIREMENT, MoyenOperationCompte.CARTE, MoyenOperationCompte.MOBILE_MONEY])('rejects unauthorized or legacy payment method %s', async (method) => {
    dto.moyenPaiementFraisOuverture = method;
    await expect(service.create(dto, 'encaisseur')).rejects.toThrow(BadRequestException);
    expect(tx.dossier.create).not.toHaveBeenCalled();
  });
  it('preserves the XOF restriction', async () => {
    tx.caisse.findUnique.mockResolvedValue({ active: true, devise: 'EUR' });
    await expect(service.create(dto, 'encaisseur')).rejects.toThrow('doit être en XOF');
    expect(tx.dossier.create).not.toHaveBeenCalled();
  });
  it.each([Role.SECRETARIAT, Role.JURISTE, Role.AVOCAT_STAGIAIRE, Role.COLLABORATEUR_ASSOCIE, Role.ARCHIVISTE])('rejects encashment without finance permissions: %s', async (role) => {
    tx.user.findUnique.mockResolvedValue({ active: true, role });
    await expect(service.create(dto, 'encaisseur')).rejects.toThrow(ForbiddenException);
    expect(tx.caisse.findUnique).not.toHaveBeenCalled();
    expect(tx.dossier.create).not.toHaveBeenCalled();
  });
  it.each([null, { active: false, role: Role.AVOCAT }])('rejects an absent or inactive encashment user %p', async (user) => {
    tx.user.findUnique.mockResolvedValue(user);
    await expect(service.create(dto, 'encaisseur')).rejects.toThrow(ForbiddenException);
    expect(tx.dossier.create).not.toHaveBeenCalled();
  });
  it.each([Role.AVOCAT, Role.COMPTABLE])('records all linked entries atomically for %s', async (role) => {
    tx.user.findUnique.mockResolvedValue({ active: true, role });
    const result = await service.create(dto, 'encaisseur');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(committed.map((w) => w.table)).toEqual(['dossier', 'mouvement', 'frais', 'recu']);
    expect(tx.mouvementFinance.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'ENTREE', montant: 1000, caisseId: 'caisse', moyenPaiement: 'ESPECES', dossierId: 'dossier', userId: 'encaisseur' }) });
    expect(result.fraisOuverture).toMatchObject({ statut: 'PAYE', montant: 1000, mouvementFinanceId: 'mouvement', factureId: null });
    expect(result.recusEncaissement).toEqual([expect.objectContaining({ montant: 1000, dossierId: 'dossier', mouvementFinanceId: 'mouvement', createdById: 'encaisseur' })]);
    expect(log.log).toHaveBeenCalledTimes(1);
  });
  it('validates and deduplicates collaborators before creating the dossier', async () => {
    dto.collaborateurIds = ['a', 'a', 'b'];
    tx.user.findMany = jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    await service.create(dto, 'encaisseur');
    expect(tx.user.findMany).toHaveBeenCalledWith({ where: { id: { in: ['a', 'b'] } }, select: { id: true } });
    expect(tx.dossier.create).toHaveBeenCalledWith({ data: expect.objectContaining({ collaborateurs: { create: [{ userId: 'a' }, { userId: 'b' }] } }) });
  });
  it('rejects unknown collaborators before creating any entries', async () => {
    dto.collaborateurIds = ['missing'];
    tx.user.findMany = jest.fn().mockResolvedValue([]);
    await expect(service.create(dto, 'encaisseur')).rejects.toThrow(NotFoundException);
    expect(tx.dossier.create).not.toHaveBeenCalled();
    expect(committed).toEqual([]);
  });
  it('preserves default payment methods for legacy caisse configuration', async () => {
    const caisse = await tx.caisse.findUnique();
    tx.caisse.findUnique.mockResolvedValue({ ...caisse, moyensOperation: [] });
    await service.create(dto, 'encaisseur');
    expect(committed).toHaveLength(4);
  });
  it.each(['mouvementFinance', 'fraisOuvertureDossier', 'recuEncaissement'])('propagates %s failures to the transaction without committing partial writes', async (delegate) => {
    tx[delegate].create.mockRejectedValue(new Error('write failed'));
    await expect(service.create(dto, 'encaisseur')).rejects.toThrow('write failed');
    expect(tx.dossier.create).toHaveBeenCalledTimes(1);
    expect(committed).toEqual([]);
    expect(log.log).not.toHaveBeenCalled();
  });
  it('keeps historical unpaid dossiers readable and excludes unpaid fees from receipts', async () => {
    const dossiers = await service.findAll();
    expect(dossiers[0].fraisOuverture).toMatchObject({ statut: 'A_PAYER', statutAffichage: 'IMPAYE' });
    const book = await service.getLivrePaiements('legacy');
    expect(book.totalFraisOuvertureEncaisse).toBe(0);
    expect(book.operations).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(committed).toEqual([]);
    expect(legacy.fraisOuverture.statut).toBe('A_PAYER');
  });
  it.each([undefined, null, '', '   '])('rejects creation with suspicion and empty declaration: %p', async (value) => {
    dto.kycSoupcon = true;
    dto.declarationSoupcon = value;
    await expect(service.create(dto, 'encaisseur')).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    const errors = await validate(plainToInstance(CreateDossierDto, dto));
    expect(errors.map((e) => e.property)).toContain('declarationSoupcon');
  });
  it('records a trimmed declaration when suspicion is active', async () => {
    dto.kycSoupcon = true;
    dto.declarationSoupcon = ' Declaration ';
    expect(await validate(plainToInstance(CreateDossierDto, dto))).toEqual([]);
    await service.create(dto, 'encaisseur');
    expect(tx.dossier.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kycSoupcon: true, declarationSoupcon: 'Declaration' }) });
  });
  it('the DTO requires payment confirmation, account and method', async () => {
    const invalid = plainToInstance(CreateDossierDto, { ...dto, fraisOuvertureRegles: false, caisseIdFraisOuverture: undefined, moyenPaiementFraisOuverture: undefined });
    const errors = await validate(invalid);
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['fraisOuvertureRegles', 'caisseIdFraisOuverture', 'moyenPaiementFraisOuverture']));
    expect(await validate(plainToInstance(CreateDossierDto, dto))).toEqual([]);
  });
});

import { createHash } from 'crypto';
import { EtatMesureSanction as Etat, QualificationSanction as Qualification } from '../../../generated/prisma/client';

export function sanctionsFixture() {
  let state: any = { people: [], signals: [], pieces: [], history: [], links: [] };
  const user = { id: 'avocat', role: 'AVOCAT', active: true };
  const existing = { client: { id: 'client', type: 'PARTICULIER', notes: 'historique' }, dossier: { id: 'dossier', clientId: 'client', kycSoupcon: true, declarationSoupcon: 'ancien KYC', statut: 'EN_COURS' } };
  const project = (row: any, select: any) => row ? Object.fromEntries(Object.entries(select).filter(([,v]) => v === true).map(([k]) => [k, row[k] ?? null])) : null;
  let seq = 0;
  const create = (table: string, defaults = {}) => jest.fn(async ({ data, select }) => {
    const row = { id: table + '-' + ++seq, createdAt: new Date(), updatedAt: new Date(), ...defaults, ...data };
    state[table].push(row); return project(row, select);
  });
  const find = (table: string) => jest.fn(async ({ where, select }) => project(state[table].find((row) => Object.entries(where).every(([k,v]) => v === undefined || row[k] === v)), select));
  const all = (table: string) => jest.fn(async ({ where = {}, select, take, skip = 0 }) => state[table].filter((row) => Object.entries(where).every(([k,v]) => v === undefined || (typeof v === 'object' ? true : row[k] === v))).slice(skip, skip + (take ?? 100)).map(row => project(row, select)));
  const update = (table: string) => jest.fn(async ({ where, data }) => {
    const row = state[table].find((row) => row.id === where.id && row.version === where.version);
    if (!row) return { count: 0 };
    Object.assign(row, data, { version: row.version + 1, updatedAt: new Date() }); return { count: 1 };
  });
  const db: any = {
    user: { findUnique: jest.fn(async () => ({ ...user })) },
    client: { findUnique: jest.fn(async ({ where }) => where.id === 'client' ? { id: 'client', type: 'PARTICULIER' } : null) },
    dossier: { findUnique: jest.fn(async ({ where }) => where.id === 'dossier' ? { id: 'dossier', clientId: 'client' } : null) },
    personneSuivie: { create: create('people', { version: 1 }), findUnique: find('people'), findMany: all('people'), count: jest.fn(async () => state.people.length), updateMany: update('people') },
    signalementSanction: { create: create('signals', { version: 1, qualification: Qualification.A_VERIFIER, etatMesure: Etat.NON_DETERMINE }), findUnique: find('signals'), findFirst: find('signals'), findMany: all('signals'), count: jest.fn(async () => state.signals.length), updateMany: update('signals') },
    sanctionHistorique: { create: create('history'), findMany: all('history') },
    sanctionPiece: { create: create('pieces'), findFirst: find('pieces'), findMany: all('pieces') },
    dossierPersonne: { create: create('links'), findMany: all('links') },
  };
  // A serial queue models transaction isolation; NOT a real PostgreSQL concurrency test.
  let queue: Promise<void> = Promise.resolve();
  db.$transaction = jest.fn(async (work) => {
    const previous = queue; let release!: () => void;
    queue = new Promise<void>((resolve) => { release = resolve; });
    await previous; const before = structuredClone(state);
    try { return await work(db); } catch (error) { state = before; throw error; } finally { release(); }
  });
  const objects = new Map<string, Buffer>();
  const storage: any = {
    put: jest.fn(async (key, file) => { objects.set(key, file.buffer); }),
    read: jest.fn(async key => { const bytes = objects.get(key); if (!bytes) throw new Error('storage private'); return bytes; }),
    remove: jest.fn(async key => { objects.delete(key); }),
  };
  return { db, storage, user, existing, objects, state: () => state, sha: (b: Buffer) => createHash('sha256').update(b).digest('hex') };
}


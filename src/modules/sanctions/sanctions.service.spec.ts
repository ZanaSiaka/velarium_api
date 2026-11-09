import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ActionSanction as Action, EtatMesureSanction as Etat, QualificationSanction as Qualification, NaturePersonneSuivie as Nature } from '../../../generated/prisma/client';
import { SanctionsService, MEASURE_TRANSITIONS } from './sanctions.service';
import { sanctionsFixture } from './sanctions.fixtures';

jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));
const basic = { type: 'DISCIPLINAIRE', source: 'Décision officielle vérifiée', description: 'Description factuelle', autorite: 'Autorité', referenceDecision: 'DEC-01', dateDecision: '2026-09-01', dateDebut: '2026-10-01', dateFin: '2026-12-31' };
const pdf = { buffer: Buffer.from('%PDF-1.7\njustificatif test'), size: Buffer.byteLength('%PDF-1.7\njustificatif test'), mimetype: 'application/pdf' };
const motif = 'Vérification documentée du changement';

describe('P3.1 sanctions business rules and atomicity (mocks only)', () => {
  let f: ReturnType<typeof sanctionsFixture>, service: SanctionsService;
  beforeAll(() => { jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }); jest.setSystemTime(new Date('2026-10-28T12:00:00Z')); });
  afterAll(() => jest.useRealTimers());
  beforeEach(() => { f = sanctionsFixture(); service = new SanctionsService(f.db, f.storage); });
  async function person(established = true, clientId?: string) {
    return service.createPersonne('avocat', { nature: Nature.PHYSIQUE, nom: 'Homonyme', clientId, identiteEtablie: established,
      ...(established ? { identifiantType: 'IDENTIFIANT_VERIFIE', identifiantValeur: 'ID-01', justificationIdentite: 'Identité vérifiée manuellement par source fiable.' } : {}) });
  }
  async function signal(established = true, override = {}) {
    const p = await person(established);
    return service.createSignalement('avocat', p.id, { ...basic, ...override });
  }
  async function proof(id: string, version: number) {
    return service.uploadPiece('avocat', id, { version, motif, referenceSource: 'Pièce officielle DEC-01' }, pdf);
  }
  async function confirmed() {
    const s = await signal(); const p = await proof(s.id, s.version);
    return service.transition('avocat', s.id, { version: p.version, action: Action.CONFIRMER, etatMesure: Etat.EN_VIGUEUR, justificatifId: p.piece.id, motif });
  }
  it.each(['COLLABORATEUR_ASSOCIE','AVOCAT_STAGIAIRE','JURISTE','ARCHIVISTE','SECRETARIAT','COMPTABLE'])('denies role %s on searches, before data lookup', async role => {
    f.user.role = role;
    await expect(service.listPersonnes('avocat', {} as never)).rejects.toThrow(ForbiddenException);
    expect(f.db.personneSuivie.findMany).not.toHaveBeenCalled();
  });
  it('denies inactive lawyers at service level', async () => {
    f.user.active = false;
    await expect(person()).rejects.toThrow(ForbiddenException);
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  it('rechecks the active lawyer inside the mutation transaction', async () => {
    f.db.user.findUnique.mockResolvedValueOnce(f.user).mockResolvedValueOnce({ ...f.user, active: false });
    await expect(person()).rejects.toThrow(ForbiddenException);
    expect(f.state().people).toEqual([]);
  });
  it('never deduplicates homonyms or links a client by name', async () => {
    const a = await person(), b = await person();
    expect(a.id).not.toBe(b.id); expect(a.clientId).toBeNull(); expect(b.clientId).toBeNull();
    expect(f.db.client.findUnique).not.toHaveBeenCalled();
  });
  it('accepts legal entities and an explicit existing client link', async () => {
    f.db.client.findUnique.mockResolvedValueOnce({ id:'client', type:'ENTREPRISE' });
    const p = await service.createPersonne('avocat', { nature: Nature.MORALE, nom: 'Société', clientId: 'client' });
    expect(p.clientId).toBe('client'); expect(p.identiteVerifieeAt).toBeNull();
    expect(f.state().history[0].action).toBe('PERSONNE_CREEE');
  });
  it('rejects unknown explicit client links', async () => {
    await expect(person(true, 'missing')).rejects.toThrow('Client introuvable');
    expect(f.state().people).toHaveLength(0);
  });
  it('requires identifying information for an established identity', async () => {
    await expect(service.createPersonne('avocat', { nature: Nature.PHYSIQUE, nom: 'Nom', identiteEtablie: true })).rejects.toThrow(BadRequestException);
  });
  it('manually links a dossier with its own version and immutable history', async () => {
    const p = await person(true, 'client');
    const link = await service.linkDossier('avocat', p.id, { version: 1, dossierId: 'dossier', qualite: 'CLIENT', motif });
    expect(link.version).toBe(2); expect(f.state().history.at(-1).action).toBe('DOSSIER_LIE');
    await expect(service.linkDossier('avocat', p.id, { version: 1, dossierId: 'dossier', qualite: 'AUTRE', motif })).rejects.toThrow(ConflictException);
  });
  it('refuses a client role inconsistent with the explicit client link', async () => {
    const p = await person();
    await expect(service.linkDossier('avocat', p.id, { version: 1, dossierId: 'dossier', qualite: 'CLIENT', motif })).rejects.toThrow(BadRequestException);
    expect(f.state().links).toHaveLength(0);
  });
  it('always starts unverified with an undetermined measure', async () => {
    const s = await signal();
    expect(s).toMatchObject({ qualification: Qualification.A_VERIFIER, etatMesure: Etat.NON_DETERMINE, verifiedAt: null });
  });
  it.each(['qualification', 'etatMesure', 'verifiedById', 'justificatifId'])('rejects %s injected into a creation', async field => {
    const p = await person();
    await expect(service.createSignalement('avocat', p.id, { ...basic, [field]: 'CONFIRMEE' } as never)).rejects.toThrow('Données invalides');
  });
  it('refuses confirmation without proof', async () => {
    const s = await signal();
    await expect(service.transition('avocat', s.id, { version: 1, action: Action.CONFIRMER, etatMesure: Etat.EN_VIGUEUR, motif })).rejects.toThrow('justificatif');
    expect(f.state().signals[0].qualification).toBe(Qualification.A_VERIFIER);
  });
  it('does not equate an imported or linked client with an established identity', async () => {
    const s = await signal(false); const p = await proof(s.id, 1);
    await expect(service.transition('avocat', s.id, { version: p.version, action: Action.CONFIRMER, etatMesure: Etat.EN_VIGUEUR, justificatifId: p.piece.id, motif })).rejects.toThrow('identité');
  });
  it('confirms with source, established identity and verified stored proof', async () => {
    const s = await confirmed();
    expect(s).toMatchObject({ qualification: Qualification.CONFIRMEE, etatMesure: Etat.EN_VIGUEUR, verifiedById: 'avocat', version: 3 });
    expect(s.verifiedAt).toEqual(new Date());
    expect(f.state().history.at(-1).snapshot.after.justificatifId).toBe(s.justificatifId);
  });
  it('requires the proof to belong to the signalement', async () => {
    const a = await signal(), b = await signal(); const p = await proof(a.id, 1);
    await expect(service.transition('avocat', b.id, { version: 1, action: Action.CONFIRMER, etatMesure: Etat.EN_VIGUEUR, justificatifId: p.piece.id, motif })).rejects.toThrow('rattaché');
  });
  it('refuses tampered stored bytes', async () => {
    const s = await signal(), p = await proof(s.id, 1); f.storage.read.mockResolvedValue(Buffer.from('tampered'));
    await expect(service.transition('avocat', s.id, { version: 2, action: Action.CONFIRMER, etatMesure: Etat.EN_VIGUEUR, justificatifId: p.piece.id, motif })).rejects.toThrow('vérifié');
  });
  it.each([{ autorite: null }, { referenceDecision: null }, { dateDecision: null }, { dateDecision: '2026-12-01' }])('refuses incomplete confirmed decisions %p', async override => {
    const s = await signal(true, override), p = await proof(s.id, 1);
    await expect(service.transition('avocat', s.id, { version: 2, action: Action.CONFIRMER, etatMesure: Etat.EN_VIGUEUR, justificatifId: p.piece.id, motif })).rejects.toThrow(BadRequestException);
  });
  it('supports a justified decision date not applicable', async () => {
    const s = await signal(true, { dateDecision: null, dateDecisionApplicable: false, motifDateDecisionAbsente: 'Décision sans date applicable, justification documentée.' }), p = await proof(s.id, 1);
    expect((await service.transition('avocat', s.id, { version: 2, action: Action.CONFIRMER, etatMesure: Etat.EN_VIGUEUR, justificatifId: p.piece.id, motif })).qualification).toBe(Qualification.CONFIRMEE);
  });
  it('preserves an unknown end date without inferring permanence', async () => {
    const s = await signal(true, { dateFin: null }), p = await proof(s.id, 1);
    const result = await service.transition('avocat', s.id, { version: 2, action: Action.CONFIRMER, etatMesure: Etat.EN_VIGUEUR, justificatifId: p.piece.id, motif });
    expect(result.dateFin).toBeNull(); expect(result).not.toHaveProperty('permanente');
  });
  it.each([{ dateDebut: '2026-12-31', dateFin: '2026-01-01' }, { dateDecision: '2026-02-30' }, { dateFin: 'not-a-date' }, { dateDecisionApplicable: false }])('rejects incoherent dates %p', async override => {
    await expect(signal(true, override)).rejects.toThrow(BadRequestException);
  });
  it('preserves omitted PATCH fields and explicitly clears optional fields', async () => {
    const s = await signal(); const result = await service.patchSignalement('avocat', s.id, { version: 1, motif, description: 'Rectification factuelle', sourceUrl: null, dateFin: null });
    expect(result).toMatchObject({ source: basic.source, description: 'Rectification factuelle', autorite: basic.autorite, dateFin: null, qualification: Qualification.A_VERIFIER });
  });
  it.each(['type','source','description','dateDecisionApplicable','version'])('rejects null in required PATCH field %s', async field => {
    const s = await signal();
    await expect(service.patchSignalement('avocat', s.id, { version: 1, motif, [field]: null } as never)).rejects.toThrow(BadRequestException);
  });
  it('rejects qualification changes and short/missing motives through PATCH', async () => {
    const s = await signal();
    await expect(service.patchSignalement('avocat', s.id, { version: 1, motif, qualification: 'CONFIRMEE' } as never)).rejects.toThrow(BadRequestException);
    await expect(service.patchSignalement('avocat', s.id, { version: 1 } as never)).rejects.toThrow(BadRequestException);
  });
  it('requires proof again for corrections to confirmed records', async () => {
    const s = await confirmed();
    await expect(service.patchSignalement('avocat', s.id, { version: s.version, motif, description: 'Correction sensible' })).rejects.toThrow('justificatif');
    const result = await service.patchSignalement('avocat', s.id, { version: s.version, motif, description: 'Correction sensible', justificatifId: s.justificatifId! });
    expect(result.version).toBe(4); expect(result.qualification).toBe(Qualification.CONFIRMEE);
  });
  it('supports exclusion and explicit reopening without an active measure', async () => {
    const s = await signal();
    const excluded = await service.transition('avocat', s.id, { version: 1, action: Action.ECARTER, motif });
    expect(excluded).toMatchObject({ qualification: Qualification.ECARTEE, etatMesure: Etat.NON_DETERMINE });
    expect((await service.transition('avocat', s.id, { version: 2, action: Action.REOUVRIR, motif })).qualification).toBe(Qualification.A_VERIFIER);
  });
  it('does not revert a confirmed sanction to unverified or excluded', async () => {
    const s = await confirmed();
    for (const action of [Action.ECARTER, Action.REOUVRIR, Action.CONFIRMER]) await expect(service.transition('avocat', s.id, { version: s.version, action, motif })).rejects.toThrow(BadRequestException);
  });
  it.each(Object.values(Etat).flatMap(from => Object.values(Etat).map(to => [from, to] as const)))('enforces measure transition %s -> %s', async (from, to) => {
    const s = await confirmed(); f.state().signals[0].etatMesure = from;
    const input = { version: s.version, action: Action.MODIFIER_MESURE, etatMesure: to, justificatifId: s.justificatifId!, motif, dateFin: to === Etat.EXPIREE ? '2026-10-20' : '2026-12-31' };
    if (MEASURE_TRANSITIONS[from].includes(to)) {
      const result = await service.transition('avocat', s.id, input);
      expect(result).toMatchObject({ qualification: Qualification.CONFIRMEE, etatMesure: to });
    } else await expect(service.transition('avocat', s.id, input)).rejects.toThrow(BadRequestException);
  });
  it('rejects future active measures and expired measures without an end', async () => {
    for (const [etatMesure, override] of [[Etat.EN_VIGUEUR, { dateDebut: '2026-12-01' }], [Etat.EXPIREE, { dateFin: null }], [Etat.A_VENIR, { dateDebut: '2026-10-01' }]] as const) {
      const s = await signal(true, override), p = await proof(s.id, 1);
      await expect(service.transition('avocat', s.id, { version: 2, action: Action.CONFIRMER, etatMesure, justificatifId: p.piece.id, motif })).rejects.toThrow(BadRequestException);
    }
  });
  it('returns 409 for stale versions without adding history', async () => {
    const s = await signal(); const before = structuredClone(f.state());
    await expect(service.patchSignalement('avocat', s.id, { version: 99, motif, source: 'Autre source' })).rejects.toThrow(ConflictException);
    expect(f.state()).toEqual(before);
  });
  it('allows only one of two concurrent mutations of the same version', async () => {
    const s = await signal();
    const results = await Promise.allSettled([service.patchSignalement('avocat', s.id, { version: 1, motif, source: 'Source A' }), service.patchSignalement('avocat', s.id, { version: 1, motif, source: 'Source B' })]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(x => x.status === 'rejected')).toHaveLength(1);
    expect(f.state().history.filter(x => x.action === 'SIGNALEMENT_CORRIGE')).toHaveLength(1);
  });
  it('handles a failed CAS even when the earlier version read matched', async () => {
    const s = await signal(); f.db.signalementSanction.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.patchSignalement('avocat', s.id, { version: 1, motif, source: 'Source A' })).rejects.toThrow(ConflictException);
  });
  it('rolls back the mutation if private history insertion fails', async () => {
    const s = await signal(); const before = structuredClone(f.state());
    f.db.sanctionHistorique.create.mockRejectedValueOnce(new Error('private SQL details'));
    await expect(service.patchSignalement('avocat', s.id, { version: 1, motif, source: 'Source A' })).rejects.toThrow('Opération non enregistrée');
    expect(f.state()).toEqual(before);
  });
  it('rolls back proof metadata but preserves a private object if commit outcome may be unknown', async () => {
    const s = await signal(); const before = structuredClone(f.state());
    f.db.sanctionHistorique.create.mockRejectedValueOnce(new Error('private SQL'));
    await expect(proof(s.id, 1)).rejects.toThrow('Opération non enregistrée');
    expect(f.state()).toEqual(before); expect(f.objects.size).toBe(1);
  });
  it('cleans the newly uploaded object after a definite optimistic conflict', async () => {
    const s = await signal(); f.db.signalementSanction.updateMany.mockResolvedValueOnce({ count:0 });
    await expect(proof(s.id, 1)).rejects.toThrow(ConflictException);
    expect(f.state().pieces).toHaveLength(0); expect(f.objects.size).toBe(0);
  });
  it('allows establishing identity later with an explicit, versioned correction', async () => {
    const p = await person(false);
    const after = await service.patchPersonne('avocat',p.id,{ version:1, motif, identiteEtablie:true, identifiantType:'IDENTIFIANT', identifiantValeur:'ID-02', justificationIdentite:'Contrôle manuel documenté' });
    expect(after.identiteVerifieeParId).toBe('avocat'); expect(after.version).toBe(2);
    expect(f.state().history.at(-1).action).toBe('PERSONNE_CORRIGEE');
    const cleared = await service.patchPersonne('avocat',p.id,{ version:2, motif, identiteEtablie:false, identifiantValeur:null });
    expect(cleared.identifiantValeur).toBeNull(); expect(cleared.identiteVerifieeAt).toBeNull();
  });
  it('does not allow silently changing a confirmed sanction subject', async () => {
    const s = await confirmed();
    await expect(service.patchPersonne('avocat',s.personneId,{version:1,motif,nom:'Autre personne'})).rejects.toThrow(ConflictException);
  });
  it('checks manual client link nature compatibility', async () => {
    await expect(service.createPersonne('avocat',{nature:Nature.MORALE,nom:'Entreprise',clientId:'client'})).rejects.toThrow(BadRequestException);
  });
  it('sanitizes read errors instead of exposing query contents', async () => {
    f.db.personneSuivie.findMany.mockRejectedValueOnce(new Error('private name + SQL'));
    await expect(service.listPersonnes('avocat',{} as never)).rejects.toThrow('Information indisponible.');
  });
  it('never exposes storage keys and rechecks lawyer access to downloads', async () => {
    const s = await signal(), p = await proof(s.id, 1);
    expect(p.piece).not.toHaveProperty('storageKey');
    expect(await service.listPieces('avocat', s.id, {} as never)).toEqual([p.piece]);
    const download = await service.downloadPiece('avocat', s.id, p.piece.id);
    expect(download.bytes).toEqual(pdf.buffer); expect(download).not.toHaveProperty('storageKey');
    f.user.active = false;
    await expect(service.downloadPiece('avocat', s.id, p.piece.id)).rejects.toThrow(ForbiddenException);
  });
  it('denies revocation occurring while bytes are read', async () => {
    const s = await signal(), p = await proof(s.id, 1);
    f.storage.read.mockImplementationOnce(async () => { f.user.active = false; return pdf.buffer; });
    await expect(service.downloadPiece('avocat', s.id, p.piece.id)).rejects.toThrow(ForbiddenException);
  });
  it.each([{ ...pdf, mimetype: 'text/html' }, { ...pdf, size: 0 }, { buffer: Buffer.alloc(5 * 1024 * 1024 + 1), size: 5 * 1024 * 1024 + 1, mimetype: 'application/pdf' }])('refuses invalid attachments', async file => {
    const s = await signal();
    await expect(service.uploadPiece('avocat', s.id, { version: 1, motif, referenceSource: 'DEC-01' }, file)).rejects.toThrow(BadRequestException);
    expect(f.storage.put).not.toHaveBeenCalled();
  });
  it('returns projected fields and bounded pagination only to active lawyers', async () => {
    await person(); await service.listPersonnes('avocat', {} as never);
    const query = f.db.personneSuivie.findMany.mock.calls[0][0];
    expect(query.take).toBe(20); expect(query.select).not.toHaveProperty('createdBy');
    await expect(service.listPersonnes('avocat', { page: 1, limit: 1000 })).rejects.toThrow(BadRequestException);
  });
  it('does not touch historic Clients, Dossiers, KYC or finance', async () => {
    const before = structuredClone(f.existing);
    const s = await confirmed();
    await service.transition('avocat', s.id, { version: s.version, action: Action.MODIFIER_MESURE, etatMesure: Etat.SUSPENDUE, justificatifId: s.justificatifId!, motif });
    expect(f.existing).toEqual(before);
    expect(f.db.client).not.toHaveProperty('update'); expect(f.db.dossier).not.toHaveProperty('update');
    expect(f.db).not.toHaveProperty('activityLog'); expect(f.db).not.toHaveProperty('facture');
  });
});


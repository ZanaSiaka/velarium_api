import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance, ClassConstructor } from 'class-transformer';
import { validateSync } from 'class-validator';
import { createHash, randomUUID } from 'crypto';
import { ActionSanction, EtatMesureSanction as Etat, QualificationSanction as Qualification, Prisma, Role } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePersonneSuivieDto, CreateSanctionDto, DepotSanctionPieceDto, LienDossierPersonneDto, ListeSanctionsDto, PageSanctionsDto, PatchPersonneSuivieDto, PatchSanctionDto, RecherchePersonnesDto, TransitionSanctionDto } from './sanctions.dto';
import { SANCTION_MAX_FILE, SANCTION_PREFIX, SanctionFile, SanctionsStorageService } from './sanctions-storage.service';

const PERSON = { id: true, nature: true, nom: true, identifiantType: true, identifiantValeur: true, justificationIdentite: true, identiteVerifieeAt: true, identiteVerifieeParId: true, clientId: true, createdById: true, version: true, createdAt: true, updatedAt: true } satisfies Prisma.PersonneSuivieSelect;
const SIGNAL = { id: true, personneId: true, qualification: true, etatMesure: true, type: true, source: true, sourceUrl: true, autorite: true, referenceDecision: true, description: true, dateDecision: true, dateDecisionApplicable: true, motifDateDecisionAbsente: true, dateDebut: true, dateFin: true, createdById: true, verifiedById: true, verifiedAt: true, justificatifId: true, version: true, createdAt: true, updatedAt: true } satisfies Prisma.SignalementSanctionSelect;
const PIECE = { id: true, signalementId: true, mimeType: true, taille: true, sha256: true, referenceSource: true, uploadedById: true, createdAt: true } satisfies Prisma.SanctionPieceSelect;
const HISTORY = { id: true, personneId: true, signalementId: true, userId: true, action: true, motif: true, version: true, snapshot: true, createdAt: true } satisfies Prisma.SanctionHistoriqueSelect;
type Signal = Prisma.SignalementSanctionGetPayload<{ select: typeof SIGNAL }>;
type Tx = Prisma.TransactionClient;
type BusinessData = Pick<Signal, 'type' | 'source' | 'description' | 'sourceUrl' | 'autorite' | 'referenceDecision' | 'dateDecision' | 'dateDecisionApplicable' | 'motifDateDecisionAbsente' | 'dateDebut' | 'dateFin'>;
const nullableText = ['sourceUrl', 'autorite', 'referenceDecision', 'motifDateDecisionAbsente'] as const;
const requiredText = ['type', 'source', 'description'] as const;
const dates = ['dateDecision', 'dateDebut', 'dateFin'] as const;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function bad(message = 'Données de sanction incohérentes.'): never { throw new BadRequestException(message); }

export const MEASURE_TRANSITIONS: Readonly<Record<Etat, readonly Etat[]>> = {
  NON_DETERMINE: [],
  A_VENIR: [Etat.EN_VIGUEUR, Etat.SUSPENDUE, Etat.EXPIREE, Etat.LEVEE, Etat.ANNULEE],
  EN_VIGUEUR: [Etat.SUSPENDUE, Etat.EXPIREE, Etat.LEVEE, Etat.ANNULEE],
  SUSPENDUE: [Etat.EN_VIGUEUR, Etat.EXPIREE, Etat.LEVEE, Etat.ANNULEE],
  EXPIREE: [Etat.ANNULEE], LEVEE: [Etat.ANNULEE], ANNULEE: [],
};

@Injectable()
export class SanctionsService {
  constructor(private readonly prisma: PrismaService, private readonly storage: SanctionsStorageService) {}

  private async query<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof HttpException) throw error;
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034') throw new ConflictException('Conflit de version. Actualisez avant de réessayer.');
      throw new ServiceUnavailableException('Information indisponible.');
    }
  }

  async assertAccess(userId: string | undefined, db: Pick<Tx, 'user'> = this.prisma) {
    if (!userId) throw new UnauthorizedException('Authentification requise.');
    const user = await this.query(() => db.user.findUnique({ where: { id: userId }, select: { id: true, active: true, role: true } }));
    if (!user?.active || user.role !== Role.AVOCAT) throw new ForbiddenException('Accès réservé aux avocats actifs.');
  }
  private dto<T extends object>(type: ClassConstructor<T>, input: T): T {
    if (!input || typeof input !== 'object' || Array.isArray(input)) bad('Données invalides.');
    const data = plainToInstance(type, input);
    if (validateSync(data, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }).length) bad('Données invalides.');
    return data;
  }
  private async transaction<T>(userId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertAccess(userId, tx);
      return work(tx);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 20000 }).catch((error: unknown) => {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      if (code === 'P2002' || code === 'P2034') throw new ConflictException('Conflit de version ou lien déjà enregistré.');
      // Never return Prisma error metadata, queries or user-supplied values to HTTP/logs.
      if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof UnauthorizedException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Opération non enregistrée. Réessayez après actualisation.');
    });
  }
  private async person(db: Pick<Tx, 'personneSuivie'>, id: string) {
    const person = await this.query(() => db.personneSuivie.findUnique({ where: { id }, select: PERSON }));
    if (!person) throw new NotFoundException('Personne suivie introuvable.');
    return person;
  }
  private async signal(db: Pick<Tx, 'signalementSanction'>, id: string) {
    const signal = await this.query(() => db.signalementSanction.findUnique({ where: { id }, select: SIGNAL }));
    if (!signal) throw new NotFoundException('Signalement introuvable.');
    return signal;
  }
  private version(current: { version: number }, expected: number) {
    if (current.version !== expected) throw new ConflictException('Version obsolète. Actualisez avant de modifier.');
  }
  private async history(tx: Tx, userId: string, personneId: string, signalementId: string | null, action: string, motif: string, version: number, snapshot: unknown) {
    await tx.sanctionHistorique.create({ data: { personneId, signalementId, userId, action, motif: motif.trim(), version, snapshot: json(snapshot) }, select: { id: true } });
  }
  private business(dto: Partial<CreateSanctionDto>, current?: Signal): BusinessData {
    const out: BusinessData = {
      type: current?.type ?? '', source: current?.source ?? '', description: current?.description ?? '',
      sourceUrl: current?.sourceUrl ?? null, autorite: current?.autorite ?? null, referenceDecision: current?.referenceDecision ?? null,
      dateDecision: current?.dateDecision ?? null, dateDecisionApplicable: current?.dateDecisionApplicable ?? true,
      motifDateDecisionAbsente: current?.motifDateDecisionAbsente ?? null, dateDebut: current?.dateDebut ?? null, dateFin: current?.dateFin ?? null,
    };
    for (const key of requiredText) if (dto[key] !== undefined) out[key] = dto[key]!.trim();
    for (const key of nullableText) if (dto[key] !== undefined) out[key] = dto[key]?.trim() || null;
    for (const key of dates) if (dto[key] !== undefined) out[key] = dto[key] === null ? null : new Date(dto[key]! + 'T00:00:00.000Z');
    if (dto.dateDecisionApplicable !== undefined) out.dateDecisionApplicable = dto.dateDecisionApplicable;
    this.checkDates(out);
    return out;
  }
  private checkDates(data: BusinessData) {
    if (data.dateDebut && data.dateFin && data.dateFin < data.dateDebut) bad('La fin ne peut pas précéder le début.');
    if (!data.dateDecisionApplicable && data.dateDecision) bad('La date de décision et son applicabilité sont incohérentes.');
  }
  private confirmed(data: BusinessData, state: Etat) {
    this.checkDates(data);
    if (!data.autorite || !data.referenceDecision || (data.dateDecisionApplicable ? !data.dateDecision : !data.motifDateDecisionAbsente)) bad('Autorité, référence et date de décision applicable, ou motif de son absence, sont requis.');
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
    if (data.dateDecision && data.dateDecision > today) bad('La décision confirmée ne peut pas être future.');
    if (state === Etat.NON_DETERMINE) bad('Précisez l’état de la mesure confirmée.');
    if (state === Etat.A_VENIR && (!data.dateDebut || data.dateDebut <= today)) bad('Une mesure à venir exige une date de début future.');
    if (state === Etat.EN_VIGUEUR && (!data.dateDebut || data.dateDebut > today || (data.dateFin && data.dateFin < today))) bad('Les dates ne permettent pas une mesure en vigueur.');
    if (state === Etat.EXPIREE && (!data.dateFin || data.dateFin >= today)) bad('Une mesure expirée exige une date de fin passée.');
  }
  private async proof(db: Pick<Tx, 'sanctionPiece'>, signalementId: string, pieceId: string | undefined) {
    if (!pieceId) bad('Un justificatif vérifiable est obligatoire.');
    const piece = await this.query(() => db.sanctionPiece.findFirst({ where: { id: pieceId, signalementId }, select: { ...PIECE, storageKey: true } }));
    if (!piece || !piece.referenceSource.trim()) bad('Justificatif absent ou non rattaché au signalement.');
    const bytes = await this.query(() => this.storage.read(piece.storageKey));
    if (bytes.length !== piece.taille || sha(bytes) !== piece.sha256) bad('Le justificatif ne peut pas être vérifié.');
    return { piece, bytes };
  }

  async listPersonnes(userId: string, input: RecherchePersonnesDto) {
    await this.assertAccess(userId);
    const dto = this.dto(RecherchePersonnesDto, input);
    const where: Prisma.PersonneSuivieWhereInput = dto.recherche ? { nom: { contains: dto.recherche.trim(), mode: 'insensitive' } } : {};
    const [items, total] = await this.query(() => Promise.all([
      this.prisma.personneSuivie.findMany({ where, select: PERSON, orderBy: [{ nom: 'asc' }, { id: 'asc' }], take: dto.limit, skip: (dto.page - 1) * dto.limit }),
      this.prisma.personneSuivie.count({ where }),
    ]));
    return { items, total, page: dto.page, limit: dto.limit };
  }
  async getPersonne(userId: string, id: string) {
    await this.assertAccess(userId);
    return this.person(this.prisma, id);
  }
  async createPersonne(userId: string, input: CreatePersonneSuivieDto) {
    await this.assertAccess(userId);
    const dto = this.dto(CreatePersonneSuivieDto, input);
    if (dto.identiteEtablie && (!dto.identifiantType?.trim() || !dto.identifiantValeur?.trim() || !dto.justificationIdentite?.trim())) bad('Une identité établie exige un identifiant et une justification.');
    return this.transaction(userId, async (tx) => {
      if (dto.clientId) {
        const client = await tx.client.findUnique({ where: { id: dto.clientId }, select: { id: true, type: true } });
        if (!client) throw new NotFoundException('Client introuvable.');
        if ((dto.nature === 'MORALE') !== (client.type === 'ENTREPRISE')) bad('La nature de la personne ne correspond pas au client lié.');
      }
      const person = await tx.personneSuivie.create({ data: {
        nature: dto.nature, nom: dto.nom.trim(), clientId: dto.clientId ?? null,
        identifiantType: dto.identifiantType?.trim() || null, identifiantValeur: dto.identifiantValeur?.trim() || null,
        justificationIdentite: dto.justificationIdentite?.trim() || null,
        identiteVerifieeAt: dto.identiteEtablie ? new Date() : null, identiteVerifieeParId: dto.identiteEtablie ? userId : null, createdById: userId,
      }, select: PERSON });
      await this.history(tx, userId, person.id, null, 'PERSONNE_CREEE', dto.justificationIdentite?.trim() || 'Création explicite d’une personne suivie.', person.version, { after: person });
      return person;
    });
  }
  async patchPersonne(userId: string, id: string, input: PatchPersonneSuivieDto) {
    await this.assertAccess(userId); const dto = this.dto(PatchPersonneSuivieDto, input);
    return this.transaction(userId, async (tx) => {
      const current = await this.person(tx, id); this.version(current, dto.version);
      if (await tx.signalementSanction.findFirst({ where: { personneId: id, qualification: Qualification.CONFIRMEE }, select: { id: true } })) {
        throw new ConflictException('Identité liée à une sanction confirmée : correction spécialisée nécessaire.');
      }
      const data: Prisma.PersonneSuivieUncheckedUpdateManyInput = {};
      const next = { ...current };
      if (dto.nature !== undefined) next.nature = dto.nature;
      if (dto.nom !== undefined) next.nom = dto.nom.trim();
      for (const key of ['clientId', 'identifiantType', 'identifiantValeur', 'justificationIdentite'] as const) if (dto[key] !== undefined) next[key] = dto[key]?.trim() || null;
      const established = dto.identiteEtablie ?? !!current.identiteVerifieeAt;
      if (established && (!next.identifiantType || !next.identifiantValeur || !next.justificationIdentite)) bad('Une identité établie exige un identifiant et une justification.');
      if (next.clientId) {
        const client = await tx.client.findUnique({ where: { id: next.clientId }, select: { id: true, type: true } });
        if (!client) throw new NotFoundException('Client introuvable.');
        if ((next.nature === 'MORALE') !== (client.type === 'ENTREPRISE')) bad('La nature de la personne ne correspond pas au client lié.');
      }
      Object.assign(data, { nature: next.nature, nom: next.nom, clientId: next.clientId, identifiantType: next.identifiantType, identifiantValeur: next.identifiantValeur,
        justificationIdentite: next.justificationIdentite, identiteVerifieeAt: established ? new Date() : null, identiteVerifieeParId: established ? userId : null, version: { increment: 1 } });
      const changed = await tx.personneSuivie.updateMany({ where: { id, version: dto.version }, data });
      if (!changed.count) throw new ConflictException('Version obsolète.');
      const after = await this.person(tx, id);
      await this.history(tx, userId, id, null, 'PERSONNE_CORRIGEE', dto.motif, after.version, { before: current, after });
      return after;
    });
  }
  async linkDossier(userId: string, id: string, input: LienDossierPersonneDto) {
    await this.assertAccess(userId); const dto = this.dto(LienDossierPersonneDto, input);
    return this.transaction(userId, async (tx) => {
      const person = await this.person(tx, id); this.version(person, dto.version);
      const dossier = await tx.dossier.findUnique({ where: { id: dto.dossierId }, select: { id: true, clientId: true } });
      if (!dossier) throw new NotFoundException('Dossier introuvable.');
      if (dto.qualite === 'CLIENT' && (!person.clientId || person.clientId !== dossier.clientId)) bad('Le lien client doit être explicite et correspondre au dossier.');
      const changed = await tx.personneSuivie.updateMany({ where: { id, version: dto.version }, data: { version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('Version obsolète.');
      const link = await tx.dossierPersonne.create({ data: { personneId: id, dossierId: dossier.id, qualite: dto.qualite, createdById: userId }, select: { id: true, personneId: true, dossierId: true, qualite: true, createdById: true, createdAt: true } });
      await this.history(tx, userId, id, null, 'DOSSIER_LIE', dto.motif, dto.version + 1, { link });
      return { ...link, version: dto.version + 1 };
    });
  }
  async listDossiers(userId: string, id: string, input: PageSanctionsDto) {
    await this.assertAccess(userId); const dto = this.dto(PageSanctionsDto, input); await this.person(this.prisma, id);
    return this.query(() => this.prisma.dossierPersonne.findMany({ where: { personneId: id }, select: { id: true, dossierId: true, qualite: true, createdAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: dto.limit, skip: (dto.page - 1) * dto.limit }));
  }
  async createSignalement(userId: string, personneId: string, input: CreateSanctionDto) {
    await this.assertAccess(userId); const dto = this.dto(CreateSanctionDto, input); const data = this.business(dto);
    return this.transaction(userId, async (tx) => {
      await this.person(tx, personneId);
      const signal = await tx.signalementSanction.create({ data: { ...data, personneId, createdById: userId, qualification: Qualification.A_VERIFIER, etatMesure: Etat.NON_DETERMINE }, select: SIGNAL });
      await this.history(tx, userId, personneId, signal.id, 'SIGNALEMENT_CREE', 'Création d’un signalement à vérifier.', signal.version, { after: signal });
      return signal;
    });
  }
  async listSignalements(userId: string, personneId: string, input: ListeSanctionsDto) {
    await this.assertAccess(userId); const dto = this.dto(ListeSanctionsDto, input); await this.person(this.prisma, personneId);
    const where = { personneId, qualification: dto.qualification, etatMesure: dto.etatMesure };
    const [items, total] = await this.query(() => Promise.all([
      this.prisma.signalementSanction.findMany({ where, select: SIGNAL, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: dto.limit, skip: (dto.page - 1) * dto.limit }),
      this.prisma.signalementSanction.count({ where }),
    ]));
    return { items, total, page: dto.page, limit: dto.limit };
  }
  async getSignalement(userId: string, id: string) {
    await this.assertAccess(userId); return this.signal(this.prisma, id);
  }
  private async save(tx: Tx, userId: string, current: Signal, version: number, data: Prisma.SignalementSanctionUncheckedUpdateManyInput, action: string, motif: string) {
    const changed = await tx.signalementSanction.updateMany({ where: { id: current.id, version }, data: { ...data, version: { increment: 1 } } });
    if (!changed.count) throw new ConflictException('Version obsolète.');
    const after = await this.signal(tx, current.id);
    await this.history(tx, userId, current.personneId, current.id, action, motif, after.version, { before: current, after });
    return after;
  }
  async patchSignalement(userId: string, id: string, input: PatchSanctionDto) {
    await this.assertAccess(userId); const dto = this.dto(PatchSanctionDto, input);
    return this.transaction(userId, async (tx) => {
      const current = await this.signal(tx, id); this.version(current, dto.version);
      const data = this.business(dto, current);
      let verification: Prisma.SignalementSanctionUncheckedUpdateManyInput = {};
      if (current.qualification === Qualification.CONFIRMEE) {
        this.confirmed(data, current.etatMesure);
        const { piece } = await this.proof(tx, id, dto.justificatifId);
        verification = { justificatifId: piece.id, verifiedById: userId, verifiedAt: new Date() };
      }
      return this.save(tx, userId, current, dto.version, { ...data, ...verification }, 'SIGNALEMENT_CORRIGE', dto.motif);
    });
  }
  async transition(userId: string, id: string, input: TransitionSanctionDto) {
    await this.assertAccess(userId); const dto = this.dto(TransitionSanctionDto, input);
    return this.transaction(userId, async (tx) => {
      const current = await this.signal(tx, id); this.version(current, dto.version);
      let qualification = current.qualification, etatMesure = current.etatMesure;
      const data = this.business(dto, current);
      let verification: Prisma.SignalementSanctionUncheckedUpdateManyInput = {};
      switch (dto.action) {
        case ActionSanction.ECARTER:
          if (qualification !== Qualification.A_VERIFIER || dto.etatMesure || dto.justificatifId) bad('Transition interdite.');
          qualification = Qualification.ECARTEE; etatMesure = Etat.NON_DETERMINE; break;
        case ActionSanction.REOUVRIR:
          if (qualification !== Qualification.ECARTEE || dto.etatMesure || dto.justificatifId) bad('Transition interdite.');
          qualification = Qualification.A_VERIFIER; etatMesure = Etat.NON_DETERMINE; break;
        case ActionSanction.CONFIRMER: {
          if (qualification !== Qualification.A_VERIFIER || !dto.etatMesure) bad('Transition interdite.');
          const person = await this.person(tx, current.personneId);
          if (!person.identiteVerifieeAt || !person.identiteVerifieeParId || !person.identifiantType || !person.identifiantValeur || !person.justificationIdentite) bad('L’identité doit être explicitement établie avant confirmation.');
          qualification = Qualification.CONFIRMEE; etatMesure = dto.etatMesure; break;
        }
        case ActionSanction.MODIFIER_MESURE:
          if (qualification !== Qualification.CONFIRMEE || !dto.etatMesure || !MEASURE_TRANSITIONS[etatMesure].includes(dto.etatMesure)) bad('Transition interdite.');
          etatMesure = dto.etatMesure; break;
      }
      if (qualification === Qualification.CONFIRMEE) {
        this.confirmed(data, etatMesure);
        const { piece } = await this.proof(tx, id, dto.justificatifId);
        verification = { justificatifId: piece.id, verifiedById: userId, verifiedAt: new Date() };
      }
      return this.save(tx, userId, current, dto.version, { ...data, qualification, etatMesure, ...verification }, dto.action, dto.motif);
    });
  }
  async historyList(userId: string, id: string, input: PageSanctionsDto, forPerson = false) {
    await this.assertAccess(userId); const dto = this.dto(PageSanctionsDto, input);
    if (forPerson) await this.person(this.prisma, id); else await this.signal(this.prisma, id);
    return this.query(() => this.prisma.sanctionHistorique.findMany({ where: forPerson ? { personneId: id } : { signalementId: id }, select: HISTORY, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: dto.limit, skip: (dto.page - 1) * dto.limit }));
  }
  private checkFile(file: SanctionFile | undefined) {
    if (!file || !Buffer.isBuffer(file.buffer) || file.size !== file.buffer.length || file.size < 8 || file.size > SANCTION_MAX_FILE) bad('Justificatif requis, de 5 Mio maximum.');
    const formats = { 'application/pdf': Buffer.from('%PDF-'), 'image/png': Buffer.from([137,80,78,71,13,10,26,10]), 'image/jpeg': Buffer.from([255,216,255]) };
    const signature: Buffer | undefined = formats[file.mimetype];
    if (!signature || !file.buffer.subarray(0, signature.length).equals(signature)) bad('Justificatif PDF, PNG ou JPEG valide requis.');
    return file;
  }
  async uploadPiece(userId: string, id: string, input: DepotSanctionPieceDto, upload: SanctionFile | undefined) {
    await this.assertAccess(userId); const dto = this.dto(DepotSanctionPieceDto, input); const file = this.checkFile(upload);
    const before = await this.signal(this.prisma, id); this.version(before, dto.version);
    const key = SANCTION_PREFIX + randomUUID();
    await this.query(() => this.storage.put(key, file));
    try {
      // Read back the stored bytes before persisting a proof, never trust browser metadata alone.
      const stored = await this.query(() => this.storage.read(key));
      if (stored.length !== file.size || sha(stored) !== sha(file.buffer)) bad('Le justificatif stocké ne peut pas être vérifié.');
      return await this.transaction(userId, async (tx) => {
        const current = await this.signal(tx, id); this.version(current, dto.version);
        const piece = await tx.sanctionPiece.create({ data: { signalementId: id, storageKey: key, mimeType: file.mimetype, taille: file.size, sha256: sha(stored), referenceSource: dto.referenceSource.trim(), uploadedById: userId }, select: PIECE });
        const signal = await this.save(tx, userId, current, dto.version, {}, 'JUSTIFICATIF_AJOUTE', dto.motif);
        // Persist the attachment metadata in the same private immutable history transaction.
        await this.history(tx, userId, current.personneId, id, 'PIECE_ENREGISTREE', dto.motif, signal.version, { piece });
        return { piece, version: signal.version };
      });
    } catch (error) {
      // S3 cannot join a SQL transaction; compensate without exposing storage keys or errors.
      // An infrastructure error can leave commit outcome unknown: never delete a possibly committed proof.
      if (!(error instanceof ServiceUnavailableException)) {
        try { await this.storage.remove(key); } catch { /* reconcile private orphans out of band */ }
      }
      throw error;
    }
  }
  async listPieces(userId: string, id: string, input: PageSanctionsDto) {
    await this.assertAccess(userId); const dto = this.dto(PageSanctionsDto, input); await this.signal(this.prisma, id);
    return this.query(() => this.prisma.sanctionPiece.findMany({ where: { signalementId: id }, select: PIECE, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: dto.limit, skip: (dto.page - 1) * dto.limit }));
  }
  async downloadPiece(userId: string, id: string, pieceId: string) {
    await this.assertAccess(userId); await this.signal(this.prisma, id);
    const { piece, bytes } = await this.proof(this.prisma, id, pieceId);
    // Re-check after storage IO, before returning any sensitive bytes.
    await this.assertAccess(userId);
    return { bytes, mimeType: piece.mimeType, id: piece.id };
  }
}


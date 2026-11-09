import { BadRequestException, ConflictException, ForbiddenException, GoneException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { validateSync } from 'class-validator';
import { PrismaService } from '../../../prisma/prisma.service';
import { ClientType, Prisma, Role } from '../../../../generated/prisma/client';
import { CreateClientDto } from '../dto/create-client.dto';
import { IMPORT_LIMITS, ImportUpload, RawClientRow, readClientWorkbook } from './client-workbook';

export type ImportRow = { line: number; data: CreateClientDto; status: 'valid' | 'invalid' | 'duplicate' | 'created' | 'skipped'; errors: string[] };
export type ImportReport = { rows: ImportRow[]; totals: Record<ImportRow['status'] | 'total', number>; batchId?: string };
type IdentityClient = Pick<CreateClientDto, 'type' | 'nom' | 'email' | 'numeroContribuable'>;
type Ticket = { version: 1; owner: string; hash: string; nonce: string; expires: number; eligible: number[] };
type Db = Pick<Prisma.TransactionClient, 'user' | 'clientImport' | 'clientImportIdentity' | '$queryRaw'>;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const normalize = (value?: string | null) => value?.trim().replace(/\s+/g, ' ').toLowerCase() || '';
export function clientIdentityKeys(data: IdentityClient): string[] {
  const keys = ['name|' + data.type + '|' + normalize(data.nom)];
  if (normalize(data.email)) keys.push('email|' + normalize(data.email));
  if (normalize(data.numeroContribuable)) keys.push('tax|' + normalize(data.numeroContribuable));
  return keys.map(hash);
}
function report(rows: ImportRow[], batchId?: string): ImportReport {
  const totals: ImportReport['totals'] = { total: rows.length, valid: 0, invalid: 0, duplicate: 0, created: 0, skipped: 0 };
  rows.forEach((row) => totals[row.status]++);
  return { rows, totals, ...(batchId ? { batchId } : {}) };
}

@Injectable()
export class ClientImportService {
  constructor(private readonly prisma: PrismaService) {}

  async assertPermission(db: Db, userId: string) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, active: true } });
    if (!user?.active || user.role !== Role.AVOCAT) throw new ForbiddenException('L’import de clients est réservé aux avocats actifs.');
  }

  private secret(): Buffer {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new ServiceUnavailableException('Configuration de signature de l’import indisponible.');
    return createHmac('sha256', secret).update('velarium/client-import/v1').digest();
  }
  private sign(ticket: Ticket): string {
    const body = Buffer.from(JSON.stringify(ticket)).toString('base64url');
    return body + '.' + createHmac('sha256', this.secret()).update(body).digest('base64url');
  }
  private verify(token: string, userId: string): Ticket {
    if (typeof token !== 'string' || token.length > 24000) throw new BadRequestException('Confirmation invalide.');
    const [body, signature, extra] = token.split('.');
    const expected = createHmac('sha256', this.secret()).update(body || '').digest('base64url');
    const received = Buffer.from(signature || '', 'utf8'), wanted = Buffer.from(expected, 'utf8');
    if (extra || !signature || received.length !== wanted.length || !timingSafeEqual(received, wanted)) throw new BadRequestException('Confirmation altérée ou invalide.');
    let ticket: Ticket;
    try { ticket = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { throw new BadRequestException('Confirmation invalide.'); }
    if (ticket.version !== 1 || ticket.owner !== userId || !/^[a-f0-9]{64}$/.test(ticket.hash) ||
        !/^[a-f0-9-]{36}$/.test(ticket.nonce) || !Array.isArray(ticket.eligible) || ticket.eligible.length > IMPORT_LIMITS.rows ||
        ticket.eligible.some((line) => !Number.isInteger(line) || line < 2 || line > IMPORT_LIMITS.rows + 1) || !Number.isFinite(ticket.expires)) throw new BadRequestException('Confirmation invalide pour cet utilisateur.');
    if (ticket.expires <= Date.now()) throw new GoneException('La prévisualisation a expiré. Chargez de nouveau le fichier.');
    return ticket;
  }

  private async classify(raw: RawClientRow[], db: Db): Promise<ImportRow[]> {
    const seen = new Map<string, number>();
    const rows: ImportRow[] = raw.map((row) => {
      const cells = row.cells;
      const rawType = normalize(cells.type).normalize('NFD').replace(/\p{Diacritic}/gu, '');
      const type = new Map([['particulier', ClientType.PARTICULIER], ['entreprise', ClientType.ENTREPRISE]]).get(rawType)!;
      const data: CreateClientDto = {
        type, nom: cells.nom?.trim().replace(/\s+/g, ' ') || '',
        email: normalize(cells.email) || null,
        telephone: cells.telephone?.trim() || null,
        adresse: cells.adresse?.trim() || null,
        numeroContribuable: cells.numeroContribuable?.trim() || null,
        notes: cells.notes?.trim() || null,
      };
      const errors = [...row.issues];
      for (const error of validateSync(Object.assign(new CreateClientDto(), data))) {
        errors.push(({ type: 'Type requis : PARTICULIER ou ENTREPRISE.', nom: 'Nom obligatoire.', email: 'Adresse email invalide.' } as Record<string, string>)[error.property] || 'Valeur invalide : ' + error.property);
      }
      if (data.numeroContribuable && data.type !== ClientType.ENTREPRISE) errors.push('Le numéro contribuable est réservé aux entreprises.');
      if (errors.length) return { line: row.line, data, errors, status: 'invalid' };
      const keys = clientIdentityKeys(data);
      const duplicate = keys.map((key) => seen.get(key)).find((line) => line !== undefined);
      // Remember every valid business identity, including duplicate chains, conservatively.
      keys.forEach((key) => { if (!seen.has(key)) seen.set(key, row.line); });
      return { line: row.line, data, errors: duplicate === undefined ? [] : ['Doublon dans le fichier, ligne ' + duplicate + '.'], status: duplicate === undefined ? 'valid' : 'duplicate' };
    });
    const candidates = rows.filter((row) => row.status === 'valid');
    if (!candidates.length) return rows;
    const names = [...new Set(candidates.map((row) => normalize(row.data.nom)))];
    const emails = [...new Set(candidates.map((row) => normalize(row.data.email)).filter(Boolean))];
    const taxes = [...new Set(candidates.map((row) => normalize(row.data.numeroContribuable)).filter(Boolean))];
    // One bounded batch lookup; do not fetch the whole client table or query once per row.
    const existing = await db.$queryRaw<IdentityClient[]>(Prisma.sql`
      SELECT "type", "nom", "email", "numeroContribuable" FROM "Client"
      WHERE regexp_replace(lower(btrim("nom")), '\\s+', ' ', 'g') IN (${Prisma.join(names)})
      ${emails.length ? Prisma.sql`OR lower(btrim("email")) IN (${Prisma.join(emails)})` : Prisma.empty}
      ${taxes.length ? Prisma.sql`OR regexp_replace(lower(btrim("numeroContribuable")), '\\s+', ' ', 'g') IN (${Prisma.join(taxes)})` : Prisma.empty}
    `);
    const keys = candidates.flatMap((row) => clientIdentityKeys(row.data));
    const claimed = await db.clientImportIdentity.findMany({ where: { key: { in: keys } }, select: { key: true } });
    const existingKeys = new Set([...existing.flatMap(clientIdentityKeys), ...claimed.map((entry) => entry.key)]);
    for (const row of candidates) if (clientIdentityKeys(row.data).some((key) => existingKeys.has(key))) {
      row.status = 'duplicate'; row.errors.push('Client déjà présent en base ou déjà importé. Aucun écrasement.');
    }
    return rows;
  }

  async preview(file: ImportUpload, userId: string) {
    await this.assertPermission(this.prisma, userId);
    const raw = await readClientWorkbook(file);
    const fileHash = hash(file.buffer);
    if (await this.prisma.clientImport.findUnique({ where: { fileHash }, select: { id: true } })) throw new ConflictException('Ce fichier a déjà été confirmé. Aucun nouvel import.');
    const rows = await this.classify(raw, this.prisma);
    const expires = Date.now() + 15 * 60 * 1000;
    const token = this.sign({ version: 1, owner: userId, hash: fileHash, nonce: randomUUID(), expires, eligible: rows.filter((row) => row.status === 'valid').map((row) => row.line) });
    return { ...report(rows), token, expiresAt: new Date(expires).toISOString() };
  }

  async confirm(file: ImportUpload, userId: string, token: string, confirmed: string): Promise<ImportReport> {
    await this.assertPermission(this.prisma, userId);
    if (confirmed !== 'true') throw new BadRequestException('La confirmation explicite est obligatoire.');
    const ticket = this.verify(token, userId);
    const raw = await readClientWorkbook(file);
    if (hash(file.buffer) !== ticket.hash) throw new BadRequestException('Le fichier diffère de la prévisualisation.');
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Serializes import confirmations across all API workers (transaction-scoped, no session state).
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(1735289137)::text AS locked`;
        await this.assertPermission(tx, userId);
        if (ticket.expires <= Date.now()) throw new GoneException('La prévisualisation a expiré.');
        const prior = await tx.clientImport.findUnique({ where: { id: ticket.nonce } });
        if (prior) {
          if (prior.ownerId !== userId || prior.fileHash !== ticket.hash) throw new ConflictException('Confirmation incohérente.');
          return prior.report as unknown as ImportReport;
        }
        if (await tx.clientImport.findUnique({ where: { fileHash: ticket.hash } })) throw new ConflictException('Ce fichier a déjà été importé.');
        const rows = await this.classify(raw, tx);
        const eligible = new Set(ticket.eligible);
        for (const row of rows) if (row.status === 'valid' && !eligible.has(row.line)) {
          row.status = 'skipped'; row.errors.push('Ligne non validée à la prévisualisation.');
        }
        const valid = rows.filter((row) => row.status === 'valid');
        if (!ticket.eligible.length) throw new BadRequestException('Aucune ligne valide à confirmer.');
        if (valid.length) {
          const created = await tx.client.createManyAndReturn({ data: valid.map((row) => row.data), select: { id: true, type: true, nom: true, email: true, numeroContribuable: true } });
          await tx.clientImportIdentity.createMany({ data: created.flatMap((client) => clientIdentityKeys(client).map((key) => ({ key, clientId: client.id }))) });
          await tx.activityLog.createMany({ data: created.map((client) => ({ userId, action: 'CLIENT_CREE', entityType: 'Client', entityId: client.id, metadata: { importId: ticket.nonce } })) });
          valid.forEach((row) => { row.status = 'created'; });
        }
        const result = report(rows, ticket.nonce);
        await tx.clientImport.create({ data: { id: ticket.nonce, ownerId: userId, fileHash: ticket.hash, report: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue } });
        return result;
      }, { maxWait: 10000, timeout: 30000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Import non confirmé. Réessayez avec la même confirmation pour récupérer le résultat ; aucun écrasement ne sera effectué.');
    }
  }
}

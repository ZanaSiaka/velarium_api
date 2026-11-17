import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export function isTreasuryConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  if (error.code === 'P2034') return true;
  if (error.code !== 'P2010' || !('meta' in error) || !error.meta || typeof error.meta !== 'object' || !('code' in error.meta)) return false;
  return error.meta.code === '40001' || error.meta.code === '40P01';
}

export async function treasuryTransaction<T>(prisma: PrismaService, work: (tx: Prisma.TransactionClient) => Promise<T>, options: boolean | { maxWait?: number; timeout?: number } = false): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(work, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 20_000, ...(typeof options === 'object' ? options : {}) });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (!isTreasuryConflict(error) && !(options === true && code === 'P2002')) throw error;
      if (attempt === 2) throw new ConflictException('Opération concurrente non finalisée. Vérifiez les opérations enregistrées avant de réessayer.');
    }
  }
  throw new ConflictException('Veuillez réessayer cette opération.');
}

// All treasury writers and account mutations lock the same rows before reading them.
// Transfers acquire both locks in one stable order. Values are bound, never interpolated SQL.
export async function lockTreasuryAccounts(tx: Prisma.TransactionClient, ids: readonly string[]) {
  const ordered = [...new Set(ids)].sort();
  if (!ordered.length || ordered.some(id => typeof id !== 'string' || !id.trim())) throw new BadRequestException('Compte financier requis.');
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Caisse" WHERE "id" IN (${Prisma.join(ordered)}) ORDER BY "id" FOR UPDATE`);
}

export function treasuryCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException('Utilisez un code monétaire de trois lettres, notamment XOF pour le franc CFA BCEAO. Les comptes historiques FCFA nécessitent une validation préalable.');
  return currency;
}

export function treasuryAmount(value: number, allowZero = false) {
  if (!Number.isFinite(value)) throw new BadRequestException('Montant invalide.');
  const amount = new Prisma.Decimal(value.toString());
  if (amount.decimalPlaces() > 2 || amount.greaterThan('9999999999999.99') || (allowZero ? amount.isNegative() : !amount.greaterThan(0))) {
    throw new BadRequestException('Montant invalide : respectez la précision de deux décimales et un montant positif.');
  }
  return amount;
}

export async function readTreasuryAccounts(db: Prisma.TransactionClient, ids?: readonly string[]) {
  const [accounts, source, destination] = await Promise.all([
    db.caisse.findMany({ where: ids ? { id: { in: [...ids] } } : undefined, orderBy: { createdAt: 'asc' } }),
    db.mouvementFinance.groupBy({ by: ['caisseId', 'type'], where: ids ? { caisseId: { in: [...ids] } } : undefined, _sum: { montant: true }, _count: { _all: true } }),
    db.mouvementFinance.groupBy({ by: ['caisseDestinationId', 'type'], where: { caisseDestinationId: ids ? { in: [...ids] } : { not: null } }, _sum: { montant: true }, _count: { _all: true } }),
  ]);
  const totals = new Map(accounts.map(account => [account.id, { incoming: new Prisma.Decimal(0), outgoing: new Prisma.Decimal(0), history: false }]));
  for (const row of source) {
    const total = totals.get(row.caisseId);
    if (!total) continue;
    total.history ||= row._count._all > 0;
    if (row.type === 'ENTREE') total.incoming = total.incoming.plus(row._sum.montant ?? 0);
    if (row.type === 'SORTIE' || row.type === 'TRANSFERT') total.outgoing = total.outgoing.plus(row._sum.montant ?? 0);
  }
  for (const row of destination) {
    const total = row.caisseDestinationId ? totals.get(row.caisseDestinationId) : undefined;
    if (!total) continue;
    total.history ||= row._count._all > 0;
    if (row.type === 'TRANSFERT') total.incoming = total.incoming.plus(row._sum.montant ?? 0);
  }
  return accounts.map(account => {
    const total = totals.get(account.id)!;
    if (!account.soldeInitial.isFinite() || !total.incoming.isFinite() || !total.outgoing.isFinite()) {
      throw new ConflictException('Solde financier indisponible ou invalide. Une vérification des données est nécessaire.');
    }
    return { ...account, totalEntrees: total.incoming, totalSorties: total.outgoing,
      solde: account.soldeInitial.plus(total.incoming).minus(total.outgoing), hasHistory: total.history };
  });
}

export function serializeTreasuryAccount(row: Awaited<ReturnType<typeof readTreasuryAccounts>>[number]) {
  return { ...row, soldeInitial: row.soldeInitial.toNumber(), totalEntrees: row.totalEntrees.toNumber(),
    totalSorties: row.totalSorties.toNumber(), solde: row.solde.toNumber(),
    soldeInitialExact: row.soldeInitial.toFixed(2), totalEntreesExact: row.totalEntrees.toFixed(2),
    totalSortiesExact: row.totalSorties.toFixed(2), soldeExact: row.solde.toFixed(2) };
}

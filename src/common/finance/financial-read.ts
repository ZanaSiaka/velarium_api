import { Decimal } from '@prisma/client/runtime/client';

export type MoneyValue = Decimal | string | number;

export function exactMoney(value: MoneyValue | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    const amount = new Decimal(value);
    return amount.isFinite() && amount.decimalPlaces() <= 2 ? amount.toFixed(2) : null;
  } catch { return null; }
}

export function sumMoney(values: readonly (string | null)[]): string | null {
  if (values.some(value => value === null)) return null;
  return values.reduce<Decimal>((total, value) => total.plus(value!), new Decimal(0)).toFixed(2);
}

export function remainingMoney(amount: string | null, applied: string | null): string | null {
  if (amount === null || applied === null) return null;
  return Decimal.max(new Decimal(amount).minus(applied), 0).toFixed(2);
}

export function readProvisionBalance(provision: {
  montant: MoneyValue;
  factureId: string | null;
  imputations: readonly { montant: MoneyValue }[];
}) {
  const montantInitial = exactMoney(provision.montant);
  const montantExplicite = sumMoney(provision.imputations.map(row => exactMoney(row.montant)));
  const legacy = provision.factureId !== null;
  let avertissement: string | null = null;
  if (montantInitial === null || montantExplicite === null) avertissement = 'Montant indisponible ou précision non reconnue.';
  else if (legacy && provision.imputations.length > 0) avertissement = 'Affectation historique et imputations explicites coexistantes : arbitrage nécessaire.';
  else if (legacy) avertissement = 'Le rattachement historique ne démontre pas le montant effectivement imputé : validation nécessaire.';
  else if (new Decimal(montantInitial).isNegative() || new Decimal(montantExplicite).isNegative()) avertissement = 'Montant négatif historique à vérifier.';
  else if (!legacy && new Decimal(montantExplicite).greaterThan(montantInitial)) avertissement = 'Les imputations dépassent le montant initial de la provision.';
  const montantImpute = avertissement ? null : legacy ? montantInitial : montantExplicite;
  return {
    montantInitial,
    montantImpute,
    montantDisponible: avertissement ? null : remainingMoney(montantInitial, montantImpute),
    montantImputationsExplicites: montantExplicite,
    mode: avertissement ? 'AMBIGUE' : legacy ? 'LEGACY' : provision.imputations.length ? 'IMPUTATIONS' : 'NON_AFFECTEE',
    avertissement,
  };
}

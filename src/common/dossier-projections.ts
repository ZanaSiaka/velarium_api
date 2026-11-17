import { Prisma } from '../../generated/prisma/client';

// Safe references for secondary resources: no KYC, financial relation or full User.
export const DOSSIER_REFERENCE_SELECT = {
  id: true, reference: true, type: true, natureAffaire: true, typeDossier: true, statut: true,
} satisfies Prisma.DossierSelect;

export const DOSSIER_PUBLIC_SELECT = {
  ...DOSSIER_REFERENCE_SELECT, clientId: true, avocatResponsableId: true,
  juridiction: true, partieAdverse: true, dateOuverture: true, dateCloture: true,
  createdAt: true, updatedAt: true, archive: true, archivedAt: true,
  avocatClientNom: true, avocatClientEmail: true, avocatClientTelephone: true,
} satisfies Prisma.DossierSelect;

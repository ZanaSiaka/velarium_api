-- P3.1 additive migration; do not execute without deployment approval.
-- No existing row is updated/deleted. New references use RESTRICT.
BEGIN;

CREATE TYPE "NaturePersonneSuivie" AS ENUM ('PHYSIQUE', 'MORALE');
CREATE TYPE "QualificationSanction" AS ENUM ('A_VERIFIER', 'CONFIRMEE', 'ECARTEE');
CREATE TYPE "EtatMesureSanction" AS ENUM ('NON_DETERMINE', 'A_VENIR', 'EN_VIGUEUR', 'SUSPENDUE', 'EXPIREE', 'LEVEE', 'ANNULEE');
CREATE TYPE "ActionSanction" AS ENUM ('CONFIRMER', 'ECARTER', 'REOUVRIR', 'MODIFIER_MESURE');

CREATE TABLE "PersonneSuivie" (
  "id" TEXT NOT NULL,
  "nature" "NaturePersonneSuivie" NOT NULL,
  "nom" TEXT NOT NULL,
  "identifiantType" TEXT,
  "identifiantValeur" TEXT,
  "justificationIdentite" TEXT,
  "identiteVerifieeAt" TIMESTAMP(3),
  "identiteVerifieeParId" TEXT,
  "clientId" TEXT,
  "createdById" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersonneSuivie_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DossierPersonne" (
  "id" TEXT NOT NULL,
  "personneId" TEXT NOT NULL,
  "dossierId" TEXT NOT NULL,
  "qualite" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DossierPersonne_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SignalementSanction" (
  "id" TEXT NOT NULL,
  "personneId" TEXT NOT NULL,
  "qualification" "QualificationSanction" NOT NULL DEFAULT 'A_VERIFIER',
  "etatMesure" "EtatMesureSanction" NOT NULL DEFAULT 'NON_DETERMINE',
  "type" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "autorite" TEXT,
  "referenceDecision" TEXT,
  "description" TEXT NOT NULL,
  "dateDecision" DATE,
  "dateDecisionApplicable" BOOLEAN NOT NULL DEFAULT true,
  "motifDateDecisionAbsente" TEXT,
  "dateDebut" DATE,
  "dateFin" DATE,
  "createdById" TEXT NOT NULL,
  "verifiedById" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "justificatifId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SignalementSanction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SanctionHistorique" (
  "id" TEXT NOT NULL,
  "personneId" TEXT NOT NULL,
  "signalementId" TEXT,
  "userId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "motif" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SanctionHistorique_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SanctionPiece" (
  "id" TEXT NOT NULL,
  "signalementId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "taille" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "referenceSource" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SanctionPiece_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PersonneSuivie_clientId_key" ON "PersonneSuivie" ("clientId");
CREATE INDEX "PersonneSuivie_nom_id_idx" ON "PersonneSuivie" ("nom", "id");
CREATE UNIQUE INDEX "DossierPersonne_dossierId_personneId_qualite_key" ON "DossierPersonne" ("dossierId", "personneId", "qualite");
CREATE INDEX "DossierPersonne_personneId_createdAt_idx" ON "DossierPersonne" ("personneId", "createdAt");
CREATE INDEX "SignalementSanction_personneId_createdAt_id_idx" ON "SignalementSanction" ("personneId", "createdAt", "id");
CREATE INDEX "SignalementSanction_qualification_etatMesure_idx" ON "SignalementSanction" ("qualification", "etatMesure");
CREATE INDEX "SanctionHistorique_signalementId_createdAt_id_idx" ON "SanctionHistorique" ("signalementId", "createdAt", "id");
CREATE INDEX "SanctionHistorique_personneId_createdAt_id_idx" ON "SanctionHistorique" ("personneId", "createdAt", "id");
CREATE UNIQUE INDEX "SanctionPiece_storageKey_key" ON "SanctionPiece" ("storageKey");
CREATE UNIQUE INDEX "SanctionPiece_id_signalementId_key" ON "SanctionPiece" ("id", "signalementId");
CREATE INDEX "SanctionPiece_signalementId_createdAt_id_idx" ON "SanctionPiece" ("signalementId", "createdAt", "id");
ALTER TABLE "PersonneSuivie" ADD CONSTRAINT "PersonneSuivie_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PersonneSuivie" ADD CONSTRAINT "PersonneSuivie_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PersonneSuivie" ADD CONSTRAINT "PersonneSuivie_identiteVerifieeParId_fkey" FOREIGN KEY ("identiteVerifieeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DossierPersonne" ADD CONSTRAINT "DossierPersonne_personneId_fkey" FOREIGN KEY ("personneId") REFERENCES "PersonneSuivie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DossierPersonne" ADD CONSTRAINT "DossierPersonne_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "Dossier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DossierPersonne" ADD CONSTRAINT "DossierPersonne_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SignalementSanction" ADD CONSTRAINT "SignalementSanction_personneId_fkey" FOREIGN KEY ("personneId") REFERENCES "PersonneSuivie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SignalementSanction" ADD CONSTRAINT "SignalementSanction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SignalementSanction" ADD CONSTRAINT "SignalementSanction_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SanctionHistorique" ADD CONSTRAINT "SanctionHistorique_personneId_fkey" FOREIGN KEY ("personneId") REFERENCES "PersonneSuivie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SanctionHistorique" ADD CONSTRAINT "SanctionHistorique_signalementId_fkey" FOREIGN KEY ("signalementId") REFERENCES "SignalementSanction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SanctionHistorique" ADD CONSTRAINT "SanctionHistorique_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SanctionPiece" ADD CONSTRAINT "SanctionPiece_signalementId_fkey" FOREIGN KEY ("signalementId") REFERENCES "SignalementSanction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SanctionPiece" ADD CONSTRAINT "SanctionPiece_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SignalementSanction" ADD CONSTRAINT "SignalementSanction_justificatifId_id_fkey" FOREIGN KEY ("justificatifId", "id") REFERENCES "SanctionPiece"("id", "signalementId") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "PersonneSuivie" ADD CONSTRAINT "PersonneSuivie_version_check" CHECK ("version" > 0);
ALTER TABLE "PersonneSuivie" ADD CONSTRAINT "PersonneSuivie_identity_check"
  CHECK (("identiteVerifieeAt" IS NULL AND "identiteVerifieeParId" IS NULL)
    OR ("identiteVerifieeAt" IS NOT NULL AND "identiteVerifieeParId" IS NOT NULL
      AND "identifiantType" IS NOT NULL AND length(btrim("identifiantType")) > 0
      AND "identifiantValeur" IS NOT NULL AND length(btrim("identifiantValeur")) > 0
      AND "justificationIdentite" IS NOT NULL AND length(btrim("justificationIdentite")) > 0));
ALTER TABLE "DossierPersonne" ADD CONSTRAINT "DossierPersonne_qualite_check"
  CHECK ("qualite" IN ('CLIENT', 'PARTIE_ADVERSE', 'AVOCAT_ADVERSE', 'REPRESENTANT', 'AUTRE'));
ALTER TABLE "SignalementSanction" ADD CONSTRAINT "SignalementSanction_version_check" CHECK ("version" > 0);
ALTER TABLE "SignalementSanction" ADD CONSTRAINT "SignalementSanction_qualification_check"
  CHECK (("qualification" = 'CONFIRMEE' AND "etatMesure" <> 'NON_DETERMINE' AND "verifiedById" IS NOT NULL AND "verifiedAt" IS NOT NULL AND "justificatifId" IS NOT NULL)
    OR ("qualification" <> 'CONFIRMEE' AND "etatMesure" = 'NON_DETERMINE'));
ALTER TABLE "SignalementSanction" ADD CONSTRAINT "SignalementSanction_dates_check"
  CHECK (("dateFin" IS NULL OR "dateDebut" IS NULL OR "dateFin" >= "dateDebut")
    AND ("dateDecisionApplicable" OR "dateDecision" IS NULL));
ALTER TABLE "SignalementSanction" ADD CONSTRAINT "SignalementSanction_confirmation_check"
  CHECK ("qualification" <> 'CONFIRMEE' OR (
    "autorite" IS NOT NULL AND length(btrim("autorite")) > 0
    AND "referenceDecision" IS NOT NULL AND length(btrim("referenceDecision")) > 0
    AND (("dateDecisionApplicable" AND "dateDecision" IS NOT NULL)
      OR (NOT "dateDecisionApplicable" AND "motifDateDecisionAbsente" IS NOT NULL AND length(btrim("motifDateDecisionAbsente")) > 0))));
ALTER TABLE "SanctionPiece" ADD CONSTRAINT "SanctionPiece_size_check" CHECK ("taille" > 0 AND "taille" <= 5242880);
ALTER TABLE "SanctionPiece" ADD CONSTRAINT "SanctionPiece_namespace_check" CHECK ("storageKey" ~ '^sanctions-private/v1/[a-f0-9-]{36}$');
ALTER TABLE "SanctionPiece" ADD CONSTRAINT "SanctionPiece_sha_check" CHECK ("sha256" ~ '^[a-f0-9]{64}$');
ALTER TABLE "SanctionPiece" ADD CONSTRAINT "SanctionPiece_mime_check" CHECK ("mimeType" IN ('application/pdf', 'image/png', 'image/jpeg'));

-- Append-only audit at DB level, including TRUNCATE; no generic ActivityLog payloads.
CREATE FUNCTION velarium_sanction_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sanction history is append-only';
END;
$$;
CREATE TRIGGER sanction_history_no_mutation BEFORE UPDATE OR DELETE ON "SanctionHistorique"
  FOR EACH ROW EXECUTE FUNCTION velarium_sanction_history_immutable();
CREATE TRIGGER sanction_history_no_truncate BEFORE TRUNCATE ON "SanctionHistorique"
  FOR EACH STATEMENT EXECUTE FUNCTION velarium_sanction_history_immutable();

COMMIT;


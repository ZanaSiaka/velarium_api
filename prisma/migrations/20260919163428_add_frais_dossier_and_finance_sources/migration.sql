-- CreateEnum
CREATE TYPE "StatutFraisOuverture" AS ENUM (
  'A_FACTURER',
  'FACTURE',
  'PAYE'
);

-- CreateEnum
CREATE TYPE "SourceFacture" AS ENUM (
  'DOSSIER',
  'FRAIS_OUVERTURE_DOSSIER',
  'AUTRE'
);

-- CreateEnum
CREATE TYPE "SourceMouvementFinance" AS ENUM (
  'PAIEMENT_FACTURE',
  'FRAIS_OUVERTURE_DOSSIER',
  'PROVISION',
  'TRANSFERT',
  'ACHAT',
  'LOYER',
  'SALAIRE',
  'REMBOURSEMENT',
  'IMPOT_TAXE',
  'AUTRE'
);

-- CreateEnum
CREATE TYPE "TypeLigneFacture" AS ENUM (
  'HONORAIRES',
  'FRAIS_OUVERTURE_DOSSIER',
  'AUTRE'
);

-- AlterEnum
ALTER TYPE "CategorieFinance"
ADD VALUE 'FRAIS_OUVERTURE_DOSSIER';


-- =========================================================
-- FACTURES
-- =========================================================

ALTER TABLE "Facture"
ADD COLUMN "source" "SourceFacture" NOT NULL DEFAULT 'DOSSIER',
ADD COLUMN "sourceLibelle" TEXT;


-- =========================================================
-- LIGNES DE FACTURE
-- =========================================================

ALTER TABLE "LigneFacture"
ADD COLUMN "type" "TypeLigneFacture" NOT NULL DEFAULT 'AUTRE';


-- =========================================================
-- MOUVEMENTS FINANCIERS
-- =========================================================

-- IMPORTANT :
-- On ajoute d'abord source en nullable,
-- car la table contient potentiellement déjà des données.

ALTER TABLE "MouvementFinance"
ADD COLUMN "source" "SourceMouvementFinance",
ADD COLUMN "sourceLibelle" TEXT,
ADD COLUMN "sourceReference" TEXT,
ADD COLUMN "tiers" TEXT;


-- ---------------------------------------------------------
-- Migration des anciennes sources que l'on peut identifier
-- ---------------------------------------------------------

UPDATE "MouvementFinance"
SET "source" = 'TRANSFERT'
WHERE "type" = 'TRANSFERT';


UPDATE "MouvementFinance"
SET "source" = 'PAIEMENT_FACTURE'
WHERE "source" IS NULL
  AND "categorie" = 'PAIEMENT_FACTURE';


UPDATE "MouvementFinance"
SET "source" = 'PROVISION'
WHERE "source" IS NULL
  AND "categorie" = 'PROVISION';


UPDATE "MouvementFinance"
SET "source" = 'ACHAT'
WHERE "source" IS NULL
  AND "categorie" = 'ACHAT';


UPDATE "MouvementFinance"
SET "source" = 'LOYER'
WHERE "source" IS NULL
  AND "categorie" = 'LOYER';


UPDATE "MouvementFinance"
SET "source" = 'SALAIRE'
WHERE "source" IS NULL
  AND "categorie" = 'SALAIRES';


UPDATE "MouvementFinance"
SET "source" = 'REMBOURSEMENT'
WHERE "source" IS NULL
  AND "categorie" = 'REMBOURSEMENT';


UPDATE "MouvementFinance"
SET "source" = 'IMPOT_TAXE'
WHERE "source" IS NULL
  AND "categorie" = 'IMPOTS_TAXES';


-- ---------------------------------------------------------
-- Pour toutes les anciennes opérations dont l'origine
-- exacte ne peut pas être déduite
-- ---------------------------------------------------------

UPDATE "MouvementFinance"
SET
  "source" = 'AUTRE',
  "sourceLibelle" = COALESCE(
    NULLIF(TRIM("description"), ''),
    NULLIF(TRIM("reference"), ''),
    'Opération existante avant la gestion des sources'
  )
WHERE "source" IS NULL;


-- Toutes les anciennes lignes ont maintenant une source.
-- On peut donc rendre le champ obligatoire.

ALTER TABLE "MouvementFinance"
ALTER COLUMN "source" SET NOT NULL;


-- =========================================================
-- PAIEMENTS
-- =========================================================

ALTER TABLE "Paiement"
ADD COLUMN "mouvementFinanceId" TEXT;


-- =========================================================
-- PROVISIONS
-- =========================================================

ALTER TABLE "Provision"
ADD COLUMN "mouvementFinanceId" TEXT;


-- =========================================================
-- FRAIS D'OUVERTURE DE DOSSIER
-- =========================================================

CREATE TABLE "FraisOuvertureDossier" (
  "id" TEXT NOT NULL,
  "dossierId" TEXT NOT NULL,
  "montant" DECIMAL(14,2) NOT NULL,
  "statut" "StatutFraisOuverture" NOT NULL DEFAULT 'A_FACTURER',
  "datePaiement" TIMESTAMP(3),
  "factureId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FraisOuvertureDossier_pkey"
  PRIMARY KEY ("id")
);


-- =========================================================
-- INDEX FRAIS D'OUVERTURE
-- =========================================================

CREATE UNIQUE INDEX "FraisOuvertureDossier_dossierId_key"
ON "FraisOuvertureDossier"("dossierId");

CREATE UNIQUE INDEX "FraisOuvertureDossier_factureId_key"
ON "FraisOuvertureDossier"("factureId");

CREATE INDEX "FraisOuvertureDossier_statut_idx"
ON "FraisOuvertureDossier"("statut");

CREATE INDEX "FraisOuvertureDossier_datePaiement_idx"
ON "FraisOuvertureDossier"("datePaiement");


-- =========================================================
-- INDEX FACTURE
-- =========================================================

CREATE INDEX "Facture_source_idx"
ON "Facture"("source");


-- =========================================================
-- INDEX LIGNE FACTURE
-- =========================================================

CREATE INDEX "LigneFacture_type_idx"
ON "LigneFacture"("type");


-- =========================================================
-- INDEX MOUVEMENT FINANCE
-- =========================================================

CREATE INDEX "MouvementFinance_source_idx"
ON "MouvementFinance"("source");

CREATE INDEX "MouvementFinance_sourceReference_idx"
ON "MouvementFinance"("sourceReference");


-- =========================================================
-- INDEX PAIEMENT / PROVISION
-- =========================================================

CREATE UNIQUE INDEX "Paiement_mouvementFinanceId_key"
ON "Paiement"("mouvementFinanceId");

CREATE INDEX "Paiement_factureId_idx"
ON "Paiement"("factureId");

CREATE UNIQUE INDEX "Provision_mouvementFinanceId_key"
ON "Provision"("mouvementFinanceId");


-- =========================================================
-- FOREIGN KEYS
-- =========================================================

ALTER TABLE "FraisOuvertureDossier"
ADD CONSTRAINT "FraisOuvertureDossier_dossierId_fkey"
FOREIGN KEY ("dossierId")
REFERENCES "Dossier"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


ALTER TABLE "FraisOuvertureDossier"
ADD CONSTRAINT "FraisOuvertureDossier_factureId_fkey"
FOREIGN KEY ("factureId")
REFERENCES "Facture"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;


ALTER TABLE "Paiement"
ADD CONSTRAINT "Paiement_mouvementFinanceId_fkey"
FOREIGN KEY ("mouvementFinanceId")
REFERENCES "MouvementFinance"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;


ALTER TABLE "Provision"
ADD CONSTRAINT "Provision_mouvementFinanceId_fkey"
FOREIGN KEY ("mouvementFinanceId")
REFERENCES "MouvementFinance"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
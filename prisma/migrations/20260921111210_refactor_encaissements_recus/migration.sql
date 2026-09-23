-- ============================================================
-- VELARIUM
-- Migration : refactor_encaissements_recus
--
-- Objectifs :
-- - nouveaux moyens de paiement structurés
-- - statut A_PAYER pour les frais d'ouverture
-- - rattachement des frais d'ouverture à un mouvement Finance
-- - moyen de paiement structuré sur MouvementFinance
-- - reçus d'encaissement
-- - imputation des provisions sur les factures
--
-- IMPORTANT :
-- Cette migration conserve volontairement :
-- - CARTE
-- - MOBILE_MONEY
-- - A_FACTURER
-- - FACTURE
-- - factureId sur Provision
-- - factureId sur FraisOuvertureDossier
--
-- Ils seront nettoyés dans une migration ultérieure.
-- ============================================================


-- ============================================================
-- 1. ENUM DES TYPES DE REÇUS
-- ============================================================

CREATE TYPE "TypeRecuEncaissement" AS ENUM (
    'FRAIS_OUVERTURE_DOSSIER',
    'PROVISION'
);


-- ============================================================
-- 2. NOUVEAUX MOYENS DE PAIEMENT
-- ============================================================
--
-- Compte bancaire :
--   VIREMENT
--   CHEQUE
--
-- Mobile Money :
--   ORANGE_MONEY
--   WAVE
--   MTN_MONEY
--   MOOV_MONEY
--
-- Carte bancaire :
--   PAIEMENT_CARTE
--
-- Espèces :
--   ESPECES
--
-- Les anciennes valeurs CARTE et MOBILE_MONEY sont conservées
-- temporairement dans l'enum existant.
-- ============================================================

ALTER TYPE "MoyenOperationCompte"
ADD VALUE 'ORANGE_MONEY';

ALTER TYPE "MoyenOperationCompte"
ADD VALUE 'WAVE';

ALTER TYPE "MoyenOperationCompte"
ADD VALUE 'MTN_MONEY';

ALTER TYPE "MoyenOperationCompte"
ADD VALUE 'MOOV_MONEY';

ALTER TYPE "MoyenOperationCompte"
ADD VALUE 'PAIEMENT_CARTE';


-- ============================================================
-- 3. NOUVEAU STATUT DES FRAIS D'OUVERTURE
-- ============================================================
--
-- Nouvelle logique :
--
-- A_PAYER
-- PAYE
--
-- Les anciennes valeurs A_FACTURER et FACTURE restent
-- temporairement disponibles pour les données historiques.
-- ============================================================

ALTER TYPE "StatutFraisOuverture"
ADD VALUE 'A_PAYER';


-- ============================================================
-- 4. FRAIS D'OUVERTURE :
--    LIAISON VERS LE MOUVEMENT FINANCE
-- ============================================================

ALTER TABLE "FraisOuvertureDossier"
ADD COLUMN "mouvementFinanceId" TEXT,
ALTER COLUMN "statut" SET DEFAULT 'A_PAYER';


-- ============================================================
-- 5. MOUVEMENT FINANCE :
--    AJOUT DU MOYEN DE PAIEMENT STRUCTURÉ
-- ============================================================

ALTER TABLE "MouvementFinance"
ADD COLUMN "moyenPaiement" "MoyenOperationCompte";


-- ============================================================
-- 6. TABLE DES IMPUTATIONS DE PROVISIONS
-- ============================================================
--
-- Une provision peut désormais être reçue avant toute facture.
--
-- Exemple :
--
-- Provision reçue : 500 000
--
-- Imputation FACT-001 : 200 000
-- Imputation FACT-002 : 150 000
--
-- Disponible : 150 000
--
-- Aucune nouvelle entrée Finance n'est créée lors
-- d'une imputation.
-- ============================================================

CREATE TABLE "ImputationProvision" (
    "id" TEXT NOT NULL,

    "provisionId" TEXT NOT NULL,

    "factureId" TEXT NOT NULL,

    "montant" DECIMAL(14,2) NOT NULL,

    "dateImputation" TIMESTAMP(3)
        NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    "createdById" TEXT NOT NULL,

    "createdAt" TIMESTAMP(3)
        NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImputationProvision_pkey"
        PRIMARY KEY ("id")
);


-- ============================================================
-- 7. TABLE DES REÇUS D'ENCAISSEMENT
-- ============================================================
--
-- Un reçu correspond à un encaissement réel.
--
-- 1 MouvementFinance
-- =
-- 1 RecuEncaissement maximum
--
-- Pour le moment :
-- - frais d'ouverture
-- - provision
-- ============================================================

CREATE TABLE "RecuEncaissement" (
    "id" TEXT NOT NULL,

    "numero" TEXT NOT NULL,

    "type" "TypeRecuEncaissement" NOT NULL,

    "montant" DECIMAL(14,2) NOT NULL,

    "dateEmission" TIMESTAMP(3)
        NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    "recuDe" TEXT NOT NULL,

    "compteLibelle" TEXT NOT NULL,

    "moyenPaiement" "MoyenOperationCompte" NOT NULL,

    "referencePaiement" TEXT,

    "objet" TEXT NOT NULL,

    "note" TEXT,

    "dossierId" TEXT NOT NULL,

    "mouvementFinanceId" TEXT NOT NULL,

    "createdById" TEXT NOT NULL,

    "createdAt" TIMESTAMP(3)
        NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecuEncaissement_pkey"
        PRIMARY KEY ("id")
);


-- ============================================================
-- 8. INDEXES : IMPUTATIONS
-- ============================================================

CREATE INDEX "ImputationProvision_provisionId_idx"
ON "ImputationProvision"("provisionId");

CREATE INDEX "ImputationProvision_factureId_idx"
ON "ImputationProvision"("factureId");

CREATE INDEX "ImputationProvision_createdById_idx"
ON "ImputationProvision"("createdById");

CREATE UNIQUE INDEX "ImputationProvision_provisionId_factureId_key"
ON "ImputationProvision"(
    "provisionId",
    "factureId"
);


-- ============================================================
-- 9. INDEXES : REÇUS
-- ============================================================

CREATE UNIQUE INDEX "RecuEncaissement_numero_key"
ON "RecuEncaissement"("numero");

CREATE UNIQUE INDEX "RecuEncaissement_mouvementFinanceId_key"
ON "RecuEncaissement"("mouvementFinanceId");

CREATE INDEX "RecuEncaissement_dossierId_idx"
ON "RecuEncaissement"("dossierId");

CREATE INDEX "RecuEncaissement_type_idx"
ON "RecuEncaissement"("type");

CREATE INDEX "RecuEncaissement_dateEmission_idx"
ON "RecuEncaissement"("dateEmission");

CREATE INDEX "RecuEncaissement_createdById_idx"
ON "RecuEncaissement"("createdById");


-- ============================================================
-- 10. INDEX UNIQUE :
--     FRAIS D'OUVERTURE -> MOUVEMENT FINANCE
-- ============================================================
--
-- Plusieurs NULL sont autorisés par PostgreSQL.
--
-- Les anciens frais peuvent donc rester temporairement
-- sans mouvementFinanceId.
-- ============================================================

CREATE UNIQUE INDEX "FraisOuvertureDossier_mouvementFinanceId_key"
ON "FraisOuvertureDossier"("mouvementFinanceId");


-- ============================================================
-- 11. INDEX :
--     MOYEN DE PAIEMENT DES MOUVEMENTS
-- ============================================================

CREATE INDEX "MouvementFinance_moyenPaiement_idx"
ON "MouvementFinance"("moyenPaiement");


-- ============================================================
-- 12. FOREIGN KEY :
--     FRAIS D'OUVERTURE -> MOUVEMENT FINANCE
-- ============================================================

ALTER TABLE "FraisOuvertureDossier"
ADD CONSTRAINT "FraisOuvertureDossier_mouvementFinanceId_fkey"
FOREIGN KEY ("mouvementFinanceId")
REFERENCES "MouvementFinance"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;


-- ============================================================
-- 13. FOREIGN KEY :
--     IMPUTATION -> PROVISION
-- ============================================================

ALTER TABLE "ImputationProvision"
ADD CONSTRAINT "ImputationProvision_provisionId_fkey"
FOREIGN KEY ("provisionId")
REFERENCES "Provision"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


-- ============================================================
-- 14. FOREIGN KEY :
--     IMPUTATION -> FACTURE
-- ============================================================

ALTER TABLE "ImputationProvision"
ADD CONSTRAINT "ImputationProvision_factureId_fkey"
FOREIGN KEY ("factureId")
REFERENCES "Facture"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


-- ============================================================
-- 15. FOREIGN KEY :
--     IMPUTATION -> UTILISATEUR
-- ============================================================

ALTER TABLE "ImputationProvision"
ADD CONSTRAINT "ImputationProvision_createdById_fkey"
FOREIGN KEY ("createdById")
REFERENCES "User"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;


-- ============================================================
-- 16. FOREIGN KEY :
--     REÇU -> DOSSIER
-- ============================================================

ALTER TABLE "RecuEncaissement"
ADD CONSTRAINT "RecuEncaissement_dossierId_fkey"
FOREIGN KEY ("dossierId")
REFERENCES "Dossier"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


-- ============================================================
-- 17. FOREIGN KEY :
--     REÇU -> MOUVEMENT FINANCE
-- ============================================================

ALTER TABLE "RecuEncaissement"
ADD CONSTRAINT "RecuEncaissement_mouvementFinanceId_fkey"
FOREIGN KEY ("mouvementFinanceId")
REFERENCES "MouvementFinance"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


-- ============================================================
-- 18. FOREIGN KEY :
--     REÇU -> UTILISATEUR AYANT ÉMIS LE REÇU
-- ============================================================

ALTER TABLE "RecuEncaissement"
ADD CONSTRAINT "RecuEncaissement_createdById_fkey"
FOREIGN KEY ("createdById")
REFERENCES "User"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;


-- ============================================================
-- FIN DE LA MIGRATION STRUCTURELLE
-- ============================================================
--
-- ATTENTION :
--
-- On ne fait PAS encore ici :
--
-- A_FACTURER -> A_PAYER
-- FACTURE     -> A_PAYER / PAYE
--
-- On ne supprime PAS encore :
--
-- FraisOuvertureDossier.factureId
-- Provision.factureId
--
-- On ne supprime PAS encore :
--
-- MoyenOperationCompte.CARTE
-- MoyenOperationCompte.MOBILE_MONEY
--
-- On ne supprime PAS encore :
--
-- StatutFraisOuverture.A_FACTURER
-- StatutFraisOuverture.FACTURE
--
-- On ne supprime aucune ancienne facture automatiquement.
--
-- Ces opérations seront réalisées dans une migration
-- de nettoyage après analyse des données existantes.
-- ============================================================
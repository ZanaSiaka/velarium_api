-- Ajout des nouveaux champs de gestion des dossiers

ALTER TABLE "Dossier"
ADD COLUMN "archive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "avocatClientEmail" TEXT,
ADD COLUMN "avocatClientNom" TEXT,
ADD COLUMN "avocatClientTelephone" TEXT,
ADD COLUMN "declarationSoupcon" TEXT,
ADD COLUMN "kycSoupcon" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "natureAffaire" TEXT,
ADD COLUMN "typeDossier" TEXT;

-- Migration des anciennes données :
-- l'ancien champ "type" correspondait à la nature de l'affaire.
UPDATE "Dossier"
SET "natureAffaire" = "type"
WHERE "type" IS NOT NULL;

-- Le champ "type" reste conservé temporairement
-- pour éviter toute perte de données.
ALTER TABLE "Dossier"
ALTER COLUMN "type" DROP NOT NULL;
-- ============================================================
-- 1. MOYENS D'OPERATION
-- ============================================================

CREATE TYPE "MoyenOperationCompte" AS ENUM (
    'VIREMENT',
    'CHEQUE',
    'CARTE',
    'MOBILE_MONEY',
    'ESPECES'
);


-- ============================================================
-- 2. EVOLUTION DES TYPES DE CAISSE / COMPTE
--
-- On renomme directement les anciennes valeurs afin de
-- préserver toutes les données existantes.
-- ============================================================

ALTER TYPE "TypeCaisse"
RENAME VALUE 'BANQUE'
TO 'BANCAIRE';

ALTER TYPE "TypeCaisse"
RENAME VALUE 'WAVE'
TO 'MOBILE_MONEY';

ALTER TYPE "TypeCaisse"
ADD VALUE IF NOT EXISTS 'EPARGNE';

ALTER TYPE "TypeCaisse"
ADD VALUE IF NOT EXISTS 'CARTE_BANCAIRE';


-- ============================================================
-- 3. NOUVELLES INFORMATIONS DU COMPTE
-- ============================================================

ALTER TABLE "Caisse"
ADD COLUMN "identifiant" TEXT;

ALTER TABLE "Caisse"
ADD COLUMN "institution" TEXT;

ALTER TABLE "Caisse"
ADD COLUMN "titulaire" TEXT;

ALTER TABLE "Caisse"
ADD COLUMN "moyensOperation"
"MoyenOperationCompte"[]
DEFAULT ARRAY[]::"MoyenOperationCompte"[];


-- ============================================================
-- 4. MIGRATION DES DONNEES EXISTANTES
-- ============================================================

-- Les anciens comptes bancaires pourront fonctionner
-- par virement et chèque.

UPDATE "Caisse"
SET "moyensOperation" = ARRAY[
    'VIREMENT'::"MoyenOperationCompte",
    'CHEQUE'::"MoyenOperationCompte"
]
WHERE "type" = 'BANCAIRE';


-- Les anciennes caisses Wave deviennent des comptes
-- Mobile Money, avec Wave comme institution connue.

UPDATE "Caisse"
SET
    "institution" = COALESCE(
        "institution",
        'Wave'
    ),
    "moyensOperation" = ARRAY[
        'MOBILE_MONEY'::"MoyenOperationCompte"
    ]
WHERE "type" = 'MOBILE_MONEY';


-- Les caisses physiques utilisent les espèces.

UPDATE "Caisse"
SET "moyensOperation" = ARRAY[
    'ESPECES'::"MoyenOperationCompte"
]
WHERE "type" = 'ESPECES';
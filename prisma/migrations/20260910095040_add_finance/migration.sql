-- CreateEnum
CREATE TYPE "TypeCaisse" AS ENUM ('ESPECES', 'BANQUE', 'WAVE', 'AUTRE');

-- CreateEnum
CREATE TYPE "TypeMouvementFinance" AS ENUM ('ENTREE', 'SORTIE', 'TRANSFERT');

-- CreateEnum
CREATE TYPE "CategorieFinance" AS ENUM ('HONORAIRES', 'PAIEMENT_FACTURE', 'PROVISION', 'REMBOURSEMENT', 'DEPOT', 'RETRAIT', 'ACHAT', 'FOURNITURES', 'SALAIRES', 'LOYER', 'ELECTRICITE', 'INTERNET', 'TRANSPORT', 'FRAIS_BANCAIRES', 'IMPOTS_TAXES', 'AUTRE');

-- CreateTable
CREATE TABLE "Caisse" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "type" "TypeCaisse" NOT NULL,
    "devise" TEXT NOT NULL DEFAULT 'XOF',
    "soldeInitial" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Caisse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MouvementFinance" (
    "id" TEXT NOT NULL,
    "type" "TypeMouvementFinance" NOT NULL,
    "montant" DECIMAL(15,2) NOT NULL,
    "description" TEXT,
    "categorie" "CategorieFinance" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference" TEXT,
    "pieceJointe" TEXT,
    "caisseId" TEXT NOT NULL,
    "caisseDestinationId" TEXT,
    "userId" TEXT NOT NULL,
    "dossierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MouvementFinance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MouvementFinance_caisseId_idx" ON "MouvementFinance"("caisseId");

-- CreateIndex
CREATE INDEX "MouvementFinance_caisseDestinationId_idx" ON "MouvementFinance"("caisseDestinationId");

-- CreateIndex
CREATE INDEX "MouvementFinance_userId_idx" ON "MouvementFinance"("userId");

-- CreateIndex
CREATE INDEX "MouvementFinance_type_idx" ON "MouvementFinance"("type");

-- CreateIndex
CREATE INDEX "MouvementFinance_categorie_idx" ON "MouvementFinance"("categorie");

-- CreateIndex
CREATE INDEX "MouvementFinance_date_idx" ON "MouvementFinance"("date");

-- CreateIndex
CREATE INDEX "MouvementFinance_dossierId_idx" ON "MouvementFinance"("dossierId");

-- AddForeignKey
ALTER TABLE "MouvementFinance" ADD CONSTRAINT "MouvementFinance_caisseId_fkey" FOREIGN KEY ("caisseId") REFERENCES "Caisse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementFinance" ADD CONSTRAINT "MouvementFinance_caisseDestinationId_fkey" FOREIGN KEY ("caisseDestinationId") REFERENCES "Caisse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementFinance" ADD CONSTRAINT "MouvementFinance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementFinance" ADD CONSTRAINT "MouvementFinance_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "Dossier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

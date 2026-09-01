-- CreateEnum
CREATE TYPE "TypeContrat" AS ENUM ('CDI', 'CDD', 'STAGE', 'ALTERNANCE', 'FREELANCE', 'PRESTATION', 'AUTRE');

-- CreateEnum
CREATE TYPE "TypePieceUtilisateur" AS ENUM ('CNI', 'PASSEPORT', 'CONTRAT', 'DIPLOME', 'ATTESTATION', 'CV', 'PHOTO', 'AUTRE');

-- CreateTable
CREATE TABLE "ContratUtilisateur" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TypeContrat" NOT NULL,
    "dateDebut" TIMESTAMP(3) NOT NULL,
    "dateFin" TIMESTAMP(3),
    "poste" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContratUtilisateur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PieceUtilisateur" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contratId" TEXT,
    "type" "TypePieceUtilisateur" NOT NULL,
    "nom" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "dateExpiration" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PieceUtilisateur_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContratUtilisateur_userId_idx" ON "ContratUtilisateur"("userId");

-- CreateIndex
CREATE INDEX "PieceUtilisateur_userId_idx" ON "PieceUtilisateur"("userId");

-- CreateIndex
CREATE INDEX "PieceUtilisateur_contratId_idx" ON "PieceUtilisateur"("contratId");

-- AddForeignKey
ALTER TABLE "ContratUtilisateur" ADD CONSTRAINT "ContratUtilisateur_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PieceUtilisateur" ADD CONSTRAINT "PieceUtilisateur_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PieceUtilisateur" ADD CONSTRAINT "PieceUtilisateur_contratId_fkey" FOREIGN KEY ("contratId") REFERENCES "ContratUtilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

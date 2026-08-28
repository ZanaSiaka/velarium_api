-- CreateEnum
CREATE TYPE "TacheStatut" AS ENUM ('A_FAIRE', 'EN_COURS', 'TERMINEE', 'ANNULEE');

-- CreateEnum
CREATE TYPE "TachePriorite" AS ENUM ('BASSE', 'NORMALE', 'HAUTE', 'URGENTE');

-- CreateTable
CREATE TABLE "Tache" (
    "id" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "description" TEXT,
    "statut" "TacheStatut" NOT NULL DEFAULT 'A_FAIRE',
    "priorite" "TachePriorite" NOT NULL DEFAULT 'NORMALE',
    "dateEcheance" TIMESTAMP(3),
    "createurId" TEXT NOT NULL,
    "assigneAId" TEXT NOT NULL,
    "dossierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tache_assigneAId_idx" ON "Tache"("assigneAId");

-- CreateIndex
CREATE INDEX "Tache_createurId_idx" ON "Tache"("createurId");

-- CreateIndex
CREATE INDEX "Tache_dossierId_idx" ON "Tache"("dossierId");

-- CreateIndex
CREATE INDEX "Tache_statut_idx" ON "Tache"("statut");

-- CreateIndex
CREATE INDEX "Tache_dateEcheance_idx" ON "Tache"("dateEcheance");

-- AddForeignKey
ALTER TABLE "Tache" ADD CONSTRAINT "Tache_createurId_fkey" FOREIGN KEY ("createurId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tache" ADD CONSTRAINT "Tache_assigneAId_fkey" FOREIGN KEY ("assigneAId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tache" ADD CONSTRAINT "Tache_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "Dossier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

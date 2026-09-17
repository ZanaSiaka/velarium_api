-- AlterTable
ALTER TABLE "Provision" ADD COLUMN     "moyenPaiement" TEXT;

-- CreateIndex
CREATE INDEX "Provision_dossierId_idx" ON "Provision"("dossierId");

-- CreateIndex
CREATE INDEX "Provision_datePaiement_idx" ON "Provision"("datePaiement");

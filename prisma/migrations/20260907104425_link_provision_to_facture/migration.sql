-- AlterTable
ALTER TABLE "Provision" ADD COLUMN     "factureId" TEXT;

-- CreateIndex
CREATE INDEX "Provision_factureId_idx" ON "Provision"("factureId");

-- AddForeignKey
ALTER TABLE "Provision" ADD CONSTRAINT "Provision_factureId_fkey" FOREIGN KEY ("factureId") REFERENCES "Facture"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "PieceJointeFinance" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "taille" INTEGER,
    "type" TEXT,
    "mouvementId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PieceJointeFinance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PieceJointeFinance_storageKey_key" ON "PieceJointeFinance"("storageKey");

-- CreateIndex
CREATE INDEX "PieceJointeFinance_mouvementId_idx" ON "PieceJointeFinance"("mouvementId");

-- CreateIndex
CREATE INDEX "PieceJointeFinance_uploadedById_idx" ON "PieceJointeFinance"("uploadedById");

-- AddForeignKey
ALTER TABLE "PieceJointeFinance" ADD CONSTRAINT "PieceJointeFinance_mouvementId_fkey" FOREIGN KEY ("mouvementId") REFERENCES "MouvementFinance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PieceJointeFinance" ADD CONSTRAINT "PieceJointeFinance_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

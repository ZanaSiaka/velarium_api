-- Additive import ledger. No existing client is updated, deleted or backfilled.
CREATE TABLE "ClientImport" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "fileHash" TEXT NOT NULL,
  "report" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientImport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClientImport_fileHash_key" ON "ClientImport"("fileHash");
CREATE INDEX "ClientImport_ownerId_createdAt_idx" ON "ClientImport"("ownerId", "createdAt");
ALTER TABLE "ClientImport" ADD CONSTRAINT "ClientImport_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ClientImportIdentity" (
  "key" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientImportIdentity_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "ClientImportIdentity_clientId_idx" ON "ClientImportIdentity"("clientId");
ALTER TABLE "ClientImportIdentity" ADD CONSTRAINT "ClientImportIdentity_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

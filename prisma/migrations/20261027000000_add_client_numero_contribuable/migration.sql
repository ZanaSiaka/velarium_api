-- Additive change only: historical clients retain NULL.
ALTER TABLE "Client" ADD COLUMN "numeroContribuable" TEXT;

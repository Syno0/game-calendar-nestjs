-- La dernière activité d'un compte, qui fonde la purge des comptes inactifs.
ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Sans reprise, tous les comptes existants dateraient leur activité du jour de
-- la migration. `updatedAt` est la dernière connexion OAuth : la meilleure
-- approximation disponible, et elle ne peut que sous-estimer l'activité.
UPDATE "User" SET "lastSeenAt" = "updatedAt";

CREATE INDEX "User_lastSeenAt_idx" ON "User"("lastSeenAt");

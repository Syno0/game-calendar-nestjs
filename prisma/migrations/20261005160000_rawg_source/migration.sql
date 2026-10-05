-- CreateTable
CREATE TABLE "RawgGame" (
    "rawgId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "released" DATE,
    "tba" BOOLEAN NOT NULL DEFAULT false,
    "releasedSeenAt" TIMESTAMP(3),
    "rawgUpdatedAt" TIMESTAMP(3),
    "metacritic" INTEGER,
    "rating" DOUBLE PRECISION,
    "ratingsCount" INTEGER,
    "added" INTEGER,
    "addedByStatus" JSONB,
    "esrb" TEXT,
    "playtime" INTEGER,
    "platformSlugs" TEXT[],
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawgGame_pkey" PRIMARY KEY ("rawgId")
);

-- CreateTable
CREATE TABLE "GameLink" (
    "igdbGameId" INTEGER NOT NULL,
    "rawgId" INTEGER,
    "method" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "igdbName" TEXT,
    "igdbHypes" INTEGER NOT NULL DEFAULT 0,
    "igdbDate" TIMESTAMP(3),
    "igdbPrecision" TEXT,
    "igdbUpdatedAt" TIMESTAMP(3),

    CONSTRAINT "GameLink_pkey" PRIMARY KEY ("igdbGameId")
);

-- CreateTable
CREATE TABLE "GameDateOverride" (
    "igdbGameId" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "date" DATE,
    "precision" TEXT,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameDateOverride_pkey" PRIMARY KEY ("igdbGameId")
);

-- CreateTable
CREATE TABLE "RawgSyncState" (
    "key" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "pages" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RawgSyncState_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "RawgApiUsage" (
    "day" DATE NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RawgApiUsage_pkey" PRIMARY KEY ("day")
);

-- CreateIndex
CREATE INDEX "RawgGame_nameKey_idx" ON "RawgGame"("nameKey");

-- CreateIndex
CREATE INDEX "RawgGame_released_idx" ON "RawgGame"("released");

-- CreateIndex
CREATE INDEX "GameLink_rawgId_idx" ON "GameLink"("rawgId");

-- AddForeignKey
ALTER TABLE "GameLink" ADD CONSTRAINT "GameLink_rawgId_fkey" FOREIGN KEY ("rawgId") REFERENCES "RawgGame"("rawgId") ON DELETE SET NULL ON UPDATE CASCADE;

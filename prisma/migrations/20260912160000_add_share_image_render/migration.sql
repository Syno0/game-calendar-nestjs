-- CreateTable
CREATE TABLE "ShareImageRender" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "layout" TEXT NOT NULL,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "viaShareLink" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareImageRender_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShareImageRender_userId_idx" ON "ShareImageRender"("userId");

-- CreateIndex
CREATE INDEX "ShareImageRender_createdAt_idx" ON "ShareImageRender"("createdAt");

-- AddForeignKey
ALTER TABLE "ShareImageRender" ADD CONSTRAINT "ShareImageRender_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

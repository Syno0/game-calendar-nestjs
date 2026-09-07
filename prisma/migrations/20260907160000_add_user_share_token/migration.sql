-- AlterTable
ALTER TABLE "User" ADD COLUMN     "shareCreatedAt" TIMESTAMP(3),
ADD COLUMN     "shareToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_shareToken_key" ON "User"("shareToken");


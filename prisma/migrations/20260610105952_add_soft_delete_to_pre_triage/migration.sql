-- AlterTable
ALTER TABLE "PreTriage" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedBy" TEXT;

-- CreateIndex
CREATE INDEX "PreTriage_isDeleted_idx" ON "PreTriage"("isDeleted");

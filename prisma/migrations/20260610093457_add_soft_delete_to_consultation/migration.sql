-- AlterTable
ALTER TABLE "Consultation" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Consultation_isDeleted_idx" ON "Consultation"("isDeleted");

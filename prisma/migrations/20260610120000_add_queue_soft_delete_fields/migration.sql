ALTER TABLE "QueueManagement"
ADD COLUMN "createdBy" TEXT,
ADD COLUMN "updatedBy" TEXT,
ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "QueueManagement_isDeleted_idx" ON "QueueManagement"("isDeleted");

CREATE UNIQUE INDEX "QueueManagement_queueNumber_key" ON "QueueManagement"("queueNumber");

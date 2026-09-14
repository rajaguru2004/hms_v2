-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "logoTextUrl" TEXT;

-- RenameIndex
ALTER INDEX "QueueManagement_organizationId_status_joinedQueueAt_isDeleted_i" RENAME TO "QueueManagement_organizationId_status_joinedQueueAt_isDelet_idx";

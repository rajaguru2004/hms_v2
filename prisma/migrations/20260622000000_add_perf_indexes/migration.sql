-- Performance Indexes Migration
-- Fixes slow queries on: dashboard, laboratory/stats, laboratory/orders, pharmacy/stats, pharmacy/sales
-- All indexes use IF NOT EXISTS for idempotency

-- Patient: dashboard patient count (organizationId, isActive, isDeleted)
CREATE INDEX IF NOT EXISTS "Patient_organizationId_isActive_isDeleted_idx"
  ON "Patient"("organizationId", "isActive", "isDeleted");

-- QueueManagement: dashboard queue count (organizationId, status, joinedQueueAt, isDeleted)
CREATE INDEX IF NOT EXISTS "QueueManagement_organizationId_status_joinedQueueAt_isDeleted_idx"
  ON "QueueManagement"("organizationId", "status", "joinedQueueAt", "isDeleted");

-- Appointment: dashboard today count
CREATE INDEX IF NOT EXISTS "Appointment_organizationId_appointmentDate_isDeleted_idx"
  ON "Appointment"("organizationId", "appointmentDate", "isDeleted");

-- Appointment: dashboard status breakdown
CREATE INDEX IF NOT EXISTS "Appointment_organizationId_status_appointmentDate_isDeleted_idx"
  ON "Appointment"("organizationId", "status", "appointmentDate", "isDeleted");

-- Bed: dashboard bed status count
CREATE INDEX IF NOT EXISTS "Bed_organizationId_status_idx"
  ON "Bed"("organizationId", "status");

-- Prescription: dashboard + pharmacy pending count
CREATE INDEX IF NOT EXISTS "Prescription_organizationId_status_idx"
  ON "Prescription"("organizationId", "status");

-- PharmacySale: pharmacy sales by date
CREATE INDEX IF NOT EXISTS "PharmacySale_organizationId_saleDate_idx"
  ON "PharmacySale"("organizationId", "saleDate");

-- Payment: dashboard revenue sum (organizationId, paymentDate, isRefund)
CREATE INDEX IF NOT EXISTS "Payment_organizationId_paymentDate_isRefund_idx"
  ON "Payment"("organizationId", "paymentDate", "isRefund");

-- LabOrder: lab stats counts by status
CREATE INDEX IF NOT EXISTS "LabOrder_organizationId_status_idx"
  ON "LabOrder"("organizationId", "status");

-- LabOrder: lab stats completedToday range
CREATE INDEX IF NOT EXISTS "LabOrder_organizationId_status_resultsReportedAt_idx"
  ON "LabOrder"("organizationId", "status", "resultsReportedAt");

-- LabOrder: lab orders listing sort by date
CREATE INDEX IF NOT EXISTS "LabOrder_organizationId_orderDate_idx"
  ON "LabOrder"("organizationId", "orderDate");

-- LabResult: critical unverified results (dashboard + lab stats)
CREATE INDEX IF NOT EXISTS "LabResult_isCritical_verifiedAt_idx"
  ON "LabResult"("isCritical", "verifiedAt");

CREATE INDEX IF NOT EXISTS "LabResult_organizationId_isCritical_verifiedAt_idx"
  ON "LabResult"("organizationId", "isCritical", "verifiedAt");

-- LabTest: lab tests listing (organizationId, isActive)
CREATE INDEX IF NOT EXISTS "LabTest_organizationId_isActive_idx"
  ON "LabTest"("organizationId", "isActive");

-- LabTest: lab tests listing with category filter
CREATE INDEX IF NOT EXISTS "LabTest_organizationId_isActive_testCategory_idx"
  ON "LabTest"("organizationId", "isActive", "testCategory");

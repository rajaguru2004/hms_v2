-- Patient portal identity.
--
-- A patient's record has always existed; what has never existed is any way for
-- the patient to prove it is theirs and sign in as themselves. `PATIENT` has
-- been in the role enum and the seed since the beginning, but a PATIENT user
-- could not resolve *which* patient they were, so nothing patient-scoped could
-- be enforced.
--
-- Two changes:
--
--   1. `Patient.userId` — the portal account for this record. Unique, because
--      one record is one person. Two Users pointing at one Patient is two
--      people answering as the same patient, and the self-scoping guard would
--      have no way to tell them apart.
--
--   2. `PatientPortalClaim` — one row per attempt to claim an MRN, successful
--      or not. `mrnAttempted` is stored even when it matched nothing: a run of
--      failures against sequential MRNs is the thing worth seeing, and it is
--      invisible if only successes are written. `tokenHash` never holds the
--      token itself, the same argument `RefreshToken` already makes.
--
-- No backfill. No patient has an account yet, so every existing row keeps a
-- null `userId`, which is exactly "has not claimed their record".
-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "userId" TEXT;

-- CreateTable
CREATE TABLE "PatientPortalClaim" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "mrnAttempted" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientPortalClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PatientPortalClaim_tokenHash_key" ON "PatientPortalClaim"("tokenHash");

-- CreateIndex
CREATE INDEX "PatientPortalClaim_organizationId_idx" ON "PatientPortalClaim"("organizationId");

-- CreateIndex
CREATE INDEX "PatientPortalClaim_mrnAttempted_idx" ON "PatientPortalClaim"("mrnAttempted");

-- CreateIndex
CREATE INDEX "PatientPortalClaim_status_idx" ON "PatientPortalClaim"("status");

-- CreateIndex
CREATE INDEX "PatientPortalClaim_expiresAt_idx" ON "PatientPortalClaim"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_userId_key" ON "Patient"("userId");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPortalClaim" ADD CONSTRAINT "PatientPortalClaim_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPortalClaim" ADD CONSTRAINT "PatientPortalClaim_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPortalClaim" ADD CONSTRAINT "PatientPortalClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


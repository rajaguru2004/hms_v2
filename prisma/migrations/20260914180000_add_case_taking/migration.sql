-- Patient case taking.
--
-- Six tables holding the history a patient tells before they meet a doctor,
-- everything read out of the documents they photographed, and where every
-- single fact came from.
--
-- Three choices worth explaining, because each one breaks a habit this schema
-- otherwise keeps:
--
--   1. `Json`, not `String`. Everywhere else here a JSON payload lives in a
--      `String` column. A `String` column accepts malformed JSON silently. A
--      corrupt `Consultation.attachments` loses a file URL; a corrupt
--      `CaseSession.clinicalState` loses a patient's medical history. Only
--      `PatientDocument.ocrText` stays text, because it is text.
--
--   2. `CaseFact` is append-only, with `supersededById`. A correction writes a
--      new row rather than editing one, so "the patient said no diabetes, the
--      uploaded discharge summary said diabetes, the patient then corrected
--      themselves" stays readable instead of collapsing to whatever was
--      written last.
--
--   3. `CaseFact.presence` is a required column with no default. Its six values
--      — recorded, none, unknown, not_applicable, not_assessed, declined —
--      must never collapse into each other, and the absence of a row means
--      not_assessed. There is deliberately no default that could be `none`,
--      because turning "nobody asked" into "the patient said no" fabricates a
--      negative clinical finding.
--
-- `CaseSubmission` is separate from `CaseSession` for the same reason a signed
-- document is separate from the draft: the session keeps moving afterwards, and
-- what the doctor opened has to stay what the doctor opened.

-- CreateTable
CREATE TABLE "CaseSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'new_consultation',
    "language" TEXT NOT NULL DEFAULT 'en',
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "consentGivenAt" TIMESTAMP(3),
    "consentVersion" TEXT,
    "currentSection" TEXT,
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "clinicalState" JSONB,
    "sectionStatus" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CaseSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseTurn" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "section" TEXT,
    "fieldKey" TEXT,
    "questionText" TEXT,
    "answerRaw" TEXT,
    "answerModality" TEXT,
    "transcriptConfidence" DOUBLE PRECISION,
    "audioKey" TEXT,
    "llmModel" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseFact" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "fieldPath" TEXT NOT NULL,
    "valueJson" JSONB,
    "presence" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT,
    "confidence" DOUBLE PRECISION,
    "verification" TEXT NOT NULL DEFAULT 'pending',
    "supersededById" TEXT,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseRedFlag" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "severity" TEXT NOT NULL,
    "matchedFacts" JSONB,
    "message" TEXT NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "escalationRef" TEXT,

    CONSTRAINT "CaseRedFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "sessionId" TEXT,
    "fileKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "pageCount" INTEGER NOT NULL DEFAULT 1,
    "sha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "docType" TEXT,
    "docTypeConfidence" DOUBLE PRECISION,
    "ocrEngine" TEXT,
    "ocrConfidence" DOUBLE PRECISION,
    "ocrText" TEXT,
    "ocrBlocks" JSONB,
    "extraction" JSONB,
    "extractionConfidence" DOUBLE PRECISION,
    "visionFallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "duplicateOfId" TEXT,
    "failureReason" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PatientDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseSubmission" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "structuredCase" JSONB NOT NULL,
    "consultationId" TEXT,
    "preTriageId" TEXT,
    "queueId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaseSession_organizationId_idx" ON "CaseSession"("organizationId");

-- CreateIndex
CREATE INDEX "CaseSession_patientId_idx" ON "CaseSession"("patientId");

-- CreateIndex
CREATE INDEX "CaseSession_status_idx" ON "CaseSession"("status");

-- CreateIndex
CREATE INDEX "CaseSession_isDeleted_idx" ON "CaseSession"("isDeleted");

-- CreateIndex
CREATE INDEX "CaseSession_patientId_status_idx" ON "CaseSession"("patientId", "status");

-- CreateIndex
CREATE INDEX "CaseTurn_sessionId_idx" ON "CaseTurn"("sessionId");

-- CreateIndex
CREATE INDEX "CaseTurn_fieldKey_idx" ON "CaseTurn"("fieldKey");

-- CreateIndex
CREATE UNIQUE INDEX "CaseTurn_sessionId_sequence_key" ON "CaseTurn"("sessionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "CaseFact_supersededById_key" ON "CaseFact"("supersededById");

-- CreateIndex
CREATE INDEX "CaseFact_sessionId_idx" ON "CaseFact"("sessionId");

-- CreateIndex
CREATE INDEX "CaseFact_patientId_idx" ON "CaseFact"("patientId");

-- CreateIndex
CREATE INDEX "CaseFact_sessionId_fieldPath_idx" ON "CaseFact"("sessionId", "fieldPath");

-- CreateIndex
CREATE INDEX "CaseFact_verification_idx" ON "CaseFact"("verification");

-- CreateIndex
CREATE INDEX "CaseRedFlag_sessionId_idx" ON "CaseRedFlag"("sessionId");

-- CreateIndex
CREATE INDEX "CaseRedFlag_severity_idx" ON "CaseRedFlag"("severity");

-- CreateIndex
CREATE INDEX "CaseRedFlag_ruleId_idx" ON "CaseRedFlag"("ruleId");

-- CreateIndex
CREATE INDEX "PatientDocument_organizationId_idx" ON "PatientDocument"("organizationId");

-- CreateIndex
CREATE INDEX "PatientDocument_patientId_idx" ON "PatientDocument"("patientId");

-- CreateIndex
CREATE INDEX "PatientDocument_sessionId_idx" ON "PatientDocument"("sessionId");

-- CreateIndex
CREATE INDEX "PatientDocument_sha256_idx" ON "PatientDocument"("sha256");

-- CreateIndex
CREATE INDEX "PatientDocument_status_idx" ON "PatientDocument"("status");

-- CreateIndex
CREATE INDEX "PatientDocument_isDeleted_idx" ON "PatientDocument"("isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "CaseSubmission_sessionId_key" ON "CaseSubmission"("sessionId");

-- CreateIndex
CREATE INDEX "CaseSubmission_organizationId_idx" ON "CaseSubmission"("organizationId");

-- CreateIndex
CREATE INDEX "CaseSubmission_patientId_idx" ON "CaseSubmission"("patientId");

-- CreateIndex
CREATE INDEX "CaseSubmission_submittedAt_idx" ON "CaseSubmission"("submittedAt");

-- AddForeignKey
ALTER TABLE "CaseSession" ADD CONSTRAINT "CaseSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseSession" ADD CONSTRAINT "CaseSession_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseTurn" ADD CONSTRAINT "CaseTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CaseSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseFact" ADD CONSTRAINT "CaseFact_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CaseSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseFact" ADD CONSTRAINT "CaseFact_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "CaseFact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseRedFlag" ADD CONSTRAINT "CaseRedFlag_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CaseSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDocument" ADD CONSTRAINT "PatientDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDocument" ADD CONSTRAINT "PatientDocument_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDocument" ADD CONSTRAINT "PatientDocument_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CaseSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDocument" ADD CONSTRAINT "PatientDocument_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "PatientDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseSubmission" ADD CONSTRAINT "CaseSubmission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseSubmission" ADD CONSTRAINT "CaseSubmission_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CaseSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseSubmission" ADD CONSTRAINT "CaseSubmission_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


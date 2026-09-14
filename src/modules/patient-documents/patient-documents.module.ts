import { Module } from '@nestjs/common';

import { DOCUMENT_LLM } from './llm/document-llm.port';
import { OllamaDocumentLlm } from './llm/ollama-document-llm';
import { SidecarOcrClient } from './ocr/sidecar-ocr.client';
import { PatientDocumentsController } from './patient-documents.controller';
import { PatientDocumentsRepository } from './patient-documents.repository';
import { PatientDocumentsService } from './patient-documents.service';
import { DocumentPipelineService } from './pipeline/document-pipeline.service';

/**
 * Medical Document Intelligence.
 *
 * No imports. `PrismaModule`, `AuditModule` and `StorageModule` are all
 * `@Global()`, and this module deliberately depends on no other feature module
 * — a document is read, structured and left for review without consulting
 * pharmacy, laboratory or case-taking. The one place it reaches sideways is a
 * scoped read of `CaseSession` to check that a session id belongs to the
 * patient, which is a query and not a dependency.
 *
 * ── The one binding to change ───────────────────────────────────────────────
 *
 * `DOCUMENT_LLM` is bound here to `OllamaDocumentLlm`, which is a stopgap. The
 * AI module owns model access for the platform; when its provider lands, the
 * binding becomes an adapter over it and `OllamaDocumentLlm` is deleted. The
 * contract that has to be met is `DocumentLlm` in `llm/document-llm.port.ts` —
 * two methods, one over text and one over an image, neither of which reports a
 * confidence.
 */
@Module({
  controllers: [PatientDocumentsController],
  providers: [
    PatientDocumentsService,
    PatientDocumentsRepository,
    DocumentPipelineService,
    SidecarOcrClient,
    { provide: DOCUMENT_LLM, useClass: OllamaDocumentLlm },
  ],
  exports: [PatientDocumentsService, PatientDocumentsRepository],
})
export class PatientDocumentsModule {}

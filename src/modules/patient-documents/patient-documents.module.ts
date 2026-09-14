import { Module } from '@nestjs/common';

import { CaseTakingModule } from '../case-taking/case-taking.module';
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
 * `PrismaModule`, `AuditModule` and `StorageModule` are all `@Global()`. Reading
 * and structuring a document consults no other feature module — not pharmacy,
 * not laboratory — and the check that a session id belongs to the patient is a
 * scoped query rather than a dependency.
 *
 * ── The one feature module this does import, and why
 *
 * `CaseTakingModule`, for `CaseTakingRepository.recordFact`. A patient
 * correcting a value on a document attached to an interview is replacing a
 * clinical assertion, and there is exactly one mechanism in this codebase
 * allowed to do that: write a new `CaseFact` and point the old one at it, in a
 * transaction. Writing a second copy of that here would be a second mechanism
 * for one idea, and the two would drift the first time one of them learned
 * something the other did not. The dependency runs one way only —
 * `CaseTakingModule` imports `AiModule` and nothing from here — so there is no
 * cycle to break later.
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
  imports: [CaseTakingModule],
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

import { Module } from '@nestjs/common';
import { OllamaProvider } from './ollama.provider';
import { SidecarClient } from './sidecar.client';
import { MedicationMatcher } from './medication-matcher.service';
import { LLM_PROVIDER } from './llm-provider.interface';

/**
 * Everything that talks to a model, and nothing that decides anything.
 *
 * Exported as a module rather than wired into case-taking directly because the
 * medical-document stream needs the same three services — the same provider for
 * OCR-text extraction and the vision fallback, the same sidecar for the OCR
 * itself, the same matcher for the drug names on a prescription. Two copies of
 * the extraction rules is one copy that gets the `presence` field back.
 *
 * `LLM_PROVIDER` is a string token because the thing being injected is an
 * interface, and because a concrete class as the token invites an `instanceof`
 * somewhere that then cannot be given a stub in a test.
 */
@Module({
  providers: [
    OllamaProvider,
    { provide: LLM_PROVIDER, useExisting: OllamaProvider },
    SidecarClient,
    MedicationMatcher,
  ],
  exports: [LLM_PROVIDER, OllamaProvider, SidecarClient, MedicationMatcher],
})
export class AiModule {}

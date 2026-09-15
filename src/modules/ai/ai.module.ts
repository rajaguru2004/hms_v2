import { Module } from '@nestjs/common';
import { OllamaProvider } from './ollama.provider';
import { OllamaTranslationProvider } from './ollama-translation.provider';
import { SidecarClient } from './sidecar.client';
import { MedicationMatcher } from './medication-matcher.service';
import { LLM_PROVIDER } from './llm-provider.interface';
import { TRANSLATION_PROVIDER } from './translation-provider.interface';

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
 * somewhere that then cannot be given a stub in a test. `TRANSLATION_PROVIDER`
 * is a second token rather than another method on the first because the two
 * seams point at different servers — extraction at Ollama's default port, the
 * translator at 8080 — and a single provider would have hidden that behind one
 * `isAvailable`.
 */
@Module({
  providers: [
    OllamaProvider,
    { provide: LLM_PROVIDER, useExisting: OllamaProvider },
    OllamaTranslationProvider,
    { provide: TRANSLATION_PROVIDER, useExisting: OllamaTranslationProvider },
    SidecarClient,
    MedicationMatcher,
  ],
  exports: [
    LLM_PROVIDER,
    TRANSLATION_PROVIDER,
    OllamaProvider,
    OllamaTranslationProvider,
    SidecarClient,
    MedicationMatcher,
  ],
})
export class AiModule {}

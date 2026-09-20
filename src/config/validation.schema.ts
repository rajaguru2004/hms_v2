import * as Joi from 'joi';

/**
 * Environment variable validation schema using Joi.
 * Application FAILS at startup if any required variable is missing or invalid.
 * This prevents silent misconfigurations in staging/production.
 */
export const validationSchema = Joi.object({
  // App
  NODE_ENV: Joi.string()
    .valid('development', 'staging', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  APP_NAME: Joi.string().default('HMS v2'),
  APP_VERSION: Joi.string().default('2.0.0'),
  API_PREFIX: Joi.string().default('api'),
  CORS_ORIGINS: Joi.string().default('http://localhost:3000'),

  // Database — REQUIRED
  DATABASE_URL: Joi.string()
    .required()
    .description('PostgreSQL connection string'),

  // JWT — REQUIRED
  JWT_SECRET: Joi.string()
    .min(32)
    .required()
    .description('JWT signing secret (min 32 chars)'),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).optional(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // Redis
  REDIS_ENABLED: Joi.string().valid('true', 'false').default('true'),
  REDIS_HOST: Joi.string().optional().description('Redis server hostname'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().optional().allow(''),
  REDIS_TTL: Joi.number().default(300),
  REDIS_DB: Joi.number().default(0),

  // Optional tuning
  DB_CONNECTION_TIMEOUT: Joi.number().default(10000),
  DB_POOL_MIN: Joi.number().default(2),
  DB_POOL_MAX: Joi.number().default(10),

  // S3
  S3_ENDPOINT: Joi.string()
    .optional()
    .default('https://hms.s3.skillhiveinnovations.com'),
  S3_BUCKET: Joi.string().optional().default('hmsbucket'),
  S3_ACCESS_KEY: Joi.string().optional(),
  S3_SECRET_KEY: Joi.string().optional(),

  // Local AI — every one of these is optional with a default, on purpose.
  //
  // Nothing in the case-taking feature requires a model to be reachable: the
  // question selector is pure and synchronous, the safety engine is versioned
  // data, and presence is derived by code. A box with no Ollama and no sidecar
  // runs the interview as a plain questionnaire with typed answers, which is
  // §42's offline mode and is a degradation rather than a failure. Making any
  // of these required would turn "the model is not installed here" into "the
  // hospital API will not boot".
  OLLAMA_URL: Joi.string().optional().default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: Joi.string().optional().default('gemma3:4b'),
  AI_SIDECAR_URL: Joi.string().optional().default('http://127.0.0.1:8801'),
  AI_ENABLED: Joi.string().valid('true', 'false').default('true'),
  // Generous by web standards and tight by this model's: a long extraction
  // measured twenty seconds warm, seventy-four cold. It exists so a wedged
  // model releases the request, not to make the call fast.
  AI_TIMEOUT_MS: Joi.number().default(90000),

  // Whether the medical-document pipeline may call a language model at all.
  //
  // Separate from AI_ENABLED because the two answer different questions. That
  // one is the platform's master switch: it also gates `SidecarClient`, whose
  // Whisper and Piper models are CPU-capable and are what make the voice
  // interview work. Turning AI_ENABLED off to spare a GPU-less box the cost of
  // a language model takes speech-to-text and text-to-speech down with it, for
  // a saving that this flag makes on its own.
  //
  // Document OCR is NOT affected by either flag, and the asymmetry is worth
  // knowing rather than discovering. The document pipeline reads through
  // `SidecarOcrClient`, which has its own `MEDIHIVE_SIDECAR_URL` and no enable
  // gate; `SidecarClient` — the gated one — is used only by case-taking. So a
  // box with every AI flag off still OCRs uploaded documents and still parses
  // them deterministically. That is the degradation this design is for.
  //
  // Off, the pipeline runs deterministic extraction alone: `rules-extractor.ts`
  // reads a printed prescription or lab report end to end with no model, and
  // says on the row how much of the page it accounted for. It does not fail,
  // and it does not claim to have read what it did not — the envelope carries
  // `extractionMethod` and `escalation.modelEnabled` so that "switched off
  // here" stays distinguishable from "tried and broke" a month later.
  MEDIHIVE_DOCUMENT_LLM_ENABLED: Joi.string()
    .valid('true', 'false')
    .default('true'),

  // The §9 vision fallback, separately, and the first thing to turn off on a
  // box with no accelerator. It is the most expensive call in the feature —
  // the whole page as pixels through a 4B model — and unlike text extraction
  // there is no deterministic path behind it, so on a GPU-less box it buys a
  // minutes-long spinner and then a transcript nobody should store anyway.
  MEDIHIVE_DOCUMENT_VISION_ENABLED: Joi.string()
    .valid('true', 'false')
    .default('true'),

  // Whether an unreviewed question translation may be spoken to a patient.
  //
  // Declared here so it is documented in one place and so a misspelt value is a
  // boot failure rather than a flag that is silently off. It is read in
  // `case-taking/engine/phrasebook.ts` rather than through ConfigService, for
  // the reason set out there: the question selector is a pure synchronous
  // function with no injector, and `load-env.ts` already guarantees the
  // variable is populated before it is imported.
  //
  // `false` is the default and the only value a deployment with real patients
  // should carry. `true` opens the gate on every phrasebook whose `reviewedAt`
  // is null — today Hindi (machine-drafted, complete) and Tamil (hand-drafted,
  // four questions) — so that a translation can be proved end to end before a
  // clinician is asked to review it. It never counts as a review, and the boot
  // log names every language it is serving unreviewed.
  MEDIHIVE_ALLOW_UNREVIEWED_PHRASEBOOKS: Joi.string()
    .valid('true', 'false')
    .default('false'),

  // ── LiveKit, for the streaming voice session ────────────────────────────────
  //
  // Optional, all three, and deliberately so: a box with no media server still
  // boots and still runs a complete interview. The patient taps, types, or
  // records-and-uploads exactly as before, and the room is an enhancement that
  // simply never opens. Making these required would let a missing third-party
  // credential stop a hospital taking a history.
  //
  // The SECRET is read here and never leaves the server. The phone is issued a
  // short-lived room token minted against its own bearer token; it never sees
  // the key or the secret, because a credential shipped inside an APK is a
  // credential held by anyone who has the APK.
  LIVEKIT_URL: Joi.string()
    .uri({ scheme: ['ws', 'wss'] })
    .optional(),
  LIVEKIT_API_KEY: Joi.string().optional(),
  LIVEKIT_API_SECRET: Joi.string().optional(),
});

export const validationOptions = {
  allowUnknown: true, // pass-through unknown vars (e.g., CI injected)
  abortEarly: false, // report ALL missing vars at once, not just first
};

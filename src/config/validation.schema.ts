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
});

export const validationOptions = {
  allowUnknown: true, // pass-through unknown vars (e.g., CI injected)
  abortEarly: false, // report ALL missing vars at once, not just first
};

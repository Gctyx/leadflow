import { z } from 'zod';

const csv = (min: number) =>
  z
    .string()
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.string().min(min, `cada valor precisa ter ao menos ${min} caracteres`)).min(1));

const bool = (def: boolean) =>
  z
    .string()
    .default(String(def))
    .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: bool(false),
  DEFAULT_PHONE_REGION: z.string().length(2).default('BR'),
  DOCS_ENABLED: bool(true),

  DATABASE_URL: z.string().min(1),
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),

  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  REDIS_STREAM_KEY: z.string().default('leadflow:webhooks'),
  REDIS_STREAM_GROUP: z.string().default('leadflow-workers'),

  API_KEYS: csv(16),
  WEBHOOK_SECRETS: csv(16),
  WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(30).default(300),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_API_MAX: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_WEBHOOK_MAX: z.coerce.number().int().min(1).default(600),

  WORKER_INLINE: bool(true),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  WEBHOOK_BACKOFF_BASE_MS: z.coerce.number().int().min(1).default(2000),
  WEBHOOK_BACKOFF_MAX_MS: z.coerce.number().int().min(1).default(300_000),
  WEBHOOK_LOCK_SECONDS: z.coerce.number().int().min(5).default(60),
  WORKER_SWEEP_INTERVAL_MS: z.coerce.number().int().min(100).default(5000),
  WORKER_BATCH: z.coerce.number().int().min(1).max(100).default(10),

  // --- Admin auth ---
  ADMIN_JWT_PRIVATE_JWK: z.string().transform((s) => {
    try { return JSON.parse(s); } catch { throw new Error('ADMIN_JWT_PRIVATE_JWK inválido (JSON)'); }
  }),
  ADMIN_JWT_AUDIENCE: z.string().min(3).default('leadflow-admin'),
  ADMIN_ACCESS_TTL_SECONDS: z.coerce.number().int().min(120).max(3600).default(600),
  ADMIN_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  ADMIN_MFA_REQUIRED: bool(true),
  ADMIN_AT_REST_KEY: z.string().min(64, 'ADMIN_AT_REST_KEY: forneça chave hex >= 32 bytes (64 hex chars)'),

  // OAuth providers (opcionais)
  ADMIN_OAUTH_GOOGLE_CLIENT_ID: z.string().optional(),
  ADMIN_OAUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),
  ADMIN_OAUTH_GOOGLE_ISSUER: z.string().url().optional(),
  ADMIN_OAUTH_MICROSOFT_CLIENT_ID: z.string().optional(),
  ADMIN_OAUTH_MICROSOFT_CLIENT_SECRET: z.string().optional(),
  ADMIN_OAUTH_MICROSOFT_ISSUER: z.string().url().optional(),
  ADMIN_OAUTH_GITHUB_CLIENT_ID: z.string().optional(),
  ADMIN_OAUTH_GITHUB_CLIENT_SECRET: z.string().optional(),
  ADMIN_OAUTH_GITHUB_ISSUER: z.string().url().optional(),
});

export type Config = z.infer<typeof schema>;

/** Valida o ambiente na inicialização (fail-fast): a aplicação não sobe com configuração inválida. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração inválida -> ${msg}`);
  }
  return parsed.data;
}

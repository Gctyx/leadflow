import mysql from 'mysql2/promise';
import request from 'supertest';
import { loadConfig, Config } from '../src/config';
import { buildContainer, Container } from '../src/container';
import { createApp } from '../src/app';
import { migrate } from '../src/infra/migrate';
import { signPayload } from '../src/security/signature';

export const API_KEY = 'test-api-key-0123456789';
export const SECRET = 'test-webhook-secret-0123456789';
export const OLD_SECRET = 'old-webhook-secret-0123456789';

const dbUrl = process.env.TEST_DATABASE_URL ?? 'mysql://root:root@127.0.0.1:3306/leadflow_test';
const redisUrl = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15';

export function testEnv(over: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: dbUrl,
    REDIS_URL: redisUrl,
    REDIS_STREAM_KEY: `leadflow:test:${process.pid}`,
    API_KEYS: API_KEY,
    WEBHOOK_SECRETS: `${SECRET},${OLD_SECRET}`,
    RATE_LIMIT_API_MAX: '100000',
    RATE_LIMIT_WEBHOOK_MAX: '100000',
    WORKER_INLINE: 'false',
    WEBHOOK_BACKOFF_BASE_MS: '10',
    ...over,
  } as NodeJS.ProcessEnv;
}

async function ensureDatabase(url: string) {
  const u = new URL(url);
  const conn = await mysql.createConnection({ host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) });
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${u.pathname.slice(1)}\``);
  await conn.end();
}

export interface Ctx { c: Container; app: ReturnType<typeof createApp>; config: Config }

export async function setup(over: Record<string, string> = {}): Promise<Ctx> {
  const config = loadConfig(testEnv(over));
  await ensureDatabase(config.DATABASE_URL);
  await migrate(config.DATABASE_URL, undefined, () => undefined);
  const c = buildContainer(config);
  await c.queue.init();
  return { c, app: createApp(c), config };
}

export async function reset(c: Container): Promise<void> {
  for (const t of ['lead_events', 'webhook_events', 'leads', 'sellers']) await c.pool.query(`DELETE FROM ${t}`);
  await c.redis.del(c.config.REDIS_STREAM_KEY).catch(() => undefined);
  await c.queue.init();
}

export const api = (ctx: Ctx) => ({
  post: (path: string, body?: object) => request(ctx.app).post(`/api/v1${path}`).set('x-api-key', API_KEY).send(body),
  get: (path: string) => request(ctx.app).get(`/api/v1${path}`).set('x-api-key', API_KEY),
  patch: (path: string, body?: object) => request(ctx.app).patch(`/api/v1${path}`).set('x-api-key', API_KEY).send(body),
});

let phoneSeq = 0;
/** Gera celulares BR válidos e distintos (11 9XXXX-XXXX). */
export const uniquePhone = () => `(11) 9${String(8000 + ++phoneSeq).padStart(4, '0')}-${String(1000 + phoneSeq).padStart(4, '0')}`;

export function webhookEnvelope(over: Record<string, unknown> = {}, data: Record<string, unknown> = {}) {
  return {
    event_id: `evt_${Math.random().toString(36).slice(2, 12)}`,
    source: 'landing_page',
    data: { name: 'Ana Souza', phone: uniquePhone(), ...data },
    ...over,
  };
}

export function signedWebhook(ctx: Ctx, body: object, o: { secret?: string; timestamp?: number; raw?: string; signature?: string } = {}) {
  const raw = o.raw ?? JSON.stringify(body);
  const ts = o.timestamp ?? Math.floor(Date.now() / 1000);
  const sig = o.signature ?? `v1=${signPayload(o.secret ?? SECRET, ts, raw)}`;
  return request(ctx.app)
    .post('/api/v1/webhooks/leads')
    .set('content-type', 'application/json')
    .set('x-leadflow-timestamp', String(ts))
    .set('x-leadflow-signature', sig)
    .send(raw);
}

export async function createSeller(ctx: Ctx, name: string, active = true) {
  const res = await api(ctx).post('/sellers', { name, email: `${name.toLowerCase().replace(/\W/g, '')}.${Math.random().toString(36).slice(2, 8)}@example.com`, active });
  if (res.status !== 201) throw new Error(`seller falhou: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; active: boolean };
}

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signPayload } from '../../src/security/signature';
import { createSeller, Ctx, OLD_SECRET, reset, SECRET, setup, signedWebhook, uniquePhone, webhookEnvelope } from '../helpers';

const signedHeader = (raw: string) => `v1=${signPayload(SECRET, Math.floor(Date.now() / 1000), raw)}`;

let ctx: Ctx;
beforeAll(async () => { ctx = await setup({ WEBHOOK_MAX_ATTEMPTS: '3' }); });
afterAll(async () => { await ctx.c.close(); });
beforeEach(async () => { await reset(ctx.c); });
afterEach(() => { vi.restoreAllMocks(); });

const q = async (sql: string, params: unknown[] = []) => (await ctx.c.pool.query<any[]>(sql, params))[0];
const eventRow = async (id: string) => (await q('SELECT * FROM webhook_events WHERE id = ?', [id]))[0];
const leadCount = async () => Number((await q('SELECT COUNT(*) n FROM leads'))[0].n);
const drain = async () => { await ctx.c.worker.consumeOnce(200); };

describe('segurança do webhook', () => {
  const body = () => webhookEnvelope();

  it('rejeita sem assinatura, assinatura inválida, corpo adulterado e timestamp antigo (401 genérico)', async () => {
    const b = body();
    const raw = JSON.stringify(b);
    const results = await Promise.all([
      signedWebhook(ctx, b, { signature: 'v1=' + '0'.repeat(64) }),
      signedWebhook(ctx, b, { secret: 'segredo-incorreto-0123456789' }),
      signedWebhook(ctx, b, { timestamp: Math.floor(Date.now() / 1000) - 3600 }),
      // assinatura calculada sobre o corpo original, mas enviado com o corpo alterado
      signedWebhook(ctx, b, { raw: raw.replace('Ana', 'Eva'), signature: signedHeader(raw) }),
    ]);
    for (const r of results) {
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('UNAUTHORIZED');
      expect(r.body.error.message).not.toMatch(/assinatura|signature|timestamp/i); // não revela o motivo
    }
    expect(await leadCount()).toBe(0);
    expect((await q('SELECT COUNT(*) n FROM webhook_events'))[0].n).toBe(0);
  });

  it('aceita o segredo anterior durante a rotação', async () => {
    expect((await signedWebhook(ctx, body(), { secret: OLD_SECRET })).status).toBe(202);
  });

  it('valida o envelope (campos extras, telefone inválido) com 422 e não persiste nada', async () => {
    expect((await signedWebhook(ctx, { ...body(), extra: 1 })).status).toBe(422);
    expect((await signedWebhook(ctx, webhookEnvelope({}, { phone: '123' }))).status).toBe(422);
    expect((await signedWebhook(ctx, webhookEnvelope({ event_id: 'x' }))).status).toBe(422);
    expect((await q('SELECT COUNT(*) n FROM webhook_events'))[0].n).toBe(0);
  });
});

describe('recebimento, idempotência e processamento', () => {
  it('responde 202, grava no inbox, enfileira no Redis e o worker cria o lead atribuído', async () => {
    const seller = await createSeller(ctx, 'Carlos');
    const env = webhookEnvelope({}, { email: 'Ana@Example.com' });
    const res = await signedWebhook(ctx, env);
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('accepted');

    expect((await eventRow(res.body.event_id)).status).toBe('pending');
    expect(await ctx.c.redis.xlen(ctx.config.REDIS_STREAM_KEY)).toBe(1);

    await drain();
    const ev = await eventRow(res.body.event_id);
    expect(ev.status).toBe('processed');
    expect(ev.attempts).toBe(1);
    const lead = (await q('SELECT * FROM leads WHERE id = ?', [ev.lead_id]))[0];
    expect(lead).toMatchObject({ channel: 'webhook', origin: 'landing_page', seller_id: seller.id, status: 'assigned', email: 'ana@example.com' });
    const events = await q('SELECT type, channel, webhook_event_id FROM lead_events WHERE lead_id = ? ORDER BY seq', [lead.id]);
    expect(events.map((e: any) => e.type)).toEqual(['lead.created', 'lead.assigned']);
    expect(events[0].webhook_event_id).toBe(res.body.event_id);
    expect(await ctx.c.redis.xlen(ctx.config.REDIS_STREAM_KEY)).toBe(0); // ACK + XDEL
  });

  it('reentrega do mesmo evento => 200 duplicate, sem novo lead; mesmo event_id com conteúdo diferente => 409', async () => {
    const env = webhookEnvelope();
    const first = await signedWebhook(ctx, env);
    const replay = await signedWebhook(ctx, JSON.parse(JSON.stringify(env)));
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ status: 'duplicate', event_id: first.body.event_id });
    const tampered = await signedWebhook(ctx, { ...env, data: { ...env.data, name: 'Outro Nome' } });
    expect(tampered.status).toBe(409);
    expect(tampered.body.error.code).toBe('EVENT_ID_REUSED');
    await drain();
    expect(await leadCount()).toBe(1);
  });

  it('CONCORRÊNCIA: 20 entregas simultâneas do mesmo evento => 1 linha no inbox e 1 lead', async () => {
    const env = webhookEnvelope();
    const results = await Promise.all(Array.from({ length: 20 }, () => signedWebhook(ctx, env)));
    expect(results.filter((r) => r.status === 202)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(20 - 1);
    await drain();
    await drain();
    expect(await leadCount()).toBe(1);
    expect((await q('SELECT COUNT(*) n FROM webhook_events'))[0].n).toBe(1);
  });

  it('CONCORRÊNCIA: eventos diferentes com o MESMO telefone => 1 lead, o restante vira `duplicate`', async () => {
    const phone = uniquePhone();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await signedWebhook(ctx, webhookEnvelope({}, { phone }))).body.event_id);
    await Promise.all([ctx.c.worker.consumeOnce(200), ctx.c.worker.consumeOnce(200)]); // dois "workers" disputando
    const statuses = (await Promise.all(ids.map(async (id) => (await eventRow(id)).status))).sort();
    expect(statuses.filter((s) => s === 'processed')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'duplicate')).toHaveLength(5);
    expect(await leadCount()).toBe(1);
  });

  it('mensagem entregue em duplicidade pelo Redis é neutralizada pelo claim atômico', async () => {
    const res = await signedWebhook(ctx, webhookEnvelope());
    await ctx.c.queue.enqueue(res.body.event_id); // duplicata no stream
    await drain();
    expect(await leadCount()).toBe(1);
    expect((await eventRow(res.body.event_id)).attempts).toBe(1);
  });
});

describe('resiliência', () => {
  it('Redis indisponível na recepção: ainda responde 202 e o worker processa direto do MySQL (modo degradado)', async () => {
    vi.spyOn(ctx.c.queue, 'enqueue').mockRejectedValue(new Error('redis down'));
    vi.spyOn(ctx.c.queue, 'claimStale').mockRejectedValue(new Error('redis down'));
    const res = await signedWebhook(ctx, webhookEnvelope());
    expect(res.status).toBe(202);
    expect((await eventRow(res.body.event_id)).enqueued_at).toBeNull();

    await ctx.c.worker.maintenanceTick();
    expect((await eventRow(res.body.event_id)).status).toBe('processed');
    expect(await leadCount()).toBe(1);
  });

  it('mensagem perdida no Redis: a varredura re-enfileira o evento pendente do MySQL', async () => {
    const res = await signedWebhook(ctx, webhookEnvelope());
    await ctx.c.redis.del(ctx.config.REDIS_STREAM_KEY); // Redis "perdeu" a fila
    await ctx.c.queue.init();
    await ctx.c.pool.query('UPDATE webhook_events SET enqueued_at = DATE_SUB(NOW(6), INTERVAL 5 MINUTE) WHERE id = ?', [res.body.event_id]);
    await ctx.c.worker.maintenanceTick(); // re-enfileira
    await drain();
    expect((await eventRow(res.body.event_id)).status).toBe('processed');
  });

  it('falha transitória => retry com backoff; esgotadas as tentativas => dead (sem criar lead)', async () => {
    vi.spyOn(ctx.c.leadService, 'create').mockRejectedValue(Object.assign(new Error('boom'), { code: 'ER_LOCK_WAIT_TIMEOUT' }));
    const id = (await signedWebhook(ctx, webhookEnvelope())).body.event_id;

    expect(await ctx.c.processor.process(id)).toBe('retry');
    let ev = await eventRow(id);
    expect(ev).toMatchObject({ status: 'pending', attempts: 1, last_error: 'ER_LOCK_WAIT_TIMEOUT' });
    expect(ev.enqueued_at).toBeNull();

    expect(await ctx.c.processor.process(id)).toBe('skipped'); // ainda não venceu o backoff

    for (const expected of ['retry', 'dead']) {
      await ctx.c.pool.query('UPDATE webhook_events SET next_attempt_at = DATE_SUB(NOW(6), INTERVAL 1 SECOND) WHERE id = ?', [id]);
      expect(await ctx.c.processor.process(id)).toBe(expected);
    }
    ev = await eventRow(id);
    expect(ev).toMatchObject({ status: 'dead', attempts: 3 });
    expect(await leadCount()).toBe(0);
  });

  it('worker que morreu no meio: evento `processing` com lock expirado é retomado pela varredura', async () => {
    const id = (await signedWebhook(ctx, webhookEnvelope())).body.event_id;
    await ctx.c.pool.query("UPDATE webhook_events SET status='processing', attempts=1, locked_until = DATE_SUB(NOW(6), INTERVAL 1 MINUTE) WHERE id = ?", [id]);
    await ctx.c.worker.maintenanceTick();
    await drain();
    expect(await eventRow(id)).toMatchObject({ status: 'processed', attempts: 2 });
    expect(await leadCount()).toBe(1);
  });

  it('evento "veneno" que excede as tentativas por crash é movido para dead', async () => {
    const id = (await signedWebhook(ctx, webhookEnvelope())).body.event_id;
    await ctx.c.pool.query("UPDATE webhook_events SET status='processing', attempts=3, locked_until = DATE_SUB(NOW(6), INTERVAL 1 MINUTE) WHERE id = ?", [id]);
    expect(await ctx.c.processor.process(id)).toBe('dead');
    expect(await leadCount()).toBe(0);
  });

  it('MySQL indisponível na recepção => 503 com Retry-After (o emissor deve reenviar)', async () => {
    vi.spyOn(ctx.c.webhookIngest, 'ingest').mockRejectedValue(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }));
    const res = await signedWebhook(ctx, webhookEnvelope());
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
  });
});

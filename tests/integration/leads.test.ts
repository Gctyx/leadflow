import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { api, createSeller, Ctx, reset, setup, uniquePhone } from '../helpers';

let ctx: Ctx;
beforeAll(async () => { ctx = await setup(); });
afterAll(async () => { await ctx.c.close(); });
beforeEach(async () => { await reset(ctx.c); });

const count = async (table: string, where = '1=1') => {
  const [rows] = await ctx.c.pool.query<any[]>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`);
  return Number(rows[0].n);
};

describe('autenticação e formato de erro', () => {
  it('exige X-API-Key válida', async () => {
    expect((await request(ctx.app).get('/api/v1/leads')).status).toBe(401);
    const bad = await request(ctx.app).get('/api/v1/leads').set('x-api-key', 'chave-errada-1234567890');
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('UNAUTHORIZED');
  });

  it('não vaza detalhes internos em 404/422 e devolve request_id', async () => {
    const nf = await api(ctx).get('/leads/6f9619ff-8b86-d011-b42d-00c04fc964ff');
    expect(nf.status).toBe(404);
    expect(JSON.stringify(nf.body)).not.toMatch(/stack|sql|mysql|select/i);
    expect(nf.body.error.request_id).toBeTruthy();
    expect((await api(ctx).get('/leads/1')).status).toBe(422); // id sequencial/enumerável não é aceito
  });

  it('aplica rate limit com Retry-After', async () => {
    const limited = await setup({ RATE_LIMIT_API_MAX: '3', REDIS_STREAM_KEY: 'leadflow:test:rl' });
    await limited.c.redis.del(...(await limited.c.redis.keys('leadflow:rl:*')));
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await request(limited.app).get('/api/v1/leads').set('x-api-key', 'test-api-key-0123456789')).status);
    expect(codes.slice(0, 3)).toEqual([200, 200, 200]);
    expect(codes.slice(3)).toEqual([429, 429]);
    await limited.c.close();
  });
});

describe('validação de entrada', () => {
  it.each([
    ['telefone inválido', { name: 'Ana', phone: '123' }],
    ['campo desconhecido (mass assignment)', { name: 'Ana', phone: '(11) 91234-5678', status: 'assigned' }],
    ['e-mail inválido', { name: 'Ana', phone: '(11) 91234-5678', email: 'nao-e-email' }],
    ['nome com caractere de controle', { name: 'An\u0000a', phone: '(11) 91234-5678' }],
    ['nome curto', { name: 'A', phone: '(11) 91234-5678' }],
  ])('rejeita %s com 422', async (_t, body) => {
    const res = await api(ctx).post('/leads', body);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await count('leads')).toBe(0);
  });

  it('rejeita JSON malformado com 400 e corpo gigante com 413', async () => {
    const bad = await request(ctx.app).post('/api/v1/leads').set('x-api-key', 'test-api-key-0123456789').set('content-type', 'application/json').send('{oops');
    expect(bad.status).toBe(400);
    const big = await api(ctx).post('/leads', { name: 'Ana', phone: '(11) 91234-5678', notes: 'x'.repeat(80_000) });
    expect(big.status).toBe(413);
  });

  it('rejeita cursor e filtros inválidos', async () => {
    expect((await api(ctx).get('/leads?cursor=Zm9v')).status).toBe(422);
    expect((await api(ctx).get('/leads?limit=1000')).status).toBe(422);
    expect((await api(ctx).get('/leads?status=hack')).status).toBe(422);
  });
});

describe('criação, consulta, filtros e paginação', () => {
  it('cria lead, atribui ao vendedor ativo e registra a trilha de auditoria', async () => {
    const seller = await createSeller(ctx, 'Carlos');
    const res = await api(ctx).post('/leads', { name: 'Ana Souza', phone: '(11) 91234-5678', email: 'ANA@Example.com', origin: 'meta_ads' });
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/v1/leads/${res.body.id}`);
    expect(res.body).toMatchObject({ phone: '+5511912345678', email: 'ana@example.com', status: 'assigned', seller_id: seller.id, channel: 'api' });
    expect(res.body.seq).toBeUndefined(); // id sequencial interno não é exposto

    const get = await api(ctx).get(`/leads/${res.body.id}`);
    expect(get.status).toBe(200);
    expect(get.body.id).toBe(res.body.id);

    const events = await api(ctx).get(`/leads/${res.body.id}/events`);
    expect(events.body.data.map((e: any) => e.type)).toEqual(['lead.created', 'lead.assigned']);
    expect(events.body.data[1]).toMatchObject({ seller_id: seller.id, metadata: { strategy: 'round_robin' } });
  });

  it('lista com filtros e pagina por cursor sem repetir nem perder itens', async () => {
    const s1 = await createSeller(ctx, 'Carlos');
    const created: string[] = [];
    for (let i = 0; i < 7; i++) created.push((await api(ctx).post('/leads', { name: `Lead ${i}`, phone: uniquePhone(), origin: i % 2 ? 'ads_a' : 'ads_b' })).body.id);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: any = await api(ctx).get(`/leads?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.data.map((l: any) => l.id));
      cursor = res.body.page.next_cursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual([...created].reverse()); // mais recentes primeiro
    expect(new Set(seen).size).toBe(7);

    expect((await api(ctx).get('/leads?origin=ads_a')).body.data).toHaveLength(3);
    expect((await api(ctx).get(`/leads?seller_id=${s1.id}&status=assigned`)).body.data).toHaveLength(7);
    expect((await api(ctx).get('/leads?name=Lead%203')).body.data).toHaveLength(1);
    expect((await api(ctx).get('/leads?name=%25')).body.data).toHaveLength(0); // % é escapado (não vira curinga)
    const first = (await api(ctx).get(`/leads/${created[0]}`)).body;
    expect((await api(ctx).get(`/leads?phone=${encodeURIComponent(first.phone)}`)).body.data).toHaveLength(1);
  });
});

describe('deduplicação e concorrência', () => {
  it('rejeita o mesmo telefone em formatos diferentes (409) apontando o lead existente', async () => {
    const first = await api(ctx).post('/leads', { name: 'Ana', phone: '(11) 91234-5678' });
    for (const phone of ['11912345678', '+55 11 91234-5678', '+5511912345678']) {
      const dup = await api(ctx).post('/leads', { name: 'Outra Pessoa', phone });
      expect(dup.status).toBe(409);
      expect(dup.body.error).toMatchObject({ code: 'LEAD_ALREADY_EXISTS', details: { lead_id: first.body.id } });
    }
    expect(await count('leads')).toBe(1);
    const types = (await api(ctx).get(`/leads/${first.body.id}/events`)).body.data.map((e: any) => e.type);
    expect(types.filter((t: string) => t === 'lead.duplicate_attempt')).toHaveLength(3);
  });

  it('CONCORRÊNCIA: 30 requisições simultâneas com o mesmo telefone => exatamente 1 lead', async () => {
    await createSeller(ctx, 'Carlos');
    await createSeller(ctx, 'Beatriz');
    const formats = ['(11) 91234-5678', '11912345678', '+55 11 91234-5678', '+5511912345678'];
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => api(ctx).post('/leads', { name: `Tentativa ${i}`, phone: formats[i % formats.length] })),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(29);
    expect(await count('leads')).toBe(1);
    expect(await count('lead_events', "type = 'lead.created'")).toBe(1);
    expect(await count('lead_events', "type = 'lead.assigned'")).toBe(1);
  });
});

describe('distribuição', () => {
  it('round-robin estrito entre vendedores ativos; inativos nunca recebem', async () => {
    const a = await createSeller(ctx, 'Ana');
    const b = await createSeller(ctx, 'Bruno');
    const c = await createSeller(ctx, 'Caio');
    const off = await createSeller(ctx, 'Diego', false);
    const owners: string[] = [];
    for (let i = 0; i < 9; i++) owners.push((await api(ctx).post('/leads', { name: `Lead ${i}`, phone: uniquePhone() })).body.seller_id);
    for (const s of [a, b, c]) expect(owners.filter((o) => o === s.id)).toHaveLength(3);
    expect(owners).not.toContain(off.id);
    expect(new Set(owners.slice(0, 3)).size).toBe(3); // cada ciclo passa por todos
  });

  it('desativar um vendedor tira ele da rotação (PATCH) e reativar devolve', async () => {
    const a = await createSeller(ctx, 'Ana');
    const b = await createSeller(ctx, 'Bruno');
    expect((await api(ctx).patch(`/sellers/${a.id}`, { active: false })).body.active).toBe(false);
    for (let i = 0; i < 4; i++) expect((await api(ctx).post('/leads', { name: `Lead ${i}`, phone: uniquePhone() })).body.seller_id).toBe(b.id);
    expect((await api(ctx).patch(`/sellers/${a.id}`, { active: true })).body.active).toBe(true);
    const next = [(await api(ctx).post('/leads', { name: 'Lead X', phone: uniquePhone() })).body.seller_id];
    expect(next[0]).toBe(a.id); // nunca atribuído desde a reativação => vez dele
    expect((await api(ctx).patch('/sellers/6f9619ff-8b86-d011-b42d-00c04fc964ff', { active: true })).status).toBe(404);
    expect((await api(ctx).patch(`/sellers/${a.id}`, { active: 'sim' })).status).toBe(422);
  });

  it('sem vendedor ativo o lead fica unassigned e é atribuído quando um vendedor é ativado', async () => {
    const lead = await api(ctx).post('/leads', { name: 'Ana', phone: uniquePhone() });
    expect(lead.status).toBe(201);
    expect(lead.body).toMatchObject({ status: 'unassigned', seller_id: null });
    const seller = await createSeller(ctx, 'Carlos');
    const after = await api(ctx).get(`/leads/${lead.body.id}`);
    expect(after.body).toMatchObject({ status: 'assigned', seller_id: seller.id });
    const types = (await api(ctx).get(`/leads/${lead.body.id}/events`)).body.data;
    expect(types.map((e: any) => e.type)).toEqual(['lead.created', 'lead.assigned']);
    expect(types[1].channel).toBe('system');
  });

  it('CONCORRÊNCIA: 40 leads distintos em paralelo => nenhum perdido, todos atribuídos, distribuição equilibrada', async () => {
    const sellers = [await createSeller(ctx, 'Ana'), await createSeller(ctx, 'Bruno'), await createSeller(ctx, 'Caio')];
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => api(ctx).post('/leads', { name: `Lead ${i}`, phone: uniquePhone() })));
    expect(results.every((r) => r.status === 201 && r.body.status === 'assigned')).toBe(true);
    expect(await count('leads')).toBe(40);
    const per = sellers.map((s) => results.filter((r) => r.body.seller_id === s.id).length);
    expect(per.reduce((x, y) => x + y, 0)).toBe(40);
    expect(Math.max(...per) - Math.min(...per)).toBeLessThanOrEqual(6);
    expect(Math.min(...per)).toBeGreaterThanOrEqual(8);
  });

  it('vendedores: e-mail duplicado => 409; listagem filtra por ativo', async () => {
    const body = { name: 'Ana', email: 'ana@example.com' };
    expect((await api(ctx).post('/sellers', body)).status).toBe(201);
    expect((await api(ctx).post('/sellers', { ...body, name: 'Outra' })).status).toBe(409);
    await createSeller(ctx, 'Off', false);
    expect((await api(ctx).get('/sellers?active=true')).body.data).toHaveLength(1);
    expect((await api(ctx).get('/sellers')).body.data).toHaveLength(2);
  });
});

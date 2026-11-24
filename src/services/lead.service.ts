import type { Pool, PoolConnection } from 'mysql2/promise';
import { isDupEntry, withTransaction } from '../infra/db';
import type { Logger } from '../infra/logger';
import { normalizePhone } from '../domain/phone';
import { DuplicateLeadError, NotFoundError, ValidationError } from '../domain/errors';
import { decodeCursor, encodeCursor } from '../domain/cursor';
import type { Channel, CreateLeadInput, Lead, LeadEvent } from '../domain/types';
import type { LeadFilters, LeadRepository } from '../repositories/lead.repository';
import type { LeadEventRepository } from '../repositories/lead-event.repository';
import type { DistributionService } from './distribution.service';

export interface CreateLeadContext {
  channel: Channel;
  requestId?: string;
  webhookEventId?: string;
  /** Executado dentro da mesma transação (ex.: marcar o webhook como processado atomicamente). */
  inTransaction?: (conn: PoolConnection, lead: Lead) => Promise<void>;
}

export class LeadService {
  constructor(
    private readonly pool: Pool,
    private readonly leads: LeadRepository,
    private readonly events: LeadEventRepository,
    private readonly distribution: DistributionService,
    private readonly log: Logger,
    private readonly phoneRegion: string,
  ) {}

  normalize(phone: string): string {
    const e164 = normalizePhone(phone, this.phoneRegion);
    if (!e164) throw new ValidationError('Dados inválidos', [{ in: 'body', path: 'phone', message: 'Telefone inválido' }]);
    return e164;
  }

  /**
   * Cria o lead de forma idempotente por telefone normalizado.
   *
   * Concorrência: NÃO usamos "SELECT depois INSERT" (race clássica). Inserimos direto e deixamos a
   * UNIQUE KEY uq_leads_phone decidir: exatamente uma transação vence; as demais recebem ER_DUP_ENTRY,
   * que é traduzido em DuplicateLeadError (409). Lead, evento de criação, atribuição e evento de atribuição
   * são confirmados juntos (tudo ou nada).
   */
  async create(input: CreateLeadInput, ctx: CreateLeadContext): Promise<Lead> {
    const phone = this.normalize(input.phone);
    try {
      return await withTransaction(this.pool, async (conn) => {
        let lead = await this.leads.insert(conn, {
          name: input.name,
          email: input.email ?? null,
          phoneE164: phone,
          phoneRaw: input.phone,
          channel: ctx.channel,
          origin: input.origin ?? null,
          notes: input.notes ?? null,
        });
        await this.events.append(conn, {
          leadId: lead.id,
          type: 'lead.created',
          channel: ctx.channel,
          requestId: ctx.requestId,
          webhookEventId: ctx.webhookEventId,
        });
        const sellerId = await this.distribution.assign(conn, lead.id, ctx);
        if (sellerId) lead = (await this.leads.findById(conn, lead.id))!;
        await ctx.inTransaction?.(conn, lead);
        return lead;
      });
    } catch (err) {
      if (isDupEntry(err, 'uq_leads_phone')) {
        const existing = await this.leads.findByPhone(this.pool, phone);
        if (existing) {
          // Rastreabilidade da tentativa duplicada (best-effort: não pode mascarar o 409).
          await this.events
            .append(this.pool, {
              leadId: existing.id,
              type: 'lead.duplicate_attempt',
              channel: ctx.channel,
              requestId: ctx.requestId,
              webhookEventId: ctx.webhookEventId,
            })
            .catch((e) => this.log.warn({ err: e.message }, 'falha ao registrar tentativa duplicada'));
          throw new DuplicateLeadError(existing.id);
        }
      }
      throw err;
    }
  }

  async getById(id: string): Promise<Lead> {
    const lead = await this.leads.findById(this.pool, id);
    if (!lead) throw new NotFoundError('Lead');
    return lead;
  }

  async getEvents(id: string): Promise<LeadEvent[]> {
    await this.getById(id);
    return this.events.listByLead(this.pool, id);
  }

  async list(q: {
    status?: Lead['status'];
    seller_id?: string;
    channel?: Channel;
    origin?: string;
    phone?: string;
    email?: string;
    name?: string;
    created_from?: string;
    created_to?: string;
    limit: number;
    cursor?: string;
  }): Promise<{ items: Lead[]; nextCursor: string | null }> {
    const filters: LeadFilters = {
      status: q.status,
      sellerId: q.seller_id,
      channel: q.channel,
      origin: q.origin,
      email: q.email,
      namePrefix: q.name,
      createdFrom: q.created_from ? new Date(q.created_from) : undefined,
      createdTo: q.created_to ? new Date(q.created_to) : undefined,
    };
    if (q.phone) {
      const e164 = normalizePhone(q.phone, this.phoneRegion);
      if (!e164) throw new ValidationError('Dados inválidos', [{ in: 'query', path: 'phone', message: 'Telefone inválido' }]);
      filters.phoneE164 = e164;
    }
    const before = q.cursor ? decodeCursor(q.cursor) : undefined;
    const { items, hasMore } = await this.leads.list(this.pool, filters, q.limit, before);
    return { items, nextCursor: hasMore ? encodeCursor(items[items.length - 1].seq) : null };
  }
}

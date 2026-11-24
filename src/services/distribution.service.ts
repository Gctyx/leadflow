import type { Pool, PoolConnection } from 'mysql2/promise';
import { withTransaction } from '../infra/db';
import type { Logger } from '../infra/logger';
import type { EventChannel } from '../domain/types';
import type { LeadRepository } from '../repositories/lead.repository';
import type { SellerRepository } from '../repositories/seller.repository';
import type { LeadEventRepository } from '../repositories/lead-event.repository';

export interface AssignContext {
  channel: EventChannel;
  requestId?: string;
  webhookEventId?: string;
}

/**
 * Distribuição round-robin entre vendedores ATIVOS.
 * Estratégia: o vendedor ativo com `last_assigned_at` mais antigo (nulo primeiro) recebe o lead.
 * Diferente de "menos leads no total", um vendedor recém-ativado não é inundado para "alcançar" os demais.
 */
export class DistributionService {
  constructor(
    private readonly pool: Pool,
    private readonly sellers: SellerRepository,
    private readonly leads: LeadRepository,
    private readonly events: LeadEventRepository,
    private readonly log: Logger,
  ) {}

  /** Executa DENTRO da transação do chamador: seleção do vendedor, atribuição e evento são atômicos. */
  async assign(conn: PoolConnection, leadId: string, ctx: AssignContext): Promise<string | null> {
    const sellerId = await this.sellers.lockNextAvailable(conn);
    if (!sellerId) return null; // sem vendedor ativo: o lead fica `unassigned` e é atribuído depois
    await this.sellers.touchAssigned(conn, sellerId);
    await this.leads.assign(conn, leadId, sellerId);
    await this.events.append(conn, {
      leadId,
      type: 'lead.assigned',
      channel: ctx.channel,
      sellerId,
      requestId: ctx.requestId,
      webhookEventId: ctx.webhookEventId,
      metadata: { strategy: 'round_robin' },
    });
    return sellerId;
  }

  /**
   * Atribui leads que ficaram sem vendedor (não havia vendedor ativo). Idempotente e seguro para rodar em
   * paralelo (API após ativar vendedor + varredura do worker): a linha do lead é travada e revalidada.
   */
  async assignPending(limit = 100): Promise<number> {
    const ids = await this.leads.listUnassignedIds(this.pool, limit);
    let assigned = 0;
    for (const id of ids) {
      const outcome = await withTransaction(this.pool, async (conn) => {
        if (!(await this.leads.lockIfUnassigned(conn, id))) return 'skip' as const; // outro processo já atribuiu
        const seller = await this.assign(conn, id, { channel: 'system' });
        return seller ? ('assigned' as const) : ('no_seller' as const);
      });
      if (outcome === 'assigned') assigned++;
      if (outcome === 'no_seller') break; // sem vendedores ativos: não adianta continuar
    }
    if (assigned) this.log.info({ assigned }, 'leads pendentes atribuídos');
    return assigned;
  }
}

import type { Pool } from 'mysql2/promise';
import { isDupEntry, withTransaction } from '../infra/db';
import type { Logger } from '../infra/logger';
import { ConflictError, NotFoundError } from '../domain/errors';
import type { Seller } from '../domain/types';
import type { SellerRepository } from '../repositories/seller.repository';
import type { DistributionService } from './distribution.service';

export class SellerService {
  constructor(
    private readonly pool: Pool,
    private readonly sellers: SellerRepository,
    private readonly distribution: DistributionService,
    private readonly log: Logger,
  ) {}

  async create(input: { name: string; email: string; active: boolean }): Promise<Seller> {
    try {
      const seller = await this.sellers.insert(this.pool, input);
      if (seller.active) await this.drainPending();
      return seller;
    } catch (err) {
      if (isDupEntry(err, 'uq_sellers_email')) throw new ConflictError('SELLER_ALREADY_EXISTS', 'Já existe um vendedor com este e-mail');
      throw err;
    }
  }

  async get(id: string): Promise<Seller> {
    const s = await this.sellers.findById(this.pool, id);
    if (!s) throw new NotFoundError('Vendedor');
    return s;
  }

  list(f: { active?: boolean }, limit: number): Promise<Seller[]> {
    return this.sellers.list(this.pool, f, limit);
  }

  /**
   * Ativa/desativa. A linha do vendedor é travada (FOR UPDATE): se houver uma atribuição em andamento, a
   * desativação espera ela terminar, então nenhum lead é atribuído a um vendedor já desativado.
   * Leads já atribuídos permanecem com o vendedor (reatribuição fica fora do escopo — ver README).
   */
  async setActive(id: string, active: boolean): Promise<Seller> {
    const changed = await withTransaction(this.pool, async (conn) => {
      const current = await this.sellers.findById(conn, id, true);
      if (!current) throw new NotFoundError('Vendedor');
      if (current.active !== active) await this.sellers.setActive(conn, id, active);
      return current.active !== active;
    });
    if (changed && active) await this.drainPending(); // vendedor voltou: distribui o que estava represado
    return this.get(id);
  }

  private async drainPending(): Promise<void> {
    try {
      await this.distribution.assignPending(200);
    } catch (err) {
      // Não falha a requisição: a varredura periódica do worker conclui a atribuição.
      this.log.warn({ err: (err as Error).message }, 'falha ao atribuir leads pendentes; será retentado pelo worker');
    }
  }
}

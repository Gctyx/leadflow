import { randomUUID } from 'node:crypto';
import { Db, Row, ResultSetHeader } from '../infra/db';
import type { Seller } from '../domain/types';

const toSeller = (r: Row): Seller => ({
  id: r.id,
  name: r.name,
  email: r.email,
  active: r.active === 1 || r.active === true,
  lastAssignedAt: r.last_assigned_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class SellerRepository {
  async insert(db: Db, d: { name: string; email: string; active: boolean }): Promise<Seller> {
    const id = randomUUID();
    await db.query('INSERT INTO sellers (id, name, email, active) VALUES (?, ?, ?, ?)', [id, d.name, d.email, d.active ? 1 : 0]);
    return (await this.findById(db, id))!;
  }

  async findById(db: Db, id: string, forUpdate = false): Promise<Seller | null> {
    const [rows] = await db.query<Row[]>(`SELECT * FROM sellers WHERE id = ?${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
    return rows[0] ? toSeller(rows[0]) : null;
  }

  async list(db: Db, f: { active?: boolean }, limit: number): Promise<Seller[]> {
    const where = f.active === undefined ? '' : 'WHERE active = ?';
    const params: unknown[] = f.active === undefined ? [] : [f.active ? 1 : 0];
    const [rows] = await db.query<Row[]>(`SELECT * FROM sellers ${where} ORDER BY created_at ASC, id ASC LIMIT ?`, [...params, limit]);
    return rows.map(toSeller);
  }

  async setActive(db: Db, id: string, active: boolean): Promise<void> {
    await db.query('UPDATE sellers SET active = ? WHERE id = ?', [active ? 1 : 0, id]);
  }

  /**
   * Seleciona e TRAVA (dentro da transação do chamador) o vendedor ativo menos recentemente atribuído (round-robin).
   * SKIP LOCKED: transações concorrentes não esperam umas pelas outras — cada uma pega o próximo vendedor livre.
   * Se todos estiverem travados no instante, espera pelo primeiro (FOR UPDATE simples) em vez de concluir "sem vendedor".
   */
  async lockNextAvailable(db: Db): Promise<string | null> {
    const sql = (suffix: string) =>
      `SELECT id FROM sellers WHERE active = 1 ORDER BY last_assigned_at ASC, id ASC LIMIT 1 FOR UPDATE ${suffix}`;
    let [rows] = await db.query<Row[]>(sql('SKIP LOCKED'));
    if (!rows.length) [rows] = await db.query<Row[]>(sql(''));
    return rows[0]?.id ?? null;
  }

  async touchAssigned(db: Db, id: string): Promise<void> {
    await db.query('UPDATE sellers SET last_assigned_at = CURRENT_TIMESTAMP(6) WHERE id = ?', [id]);
  }
}
export type { ResultSetHeader };

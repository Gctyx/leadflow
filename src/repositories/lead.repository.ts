import { randomUUID } from 'node:crypto';
import { Db, Row, ResultSetHeader } from '../infra/db';
import type { Channel, Lead, LeadStatus } from '../domain/types';

export interface NewLead {
  name: string;
  email: string | null;
  phoneE164: string;
  phoneRaw: string;
  channel: Channel;
  origin: string | null;
  notes: string | null;
}

export interface LeadFilters {
  status?: LeadStatus;
  sellerId?: string;
  channel?: Channel;
  origin?: string;
  phoneE164?: string;
  email?: string;
  namePrefix?: string;
  createdFrom?: Date;
  createdTo?: Date;
}

const toLead = (r: Row): Lead => ({
  id: r.id,
  seq: Number(r.seq),
  name: r.name,
  email: r.email,
  phone: r.phone_e164,
  channel: r.channel,
  origin: r.origin,
  notes: r.notes,
  status: r.status,
  sellerId: r.seller_id,
  assignedAt: r.assigned_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export class LeadRepository {
  async insert(db: Db, d: NewLead): Promise<Lead> {
    const id = randomUUID();
    await db.query(
      `INSERT INTO leads (id, name, email, phone_e164, phone_raw, channel, origin, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unassigned')`,
      [id, d.name, d.email, d.phoneE164, d.phoneRaw, d.channel, d.origin, d.notes],
    );
    return (await this.findById(db, id))!;
  }

  async findById(db: Db, id: string): Promise<Lead | null> {
    const [rows] = await db.query<Row[]>('SELECT * FROM leads WHERE id = ?', [id]);
    return rows[0] ? toLead(rows[0]) : null;
  }

  async findByPhone(db: Db, phoneE164: string): Promise<Lead | null> {
    const [rows] = await db.query<Row[]>('SELECT * FROM leads WHERE phone_e164 = ?', [phoneE164]);
    return rows[0] ? toLead(rows[0]) : null;
  }

  /** Atribui apenas se ainda estiver sem vendedor (guarda de invariante). */
  async assign(db: Db, leadId: string, sellerId: string): Promise<void> {
    const [res] = await db.query<ResultSetHeader>(
      `UPDATE leads SET seller_id = ?, status = 'assigned', assigned_at = CURRENT_TIMESTAMP(6)
       WHERE id = ? AND status = 'unassigned'`,
      [sellerId, leadId],
    );
    if (res.affectedRows !== 1) throw new Error('lead já atribuído ou inexistente');
  }

  async listUnassignedIds(db: Db, limit: number): Promise<string[]> {
    const [rows] = await db.query<Row[]>("SELECT id FROM leads WHERE status = 'unassigned' ORDER BY seq ASC LIMIT ?", [limit]);
    return rows.map((r) => r.id);
  }

  /** Trava a linha do lead se (e somente se) ainda estiver sem vendedor. */
  async lockIfUnassigned(db: Db, id: string): Promise<boolean> {
    const [rows] = await db.query<Row[]>("SELECT id FROM leads WHERE id = ? AND status = 'unassigned' FOR UPDATE", [id]);
    return rows.length === 1;
  }

  /** Paginação por cursor (keyset em `seq` DESC): custo constante e estável mesmo com inserções concorrentes. */
  async list(db: Db, f: LeadFilters, limit: number, beforeSeq?: number): Promise<{ items: Lead[]; hasMore: boolean }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (cond: string, v: unknown) => (where.push(cond), params.push(v));

    if (f.status) add('status = ?', f.status);
    if (f.sellerId) add('seller_id = ?', f.sellerId);
    if (f.channel) add('channel = ?', f.channel);
    if (f.origin) add('origin = ?', f.origin);
    if (f.phoneE164) add('phone_e164 = ?', f.phoneE164);
    if (f.email) add('email = ?', f.email);
    if (f.namePrefix) add('name LIKE ?', `${escapeLike(f.namePrefix)}%`);
    if (f.createdFrom) add('created_at >= ?', f.createdFrom);
    if (f.createdTo) add('created_at <= ?', f.createdTo);
    if (beforeSeq !== undefined) add('seq < ?', beforeSeq);

    const sql = `SELECT * FROM leads ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY seq DESC LIMIT ?`;
    const [rows] = await db.query<Row[]>(sql, [...params, limit + 1]);
    return { items: rows.slice(0, limit).map(toLead), hasMore: rows.length > limit };
  }
}

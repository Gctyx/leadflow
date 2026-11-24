import { Db, Row } from '../infra/db';
import type { EventChannel, LeadEvent, LeadEventType } from '../domain/types';

export interface NewLeadEvent {
  leadId: string;
  type: LeadEventType;
  channel: EventChannel;
  sellerId?: string | null;
  webhookEventId?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
}

const parseJson = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v ?? null);

const toEvent = (r: Row): LeadEvent => ({
  seq: Number(r.seq),
  leadId: r.lead_id,
  type: r.type,
  channel: r.channel,
  sellerId: r.seller_id,
  webhookEventId: r.webhook_event_id,
  requestId: r.request_id,
  metadata: parseJson(r.metadata),
  createdAt: r.created_at,
});

/** Trilha de auditoria append-only: só existe `append` e leitura. */
export class LeadEventRepository {
  async append(db: Db, e: NewLeadEvent): Promise<void> {
    await db.query(
      `INSERT INTO lead_events (lead_id, type, channel, seller_id, webhook_event_id, request_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [e.leadId, e.type, e.channel, e.sellerId ?? null, e.webhookEventId ?? null, e.requestId ?? null, e.metadata ? JSON.stringify(e.metadata) : null],
    );
  }

  async listByLead(db: Db, leadId: string, limit = 200): Promise<LeadEvent[]> {
    const [rows] = await db.query<Row[]>('SELECT * FROM lead_events WHERE lead_id = ? ORDER BY seq ASC LIMIT ?', [leadId, limit]);
    return rows.map(toEvent);
  }
}

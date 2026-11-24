import { PoolConnection } from 'mysql2/promise';
import { Db, Row, ResultSetHeader } from '../infra/db';
import type { WebhookEnvelope, WebhookEvent } from '../domain/types';

const toEvent = (r: Row): WebhookEvent => ({
  id: r.id,
  source: r.source,
  externalEventId: r.external_event_id,
  payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
  payloadHash: r.payload_hash,
  status: r.status,
  attempts: r.attempts,
  nextAttemptAt: r.next_attempt_at,
  enqueuedAt: r.enqueued_at,
  lockedUntil: r.locked_until,
  lastError: r.last_error,
  leadId: r.lead_id,
  receivedAt: r.received_at,
  processedAt: r.processed_at,
});

export class WebhookEventRepository {
  constructor(private readonly db: Db) {}

  async insert(e: { id: string; source: string; externalEventId: string; payload: WebhookEnvelope; payloadHash: string }): Promise<void> {
    await this.db.query(
      'INSERT INTO webhook_events (id, source, external_event_id, payload, payload_hash) VALUES (?, ?, ?, ?, ?)',
      [e.id, e.source, e.externalEventId, JSON.stringify(e.payload), e.payloadHash],
    );
  }

  async findById(id: string): Promise<WebhookEvent | null> {
    const [rows] = await this.db.query<Row[]>('SELECT * FROM webhook_events WHERE id = ?', [id]);
    return rows[0] ? toEvent(rows[0]) : null;
  }

  async findBySourceAndExternalId(source: string, externalEventId: string): Promise<WebhookEvent | null> {
    const [rows] = await this.db.query<Row[]>('SELECT * FROM webhook_events WHERE source = ? AND external_event_id = ?', [source, externalEventId]);
    return rows[0] ? toEvent(rows[0]) : null;
  }

  async markEnqueued(id: string): Promise<void> {
    await this.db.query('UPDATE webhook_events SET enqueued_at = CURRENT_TIMESTAMP(6) WHERE id = ?', [id]);
  }

  /**
   * Claim atômico (compare-and-set): só UM worker consegue mover o evento para `processing`.
   * Reentrega duplicada da fila => claim falha => no-op. Evento com lock expirado (worker morreu) pode ser retomado.
   */
  async claim(id: string, lockSeconds: number): Promise<WebhookEvent | null> {
    const [res] = await this.db.query<ResultSetHeader>(
      `UPDATE webhook_events
          SET status = 'processing', attempts = attempts + 1,
              locked_until = DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? SECOND)
        WHERE id = ?
          AND ((status = 'pending' AND next_attempt_at <= CURRENT_TIMESTAMP(6))
            OR (status = 'processing' AND locked_until < CURRENT_TIMESTAMP(6)))`,
      [lockSeconds, id],
    );
    return res.affectedRows === 1 ? this.findById(id) : null;
  }

  /** Chamado DENTRO da transação que cria o lead: efeito e marcação são atômicos. */
  async markProcessed(conn: PoolConnection, id: string, leadId: string): Promise<void> {
    await conn.query(
      `UPDATE webhook_events SET status = 'processed', lead_id = ?, processed_at = CURRENT_TIMESTAMP(6),
              locked_until = NULL, last_error = NULL WHERE id = ? AND status = 'processing'`,
      [leadId, id],
    );
  }

  async markDuplicate(id: string, leadId: string): Promise<void> {
    await this.db.query(
      `UPDATE webhook_events SET status = 'duplicate', lead_id = ?, processed_at = CURRENT_TIMESTAMP(6), locked_until = NULL
        WHERE id = ? AND status = 'processing'`,
      [leadId, id],
    );
  }

  async scheduleRetry(id: string, delayMs: number, lastError: string): Promise<void> {
    await this.db.query(
      `UPDATE webhook_events
          SET status = 'pending', locked_until = NULL, enqueued_at = NULL, last_error = ?,
              next_attempt_at = DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? MICROSECOND)
        WHERE id = ? AND status = 'processing'`,
      [lastError.slice(0, 100), Math.round(delayMs * 1000), id],
    );
  }

  async markDead(id: string, lastError: string): Promise<void> {
    await this.db.query(
      "UPDATE webhook_events SET status = 'dead', locked_until = NULL, last_error = ? WHERE id = ? AND status = 'processing'",
      [lastError.slice(0, 100), id],
    );
  }

  /** Eventos que deveriam estar sendo processados mas ninguém assumiu (Redis perdeu a mensagem, worker caiu, retry vencido). */
  async findDue(limit: number, reenqueueAfterSeconds = 60): Promise<string[]> {
    const [rows] = await this.db.query<Row[]>(
      `SELECT id FROM webhook_events
        WHERE (status = 'pending' AND next_attempt_at <= CURRENT_TIMESTAMP(6)
               AND (enqueued_at IS NULL OR enqueued_at < DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL ? SECOND)))
           OR (status = 'processing' AND locked_until < CURRENT_TIMESTAMP(6))
        ORDER BY received_at ASC LIMIT ?`,
      [reenqueueAfterSeconds, limit],
    );
    return rows.map((r) => r.id);
  }
}

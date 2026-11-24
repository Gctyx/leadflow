import { createHash, randomUUID } from 'node:crypto';
import type { Logger } from '../infra/logger';
import { isDupEntry } from '../infra/db';
import { ConflictError, ValidationError } from '../domain/errors';
import type { WebhookEnvelope, WebhookStatus } from '../domain/types';
import type { WebhookEventRepository } from '../repositories/webhook-event.repository';
import type { WebhookQueue } from '../queue/redis-stream.queue';
import type { LeadService } from './lead.service';

export interface IngestResult {
  duplicate: boolean;
  eventId: string;
  status: WebhookStatus;
}

/**
 * Recepção do webhook = "persistir primeiro, processar depois":
 *   1) valida (inclusive telefone) -> falha rápida e síncrona para o emissor;
 *   2) grava no MySQL (inbox durável + idempotência por source+event_id);
 *   3) tenta enfileirar no Redis. Se o Redis estiver fora, NÃO falha: o evento já está durável e o worker
 *      o recupera pela varredura. Só respondemos 202 depois do passo 2.
 */
export class WebhookIngestService {
  constructor(
    private readonly events: WebhookEventRepository,
    private readonly queue: WebhookQueue,
    private readonly leads: LeadService,
    private readonly log: Logger,
  ) {}

  async ingest(env: WebhookEnvelope): Promise<IngestResult> {
    this.leads.normalize(env.data.phone); // lança ValidationError (422) se o telefone for inválido

    // Hash do envelope validado (e não do corpo bruto): reentregas com espaços/ordem diferentes continuam idempotentes.
    const payloadHash = createHash('sha256').update(JSON.stringify(env)).digest('hex');
    const id = randomUUID();

    try {
      await this.events.insert({ id, source: env.source, externalEventId: env.event_id, payload: env, payloadHash });
    } catch (err) {
      if (!isDupEntry(err, 'uq_webhook_source_event')) throw err;
      const existing = await this.events.findBySourceAndExternalId(env.source, env.event_id);
      if (!existing) throw err;
      if (existing.payloadHash !== payloadHash) {
        throw new ConflictError('EVENT_ID_REUSED', 'event_id já utilizado com conteúdo diferente');
      }
      return { duplicate: true, eventId: existing.id, status: existing.status };
    }

    try {
      await this.queue.enqueue(id);
      await this.events.markEnqueued(id);
    } catch (err) {
      this.log.warn({ err: (err as Error).message, eventId: id }, 'redis indisponível: evento mantido no MySQL para o worker');
    }
    return { duplicate: false, eventId: id, status: 'pending' };
  }
}
export { ValidationError };

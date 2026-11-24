import type { Config } from '../config';
import type { Logger } from '../infra/logger';
import { computeBackoffMs } from '../domain/backoff';
import { DuplicateLeadError, ValidationError } from '../domain/errors';
import type { WebhookEventRepository } from '../repositories/webhook-event.repository';
import type { LeadService } from './lead.service';

export type ProcessOutcome = 'processed' | 'duplicate' | 'retry' | 'dead' | 'skipped';

type ProcessorConfig = Pick<Config, 'WEBHOOK_MAX_ATTEMPTS' | 'WEBHOOK_BACKOFF_BASE_MS' | 'WEBHOOK_BACKOFF_MAX_MS' | 'WEBHOOK_LOCK_SECONDS'>;

/** Processa UM evento do inbox. Nunca lança por falha de negócio: o resultado fica registrado no MySQL. */
export class WebhookProcessor {
  constructor(
    private readonly events: WebhookEventRepository,
    private readonly leads: LeadService,
    private readonly cfg: ProcessorConfig,
    private readonly log: Logger,
  ) {}

  async process(eventId: string): Promise<ProcessOutcome> {
    const ev = await this.events.claim(eventId, this.cfg.WEBHOOK_LOCK_SECONDS);
    if (!ev) return 'skipped'; // já processado, em processamento por outro worker, ou ainda não vencido

    // Evento "veneno" (derruba o worker a cada tentativa): o contador sobe no claim e ele vai para `dead`.
    if (ev.attempts > this.cfg.WEBHOOK_MAX_ATTEMPTS) {
      await this.events.markDead(ev.id, 'max_attempts_exceeded');
      this.log.error({ eventId: ev.id }, 'webhook movido para dead (tentativas excedidas)');
      return 'dead';
    }

    try {
      await this.leads.create(
        { ...ev.payload.data, origin: ev.payload.data.origin ?? ev.payload.source },
        {
          channel: 'webhook',
          webhookEventId: ev.id,
          // marcar como `processed` na MESMA transação do lead => efeito exatamente-uma-vez
          inTransaction: (conn, lead) => this.events.markProcessed(conn, ev.id, lead.id),
        },
      );
      return 'processed';
    } catch (err) {
      if (err instanceof DuplicateLeadError) {
        await this.events.markDuplicate(ev.id, err.existingLeadId); // telefone já existe: resultado final, sem retry
        return 'duplicate';
      }
      const reason = (err as { code?: string }).code ?? (err as Error).name ?? 'error';
      const permanent = err instanceof ValidationError;
      if (permanent || ev.attempts >= this.cfg.WEBHOOK_MAX_ATTEMPTS) {
        await this.events.markDead(ev.id, reason);
        this.log.error({ eventId: ev.id, reason, attempts: ev.attempts }, 'webhook movido para dead');
        return 'dead';
      }
      const delay = computeBackoffMs(ev.attempts, this.cfg.WEBHOOK_BACKOFF_BASE_MS, this.cfg.WEBHOOK_BACKOFF_MAX_MS);
      await this.events.scheduleRetry(ev.id, delay, reason);
      this.log.warn({ eventId: ev.id, reason, attempts: ev.attempts, retryInMs: delay }, 'webhook reagendado');
      return 'retry';
    }
  }
}

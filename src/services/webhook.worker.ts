import type { Config } from '../config';
import type { Logger } from '../infra/logger';
import type { WebhookEventRepository } from '../repositories/webhook-event.repository';
import type { QueueMessage, WebhookQueue } from '../queue/redis-stream.queue';
import type { WebhookProcessor } from './webhook-processor.service';
import type { DistributionService } from './distribution.service';

type WorkerConfig = Pick<Config, 'WORKER_BATCH' | 'WORKER_SWEEP_INTERVAL_MS' | 'WEBHOOK_LOCK_SECONDS'>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Dois laços independentes:
 *  - consumo: lê do Redis Stream (consumer group) e processa;
 *  - manutenção: (1) reassume mensagens órfãs (XAUTOCLAIM), (2) re-enfileira eventos vencidos do MySQL — e,
 *    se o Redis estiver fora, PROCESSA DIRETO do MySQL (modo degradado), (3) atribui leads represados.
 */
export class WebhookWorker {
  private running = false;
  private loops: Promise<void>[] = [];

  constructor(
    private readonly queue: WebhookQueue,
    private readonly processor: WebhookProcessor,
    private readonly events: WebhookEventRepository,
    private readonly distribution: DistributionService,
    private readonly cfg: WorkerConfig,
    private readonly log: Logger,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.initQueueWithRetry();
    this.loops = [this.consumeLoop(), this.maintenanceLoop()];
    this.log.info('worker iniciado');
  }

  async stop(): Promise<void> {
    this.running = false;
    await Promise.allSettled(this.loops);
    await this.queue.close();
    this.log.info('worker finalizado');
  }

  /** Cria o consumer group; se o Redis ainda não estiver disponível, tenta de novo em background. */
  private initQueueWithRetry(): void {
    void (async () => {
      while (this.running) {
        try {
          await this.queue.init();
          return;
        } catch (err) {
          this.log.warn({ err: (err as Error).message }, 'redis indisponível ao iniciar o consumer group; nova tentativa');
          await sleep(2000);
        }
      }
    })();
  }

  private async handle(m: QueueMessage): Promise<void> {
    try {
      await this.processor.process(m.eventId);
      await this.queue.ack(m.id);
    } catch (err) {
      // Sem ACK: a mensagem permanece na PEL e é reassumida via XAUTOCLAIM.
      this.log.error({ err: (err as Error).message, eventId: m.eventId }, 'falha ao processar; mensagem continua pendente');
    }
  }

  /** Uma leitura do stream (público para testes determinísticos). */
  async consumeOnce(blockMs = 1000): Promise<number> {
    const messages = await this.queue.read(this.cfg.WORKER_BATCH, blockMs);
    for (const m of messages) await this.handle(m);
    return messages.length;
  }

  private async consumeLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.consumeOnce(2000);
      } catch (err) {
        this.log.warn({ err: (err as Error).message }, 'consumo do stream falhou; aguardando');
        await sleep(1000);
      }
    }
  }

  /** Um ciclo de manutenção (público para testes). */
  async maintenanceTick(): Promise<void> {
    try {
      for (const m of await this.queue.claimStale(this.cfg.WEBHOOK_LOCK_SECONDS * 1000, 20)) await this.handle(m);
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'XAUTOCLAIM indisponível');
    }

    try {
      for (const id of await this.events.findDue(100)) {
        try {
          await this.queue.enqueue(id);
          await this.events.markEnqueued(id);
        } catch (err) {
          this.log.warn({ err: (err as Error).message }, 'redis indisponível: processando direto do MySQL (modo degradado)');
          await this.processor.process(id);
        }
      }
      await this.distribution.assignPending(100);
    } catch (err) {
      this.log.error({ err: (err as Error).message }, 'ciclo de manutenção falhou');
    }
  }

  private async maintenanceLoop(): Promise<void> {
    while (this.running) {
      await this.maintenanceTick();
      await sleep(this.cfg.WORKER_SWEEP_INTERVAL_MS);
    }
  }
}

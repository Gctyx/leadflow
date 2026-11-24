import Redis from 'ioredis';

export interface QueueMessage {
  id: string; // id da mensagem no stream
  eventId: string; // id do webhook_events
}

export interface WebhookQueue {
  enqueue(eventId: string): Promise<void>;
  init(): Promise<void>;
  read(count: number, blockMs: number): Promise<QueueMessage[]>;
  claimStale(minIdleMs: number, count: number): Promise<QueueMessage[]>;
  ack(messageId: string): Promise<void>;
  close(): Promise<void>;
}

type RawEntries = [string, string[]][];

/**
 * Fila de webhooks sobre Redis Streams + consumer group (sem BullMQ).
 *  - XADD            : produtor (API ou sweeper)
 *  - XREADGROUP      : cada mensagem vai para UM consumidor do grupo
 *  - XACK / XDEL     : confirmação após processar
 *  - XAUTOCLAIM      : recupera mensagens entregues a um worker que morreu (PEL)
 * Semântica "at-least-once": duplicatas são neutralizadas pelo claim atômico no MySQL.
 */
export class RedisStreamQueue implements WebhookQueue {
  private reader?: Redis;

  constructor(
    private readonly redis: Redis,
    private readonly o: { stream: string; group: string; consumer: string; maxLen?: number },
  ) {}

  /** Conexão dedicada: XREADGROUP BLOCK ocuparia a conexão compartilhada da API. */
  private getReader(): Redis {
    if (!this.reader) {
      this.reader = this.redis.duplicate({ maxRetriesPerRequest: null, enableOfflineQueue: true });
      this.reader.on('error', () => undefined); // erros já são tratados pelos loops do worker
    }
    return this.reader;
  }

  async init(): Promise<void> {
    try {
      await this.getReader().xgroup('CREATE', this.o.stream, this.o.group, '0', 'MKSTREAM');
    } catch (err) {
      if (!String(err).includes('BUSYGROUP')) throw err;
    }
  }

  async enqueue(eventId: string): Promise<void> {
    await this.redis.xadd(this.o.stream, 'MAXLEN', '~', this.o.maxLen ?? 100_000, '*', 'event_id', eventId);
  }

  async read(count: number, blockMs: number): Promise<QueueMessage[]> {
    const res = (await this.getReader().xreadgroup(
      'GROUP', this.o.group, this.o.consumer, 'COUNT', count, 'BLOCK', blockMs, 'STREAMS', this.o.stream, '>',
    )) as unknown as [string, RawEntries][] | null;
    return this.parse(res?.[0]?.[1]);
  }

  async claimStale(minIdleMs: number, count: number): Promise<QueueMessage[]> {
    const res = (await this.getReader().xautoclaim(
      this.o.stream, this.o.group, this.o.consumer, minIdleMs, '0-0', 'COUNT', count,
    )) as unknown as [string, RawEntries];
    return this.parse(res?.[1]);
  }

  async ack(messageId: string): Promise<void> {
    await this.redis.multi().xack(this.o.stream, this.o.group, messageId).xdel(this.o.stream, messageId).exec();
  }

  async close(): Promise<void> {
    await this.reader?.quit().catch(() => undefined);
  }

  private parse(entries?: RawEntries): QueueMessage[] {
    return (entries ?? []).flatMap(([id, fields]) => {
      const i = fields.indexOf('event_id');
      return i >= 0 ? [{ id, eventId: fields[i + 1] }] : [];
    });
  }
}

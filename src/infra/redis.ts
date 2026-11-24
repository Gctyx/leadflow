import Redis from 'ioredis';
import type { Logger } from './logger';

/**
 * Conexão compartilhada (API): `enableOfflineQueue: false` faz os comandos FALHAREM RÁPIDO quando o Redis
 * está fora, em vez de empilhar requisições na memória. Quem usa decide: rate limit => fail-open;
 * enfileiramento => o evento já está no MySQL e o worker recupera.
 */
export function createRedis(url: string, log: Logger): Redis {
  const redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 3000,
    retryStrategy: (times) => Math.min(times * 200, 3000),
  });
  redis.on('error', (err) => log.warn({ err: err.message }, 'redis error'));
  return redis;
}

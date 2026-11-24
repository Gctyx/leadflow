import { hostname } from 'node:os';
import type Redis from 'ioredis';
import type { Pool } from 'mysql2/promise';
import type { Config } from './config';
import { createLogger, Logger } from './infra/logger';
import { createPool } from './infra/db';
import { createRedis } from './infra/redis';
import { SellerRepository } from './repositories/seller.repository';
import { LeadRepository } from './repositories/lead.repository';
import { LeadEventRepository } from './repositories/lead-event.repository';
import { WebhookEventRepository } from './repositories/webhook-event.repository';
import { DistributionService } from './services/distribution.service';
import { LeadService } from './services/lead.service';
import { SellerService } from './services/seller.service';
import { WebhookIngestService } from './services/webhook-ingest.service';
import { WebhookProcessor } from './services/webhook-processor.service';
import { WebhookWorker } from './services/webhook.worker';
import { RedisStreamQueue } from './queue/redis-stream.queue';

/** Composition root: único lugar que conhece as implementações concretas (injeção de dependência manual). */
export function buildContainer(config: Config) {
  const logger: Logger = createLogger(config);
  const pool: Pool = createPool(config.DATABASE_URL, config.DB_POOL_SIZE);
  const redis: Redis = createRedis(config.REDIS_URL, logger);

  const sellerRepo = new SellerRepository();
  const leadRepo = new LeadRepository();
  const eventRepo = new LeadEventRepository();
  const webhookRepo = new WebhookEventRepository(pool);

  const queue = new RedisStreamQueue(redis, {
    stream: config.REDIS_STREAM_KEY,
    group: config.REDIS_STREAM_GROUP,
    consumer: `${hostname()}-${process.pid}`,
  });

  const distribution = new DistributionService(pool, sellerRepo, leadRepo, eventRepo, logger);
  const leadService = new LeadService(pool, leadRepo, eventRepo, distribution, logger, config.DEFAULT_PHONE_REGION);
  const sellerService = new SellerService(pool, sellerRepo, distribution, logger);
  const webhookIngest = new WebhookIngestService(webhookRepo, queue, leadService, logger);
  const processor = new WebhookProcessor(webhookRepo, leadService, config, logger);
  const worker = new WebhookWorker(queue, processor, webhookRepo, distribution, config, logger);

  return {
    config, logger, pool, redis, queue,
    sellerRepo, leadRepo, eventRepo, webhookRepo,
    distribution, leadService, sellerService, webhookIngest, processor, worker,
    async close(): Promise<void> {
      await queue.close();
      await redis.quit().catch(() => undefined);
      await pool.end().catch(() => undefined);
    },
  };
}

export type Container = ReturnType<typeof buildContainer>;

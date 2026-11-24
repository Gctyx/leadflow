import express, { Express, Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { docsRouter } from './docs/swagger';
import { adminRoutes } from './http/admin';
import type { Container } from './container';
import { apiKeyAuth, errorHandler, genReqId, notFound, rateLimit } from './http/middleware';
import { leadRoutes, sellerRoutes, webhookRoutes } from './http/routes';

export function createApp(c: Container): Express {
  const { config, logger } = c;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger,
      genReqId: genReqId as any,
      // Nunca loga query string (pode conter telefone/e-mail) nem corpo.
      serializers: { req: (req) => ({ id: req.id, method: req.method, path: String(req.url).split('?')[0] }) },
    }),
  );
  app.use(helmet());

  const live = (_req: express.Request, res: express.Response) => void res.json({ status: 'ok' });
  app.get('/health/live', live);
  app.get('/health/ready', async (_req, res) => {
    const db = await c.pool.query('SELECT 1').then(() => true, () => false);
    const redis = await c.redis.ping().then((r) => r === 'PONG', () => false);
    // Redis fora = degradado (continua atendendo; webhooks ficam no MySQL). MySQL fora = indisponível.
    res.status(db ? 200 : 503).json({ status: db ? (redis ? 'ok' : 'degraded') : 'unavailable' });
  });

  if (config.DOCS_ENABLED) {
    app.use('/', docsRouter());
  }

  const api = Router();
  const rl = (scope: string, max: number) =>
    rateLimit(c.redis, { scope, max, windowSeconds: config.RATE_LIMIT_WINDOW_SECONDS }, logger);

  // Webhook: autenticado por HMAC (sem API key), com rate limit próprio.
  api.use('/webhooks', rl('webhook', config.RATE_LIMIT_WEBHOOK_MAX), webhookRoutes(c));

  // REST: rate limit -> API key -> JSON -> validação -> regra de negócio.
  const rest = Router();
  rest.use(rl('api', config.RATE_LIMIT_API_MAX), apiKeyAuth(config.API_KEYS), express.json({ limit: '50kb' }));
  rest.use('/leads', leadRoutes(c));
  rest.use('/sellers', sellerRoutes(c));
  api.use(rest);

  app.use('/api/v1', api);
  // Admin API (autenticação e gestão; cookies HttpOnly + CSRF)
  app.use('/admin', adminRoutes(c));
  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}

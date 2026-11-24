import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import type Redis from 'ioredis';
import { AppError, FieldIssue, RateLimitedError, UnauthorizedError, ValidationError } from '../domain/errors';
import { isTransient } from '../infra/db';
import type { Logger } from '../infra/logger';
import { verifySignature } from '../security/signature';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      rawBody?: Buffer;
      validated?: { body?: any; query?: any; params?: any };
    }
  }
}

export const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

export const requestId = (req: Request): string => String(req.id ?? '');

/** Gera/propaga o id de correlação (aceita X-Request-Id apenas em formato seguro). */
export function genReqId(req: Request, res: Response): string {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

/** Autenticação por API key. Compara hashes SHA-256 em tempo constante (sem vazar tamanho/prefixo da chave). */
export function apiKeyAuth(keys: string[]): RequestHandler {
  const digests = keys.map((k) => createHash('sha256').update(k).digest());
  return (req, _res, next) => {
    const provided = req.header('x-api-key');
    if (!provided) return next(new UnauthorizedError());
    const d = createHash('sha256').update(provided).digest();
    let ok = false;
    for (const x of digests) ok = timingSafeEqual(x, d) || ok;
    next(ok ? undefined : new UnauthorizedError());
  };
}

/** Verifica a assinatura HMAC do webhook. Resposta sempre genérica (401); o motivo real vai só para o log. */
export function webhookSignature(secrets: string[], toleranceSeconds: number, log: Logger): RequestHandler {
  return (req, _res, next) => {
    const result = verifySignature({
      secrets,
      timestamp: req.header('x-leadflow-timestamp'),
      signature: req.header('x-leadflow-signature'),
      rawBody: req.rawBody,
      toleranceSeconds,
    });
    if (result.ok) return next();
    log.warn({ reason: result.reason, reqId: req.id }, 'webhook rejeitado');
    next(new UnauthorizedError());
  };
}

/**
 * Rate limit por IP em janela fixa, contadores no Redis (compartilhado entre instâncias).
 * FAIL-OPEN: se o Redis cair, preferimos atender a derrubar a API (a autenticação continua valendo).
 */
export function rateLimit(redis: Redis, o: { scope: string; max: number; windowSeconds: number }, log: Logger): RequestHandler {
  return async (req, res, next) => {
    let limited: number | null = null;
    try {
      const windowMs = o.windowSeconds * 1000;
      const bucket = Math.floor(Date.now() / windowMs);
      const key = `leadflow:rl:${o.scope}:${req.ip}:${bucket}`;
      const out = await redis.multi().incr(key).expire(key, o.windowSeconds + 1).exec();
      const count = Number(out?.[0]?.[1] ?? 0);
      res.setHeader('RateLimit-Limit', String(o.max));
      res.setHeader('RateLimit-Remaining', String(Math.max(0, o.max - count)));
      if (count > o.max) {
        limited = Math.max(1, Math.ceil(((bucket + 1) * windowMs - Date.now()) / 1000));
        log.warn({ scope: o.scope, ip: req.ip, reqId: req.id, limit: o.max, count }, 'rate limited');
      }
    } catch (err) {
      log.warn({ err: (err as Error).message, scope: o.scope, ip: req.ip, reqId: req.id }, 'rate limiter indisponível (fail-open)');
    }
    next(limited !== null ? new RateLimitedError(limited) : undefined);
  };
}

/** Valida params/query/body com Zod. As mensagens de erro não ecoam os valores recebidos. */
export const validate =
  (schemas: { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny }): RequestHandler =>
  (req, _res, next) => {
    const issues: FieldIssue[] = [];
    const out: NonNullable<Request['validated']> = {};
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const r = schema.safeParse(req[part]);
      if (r.success) out[part] = r.data;
      else issues.push(...r.error.issues.map((i) => ({ in: part, path: i.path.join('.'), message: i.message })));
    }
    if (issues.length) return next(new ValidationError('Dados inválidos', issues));
    req.validated = out;
    next();
  };

export const notFound: RequestHandler = (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Rota não encontrada'));

/** Handler único de erros: formato padronizado, sem stack trace, sem detalhes internos. */
export function errorHandler(log: Logger): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    const type = (err as { type?: string })?.type;
    let e: AppError;
    if (err instanceof AppError) e = err;
    else if (type === 'entity.too.large') e = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Corpo da requisição excede o limite');
    else if (type === 'entity.parse.failed' || type === 'encoding.unsupported' || type === 'charset.unsupported')
      e = new AppError(400, 'INVALID_BODY', 'Corpo da requisição inválido');
    else if (isTransient(err)) {
      log.error({ err: (err as Error).message, reqId: req.id }, 'dependência indisponível');
      e = new AppError(503, 'SERVICE_UNAVAILABLE', 'Serviço temporariamente indisponível', undefined, { 'Retry-After': '5' });
    } else {
      log.error({ err, reqId: req.id, path: String(req.url).split('?')[0], method: req.method }, 'erro não tratado');
      e = new AppError(500, 'INTERNAL_ERROR', 'Erro interno');
    }
    // Loga erros conhecidos também (sem vazar valores do corpo). 404 como info; demais 4xx como warn.
    if (e.status < 500) {
      const level = e.status === 404 ? 'info' : 'warn';
      const entry = { code: e.code, status: e.status, reqId: req.id, path: String(req.url).split('?')[0], method: req.method } as any;
      if (e.details && Array.isArray(e.details)) entry.issues = e.details.length;
      (log as any)[level](entry, 'request error');
    }
    res.status(e.status).set(e.headers).json({
      error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}), request_id: requestId(req) },
    });
  };
}

import express, { Router } from 'express';
import { z } from 'zod';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import type { Container } from '../container';
import { AdminAuthService } from '../services/admin-auth.service';
import { AdminAuditRepository, AdminSessionRepository, AdminUserRepository } from '../repositories/admin';
import { buildJwtSigner } from '../security/jwt';

const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(8).max(200), totp: z.string().trim().min(6).max(10).optional() }).strict();

function parseCookies(req: express.Request): Record<string, string> {
  const h = req.headers['cookie'];
  const out: Record<string, string> = {};
  if (!h) return out;
  String(h).split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1));
  });
  return out;
}

function requireCsrf(req: express.Request, res: express.Response, next: express.NextFunction) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  const cookies = parseCookies(req);
  const header = req.header('x-csrf-token');
  if (!cookies['admin_csrf'] || !header || cookies['admin_csrf'] !== header) {
    res.status(403).json({ error: { code: 'CSRF', message: 'CSRF token inválido' } });
    return;
  }
  return next();
}

function rateLimitLogin(redis: any) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const email = (req.body?.email || '').toString().toLowerCase().trim();
    const ip = req.ip || 'unknown';
    const key = `leadflow:admin:login:${email}:${ip}`;
    try {
      const attempts = await redis.incr(key);
      if (attempts === 1) await redis.expire(key, 300); // janela 5 min
      if (attempts > 10) {
        res.setHeader('Retry-After', '60');
        res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente mais tarde.' } });
        return;
      }
    } catch {}
    next();
  };
}

function setCookie(res: express.Response, name: string, value: string, opts?: { maxAgeSec?: number; path?: string }) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: opts?.path ?? '/admin',
    ...(opts?.maxAgeSec ? { maxAge: opts.maxAgeSec * 1000 } : {}),
  } as any);
}

export function adminRoutes(c: Container): Router {
  const r = Router();
  r.use(express.json({ limit: '50kb' }));

  const users = new AdminUserRepository(c.pool);
  const sessions = new AdminSessionRepository(c.pool);
  const audit = new AdminAuditRepository(c.pool);
  const svc = new AdminAuthService(c.pool, users, sessions, audit, c.config, c.logger);
  let jwtReady: Awaited<ReturnType<typeof buildJwtSigner>> | null = null;
  (async () => { await svc.init(); jwtReady = await buildJwtSigner(c.config); })().catch((e) => c.logger.error({ err: e }, 'admin auth init failed'));

  r.post('/auth/login', rateLimitLogin(c.redis), async (req, res, next) => {
    try {
      const body = loginSchema.parse(req.body);
      const out = await svc.loginWithPassword({ ...body, ip: req.ip, userAgent: req.get('user-agent') || undefined });
      // CSRF token (double submit cookie)
      const csrf = randomUUID();
      setCookie(res, 'admin_access', out.access, { maxAgeSec: c.config.ADMIN_ACCESS_TTL_SECONDS });
      setCookie(res, 'admin_refresh', out.refresh_raw, { maxAgeSec: c.config.ADMIN_REFRESH_TTL_DAYS * 24 * 3600 });
      res.cookie('admin_csrf', csrf, { httpOnly: false, sameSite: 'lax', secure: true, path: '/admin' });
      res.status(200).json({ ok: true, roles: out.roles, csrf_token: csrf });
    } catch (e) {
      if ((e as Error).message === 'MFA_REQUIRED') return res.status(412).json({ error: { code: 'MFA_REQUIRED', message: 'MFA TOTP é obrigatório' } });
      if ((e as Error).message === 'UNAUTHORIZED') return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Credenciais inválidas' } });
      return next(e);
    }
  });

  r.post('/auth/logout', (req, res) => {
    res.clearCookie('admin_access', { path: '/admin' });
    res.clearCookie('admin_refresh', { path: '/admin' });
    res.clearCookie('admin_csrf', { path: '/admin' });
    res.status(200).json({ ok: true });
  });

  r.get('/.well-known/jwks.json', async (_req, res, next) => {
    try {
      if (!jwtReady) jwtReady = await buildJwtSigner(c.config);
      res.json(await jwtReady.jwks());
    } catch (e) { next(e); }
  });

  // Middleware JWT para /admin/me e futuras rotas
  async function adminJwt(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const cookies = parseCookies(req);
      const token = cookies['admin_access'];
      if (!token) { res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Token ausente' } }); return; }
      if (!jwtReady) jwtReady = await buildJwtSigner(c.config);
      const verified = await jwtReady.verify(token);
      (req as any).user = { id: verified.payload.sub, roles: (verified.payload as any).roles };
      return next();
    } catch (e) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Token inválido' } });
      return;
    }
  }

  r.get('/me', adminJwt, async (req, res) => {
    const u = (req as any).user;
    return res.json({ id: u.id, roles: u.roles });
  });

  r.post('/auth/refresh', requireCsrf, async (req, res) => {
    try {
      const cookies = parseCookies(req);
      const opaque = cookies['admin_refresh'];
      if (!opaque) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Refresh ausente' } });
      const [sid, secret] = opaque.split('.');
      if (!sid || !secret || sid.length < 10 || secret.length < 32) return res.status(400).json({ error: { code: 'INVALID_BODY', message: 'Refresh inválido' } });
      const sess = await sessions.getById(sid);
      if (!sess || sess.revoked_at || new Date(sess.expires_at) < new Date()) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Refresh inválido' } });
      const ok = await argon2.verify(sess.refresh_token_hash.toString('utf8'), secret);
      if (!ok) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Refresh inválido' } });
      // rotate
      await sessions.revoke(sid);
      const newSid = randomUUID();
      const newSecret = require('node:crypto').randomBytes(32).toString('hex');
      const hash = await argon2.hash(newSecret, { type: argon2.argon2id });
      const expires = new Date(Date.now() + c.config.ADMIN_REFRESH_TTL_DAYS * 24 * 3600 * 1000);
      await sessions.create({ id: newSid, admin_id: sess.admin_id, refresh_token_hash: Buffer.from(hash, 'utf8'), user_agent: req.get('user-agent') || undefined, ip: req.ip, expires_at: expires, revoked_at: null, last_used_at: new Date(), rotated_from: sid });
      if (!jwtReady) jwtReady = await buildJwtSigner(c.config);
      const jti = randomUUID();
      const admin = await users.findById(sess.admin_id);
      const roles = (admin?.roles as any as string[]) || [];
      const access = await jwtReady.sign({ sub: sess.admin_id, aud: c.config.ADMIN_JWT_AUDIENCE, jti, roles, kind: 'access' }, c.config.ADMIN_ACCESS_TTL_SECONDS);
      setCookie(res, 'admin_access', access, { maxAgeSec: c.config.ADMIN_ACCESS_TTL_SECONDS });
      setCookie(res, 'admin_refresh', `${newSid}.${newSecret}`, { maxAgeSec: c.config.ADMIN_REFRESH_TTL_DAYS * 24 * 3600 });
      return res.json({ ok: true });
    } catch (e) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Refresh inválido' } });
    }
  });

  return r;
}

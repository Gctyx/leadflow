import argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import { authenticator } from 'otplib';
import type { Config } from '../config';
import type { Logger } from '../infra/logger';
import type { Pool } from 'mysql2/promise';
import { AdminAuditRepository, AdminSessionRepository, AdminUserRepository } from '../repositories/admin';
import { encryptAtRest } from '../security/crypto-at-rest';
import { buildJwtSigner } from '../security/jwt';

export class AdminAuthService {
  private jwt!: Awaited<ReturnType<typeof buildJwtSigner>>;
  constructor(
    private pool: Pool,
    private users: AdminUserRepository,
    private sessions: AdminSessionRepository,
    private audit: AdminAuditRepository,
    private cfg: Config,
    private log: Logger,
  ) {}

  async init(): Promise<void> {
    this.jwt = await buildJwtSigner(this.cfg);
  }

  async loginWithPassword(input: { email: string; password: string; totp?: string | null; ip?: string; userAgent?: string }) {
    const email = input.email.toLowerCase().trim();
    const u = await this.users.findByEmail(email);
    if (!u || !u.is_active) {
      await this.audit.log({ action: 'admin.login', resource: email, success: false, ip: input.ip, user_agent: input.userAgent });
      throw new Error('UNAUTHORIZED');
    }
    const ok = await argon2.verify(u.password_hash.toString('utf8'), input.password);
    if (!ok) {
      await this.audit.log({ action: 'admin.login', admin_id: u.id, resource: email, success: false, ip: input.ip, user_agent: input.userAgent });
      throw new Error('UNAUTHORIZED');
    }
    // MFA TOTP required
    if (this.cfg.ADMIN_MFA_REQUIRED) {
      if (!input.totp || !u.mfa_totp_secret || !u.mfa_totp_iv) {
        throw new Error('MFA_REQUIRED');
      }
      // decrypt secret
      const tag = u.mfa_totp_secret.subarray(u.mfa_totp_secret.length - 16);
      const enc = u.mfa_totp_secret.subarray(0, u.mfa_totp_secret.length - 16);
      const { decryptAtRest } = await import('../security/crypto-at-rest.js');
      const dec = decryptAtRest(this.cfg.ADMIN_AT_REST_KEY, enc, u.mfa_totp_iv, tag);
      const valid = authenticator.check(input.totp, dec.toString('ascii'));
      if (!valid) throw new Error('UNAUTHORIZED');
    }
    await this.users.markLogin(u.id);
    const jti = randomUUID();
    const roles = u.roles as any as string[];
    const access = await this.jwt.sign({ sub: u.id, aud: this.cfg.ADMIN_JWT_AUDIENCE, jti, roles, kind: 'access' }, this.cfg.ADMIN_ACCESS_TTL_SECONDS);
    // Refresh opaco: token = sessionId.secretHex, DB guarda hash(secretHex)
    const sessionId = randomUUID();
    const secretHex = randomBytes(32).toString('hex');
    const refreshOpaque = `${sessionId}.${secretHex}`;
    const expires = new Date(Date.now() + this.cfg.ADMIN_REFRESH_TTL_DAYS * 24 * 3600 * 1000);
    const hash = await argon2.hash(secretHex, { type: argon2.argon2id });
    await this.sessions.create({ id: sessionId, admin_id: u.id, refresh_token_hash: Buffer.from(hash, 'utf8'), user_agent: input.userAgent, ip: input.ip, expires_at: expires, revoked_at: null, last_used_at: null, rotated_from: null });
    return { access, refresh_raw: refreshOpaque, roles };
  }

  async setupMfa(adminId: string): Promise<{ secret: string; otpauth: string }> {
    const secret = authenticator.generateSecret();
    const label = encodeURIComponent('Leadflow Admin');
    const otpauth = authenticator.keyuri('admin', label, secret);
    // Encrypt and store (caller must persist)
    const r = encryptAtRest(this.cfg.ADMIN_AT_REST_KEY, Buffer.from(secret, 'ascii'));
    const tagged = Buffer.concat([r.enc, r.tag]);
    await this.pool.query('UPDATE admin_users SET mfa_totp_secret=?, mfa_totp_iv=? WHERE id=?', [tagged, r.iv, adminId]);
    return { secret, otpauth };
  }
}

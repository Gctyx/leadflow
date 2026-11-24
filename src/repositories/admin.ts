import type { Pool } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

export interface AdminUser {
  id: string;
  email: string;
  password_hash: Buffer;
  mfa_totp_secret?: Buffer | null;
  mfa_totp_iv?: Buffer | null;
  roles: string[];
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  last_login_at?: Date | null;
}

export class AdminUserRepository {
  constructor(private pool: Pool) {}
  async findByEmail(email: string): Promise<AdminUser | null> {
    const [rows] = await this.pool.query<any[]>('SELECT * FROM admin_users WHERE email=?', [email]);
    return rows[0] ?? null;
  }
  async findById(id: string): Promise<AdminUser | null> {
    const [rows] = await this.pool.query<any[]>('SELECT * FROM admin_users WHERE id=?', [id]);
    return rows[0] ?? null;
  }
  async markLogin(id: string): Promise<void> {
    await this.pool.query('UPDATE admin_users SET last_login_at=NOW(6) WHERE id=?', [id]);
  }
}

export interface AdminSession {
  id: string;
  admin_id: string;
  refresh_token_hash: Buffer;
  user_agent?: string | null;
  ip?: string | null;
  created_at: Date;
  expires_at: Date;
  revoked_at?: Date | null;
  last_used_at?: Date | null;
  rotated_from?: string | null;
}

export class AdminSessionRepository {
  constructor(private pool: Pool) {}
  async create(o: Omit<AdminSession, 'created_at'>): Promise<void> {
    const id = o.id || randomUUID();
    await this.pool.query(
      'INSERT INTO admin_sessions (id, admin_id, refresh_token_hash, user_agent, ip, expires_at, revoked_at, last_used_at, rotated_from) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, o.admin_id, o.refresh_token_hash, o.user_agent ?? null, o.ip ?? null, o.expires_at, o.revoked_at ?? null, o.last_used_at ?? null, o.rotated_from ?? null],
    );
  }
  async revoke(id: string): Promise<void> {
    await this.pool.query('UPDATE admin_sessions SET revoked_at=NOW(6) WHERE id=? AND revoked_at IS NULL', [id]);
  }
  async revokeAllForUser(adminId: string): Promise<void> {
    await this.pool.query('UPDATE admin_sessions SET revoked_at=NOW(6) WHERE admin_id=? AND revoked_at IS NULL', [adminId]);
  }
  async getById(id: string): Promise<AdminSession | null> {
    const [rows] = await this.pool.query<any[]>('SELECT * FROM admin_sessions WHERE id=?', [id]);
    return rows[0] ?? null;
  }
}

export class AdminAuditRepository {
  constructor(private pool: Pool) {}
  async log(entry: { admin_id?: string | null; action: string; resource?: string | null; success: boolean; ip?: string | null; user_agent?: string | null; metadata?: unknown }) {
    await this.pool.query(
      'INSERT INTO admin_audit_log (id, admin_id, action, resource, success, ip, user_agent, metadata) VALUES (UUID(),?,?,?,?,?,?,CAST(? AS JSON))',
      [entry.admin_id ?? null, entry.action, entry.resource ?? null, entry.success ? 1 : 0, entry.ip ?? null, entry.user_agent ?? null, JSON.stringify(entry.metadata ?? null)],
    );
  }
}

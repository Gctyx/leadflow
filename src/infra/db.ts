import mysql, { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export type Db = Pool | PoolConnection;
export type Row = RowDataPacket;
export type { ResultSetHeader };

export function createPool(url: string, connectionLimit: number): Pool {
  const pool = mysql.createPool({
    uri: url,
    connectionLimit,
    waitForConnections: true,
    queueLimit: 0,
    connectTimeout: 5000,
    timezone: 'Z',
    charset: 'utf8mb4',
    enableKeepAlive: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
  });
  // Todas as datas em UTC, independentemente do timezone do servidor MySQL.
  (pool as any).on('connection', (conn: any) => {
    conn.query("SET time_zone = '+00:00'");
  });
  return pool;
}

const code = (e: unknown): string | undefined => (e as { code?: string } | null)?.code;

export function isDupEntry(e: unknown, key?: string): boolean {
  if (code(e) !== 'ER_DUP_ENTRY') return false;
  return !key || String((e as { sqlMessage?: string }).sqlMessage ?? '').includes(key);
}

/** Erros que a própria transação pode repetir com segurança. */
const RETRYABLE_TX = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);
/** Indisponibilidade de infraestrutura => 503 (o cliente/emissor deve tentar de novo). */
const TRANSIENT = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'PROTOCOL_CONNECTION_LOST',
  'ER_CON_COUNT_ERROR', 'ER_SERVER_SHUTDOWN', 'ENOTFOUND', 'EAI_AGAIN',
]);
export const isRetryableTx = (e: unknown) => RETRYABLE_TX.has(code(e) ?? '');
export const isTransient = (e: unknown) => TRANSIENT.has(code(e) ?? '');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Executa `fn` em transação READ COMMITTED.
 *  - READ COMMITTED elimina os gap/next-key locks do REPEATABLE READ, que causavam deadlocks na disputa
 *    pelo vendedor (varredura de índice com FOR UPDATE). Nenhuma regra aqui depende de snapshot repetível:
 *    a unicidade vem das UNIQUE KEYs e as decisões usam leituras travadas (FOR UPDATE).
 *  - Mesmo assim, deadlock / lock wait timeout são esperados sob concorrência (ex.: vários INSERTs da mesma
 *    chave única): a transação inteira é repetida com backoff + jitter.
 */
export async function withTransaction<T>(pool: Pool, fn: (conn: PoolConnection) => Promise<T>, maxRetries = 6): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await conn.beginTransaction();
      const out = await fn(conn);
      await conn.commit();
      return out;
    } catch (err) {
      await conn.rollback().catch(() => undefined);
      if (isRetryableTx(err) && attempt < maxRetries) {
        await sleep(10 * 2 ** attempt + Math.random() * 20);
        continue;
      }
      throw err;
    } finally {
      conn.release();
    }
  }
}
